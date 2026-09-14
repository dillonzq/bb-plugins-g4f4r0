import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { clampPercent, type UsageWindow } from "./usage.ts";

export const CURSOR_MODELS_LABEL = "Cursor models";
export const OTHER_MODELS_LABEL = "Other models";
export const PLAN_USAGE_LABEL = "Plan usage";

const USAGE_FETCH_TIMEOUT_MS = 15_000;
const CURSOR_DASHBOARD_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService";

const nonNegativeNumber = z.union([
  z.number().nonnegative(),
  z.string().regex(/^\d+(?:\.\d+)?$/u).transform(Number),
]).refine(Number.isFinite);

const billingCycleEndSchema = z.union([
  z.number().int().nonnegative(),
  z.string().min(1),
]).nullish();

const currentPeriodUsageSchema = z
  .object({
    billingCycleEnd: billingCycleEndSchema,
    planUsage: z
      .object({
        autoPercentUsed: nonNegativeNumber.optional(),
        apiPercentUsed: nonNegativeNumber.optional(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const fileCredentialsSchema = z
  .object({
    accessToken: z.string().min(1).nullish(),
  })
  .passthrough();

function cursorAuthFilePath(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "Cursor", "auth.json");
  }
  if (process.platform === "darwin") {
    return join(homedir(), ".cursor", "auth.json");
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "cursor", "auth.json");
}

function resetsAtFromCycleEnd(value: z.infer<typeof billingCycleEndSchema>): string | null {
  if (value === null || value === undefined) return null;
  const ms = typeof value === "number"
    ? value
    : /^\d+$/u.test(value)
      ? Number(value)
      : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function poolWindow(label: string, usedPercent: number, resetsAt: string | null): UsageWindow {
  return {
    label,
    usedPercent,
    barPercent: clampPercent(usedPercent),
    resetsAt,
    cost: null,
  };
}

/** Map Cursor's dashboard RPC into the two included-usage pools. */
export function cursorModelWindows(raw: unknown): UsageWindow[] {
  const parsed = currentPeriodUsageSchema.safeParse(raw);
  if (!parsed.success) return [];
  const resetsAt = resetsAtFromCycleEnd(parsed.data.billingCycleEnd);
  const plan = parsed.data.planUsage;
  if (plan === null || plan === undefined) return [];
  const windows: UsageWindow[] = [];
  if (plan.autoPercentUsed !== undefined) {
    windows.push(poolWindow(CURSOR_MODELS_LABEL, plan.autoPercentUsed, resetsAt));
  }
  if (plan.apiPercentUsed !== undefined) {
    windows.push(poolWindow(OTHER_MODELS_LABEL, plan.apiPercentUsed, resetsAt));
  }
  return windows;
}

async function readAccessToken(): Promise<string | null> {
  try {
    const parsed = fileCredentialsSchema.safeParse(
      JSON.parse(await readFile(cursorAuthFilePath(), "utf8")),
    );
    return parsed.success ? parsed.data.accessToken ?? null : null;
  } catch {
    return null;
  }
}

export async function readCursorModelWindows(): Promise<UsageWindow[]> {
  const accessToken = await readAccessToken();
  if (accessToken === null) return [];
  const response = await fetch(`${CURSOR_DASHBOARD_URL}/GetCurrentPeriodUsage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
      "x-cursor-client-type": "cli",
      "x-cursor-client-version": "cli-bb-plugin-reserve",
    },
    body: "{}",
    signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return [];
  return cursorModelWindows(await response.json());
}
