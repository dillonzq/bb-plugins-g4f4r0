---
name: beacon
description: Read CPU, memory, disk, network, process, and uptime pressure on the BB server host. Use when the user asks how loaded the server is, whether Beacon is alerting, or to inspect recent diagnostics.
---

# Beacon

Beacon watches the machine running the BB server. It does not watch other enrolled machines, containers, or the user's laptop unless that laptop is the server.

Prefer the CLI in this session. Status in the sidebar footer is the interactive view.

## Commands

```
bb beacon snapshot
bb beacon snapshot --json
bb beacon health
bb beacon health --json
bb beacon logs
bb beacon logs --limit 500 --json
bb beacon test-alert
```

`snapshot` is the current reading. `--json` includes recent chart history. Repeated snapshot calls keep that history alive.

`health` prints the pressure assessment. The text form exits 2 when status is critical. The JSON form always exits 0; read `status`.

`logs` reads Beacon's own rotating diagnostics, not `bb plugin logs`. Default 100 records. `--json` writes JSONL, oldest first within the selected records. Max `--limit` is 500.

`test-alert` sends a labeled preview toast to visible BB clients. It needs `backgroundMonitoring` and `pressureNotifications` both true. It does not create load, incidents, or log rows.

## Settings

```
bb plugin config beacon
bb plugin config beacon set refreshIntervalSeconds 10
bb plugin config beacon set backgroundMonitoring true
bb plugin config beacon set pressureNotifications false
```

`refreshIntervalSeconds` is 2 to 60 and only affects the visible dashboard. The background monitor stays on a 30-second interval.

Monitoring is off by default. Disabling it cancels the timer and leaves existing logs in place.

## How to read the numbers

CPU percent is the change between samples. The first reading has no percent.

Memory used is total minus available. On Linux that is `MemAvailable`. Cache and buffers are supporting counters, not extra used memory.

Disk is the root filesystem at `/`. Used plus available may not equal total because of reserved blocks.

Network is Linux-only. It is the non-loopback interface with the most cumulative traffic, not a sum of interfaces.

Process CPU is a lifetime average on one core and can exceed 100%. It is not the dashboard's sampled host CPU.

Dashboard amber starts at 75%. CLI health warns at 85% and is critical at 95%. Background alerts need about 60 seconds at 95% CPU or 90% memory. Those three scales do not follow each other.

Toasts appear only in an open, visible BB client. There is no OS push.

Do not cause real overload to test alerts. Use `bb beacon test-alert`.
