import { PROVIDER_IDS, type ProviderId } from "./usage.ts";

export const DEFAULT_REFRESH_INTERVAL_SECONDS = 60;
export const MIN_REFRESH_INTERVAL_SECONDS = 15;
export const MAX_REFRESH_INTERVAL_SECONDS = 300;

export interface ReservePreferences {
  enableCodex: boolean;
  enableClaudeCode: boolean;
  enableCursor: boolean;
  enableGrok: boolean;
  enableOpenCode: boolean;
  refreshIntervalSeconds: number;
}

type ProviderFlag = keyof Pick<
  ReservePreferences,
  "enableCodex" | "enableClaudeCode" | "enableCursor" | "enableGrok" | "enableOpenCode"
>;

const PROVIDER_FLAGS: Readonly<Record<ProviderId, ProviderFlag>> = {
  codex: "enableCodex",
  claudeCode: "enableClaudeCode",
  cursor: "enableCursor",
  grok: "enableGrok",
  openCode: "enableOpenCode",
};

export function clampRefreshIntervalSeconds(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_REFRESH_INTERVAL_SECONDS;
  return Math.min(
    MAX_REFRESH_INTERVAL_SECONDS,
    Math.max(MIN_REFRESH_INTERVAL_SECONDS, Math.round(numeric)),
  );
}

export function enabledProviderIds(
  preferences: Pick<ReservePreferences, ProviderFlag>,
): ProviderId[] {
  return PROVIDER_IDS.filter((id) => preferences[PROVIDER_FLAGS[id]] === true);
}
