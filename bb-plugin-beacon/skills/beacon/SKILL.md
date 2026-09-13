---
name: beacon
description: Inspect the BB server's CPU, memory, disk, uptime, runtime, and health with the `bb beacon` CLI. Use when the user asks about server load, capacity, resource pressure, or whether the BB server is healthy.
---

# Beacon

Read current resource statistics from the machine running the BB server.

## Commands

| Command | Effect |
| --- | --- |
| `bb beacon snapshot` | Show concise CPU, load, memory, disk, and process statistics. |
| `bb beacon snapshot --json` | Return the complete snapshot and recent metric history as JSON. |
| `bb beacon health` | Show the current health assessment and any pressure signals. |
| `bb beacon health --json` | Return the health assessment as JSON. |
| `bb beacon logs [--limit 1..500] [--json]` | Read recent bounded diagnostics; JSON output is JSONL, oldest first within the selected records. |
| `bb beacon test-alert` | On explicit request, broadcast a labeled in-app preview to visible BB clients. Requires monitoring and notifications enabled; no real load or incident is generated. |

## Procedure

1. Use `bb beacon health` for a quick health question.
2. Use `bb beacon snapshot` when the user wants actual resource figures.
3. Add `--json` only when structured output helps a calculation or comparison.
4. State that these metrics describe the BB server host, not an enrolled remote machine.
5. Treat a one-off spike as a point-in-time observation. Use the dashboard history before calling it sustained pressure.

## Interpretation

- Healthy means no built-in pressure threshold is currently crossed.
- Warning begins at 85% for CPU, memory, or disk.
- Critical begins at 95%.
- The five-minute system load is also compared with the number of CPU cores.
- A missing disk reading means the root filesystem statistic is unavailable; it does not imply zero disk usage.
- Network rates need two samples; `null` on the first sample means sampling, not zero traffic.
- CPU utilization also needs two samples. After idle expiry, a one-off CLI read may return `null`; do not interpret it as zero CPU use or complete evidence of health.
- Sampling is demand-driven. History is capped at 72 points and expires after `max(15 seconds, 2 × refresh interval)` with no reads. The dashboard does not collect unattended history.
- Optional `backgroundMonitoring` enables separate lightweight CPU/memory checks every 30 seconds and persistent one-minute diagnostic summaries. `pressureNotifications` controls native in-app alerts. Disable background monitoring to stop idle checks entirely.
- Alerts require 60 seconds at CPU >=95% or memory >=90%, recover after 60 seconds <=85%, and use a five-minute cooldown. They are separate from instantaneous CLI health thresholds. CPU peaks are sampled interval averages, not guaranteed instantaneous maxima.
- Diagnostic logs retain at most 4,096 records of 1 KiB each in BB-managed storage, with a 10 MiB main DB cap. Export recent records with `bb beacon logs --limit 500 --json > beacon-diagnostics.jsonl`. Older records are overwritten, not retained indefinitely.
- In-app alerts work across BB pages and reconcile on reconnect/visibility changes; no native push API is exposed by the current SDK. BB must be open for delivery.
- Missing process information has `processes.available: false`; zero counts in that case do not mean there are no processes.
- Process CPU is the operating system's lifetime average for that process, while dashboard CPU utilization is sampled between refreshes.
