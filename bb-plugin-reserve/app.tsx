import { useRef, useState, type ReactNode } from "react";
import "./app.css";
import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders,
  useRpc,
  type ExperimentalSidebarFooterDisclosureProps,
} from "@get-bb/plugin-sdk/app";
import { HugeiconsIcon } from "@hugeicons/react";
import { GaugeIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFleetSnapshot } from "./hooks/use-fleet-snapshot";
import type { UsageSnapshot, rpcContract } from "./server";
import type { LoginTotal } from "./lib/fleet.ts";
import type { ProviderId, UsageWindow } from "./lib/usage.ts";
import { bbAgentProviderId, canonicalWindowLabel, formatCost, formatFetchedAt, formatRemainingPercent, formatResetCredits, formatResetTime } from "./lib/usage.ts";

const GREEN = "#22c55e";
const AMBER = "#eab308";
const RED = "#ef4444";
const SECTION = "relative min-w-0 space-y-2 p-3 after:pointer-events-none after:absolute after:bottom-0 after:left-0 after:h-px after:w-[200%] after:bg-sidebar-border after:content-[''] last:after:hidden";

function colorForUsed(value: number): string {
  if (value >= 95) return RED;
  if (value >= 80) return AMBER;
  return GREEN;
}

function ProviderGlyph({ id }: { id: ProviderId }) {
  const directory = experimental_useProviders();
  const bbId = bbAgentProviderId(id);
  const provider = directory.providers.find((item) => item.id === bbId);
  return (
    <ProviderIcon
      providerKind="agent"
      provider={provider ?? { id: bbId }}
      className="size-3.5 shrink-0"
      aria-hidden
    />
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full min-w-0 truncate rounded-full border border-sidebar-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

const FOOTER_BTN = "h-7 px-2 text-xs";

function ReloadButton({ onReload, reloading }: { onReload: () => void; reloading: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label="Reload usage"
      aria-busy={reloading}
      disabled={reloading}
      onClick={onReload}
    >
      <Icon
        name={reloading ? "Loading" : "ArrowReloadHorizontal"}
        className={reloading ? "size-4 animate-spin" : "size-4"}
        aria-hidden
      />
    </Button>
  );
}

function LaptopGlyph() {
  return <Icon name="Laptop" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

function Meter({ usedPercent, label }: { usedPercent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, usedPercent));
  return (
    <div
      className="relative h-2 min-w-0 w-full overflow-hidden rounded-none bg-sidebar-border"
      style={{ maskImage: "linear-gradient(to right, black calc(100% - 1px), transparent 0)", maskSize: "2% 100%", maskRepeat: "repeat-x" }}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={formatRemainingPercent(usedPercent)}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0" style={{ width: `${clamped}%`, backgroundColor: colorForUsed(usedPercent) }} />
    </div>
  );
}

function Section({ icon, label, ariaLabel, value, children }: { icon?: ReactNode; label: ReactNode; ariaLabel?: string; value?: ReactNode; children?: ReactNode }) {
  return (
    <section className={SECTION} aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex min-w-0 items-center gap-2 font-medium text-sidebar-foreground">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        {value === undefined ? null : <span className="shrink-0">{value}</span>}
      </div>
      {children}
    </section>
  );
}

function Row({
  icon,
  label,
  value,
  title,
  wrap = false,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value?: ReactNode;
  title?: string;
  wrap?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs" title={title}>
      <span className={`flex min-w-0 items-center gap-1.5 text-muted-foreground ${wrap ? "flex-wrap" : ""}`}>
        {icon}
        <span className={wrap ? "min-w-0" : "min-w-0 truncate"}>{label}</span>
      </span>
      {value === undefined || value === "" ? null : <span className="shrink-0 tabular-nums text-muted-foreground">{value}</span>}
    </div>
  );
}

type ResetMessage = { kind: "info" | "success" | "error"; text: string };

function CodexResetActions({
  availableCount,
  onApplied,
}: {
  availableCount: number;
  onApplied: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [confirming, setConfirming] = useState(false);
  const [consuming, setConsuming] = useState(false);
  const [message, setMessage] = useState<ResetMessage | null>(null);
  const inFlight = useRef(false);

  async function consume() {
    if (inFlight.current) return;
    inFlight.current = true;
    setConsuming(true);
    setMessage({ kind: "info", text: "Sending usage reset." });
    try {
      const prepared = await rpc.call("prepareReset", null);
      if (prepared.outcome !== "ready") {
        setConfirming(false);
        setMessage({ kind: "error", text: prepared.message });
        return;
      }
      const { outcome } = await rpc.call("consumeReset", { confirmationToken: prepared.confirmationToken });
      setConfirming(false);
      switch (outcome) {
        case "reset":
          setMessage({ kind: "success", text: "Usage reset. Refreshing limits." });
          break;
        case "alreadyRedeemed":
          setMessage({ kind: "success", text: "Usage reset was already applied. Refreshing limits." });
          break;
        case "nothingToReset":
          setMessage({ kind: "info", text: "No eligible usage window needed a reset." });
          break;
        case "noCredit":
          setMessage({ kind: "error", text: "No usage resets are available now." });
          break;
        case "confirmation-expired":
          setMessage({ kind: "error", text: "That reset confirmation expired. Choose Use reset again." });
          break;
        case "confirmation-invalid":
          setMessage({ kind: "error", text: "That reset confirmation is no longer valid." });
          break;
      }
      onApplied();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Usage reset is unavailable." });
    } finally {
      inFlight.current = false;
      setConsuming(false);
    }
  }

  function stayOpen(event: { stopPropagation(): void }) {
    event.stopPropagation();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 text-muted-foreground">
          {confirming ? "Are you sure?" : formatResetCredits(availableCount)}
        </span>
        {availableCount > 0 && !confirming ? (
          <Button
            variant="outline"
            size="xs"
            className={FOOTER_BTN}
            disabled={consuming}
            onPointerDown={stayOpen}
            onClick={(event) => { stayOpen(event); setMessage(null); setConfirming(true); }}
          >
            Use reset
          </Button>
        ) : null}
        {confirming ? (
          <div className="flex shrink-0 gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              className={FOOTER_BTN}
              disabled={consuming}
              onPointerDown={stayOpen}
              onClick={(event) => { stayOpen(event); setConfirming(false); setMessage(null); }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="xs"
              className={FOOTER_BTN}
              disabled={consuming}
              onPointerDown={stayOpen}
              onClick={(event) => { stayOpen(event); void consume(); }}
            >
              Confirm
            </Button>
          </div>
        ) : null}
      </div>
      {message !== null ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function WindowBlock({ window, providerName }: { window: UsageWindow; providerName: string }) {
  const label = canonicalWindowLabel(window.label);
  return (
    <div className="min-w-0 space-y-1">
      <Row label={label} value={formatRemainingPercent(window.usedPercent)} />
      <Meter usedPercent={window.usedPercent} label={`${providerName} ${label}`} />
      <Row
        label={formatResetTime(window.resetsAt)}
        value={window.cost ? formatCost(window.cost) : ""}
      />
    </div>
  );
}

function LoginCard({ login, onReload }: { login: LoginTotal; onReload: () => void }) {
  return (
    <Section
      icon={<ProviderGlyph id={login.providerId} />}
      label={login.providerName}
      ariaLabel={login.accountEmail ? `${login.providerName} ${login.accountEmail}` : login.providerName}
    >
      {login.accountEmail || login.planLabel ? (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {login.accountEmail ? <Pill>{login.accountEmail}</Pill> : null}
          {login.planLabel ? <Pill>{login.planLabel}</Pill> : null}
        </div>
      ) : null}
      <div className="space-y-3">
        {login.windows.map((window) => (
          <WindowBlock key={window.label} window={window} providerName={login.providerName} />
        ))}
      </div>
      {login.hosts.length > 0 ? (
        <Row
          icon={<LaptopGlyph />}
          label={login.hosts.map((host) => host.name).join(" · ")}
          wrap
        />
      ) : null}
      {login.resetCredits !== null ? (
        <CodexResetActions availableCount={login.resetCredits.availableCount} onApplied={onReload} />
      ) : null}
    </Section>
  );
}

function ReservePopover({ snapshot, onReload, reloading }: { snapshot: UsageSnapshot; onReload: () => void; reloading: boolean }) {
  return (
    <>
      {snapshot.totals.length === 0 ? (
        <Section label="Logins"><p className="text-xs text-muted-foreground">No leftover windows to show.</p></Section>
      ) : snapshot.totals.map((login) => (
        <LoginCard key={login.key} login={login} onReload={onReload} />
      ))}
      <Section
        label={formatFetchedAt(snapshot.fetchedAt)}
        value={<ReloadButton onReload={onReload} reloading={reloading} />}
      />
    </>
  );
}

function LoadingPopover() {
  return (
    <>
      {Array.from({ length: 3 }, (_, key) => (
        <Section key={key} label={<Skeleton className="h-3 w-16" />}>
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-2 w-full rounded-none" />
          <Skeleton className="h-10 w-full" />
        </Section>
      ))}
      <Section label={<Skeleton className="h-3 w-24" />} value={<Skeleton className="size-8 rounded-md" />} />
    </>
  );
}

function GaugeMark({ className }: { className?: string }) {
  return <HugeiconsIcon icon={GaugeIcon} className={className} strokeWidth={2} style={{ opacity: 0.8 }} aria-hidden="true" />;
}

function ReserveDisclosure(_props: ExperimentalSidebarFooterDisclosureProps) {
  const { container, active, snapshot, error, reload, reloading } = useFleetSnapshot();
  return (
    <div ref={container} data-reserve-shell aria-busy={(active && !snapshot && !error) || reloading} className="w-full min-w-64">
      {error ? <div role="alert" className="relative px-3 py-2 text-xs text-destructive after:pointer-events-none after:absolute after:bottom-0 after:left-0 after:h-px after:w-[200%] after:bg-sidebar-border after:content-['']">Could not refresh: {error}</div> : null}
      {snapshot ? <ReservePopover snapshot={snapshot} onReload={reload} reloading={reloading} /> : <LoadingPopover />}
    </div>
  );
}

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: "Gauge", component: GaugeMark });
  app.experimental_sidebarFooter.register({
    kind: "disclosure",
    id: "reserve",
    label: "Usage",
    icon: "Gauge",
    component: ReserveDisclosure,
  });
});
