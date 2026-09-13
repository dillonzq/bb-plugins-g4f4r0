# Beacon for BB

Beacon adds the **Status** page to BB. It shows CPU, memory, disk, network, processes, and runtime details for the machine running the BB server.

The dashboard collects data while you look at it. An optional background monitor checks CPU and memory, records diagnostics, and sends in-app alerts when usage stays high. The two collectors run independently.

Beacon reads system counters. It does not change server settings, enable swap, kill processes, or require an external monitoring service. It does not monitor other enrolled machines or measure resource limits assigned to an individual container.

## Install and configure

From the plugin directory, with BB and npm available:

```sh
npm ci
bb plugin types --check
bb plugin build
bb plugin install .
```

The manifest requires BB 0.43 or newer and Plugin SDK 0.4.87 or newer. Development currently pins SDK 0.4.87. Tests import TypeScript directly and have been verified with Node 24.21.0.

Open **Status** in the sidebar. The installed plugin is named **Beacon**.

| Setting | Default | Effect |
| --- | --- | --- |
| `refreshIntervalSeconds` | `5` | Dashboard sampling interval, an integer from 2 to 60 seconds. |
| `backgroundMonitoring` | `false` | Enables unattended CPU and memory checks and diagnostic logging. |
| `pressureNotifications` | `true` | Allows in-app alerts when background monitoring is enabled. |

Settings are available in BB's plugin settings and through the CLI:

```sh
bb plugin config beacon
bb plugin config beacon set refreshIntervalSeconds 10
bb plugin config beacon set backgroundMonitoring true
bb plugin config beacon set pressureNotifications true
```

Settings take effect without a reload. The dashboard interval does not change the background monitor's 30-second interval.

To keep logging but silence alerts:

```sh
bb plugin config beacon set pressureNotifications false
```

To stop background checks:

```sh
bb plugin config beacon set backgroundMonitoring false
```

Disabling monitoring cancels its timer and current read, clears incident tracking, and leaves existing logs available. A visible dashboard still collects its own data.

## Commands

| Command | Result |
| --- | --- |
| `bb beacon snapshot` | Current CPU, load, memory, disk, and process summary. |
| `bb beacon snapshot --json` | Full snapshot, including recent chart history. |
| `bb beacon health` | Current pressure assessment. Exits with code 2 for a critical result. |
| `bb beacon health --json` | Structured assessment. Read `status` in the JSON; this form returns exit code 0 even for a critical result. |
| `bb beacon logs` | Most recent 100 diagnostic records. |
| `bb beacon logs --limit 500 --json` | Up to 500 records as JSONL, oldest first within the selected records. |
| `bb beacon test-alert` | Sends a labeled notification preview to visible, connected BB clients. |

The test alert requires both monitoring and notifications to be enabled. It uses a separate toast ID and changes no measurements, incident state, logs, or delivery cursors. It generates no artificial CPU or memory load.

CLI snapshots and health checks share the dashboard collector. Repeated calls count as demand and can keep its history alive. Reading logs does not collect a snapshot.

## What the measurements mean

- **CPU usage** is the change in CPU counters between samples. The first sample has no percentage. Per-core percentages follow the same rule.
- **Load averages** cover 1, 5, and 15 minutes. They are not CPU percentages.
- **Memory usage** is total memory minus available memory. On Linux, available memory comes from `MemAvailable` in `/proc/meminfo`. Cache includes `Cached` and `SReclaimable`. Cache and buffers are supporting counters, not extra amounts to add to used memory.
- **Swap** appears only when configured swap is readable and its total is greater than zero. Beacon reports it but does not create or enable it.
- **Disk** describes the root filesystem at `/`. Used space comes from allocated blocks. Available space excludes reserved blocks, so used plus available may not equal total capacity.
- **Network** shows received and sent bytes per second for the non-loopback interface with the largest cumulative traffic count. It is not a sum across interfaces or a guaranteed default-route interface. Rates reset to unavailable when the interface changes or counters reset.
- **Processes** shows six processes sorted by lifetime-average CPU usage, with PID as the tie-breaker. Process CPU is relative to one core and can exceed 100%. It is not the same measurement as sampled host CPU usage.
- **Runtime** describes the BB server process. Its resident memory and heap figures include BB and its loaded plugins, not Beacon alone.

The display uses powers of 1024 for byte units, with labels such as KB and GB. Network values are bytes per second, not bits per second.

Linux provides the detailed memory and network counters. Other platforms use Node's OS counters where available. Network detail is Linux-only. A failed process scan returns `processes.available: false`; the zero counts in that result do not prove that no processes are running. Missing memory detail falls back to free memory and zero cache, buffer, and swap counters.

The process collector runs `ps` with a 1.5-second timeout and a 512 KiB output limit. On Linux it resolves executable names for the six displayed processes through `/proc/<pid>/exe`. It does not read command-line arguments.

## How the dashboard works

1. `app.tsx` registers Status and renders BB-themed cards, meters, charts, and the process table.
2. `useServerSnapshot` checks panel intersection, document visibility, and page lifecycle events. It starts polling only while the panel is visible.
3. The poller calls `metrics_snapshot` through BB's typed RPC client. Requests run one at a time. Late results from a hidden or disposed view are ignored.
4. The server's demand sampler shares one collection across concurrent viewers and CLI calls. Recent results are cached for the configured interval.
5. Hiding the panel drops its snapshot and unmounts its charts. The server releases cached data, history, and counter baselines after its idle grace period.

The grace period is the greater of 15 seconds and twice the configured interval. At the default interval it is 15 seconds; at the maximum it is two minutes. The expiry timer runs once. It does not start another collection.

History contains at most 72 points. Reopening after expiry starts fresh, so CPU and network readings need a second sample. Background logs do not refill chart history. A second visible viewer can keep the shared history alive after you leave the page.

Visible request failures back off from 5 seconds to a maximum of 60 seconds. Hiding the page cancels retries. An RPC already running on the server may finish after the client hides, but its result cannot restore the hidden charts.

### UI conventions

The UI uses vendored shadcn components, BB theme tokens, Recharts, and BB's native Sonner toasts. React and host-provided libraries are shared through BB's plugin build.

Cards use sentence-case titles and shared padding constants. Desktop detail rows use a 1.618-to-1 column split; smaller screens stack the panels. Runtime rows have equal heights. Loading and counter warmup use skeletons.

Each usage meter has 50 square-ended segments representing 2% each. A CSS mask creates the segments from two elements, rather than adding 50 DOM nodes per meter. Chart animation is disabled. CPU and network history keep missing samples as gaps.

Usage meters are green below 75%, amber from 75%, and red from 95%. Network download is blue and upload is orange. These colors do not trigger alerts.

## How background alerts work

The monitor runs as a BB background service. While disabled, it waits without a polling timer or recurring reads. When enabled, it takes an initial sample, then waits 30 seconds after each check finishes. Slow reads never overlap.

On Linux, a check reads `/proc/stat` and `/proc/meminfo`, plus small OS and runtime counters. It does not run `ps`, read disk or network statistics, or retain chart history. Its CPU baseline is separate from the dashboard's baseline.

| Metric | Start an incident | Confirm recovery |
| --- | --- | --- |
| CPU | At least 95% for 60 seconds | At most 85% for 60 seconds |
| Memory | At least 90% for 60 seconds | At most 85% for 60 seconds |

These durations describe consecutive sampled readings, not continuous observation. CPU values are interval averages. A short spike between samples can be missed.

Each metric gets one notification when an incident starts and one when it recovers. After recovery, a five-minute cooldown delays the next incident notification for that metric. An active incident is not repeatedly announced on every check.

Invalid readings and sampling errors break a pending confirmation. A gap longer than 90 seconds or a backwards clock jump also resets confirmation. Active incidents remain active until recovery is confirmed. Persisted state lets them survive plugin reloads without repeating their start notification.

### Delivery and wording

The server commits an incident or recovery before publishing it on BB's `pressure-alert` realtime channel. A global app listener displays the toast even when Status is closed.

The listener has no polling timer. It reads `monitor_status` on mount, reconnect, and return to a visible tab. That response includes current incidents and up to 32 recent transitions from the last five minutes. A new session shows current incidents, not a backlog of resolved alerts.

Two sequence cursors in session storage prevent duplicate CPU and memory messages. Keeping them separate prevents a newer CPU message from hiding a missed memory message. The listener reduces missed transitions to the latest one per metric.

Copy lives in `lib/alert-copy.ts`. Titles include "High CPU usage", "Memory usage back to normal", and "Test notification". Descriptions give the threshold or recovery reading. Peaks and durations stay in the logs. The action is "Open Status". Real alerts last 12 seconds; test previews last 20 seconds.

Beacon currently delivers in-app toasts only. It does not create notification-inbox entries or send browser, mobile, or OS push notifications. BB must be open and visible to display a toast. Enabled server monitoring and logging continue after the browser closes.

### Colors, health, and alerts are separate

The CLI health assessment warns at 85% and becomes critical at 95% for CPU, memory, or disk. It also compares five-minute load with core count, warning at a ratio of 1 and becoming critical at 1.5.

That assessment has no confirmation period. It only evaluates available measurements, so a healthy result with a missing CPU or disk reading is incomplete evidence. Dashboard colors start amber at 75%. Background notifications use the sustained thresholds above. Changing one does not change the others.

## Logs and retention

Beacon stores diagnostics through BB's plugin database API. The database is `plugins/beacon/data.db` beneath BB's data directory. Use the CLI to read or export records instead of editing the live database.

Records include:

- `summary`, written on the first successful sample and about once a minute afterward. It includes sampled CPU and memory peaks, available memory, load, BB runtime memory, and counter-read duration.
- `incident` and `recovery`, with the metric, threshold, recorded value, peak, and duration.
- `error`, with a short failure category. Repeated failures are logged at most once every five minutes.
- `monitor_disabled`, recorded when an open diagnostics store is available at disable time.

`sampleDurationMs` covers counter collection and monitor preparation, including initial database setup. It excludes saving that summary and delivering notifications. Runtime memory values measure the whole BB process. Neither field is a complete measurement of Beacon's overhead.

The database keeps 4,096 rotating log slots. Each record's JSON payload is limited to 1 KiB. It also stores two current notices and the small CPU/memory state. State and transition writes share a transaction. Current notices survive after their original log entries rotate out.

The main database is capped at 10 MiB and uses a 256 KiB page-cache target. Its write-ahead log checkpoints every 64 pages and has a 1 MiB retention target. That target is not a hard total disk limit; the write-ahead log can grow past it while a checkpoint is blocked.

At one summary per minute, 4,096 slots cover about 2.8 days. Incidents and errors shorten that window. History rotates by record count, not by age. No process arguments, hostnames, credentials, or full snapshots are included in these diagnostic records.

Export recent diagnostics to a new file:

```sh
bb beacon logs --limit 500 --json > beacon-diagnostics.jsonl
```

This exports only the selected recent records, not all 4,096 slots. The shell command replaces the destination if it already exists. JSONL has one JSON object per line.

For plugin startup and runtime warnings, use BB's separate plugin log:

```sh
bb plugin logs beacon -n 50
```

Loaded code and database handles still have a baseline memory cost. Stopping timers and releasing references does not promise an immediate drop in process RSS; the JavaScript runtime controls memory reclamation.

## Code map

| File | Responsibility |
| --- | --- |
| [server.ts](server.ts) | Settings, Zod contracts, system readers, health assessment, RPC and CLI registration, lifecycle cleanup. |
| [app.tsx](app.tsx) | Status registration, dashboard layout, formatting, charts, meters, and skeletons. |
| [hooks/use-server-snapshot.ts](hooks/use-server-snapshot.ts) | Visibility detection and React snapshot state. |
| [lib/visible-poller.ts](lib/visible-poller.ts) | Serialized client requests, backoff, and stale-response protection. |
| [lib/demand-sampler.ts](lib/demand-sampler.ts) | Shared server collection, cache, and idle expiry. |
| [lib/pressure.ts](lib/pressure.ts) | Pure incident state machine, metric names, thresholds, and timing constants. |
| [lib/pressure-monitor.ts](lib/pressure-monitor.ts) | Background loop, summaries, persistence, and event publication. |
| [lib/monitor-store.ts](lib/monitor-store.ts) | SQLite migrations, rotating records, current notices, and state reads. |
| [lib/alert-receiver.ts](lib/alert-receiver.ts) | Notice validation, per-metric cursors, and reconnect deduplication. |
| [lib/alert-copy.ts](lib/alert-copy.ts) | Production and test notification wording. |
| [components/pressure-notifications.tsx](components/pressure-notifications.tsx) | Global realtime listener, native toasts, and Status navigation. |
| [skills/beacon/SKILL.md](skills/beacon/SKILL.md) | Instructions and command reference exposed to agents. |

## Extend Beacon

### Add a dashboard measurement

1. Add the field to `snapshotSchema` in `server.ts`. `ServerSnapshot` is inferred from that schema. Use `null` for an unavailable reading rather than inventing a zero.
2. Add its reader to `collect`. Keep platform checks, timeouts, and output limits close to the read. Pass the abort signal to APIs that support it. Do not start a timer inside a reader.
3. If it uses counter deltas, keep a baseline and clear it in the demand sampler's `reset` callback. Reject counter resets and invalid elapsed time.
4. If it needs a chart, update the history schema and collected points. Keep the 72-point limit. Do not store full snapshots in history.
5. Render it in `app.tsx` with the existing card, formatting, and loading conventions. Preserve `min-w-0`, table width limits, and mobile stacking.
6. Add parsing and lifecycle tests. Cover missing data, platform fallback, idle expiry, and late results after disposal.

A new dashboard field does not belong in the background monitor by default. Add it there only if unattended alerting needs it and the read is cheap enough to run while nobody is watching.

### Change notification copy

Edit `lib/alert-copy.ts` and update `tests/alert-copy.test.mjs`. Keep the title short and the description useful without the logs. Avoid calling a recorded recovery value "current" because reconnect delivery can happen later.

Use the existing toast component and "Open Status" action. Do not add a second notification renderer or polling loop. Keep previews separate from real incident state and cursors.

### Change thresholds or timing

Edit `LIMITS`, `HOLD_MS`, `COOLDOWN_MS`, or `MONITOR_INTERVAL_MS` in `lib/pressure.ts`. Update the state-machine tests and this README.

Other durations are currently explicit values elsewhere. The monitor uses a one-minute summary interval, a 90-second status freshness window, and a five-minute recent-alert window. Review those when changing timing, especially the one-minute wording in `lib/alert-copy.ts`.

Changing dashboard colors requires `colorForPercent` in `app.tsx`. Changing CLI health thresholds requires `assessHealth` in `server.ts`. Keep those choices explicit.

### Add another alert metric

Alert handling currently assumes exactly CPU and memory. Adding a third metric requires coordinated changes, not just another threshold:

1. Extend `Metric`, `PressureState`, initialization, validation, and iteration in `lib/pressure.ts`.
2. Add a lightweight reading to the background collector and `LightSample`. Update summaries, peak tracking, and failure handling.
3. Update `monitor_status` and its schema in `server.ts`, including enum values and array bounds.
4. Update notice validation and per-metric cursors in `lib/alert-receiver.ts`. Plan a session-storage cursor version change if the saved shape changes.
5. Update the metric filters and bounds in `lib/monitor-store.ts`. Handle older persisted state without discarding existing active incidents by accident.
6. Add copy, toast cleanup, tests, and command documentation for the new metric.

Use one shared metric list if this grows beyond two metrics. Today several fixed lists and bounds make CPU/memory behavior small and easy to test, but they must stay in sync.

### Extend storage, settings, or commands

Append database migrations in `lib/monitor-store.ts`. Never reorder or rewrite an applied migration. Keep state and related log writes atomic. Test rollback and reopen behavior with the SDK's real SQLite test storage.

New log fields must fit the 1 KiB payload limit. Keep CLI exports below `PLUGIN_CLI_OUTPUT_MAX_BYTES`. Do not add unbounded queues, raw process arguments, secrets, or a write on every dashboard refresh.

Declare settings through `bb.settings.define`, provide defaults, and validate freeform values. Handle changes in the existing `onChange` callback so users do not need a reload. Background work must stop on disable and disposal.

For a CLI command, update its parser, usage text, registered command list, tests, and `skills/beacon/SKILL.md`. Reject invalid arguments before collecting data or sending a notification. Keep command output bounded.

## Develop and verify

Run these commands from the plugin directory:

```sh
bb plugin types --check
npm test
npm run typecheck
bb plugin build
bb plugin reload beacon
```

`types --check` reports an SDK mismatch without changing files. If you intend to move to the host's SDK version, run `bb plugin types`, review the dependency changes, then run `npm install` and repeat the checks.

After the plugin is installed, `bb plugin dev` provides a watch/build/reload loop. BB owns the React runtime, RPC transport, realtime connection, and toast renderer. Do not import private BB packages or bundle another React runtime.

Tests cover these areas:

- `tests/server.test.mjs` checks parsing, counter resets, shared snapshots, settings, and reloads.
- `tests/lifecycle.test.mjs` checks single-flight collection, idle expiry, hide/show races, disposal, and retry backoff.
- `tests/monitor.test.mjs` checks sustained pressure, recovery, cooldowns, failures, persistence, log bounds, deduplication, and the test-alert command.
- `tests/alert-copy.test.mjs` checks CPU, memory, recovery, and preview wording.

For a UI or lifecycle change, also check BB in a browser:

1. Open Status and wait for two samples. Check the skeletons before the second reading arrives.
2. Test a narrow viewport, including 390px. Check horizontal overflow, process names, and Runtime row alignment.
3. Switch away from Status and hide the browser tab. Confirm dashboard RPCs stop and resume without duplicate requests.
4. Test notifications with browser-local fixtures or the explicit `test-alert` command. Do not create real overload on a live server. The command broadcasts to other connected clients too.
5. Reload while work is pending. Check that the old collector cannot publish stale results or leave a timer running.

## Troubleshooting

**Charts restarted or show skeletons.** History expires when there is no demand. CPU and network deltas need a second reading. The persistent logs are separate from chart history.

**Memory is amber but there is no alert.** Amber begins at 75%. Memory alerts require at least 90% across a full minute of samples.

**An alert did not appear.** Check both settings, keep BB visible, and try `bb beacon test-alert`. Real alerts also depend on confirmation time and cooldown. Tests are ephemeral and are not replayed after reconnecting. There is no OS push delivery.

**Logs are empty.** Monitoring is off by default. Enable it and allow an initial sample. Use `bb plugin logs beacon -n 50` to check for collection or storage failures. Opening Status alone does not create diagnostic records.

**Network says unavailable.** Detailed network collection requires Linux and a readable non-loopback interface. A new or changed interface needs two samples before it has a rate.

**A process shows more than 100% CPU.** That process may use multiple cores. Its value is also a lifetime average, not the dashboard's sampled host percentage.

**A change is not visible.** Run the type check, build, and `bb plugin reload beacon`. Confirm the reload succeeded. BB can keep the previous plugin running if a replacement fails to load.
