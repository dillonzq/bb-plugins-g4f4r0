import { buildFleetView, type CodexCliState, type FleetView, type HostRef, type HostUsageReading } from "./fleet.ts";
import { normalizeUsage, type ProviderId, type RawUsageResponse } from "./usage.ts";

export interface FleetHost {
  id: string;
  name: string;
  status: "connected" | "disconnected";
  type: "persistent" | "ephemeral";
}

/** Per-host cap so a hung remote cannot stall the popover. Raise if healthy remotes routinely exceed this. */
export const HOST_USAGE_TIMEOUT_MS = 5_000;

export interface FleetSdk {
  hosts: {
    list(args?: { includeCreating?: boolean }): Promise<FleetHost[]>;
  };
  providers?: {
    list(args?: { hostId?: string; capability?: "usage"; signal?: AbortSignal }): Promise<Array<{ id: string }>>;
  };
  system: {
    usageLimits(args?: {
      hostId?: string;
      providerId?: string;
      signal?: AbortSignal;
    }): Promise<RawUsageResponse>;
  };
}

function hostRef(host: FleetHost): HostRef {
  return { id: host.id, name: host.name, status: host.status };
}

async function usageProviderIds(
  sdk: FleetSdk,
  hostId: string,
  timeoutMs: number,
): Promise<string[] | null> {
  if (sdk.providers?.list === undefined) return null;
  try {
    const providers = await sdk.providers.list({
      hostId,
      capability: "usage",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ids = providers.map((provider) => provider.id).filter((id) => id.trim().length > 0);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

async function readHostUsage(
  sdk: FleetSdk,
  hostId: string | undefined,
  timeoutMs: number,
): Promise<RawUsageResponse> {
  try {
    return await sdk.system.usageLimits({
      ...(hostId === undefined ? {} : { hostId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const ids = hostId === undefined ? null : await usageProviderIds(sdk, hostId, timeoutMs);
    if (ids === null) throw error;
    const parts = await Promise.all(ids.map(async (providerId) => {
      try {
        return await sdk.system.usageLimits({
          hostId,
          providerId,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return {};
      }
    }));
    return Object.assign({}, ...parts);
  }
}

async function readHost(
  sdk: FleetSdk,
  host: FleetHost,
  fetchedAt: Date,
  timeoutMs: number,
): Promise<HostUsageReading> {
  const ref = hostRef(host);
  if (host.status !== "connected") {
    return { host: ref, error: null, snapshot: null };
  }
  try {
    const response = await readHostUsage(sdk, host.id, timeoutMs);
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
  timeoutMs = HOST_USAGE_TIMEOUT_MS,
): Promise<HostUsageReading[]> {
  let hosts: FleetHost[];
  try {
    hosts = (await sdk.hosts.list()).filter((host) => host.type === "persistent");
  } catch {
    hosts = [];
  }

  if (hosts.length === 0) {
    try {
      const response = await readHostUsage(sdk, undefined, timeoutMs);
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

  return Promise.all(hosts.map((host) => readHost(sdk, host, fetchedAt, timeoutMs)));
}

export function assembleFleetView(
  readings: readonly HostUsageReading[],
  enabledIds: readonly ProviderId[],
  fetchedAt: Date,
  codexCli: CodexCliState,
): FleetView {
  return buildFleetView(readings, enabledIds, fetchedAt.toISOString(), codexCli);
}
