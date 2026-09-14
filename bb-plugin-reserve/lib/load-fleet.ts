import { buildFleetView, type CodexResetState, type FleetView, type HostRef, type HostUsageReading } from "./fleet.ts";
import { normalizeUsage, type ProviderId, type RawUsageResponse } from "./usage.ts";

export interface FleetHost {
  id: string;
  name: string;
  status: "connected" | "disconnected";
  type: "persistent" | "ephemeral";
}

export interface FleetSdk {
  hosts: {
    list(args?: { includeCreating?: boolean }): Promise<FleetHost[]>;
  };
  system: {
    usageLimits(args?: { hostId?: string }): Promise<RawUsageResponse>;
  };
}

function hostRef(host: FleetHost): HostRef {
  return { id: host.id, name: host.name, status: host.status };
}

async function readHost(
  sdk: FleetSdk,
  host: FleetHost,
  fetchedAt: Date,
): Promise<HostUsageReading> {
  const ref = hostRef(host);
  if (host.status !== "connected") {
    return { host: ref, error: null, snapshot: null };
  }
  try {
    const response = await sdk.system.usageLimits({ hostId: host.id });
    return {
      host: ref,
      error: null,
      snapshot: normalizeUsage(response, { id: host.id, name: host.name }, fetchedAt),
    };
  } catch (error) {
    return {
      host: ref,
      error: error instanceof Error ? error.message : String(error),
      snapshot: null,
    };
  }
}

export async function loadFleetReadings(
  sdk: FleetSdk,
  fetchedAt = new Date(),
): Promise<HostUsageReading[]> {
  let hosts: FleetHost[];
  try {
    hosts = (await sdk.hosts.list()).filter((host) => host.type === "persistent");
  } catch {
    hosts = [];
  }

  if (hosts.length === 0) {
    try {
      const response = await sdk.system.usageLimits();
      return [{
        host: { id: "local", name: "This server", status: "connected" },
        error: null,
        snapshot: normalizeUsage(response, { id: null, name: "This server" }, fetchedAt),
      }];
    } catch (error) {
      return [{
        host: { id: "local", name: "This server", status: "connected" },
        error: error instanceof Error ? error.message : String(error),
        snapshot: null,
      }];
    }
  }

  return Promise.all(hosts.map((host) => readHost(sdk, host, fetchedAt)));
}

/** Codex login on the BB server host, matched by OS hostname; null when that host is unknown. */
export function localCodexEmail(readings: readonly HostUsageReading[], serverHostName: string): string | null {
  const server = readings.length === 1 && readings[0]!.host.id === "local"
    ? readings[0]
    : readings.find((reading) => reading.host.name.toLowerCase() === serverHostName.toLowerCase());
  const codex = server?.snapshot?.providers.find((provider) => provider.id === "codex" && provider.status === "ok");
  return codex?.accountEmail ?? null;
}

export function assembleFleetView(
  readings: readonly HostUsageReading[],
  enabledIds: readonly ProviderId[],
  fetchedAt: Date,
  codexReset: CodexResetState,
): FleetView {
  return buildFleetView(readings, enabledIds, fetchedAt.toISOString(), codexReset);
}
