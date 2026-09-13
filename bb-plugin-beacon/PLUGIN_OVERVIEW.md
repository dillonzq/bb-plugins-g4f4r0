See what the machine behind BB is doing without leaving your workspace.

## Live server dashboard

Beacon tracks aggregate and per-core CPU, load windows, detailed memory composition, swap, disk capacity, network throughput, top processes, host uptime, and the BB server process itself. A dense mix of area charts, pressure bars, composition blocks, and process rows makes spikes and sustained pressure easy to distinguish.

The dashboard refreshes automatically, follows your BB theme, and lives under **Status** in the sidebar. Usage colors convey pressure without health badges or status banners.

Detailed sampling runs only on demand. Hidden dashboards stop polling and release their charts; chart history expires after a short idle grace. Optional lightweight background monitoring checks CPU and memory every 30 seconds, sends native in-app overload/recovery alerts, and retains bounded diagnostic logs without process scans or chart history.

## Built-in health checks

CPU, memory, and disk usage raise a warning at 85% and become critical at 95%. Five-minute system load is evaluated relative to the host's CPU core count. Any active signal is explained in plain language instead of hidden behind a score.

## Terminal and agent friendly

Use `bb beacon snapshot` for a concise readout or add `--json` for the full structured snapshot and recent history. `bb beacon health` returns only the health assessment. A bundled skill teaches agents when and how to use both commands.

## Private and read-only

All sampling happens on the BB server host. Metrics stay inside BB, history is memory-only, and the plugin makes no external requests. It needs no account, API key, privileged access, or third-party monitoring service.

Beacon monitors the BB server host itself. It does not inspect separate enrolled machines, containers, or application-specific services.
