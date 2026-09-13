import { useId, type ReactNode } from "react";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { ServerSnapshot } from "./server";
import { useServerSnapshot } from "./hooks/use-server-snapshot";
import { PressureNotifications } from "./components/pressure-notifications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const BLUE = "#3b82f6";
const ORANGE = "#f97316";
const GREEN = "#22c55e";
const AMBER = "#eab308";
const RED = "#ef4444";
const chartTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// One surface and spacing rhythm; desktop columns share a golden-ratio split.
const PANEL = "flex h-full min-w-0 flex-col overflow-hidden rounded-xl border-border bg-card shadow-none";
const PANEL_HEADER = "p-4 pb-3 sm:p-5 sm:pb-3";
const PANEL_CONTENT = "p-4 pt-0 sm:p-5 sm:pt-0";
const DETAIL_ROW = "grid min-w-0 items-stretch gap-4 lg:min-h-80 lg:grid-cols-[minmax(0,1.618fr)_minmax(0,1fr)]";
const OVERVIEW_ROW = "grid min-w-0 grid-cols-2 items-stretch gap-3 sm:gap-4 xl:grid-cols-4";
const DASHBOARD = "mx-auto box-border min-w-0 w-full max-w-[1440px] space-y-4 p-3 pb-8 sm:p-5 sm:pb-8";

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

function Meter({ value, label, compact = false }: { value: number | null; label: string; compact?: boolean }) {
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className={cn("relative min-w-0 w-full shrink-0 overflow-hidden rounded-none bg-foreground/[0.07]", compact ? "h-3" : "h-7")} style={{ maskImage: "linear-gradient(to right, black calc(100% - 1px), transparent 0)", maskSize: "2% 100%", maskRepeat: "repeat-x" }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-valuetext={value === null ? "Unavailable" : `${value.toFixed(1)}%, each segment represents 2%`} title="Each segment = 2% · green below 75% · amber from 75% · red from 95%">
      <span aria-hidden="true" className="absolute inset-y-0 left-0" style={{ width: `${clamped}%`, backgroundColor: colorForPercent(value) }} />
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  percentage,
  visualization,
}: {
  label: string;
  value: string;
  detail: ReactNode;
  percentage?: number | null;
  visualization?: ReactNode;
}) {
  return (
    <Card className={PANEL}>
      <CardHeader className="p-4 pb-2 sm:p-5 sm:pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className={cn(PANEL_CONTENT, "flex flex-1 flex-col")}>
        <div className="truncate text-xl font-medium leading-8 tracking-tight tabular-nums sm:text-2xl" title={value === "Sampling…" ? undefined : value}>
          {value === "Sampling…" ? <Skeleton className="h-8 w-24" aria-label="Loading measurement" /> : value}
        </div>
        <div className="mt-4 flex h-7 items-center">
          {percentage === undefined ? visualization : <Meter value={percentage} label={`${label} usage`} />}
        </div>
        <div className="mt-3 min-h-4 text-[11px] leading-4 text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || payload.length === 0) return null;
  return (
    <div className="min-w-36 rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-xl">
      <p className="mb-1.5 text-muted-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 capitalize">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
            {entry.name}
          </span>
          <span className="font-mono tabular-nums">
            {typeof entry.value === "number"
              ? entry.dataKey === "receive" || entry.dataKey === "send"
                ? formatRate(entry.value)
                : `${entry.value.toFixed(1)}%`
              : "Unavailable"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChartFrame({
  title,
  value,
  subtitle,
  children,
}: {
  title: string;
  value: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className={PANEL}>
      <CardHeader className={cn(PANEL_HEADER, "flex-row flex-wrap items-start justify-between gap-3 space-y-0")}>
        <div className="min-w-0">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {subtitle ? <div className="mt-1 text-xs text-muted-foreground" title={typeof subtitle === "string" ? subtitle : undefined}>{subtitle}</div> : null}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{value.includes("Sampling") ? <Skeleton className="h-4 w-16" aria-label="Loading measurement" /> : value}</span>
      </CardHeader>
      <CardContent className={cn(PANEL_CONTENT, "flex min-h-60 flex-1 flex-col")}>
        <div className="relative min-h-56 flex-1"><div className="absolute inset-0">{children}</div></div>
      </CardContent>
    </Card>
  );
}

function PercentChart({
  title,
  values,
  current,
  subtitle,
}: {
  title: string;
  values: Array<{ timestamp: number; value: number | null }>;
  current: number | null;
  subtitle?: string;
}) {
  const color = colorForPercent(current);
  const gradientId = `cpu-${useId().replaceAll(":", "")}`;
  const data = values.map(({ timestamp, value }) => ({
    time: chartTimeFormatter.format(timestamp),
    value,
  }));
  return (
    <ChartFrame title={title} value={formatPercent(current)} subtitle={subtitle}>
      <div className="h-full min-w-0 w-full overflow-hidden" role="img" aria-label={`${title}, latest ${formatPercent(current)}`}>
        {values.filter((point) => point.value !== null).length < 2 ? (
          <Skeleton className="h-full w-full rounded-none" aria-label="Loading CPU history" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart accessibilityLayer data={data} margin={{ left: 2, right: 8, top: 12, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="time" tickLine={false} axisLine={false} tickMargin={8} minTickGap={34} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tickMargin={4} width={34} tickFormatter={(value: number) => `${value}%`} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
              <Tooltip cursor={{ stroke: "var(--border)" }} content={(props) => <ChartTooltip {...props} />} />
              <Area name="usage" dataKey="value" type="monotone" fill={`url(#${gradientId})`} stroke={color} strokeWidth={1.8} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartFrame>
  );
}

function NetworkChart({ snapshot }: { snapshot: ServerSnapshot }) {
  const gradientId = `network-${useId().replaceAll(":", "")}`;
  const data = snapshot.history.map((point) => ({
    time: chartTimeFormatter.format(point.timestamp),
    receive: point.networkRxBytesPerSecond,
    send: point.networkTxBytesPerSecond,
  }));
  const peak = Math.max(1, ...data.flatMap((point) => [point.receive ?? 0, point.send ?? 0]));
  return (
    <ChartFrame
      title="Network throughput"
      value={snapshot.network ? `↓ ${formatRate(snapshot.network.rxBytesPerSecond)}` : "Unavailable"}
      subtitle={snapshot.network ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span className="inline-flex items-center gap-1.5"><span className="size-1.5" style={{ backgroundColor: BLUE }} />Download</span><span className="inline-flex items-center gap-1.5"><span className="size-1.5" style={{ backgroundColor: ORANGE }} />Upload</span></div> : "Network counters unavailable"}
    >
      <div className="h-full min-w-0 w-full overflow-hidden" role="img" aria-label="Network receive and send throughput">
        {snapshot.network === null ? <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Network counters unavailable</div> : data.filter((point) => point.receive !== null || point.send !== null).length < 2 ? (
          <Skeleton className="h-full w-full rounded-none" aria-label="Loading network history" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart accessibilityLayer data={data} margin={{ left: 2, right: 8, top: 12, bottom: 0 }}>
              <defs>
                <linearGradient id={`${gradientId}-receive`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={BLUE} stopOpacity={0.3} /><stop offset="95%" stopColor={BLUE} stopOpacity={0.01} /></linearGradient>
                <linearGradient id={`${gradientId}-send`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={ORANGE} stopOpacity={0.24} /><stop offset="95%" stopColor={ORANGE} stopOpacity={0.01} /></linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="time" tickLine={false} axisLine={false} tickMargin={8} minTickGap={34} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
              <YAxis domain={[0, peak]} tickLine={false} axisLine={false} tickMargin={4} width={62} tickFormatter={(value: number) => formatRate(value)} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
              <Tooltip cursor={{ stroke: "var(--border)" }} content={(props) => <ChartTooltip {...props} />} />
              <Area name="Download" dataKey="receive" type="monotone" fill={`url(#${gradientId}-receive)`} stroke={BLUE} strokeWidth={1.7} isAnimationActive={false} />
              <Area name="Upload" dataKey="send" type="monotone" fill={`url(#${gradientId}-send)`} stroke={ORANGE} strokeWidth={1.7} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartFrame>
  );
}

function LoadPanel({ snapshot }: { snapshot: ServerSnapshot }) {
  const labels = ["1 min", "5 min", "15 min"];
  return (
    <Card className={PANEL}>
      <CardHeader className={PANEL_HEADER}>
        <CardTitle className="text-sm font-medium">CPU detail</CardTitle>
        <p className="truncate text-xs text-muted-foreground" title={snapshot.cpu.model}>{snapshot.cpu.model}</p>
      </CardHeader>
      <CardContent className={cn(PANEL_CONTENT, "flex flex-1 flex-col gap-4")}>
        <div className="grid grid-cols-3 gap-2">
          {snapshot.cpu.loadAverage.map((load, index) => {
            const normalized = Math.min(100, (load / snapshot.cpu.cores) * 100);
            return (
              <div key={labels[index]} className="min-w-0 py-2">
                <div className="text-[10px] text-muted-foreground">{labels[index]}</div>
                <div className="mt-1 text-base font-semibold tabular-nums">{load.toFixed(2)}</div>
                <div className="mt-2 h-0.5 bg-foreground/[0.07]"><div className="h-full" style={{ width: `${normalized}%`, backgroundColor: colorForPercent(normalized) }} /></div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Per-core utilization</span>
            {snapshot.cpu.speedMHz > 0 ? <span className="tabular-nums">{(snapshot.cpu.speedMHz / 1000).toFixed(2)} GHz</span> : null}
          </div>
          <div className="grid max-h-60 grid-cols-1 gap-y-3 overflow-y-auto">
            {snapshot.cpu.perCoreUsagePercent.map((value, index) => (
              <div key={index} className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_3rem] items-center gap-2">
                <span className="text-[10px] text-muted-foreground">C{index}</span>
                <Meter value={value} label={`Core ${index} usage`} compact />
                <span className="text-right text-[10px] tabular-nums text-muted-foreground">{value === null ? <Skeleton className="ml-auto h-2.5 w-7" aria-label="Loading core usage" /> : formatPercent(value)}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MemoryPanel({ snapshot }: { snapshot: ServerSnapshot }) {
  const memory = snapshot.memory;
  const swapPercent = memory.swapTotalBytes === 0 ? null : (memory.swapUsedBytes / memory.swapTotalBytes) * 100;
  return (
    <Card className={PANEL}>
      <CardHeader className={cn(PANEL_HEADER, "flex-row items-center justify-between gap-3 space-y-0")}>
        <CardTitle className="text-sm font-medium">Memory composition</CardTitle>
        <span className="text-sm font-semibold tabular-nums">{formatPercent(memory.usagePercent)}</span>
      </CardHeader>
      <CardContent className={cn(PANEL_CONTENT, "flex flex-1 flex-col gap-4")}>
        <Meter value={memory.usagePercent} label="Memory usage" />
        <div className="grid flex-1 grid-cols-2 content-center gap-x-4 gap-y-4">
          {[
            ["Used", formatBytes(memory.usedBytes)],
            ["Available", formatBytes(memory.availableBytes)],
            ["Cache", formatBytes(memory.cachedBytes)],
            ["Buffers", formatBytes(memory.buffersBytes)],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <div className="text-[10px] text-muted-foreground">{label}</div>
              <div className="mt-1 truncate text-sm font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
        {swapPercent !== null ? <div className="border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">Swap</span>
            <span className="truncate tabular-nums">{formatBytes(memory.swapUsedBytes)} of {formatBytes(memory.swapTotalBytes)}</span>
          </div>
          <Meter value={swapPercent} label="Swap usage" compact />
        </div> : null}
      </CardContent>
    </Card>
  );
}

function ProcessPanel({ snapshot }: { snapshot: ServerSnapshot }) {
  return (
    <Card className={PANEL}>
      <CardHeader className={cn(PANEL_HEADER, "flex-row flex-wrap items-baseline justify-between gap-3 space-y-0")}>
        <CardTitle className="text-sm font-medium">Processes</CardTitle>
        <span className="text-xs text-muted-foreground">{snapshot.processes.available ? `${snapshot.processes.running} running · ${snapshot.processes.total} total` : "Unavailable"}</span>
      </CardHeader>
      <CardContent className={PANEL_CONTENT}>
        <table data-beacon-processes className="w-full table-fixed border-collapse text-xs text-foreground">
          <caption className="sr-only">Up to six processes with the highest lifetime average CPU usage. CPU percentages are relative to one core.</caption>
          <colgroup>
            <col className="w-[35%] sm:w-[43%]" />
            <col className="w-[20%] sm:w-[17%]" />
            <col className="w-[20%] sm:w-[17%]" />
            <col className="w-[25%] sm:w-[23%]" />
          </colgroup>
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th scope="col" className="h-9 pr-2 text-left align-middle font-medium">Process</th>
              <th scope="col" className="h-9 pl-1 text-right align-middle font-medium" title="Lifetime average; 100% equals one CPU core">CPU avg</th>
              <th scope="col" className="h-9 pl-1 text-right align-middle font-medium">Memory</th>
              <th scope="col" className="h-9 pl-1 text-right align-middle font-medium" title="Resident memory in bytes">Resident</th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {snapshot.processes.top.length === 0 ? (
              <tr><td colSpan={4} className="h-24 text-center text-muted-foreground">Process detail unavailable</td></tr>
            ) : snapshot.processes.top.map((process) => (
              <tr key={process.pid} className="border-b border-border transition-colors hover:bg-muted/50">
                <th scope="row" className="py-3 pr-2 text-left align-middle font-normal">
                  <div className="truncate font-medium" title={process.name}>{process.name}</div>
                  <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">PID {process.pid}</div>
                </th>
                <td className="py-3 pl-1 text-right align-middle tabular-nums">{process.cpuPercent.toFixed(1)}%</td>
                <td className="py-3 pl-1 text-right align-middle tabular-nums">{process.memoryPercent.toFixed(1)}%</td>
                <td className="py-3 pl-1 text-right align-middle tabular-nums">{formatBytes(process.rssBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 min-w-0 items-center justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 max-w-[68%] break-words text-right text-xs font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function RuntimePanel({ snapshot }: { snapshot: ServerSnapshot }) {
  return (
    <Card className={PANEL}>
      <CardHeader className={PANEL_HEADER}><CardTitle className="text-sm font-medium">Runtime</CardTitle></CardHeader>
      <CardContent className={cn(PANEL_CONTENT, "flex flex-1 flex-col pb-1 sm:pb-1")}>
        <dl data-beacon-runtime className="grid flex-1 grid-rows-[repeat(8,minmax(2.5rem,1fr))] divide-y divide-border">
          <DetailRow label="Host uptime">{formatDuration(snapshot.host.uptimeSeconds)}</DetailRow>
          <DetailRow label="BB uptime">{formatDuration(snapshot.runtime.processUptimeSeconds)}</DetailRow>
          <DetailRow label="Node">{snapshot.runtime.nodeVersion}</DetailRow>
          <DetailRow label="Process ID">{snapshot.runtime.pid}</DetailRow>
          <DetailRow label="Resident memory">{formatBytes(snapshot.runtime.rssBytes)}</DetailRow>
          <DetailRow label="Heap">{formatBytes(snapshot.runtime.heapUsedBytes)} / {formatBytes(snapshot.runtime.heapTotalBytes)}</DetailRow>
          <DetailRow label="External">{formatBytes(snapshot.runtime.externalBytes)}</DetailRow>
          <DetailRow label="System">{snapshot.host.platform} {snapshot.host.arch}</DetailRow>
        </dl>
      </CardContent>
    </Card>
  );
}

function SkeletonPanel({ kind }: { kind: "chart" | "cores" | "memory" | "processes" | "runtime" }) {
  return (
    <Card className={PANEL}>
      <CardHeader className={PANEL_HEADER}>
        <Skeleton className="h-3.5 w-28" />
        {kind === "chart" || kind === "cores" ? <Skeleton className="h-4 w-44 max-w-full" /> : null}
      </CardHeader>
      <CardContent className={cn(PANEL_CONTENT, "flex flex-1 flex-col", kind === "runtime" && "pb-1 sm:pb-1")}>
        {kind === "chart" ? <Skeleton className="min-h-56 w-full flex-1 rounded-none" /> : null}
        {kind === "cores" ? <div className="flex flex-1 flex-col gap-4">
          <div className="grid grid-cols-3 gap-4 py-2">{Array.from({ length: 3 }, (_, i) => <div key={i} className="space-y-2"><Skeleton className="h-2.5 w-8" /><Skeleton className="h-5 w-10" /><Skeleton className="h-0.5 w-full rounded-none" /></div>)}</div>
          <div className="space-y-3 border-t border-border pt-4"><Skeleton className="h-3 w-32" />{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-3 w-full rounded-none" />)}</div>
        </div> : null}
        {kind === "memory" ? <div className="flex flex-1 flex-col gap-4">
          <Skeleton className="h-7 w-full shrink-0 rounded-none" />
          <div className="grid flex-1 grid-cols-2 content-center gap-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="space-y-2"><Skeleton className="h-2.5 w-14" /><Skeleton className="h-4 w-20 max-w-full" /></div>)}</div>
        </div> : null}
        {kind === "processes" ? <>
          <div className="grid h-9 grid-cols-[2fr_1fr_1fr_1fr] items-center gap-4 border-b border-border">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-3 w-full max-w-16" />)}</div>
          <div className="divide-y divide-border">{Array.from({ length: 6 }, (_, i) => <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-4 py-3"><div className="space-y-1"><Skeleton className="h-3 w-20 max-w-full" /><Skeleton className="h-2.5 w-14 max-w-full" /></div>{Array.from({ length: 3 }, (_, j) => <Skeleton key={j} className="h-3 w-full max-w-12 justify-self-end" />)}</div>)}</div>
        </> : null}
        {kind === "runtime" ? <div className="grid flex-1 grid-rows-[repeat(8,minmax(2.5rem,1fr))] divide-y divide-border">{Array.from({ length: 8 }, (_, i) => <div key={i} className="flex items-center justify-between gap-4 py-2.5"><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-16" /></div>)}</div> : null}
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="h-full min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
      <main data-beacon-loading className={DASHBOARD} aria-busy="true" aria-label="Loading server metrics">
        <span className="sr-only" role="status">Loading server metrics</span>
        <div className={OVERVIEW_ROW} aria-hidden="true">{Array.from({ length: 4 }, (_, i) => <Card key={i} className={PANEL}>
          <CardHeader className="p-4 pb-2 sm:p-5 sm:pb-2"><Skeleton className="h-3 w-14" /></CardHeader>
          <CardContent className={PANEL_CONTENT}><Skeleton className="h-8 w-24 max-w-full" /><Skeleton className="mt-4 h-7 w-full rounded-none" /><Skeleton className="mt-3 h-4 w-28 max-w-full" /></CardContent>
        </Card>)}</div>
        <div className={DETAIL_ROW} aria-hidden="true"><SkeletonPanel kind="chart" /><SkeletonPanel kind="cores" /></div>
        <div className={DETAIL_ROW} aria-hidden="true"><SkeletonPanel kind="chart" /><SkeletonPanel kind="memory" /></div>
        <div className={DETAIL_ROW} aria-hidden="true"><SkeletonPanel kind="processes" /><SkeletonPanel kind="runtime" /></div>
      </main>
    </div>
  );
}

function DashboardPage() {
  const { container, active, snapshot, error } = useServerSnapshot();
  return (
    <div ref={container} data-beacon-shell className="h-full min-h-0 min-w-0 flex-1">
    {!active ? null : snapshot === null && error === null ? <LoadingState /> : (
    <div className="h-full min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
      <main data-beacon-dashboard className={DASHBOARD}>
        {error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Could not refresh metrics: {error}</div> : null}
        {snapshot ? (
          <>
            <section data-beacon-row="overview" className={OVERVIEW_ROW} aria-label="Current resource usage">
              <MetricCard label="CPU" value={formatPercent(snapshot.cpu.usagePercent)} detail={`${snapshot.cpu.cores} cores · load ${snapshot.cpu.loadAverage[0].toFixed(2)}`} percentage={snapshot.cpu.usagePercent} />
              <MetricCard label="Memory" value={formatPercent(snapshot.memory.usagePercent)} detail={`${formatBytes(snapshot.memory.usedBytes)} of ${formatBytes(snapshot.memory.totalBytes)}`} percentage={snapshot.memory.usagePercent} />
              <MetricCard label="Disk" value={snapshot.disk ? formatPercent(snapshot.disk.usagePercent) : "Unavailable"} detail={snapshot.disk ? `${formatBytes(snapshot.disk.freeBytes)} available` : "Root filesystem unavailable"} percentage={snapshot.disk?.usagePercent ?? null} />
              <MetricCard label="Network" value={snapshot.network ? formatRate(snapshot.network.rxBytesPerSecond) : "Unavailable"} visualization={!snapshot.network ? null : snapshot.network.txBytesPerSecond === null ? <Skeleton className="h-4 w-20" aria-label="Loading upload rate" /> : <span className="text-sm tabular-nums" style={{ color: ORANGE }}>↑ {formatRate(snapshot.network.txBytesPerSecond)}</span>} detail={snapshot.network ? "Download ↓ · Upload ↑" : "Network counters unavailable"} />
            </section>

            <section data-beacon-row="cpu" className={DETAIL_ROW}>
              <PercentChart title="CPU utilization" values={snapshot.history.map((point) => ({ timestamp: point.timestamp, value: point.cpuPercent }))} current={snapshot.cpu.usagePercent} subtitle="Aggregate utilization across all cores" />
              <LoadPanel snapshot={snapshot} />
            </section>

            <section data-beacon-row="network-memory" className={DETAIL_ROW}>
              <NetworkChart snapshot={snapshot} />
              <MemoryPanel snapshot={snapshot} />
            </section>

            <section data-beacon-row="processes-runtime" className={DETAIL_ROW}>
              <ProcessPanel snapshot={snapshot} />
              <RuntimePanel snapshot={snapshot} />
            </section>
          </>
        ) : null}
      </main>
    </div>
    )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "pressure-notifications", component: PressureNotifications });
  app.slots.navPanel({ id: "status", title: "Status", icon: "Target", path: "status", component: DashboardPage });
});
