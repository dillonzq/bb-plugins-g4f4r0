import type { ReactNode } from "react";
import { definePluginApp, type ExperimentalSidebarFooterDisclosureProps } from "@get-bb/plugin-sdk/app";
import type { ServerSnapshot } from "./server";
import { useServerSnapshot } from "./hooks/use-server-snapshot";
import { PressureNotifications, bindStatusOpener } from "./components/pressure-notifications";
import { Skeleton } from "@/components/ui/skeleton";

const BLUE = "#3b82f6";
const ORANGE = "#f97316";
const GREEN = "#22c55e";
const AMBER = "#eab308";
const RED = "#ef4444";
// Compact popover: one stacked column, each metric a small row of the same shape.
const SECTION = "min-w-0 space-y-2 px-4 py-3";
const HISTORY_BARS = 36;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.max(0, Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1));
  const precision = index < 2 ? 0 : index === 2 ? 1 : 2;
  return `${(bytes / 1024 ** index).toFixed(precision)} ${units[index]}`;
}

function formatRate(bytes: number | null): string {
  return bytes === null ? "Sampling…" : `${formatBytes(bytes)}/s`;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatPercent(value: number | null): string {
  return value === null ? "Sampling…" : `${value.toFixed(1)}%`;
}

function colorForPercent(value: number | null): string {
  if (value !== null && value >= 95) return RED;
  if (value !== null && value >= 75) return AMBER;
  return GREEN;
}

function Meter({ value, label }: { value: number | null; label: string }) {
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="relative h-2 min-w-0 w-full overflow-hidden rounded-none bg-foreground/[0.07]" style={{ maskImage: "linear-gradient(to right, black calc(100% - 1px), transparent 0)", maskSize: "2% 100%", maskRepeat: "repeat-x" }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-valuetext={value === null ? "Unavailable" : `${value.toFixed(1)}%`} title="Green below 75% · amber from 75% · red from 95%">
      <span aria-hidden="true" className="absolute inset-y-0 left-0" style={{ width: `${clamped}%`, backgroundColor: colorForPercent(value) }} />
    </div>
  );
}

// Recent samples as thin columns; empty slots stay visible so the strip never jumps.
function Bars({ values, max, color, label }: { values: Array<number | null>; max: number; color: (value: number) => string; label: string }) {
  const recent = values.slice(-HISTORY_BARS);
  const slots = [...Array.from({ length: HISTORY_BARS - recent.length }, () => null), ...recent];
  return (
    <div className="flex h-6 items-end gap-px" role="img" aria-label={label}>
      {slots.map((value, index) => (
        <span key={index} className="flex-1 bg-foreground/[0.07]" style={value === null ? { height: "100%" } : { height: `${Math.max(8, (value / max) * 100)}%`, backgroundColor: color(value) }} />
      ))}
    </div>
  );
}

function Metric({ label, value, detail, children }: { label: string; value: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <section className={SECTION} aria-label={label}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="truncate text-sm font-medium tabular-nums">{value === "Sampling…" ? <Skeleton className="h-4 w-14" aria-label="Loading measurement" /> : value}</span>
      </div>
      {children}
      {detail ? <div className="truncate text-[11px] leading-4 text-muted-foreground">{detail}</div> : null}
    </section>
  );
}

function StatusPopover({ snapshot }: { snapshot: ServerSnapshot }) {
  const { cpu, memory, disk, network, processes, runtime, host, history } = snapshot;
  const peakRate = Math.max(1, ...history.flatMap((point) => [point.networkRxBytesPerSecond ?? 0, point.networkTxBytesPerSecond ?? 0]));
  return (
    <>
      <Metric label="CPU" value={formatPercent(cpu.usagePercent)} detail={`${cpu.cores} cores · load ${cpu.loadAverage.map((load) => load.toFixed(2)).join(" ")}`}>
        <Bars values={history.map((point) => point.cpuPercent)} max={100} color={colorForPercent} label={`CPU history, latest ${formatPercent(cpu.usagePercent)}`} />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-x-3 gap-y-1.5 pt-1">
          {cpu.perCoreUsagePercent.map((value, index) => (
            <div key={index} className="min-w-0 space-y-1">
              <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground"><span>C{index}</span><span>{value === null ? "–" : `${Math.round(value)}%`}</span></div>
              <div className="h-1 bg-foreground/[0.07]"><div className="h-full" style={{ width: `${value ?? 0}%`, backgroundColor: colorForPercent(value) }} /></div>
            </div>
          ))}
        </div>
      </Metric>
      <Metric label="Memory" value={formatPercent(memory.usagePercent)} detail={`${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)}${memory.swapTotalBytes > 0 ? ` · swap ${formatBytes(memory.swapUsedBytes)}` : ""}`}>
        <Meter value={memory.usagePercent} label="Memory usage" />
      </Metric>
      <Metric label="Disk" value={disk ? formatPercent(disk.usagePercent) : "Unavailable"} detail={disk ? `${formatBytes(disk.freeBytes)} available` : undefined}>
        {disk ? <Meter value={disk.usagePercent} label="Disk usage" /> : null}
      </Metric>
      <Metric label="Network" value={network ? `↓ ${formatRate(network.rxBytesPerSecond)}` : "Unavailable"} detail={network ? <span style={{ color: ORANGE }}>↑ {formatRate(network.txBytesPerSecond)}</span> : undefined}>
        {network ? <Bars values={history.map((point) => point.networkRxBytesPerSecond)} max={peakRate} color={() => BLUE} label="Download history" /> : null}
      </Metric>
      <section className={SECTION} aria-label="Processes">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-muted-foreground">Processes</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{processes.available ? `${processes.running} running · ${processes.total}` : "Unavailable"}</span>
        </div>
        {processes.top.slice(0, 3).map((process) => (
          <div key={process.pid} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate" title={`${process.name} · PID ${process.pid}`}>{process.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{process.cpuPercent.toFixed(1)}% · {formatBytes(process.rssBytes)}</span>
          </div>
        ))}
      </section>
      <section className={SECTION} aria-label="Uptime">
        {[
          ["Server uptime", formatDuration(host.uptimeSeconds)],
          ["BB uptime", formatDuration(runtime.processUptimeSeconds)],
          ["BB memory", formatBytes(runtime.rssBytes)],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{value}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function StatusDisclosure(_props: ExperimentalSidebarFooterDisclosureProps) {
  const { container, active, snapshot, error } = useServerSnapshot();
  return (
    <div ref={container} data-beacon-shell className="w-72 max-w-[calc(100vw-2rem)] divide-y divide-border">
      {error ? <div role="alert" className="px-4 py-2 text-xs text-destructive">Could not refresh: {error}</div> : null}
      {/* The skeleton gives the shell height so the visibility observer can activate polling. */}
      {active && snapshot ? <StatusPopover snapshot={snapshot} /> : (
        <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading server metrics">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-4 w-full" />)}
        </div>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "pressure-notifications", component: PressureNotifications });
  bindStatusOpener(app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "status",
    label: "Status",
    icon: "Limitation",
    component: StatusDisclosure,
  }).open);
});
