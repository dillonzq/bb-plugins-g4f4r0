import {
  PLAN_USAGE_LABEL,
} from "./cursor-pools.ts";
import {
  PROVIDER_IDS,
  remainingPercent,
  type ProviderId,
  type ProviderUsage,
  type UsageResetCredits,
  type UsageSnapshot,
  type UsageWindow,
} from "./usage.ts";

export interface HostRef {
  id: string;
  name: string;
  status: "connected" | "disconnected";
}

export interface HostUsageReading {
  host: HostRef;
  error: string | null;
  snapshot: UsageSnapshot | null;
}

export interface LoginTotal {
  key: string;
  providerId: ProviderId;
  providerName: string;
  accountEmail: string | null;
  planLabel: string | null;
  windows: UsageWindow[];
  remainingPercent: number;
  resetCredits: UsageResetCredits | null;
  hosts: HostRef[];
}

export interface CodexResetState {
  availableCount: number | null;
  accountEmail: string | null;
}

export interface FleetView {
  fetchedAt: string;
  totals: LoginTotal[];
}

function loginKey(providerId: ProviderId, accountEmail: string | null): string {
  return `${providerId}|${accountEmail ?? ""}`;
}

function providerIndex(id: ProviderId): number {
  return PROVIDER_IDS.indexOf(id);
}

function parseResetMs(value: string | null): number | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function mergeWindow(current: UsageWindow, incoming: UsageWindow): UsageWindow {
  if (incoming.usedPercent < current.usedPercent) return current;
  if (incoming.usedPercent > current.usedPercent) return incoming;
  const currentReset = parseResetMs(current.resetsAt);
  const incomingReset = parseResetMs(incoming.resetsAt);
  if (currentReset === null) return incoming;
  if (incomingReset === null) return current;
  return incomingReset < currentReset ? incoming : current;
}

function mergeWindowList(windows: UsageWindow[], incoming: UsageWindow): UsageWindow[] {
  const index = windows.findIndex((window) => window.label === incoming.label);
  if (index < 0) return [...windows, incoming];
  return windows.map((window, at) => (at === index ? mergeWindow(window, incoming) : window));
}

function tightestRemaining(windows: readonly UsageWindow[]): number {
  if (windows.length === 0) return 100;
  return remainingPercent(Math.max(...windows.map((window) => window.usedPercent)));
}

function enabledProvider(provider: ProviderUsage, enabled: ReadonlySet<ProviderId>): boolean {
  return enabled.has(provider.id);
}

function coalesceAnonymousLogins(totals: Map<string, LoginTotal>): void {
  for (const [key, anonymous] of [...totals.entries()]) {
    if (anonymous.accountEmail !== null) continue;
    const candidates = [...totals.values()].filter(
      (total) =>
        total.key !== key &&
        total.providerId === anonymous.providerId &&
        total.accountEmail !== null,
    );
    if (candidates.length !== 1) continue;
    const target = candidates[0]!;
    const windows = anonymous.windows.reduce(mergeWindowList, target.windows);
    totals.set(target.key, {
      ...target,
      planLabel: target.planLabel ?? anonymous.planLabel,
      windows,
      remainingPercent: tightestRemaining(windows),
    });
    totals.delete(key);
  }
}

export function buildFleetView(
  readings: readonly HostUsageReading[],
  enabledIds: readonly ProviderId[],
  fetchedAt: string,
  codexReset: CodexResetState = { availableCount: null, accountEmail: null },
): FleetView {
  const enabled = new Set(enabledIds);
  const totals = new Map<string, LoginTotal>();

  for (const reading of readings) {
    if (reading.snapshot === null) continue;
    for (const provider of reading.snapshot.providers) {
      if (!enabledProvider(provider, enabled) || provider.status !== "ok") continue;
      const key = loginKey(provider.id, provider.accountEmail);
      const existing = totals.get(key);
      const windows = [...(existing?.windows ?? []), ...provider.windows].reduce<UsageWindow[]>(
        (list, window) => mergeWindowList(list, window),
        [],
      );
      totals.set(key, {
        key,
        providerId: provider.id,
        providerName: provider.name,
        accountEmail: provider.accountEmail ?? existing?.accountEmail ?? null,
        planLabel: provider.planLabel ?? existing?.planLabel ?? null,
        windows,
        remainingPercent: tightestRemaining(windows),
        resetCredits: null,
        hosts: [],
      });
    }
  }

  coalesceAnonymousLogins(totals);

  // Every login lists the whole fleet so disconnected machines stay visible.
  const hosts = readings.map((reading) => reading.host);
  const codexTotals = [...totals.values()].filter((total) => total.providerId === "codex");
  const resetOwner = (total: LoginTotal): boolean =>
    total.providerId === "codex" &&
    codexReset.availableCount !== null &&
    (codexReset.accountEmail === null ? codexTotals.length === 1 : total.accountEmail === codexReset.accountEmail);
  const orderedTotals = [...totals.values()].sort((left, right) => {
    const providerDelta = providerIndex(left.providerId) - providerIndex(right.providerId);
    if (providerDelta !== 0) return providerDelta;
    return (left.accountEmail ?? "").localeCompare(right.accountEmail ?? "");
  }).map((total) => ({
    ...total,
    windows: [...total.windows].sort((left, right) => left.label.localeCompare(right.label)),
    hosts,
    resetCredits: resetOwner(total) ? { availableCount: codexReset.availableCount! } : null,
  }));

  return { fetchedAt, totals: orderedTotals };
}

/** Replace BB's blended Cursor "Plan usage" with the two dashboard pools. */
export function withCursorPoolWindows(
  view: FleetView,
  pools: readonly UsageWindow[],
): FleetView {
  if (pools.length === 0) return view;
  const cursorTotals = view.totals.filter((total) => total.providerId === "cursor");
  if (cursorTotals.length !== 1) return view;
  const source = cursorTotals[0]!;
  const extras = source.windows.filter(
    (window) => window.label !== PLAN_USAGE_LABEL && !pools.some((pool) => pool.label === window.label),
  );
  const windows = [...pools, ...extras].sort((left, right) => left.label.localeCompare(right.label));
  return {
    ...view,
    totals: view.totals.map((total) => {
      if (total.key !== source.key) return total;
      return { ...total, windows, remainingPercent: tightestRemaining(windows) };
    }),
  };
}
