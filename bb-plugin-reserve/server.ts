import { hostname } from "node:os";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  consumeCodexRateLimitResetCredit,
  readCodexResetCredits,
} from "./lib/codex-reset-credits.ts";
import { assembleFleetView, loadFleetReadings, localCodexEmail } from "./lib/load-fleet.ts";
import { readCursorModelWindows } from "./lib/cursor-pools.ts";
import { withCursorPoolWindows } from "./lib/fleet.ts";
import {
  clampRefreshIntervalSeconds,
  enabledProviderIds,
} from "./lib/preferences.ts";
import {
  createResetActionGate,
  type ResetPrepareResult,
} from "./lib/reset-action-gate.ts";
import { PROVIDER_IDS } from "./lib/usage.ts";

const costSchema = z
  .object({
    usedUsdCents: z.number().finite(),
    limitUsdCents: z.number().finite(),
  })
  .strict();

const resetCreditsSchema = z
  .object({
    availableCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const usageWindowSchema = z
  .object({
    label: z.string(),
    usedPercent: z.number().finite(),
    barPercent: z.number().finite().min(0).max(100),
    resetsAt: z.string().nullable(),
    cost: costSchema.nullable(),
  })
  .strict();

const hostRefSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(["connected", "disconnected"]),
  })
  .strict();

const loginTotalSchema = z
  .object({
    key: z.string(),
    providerId: z.enum(PROVIDER_IDS),
    providerName: z.string(),
    accountEmail: z.string().nullable(),
    planLabel: z.string().nullable(),
    windows: z.array(usageWindowSchema),
    remainingPercent: z.number().finite().min(0).max(100),
    resetCredits: resetCreditsSchema.nullable(),
    hosts: z.array(hostRefSchema),
  })
  .strict();

const fleetSnapshotSchema = z
  .object({
    fetchedAt: z.string(),
    refreshIntervalMs: z.number().int().min(2000).max(300_000),
    totals: z.array(loginTotalSchema),
  })
  .strict();

const resetPrepareResultSchema: z.ZodType<ResetPrepareResult> = z.union([
  z
    .object({
      outcome: z.literal("ready"),
      confirmationToken: z.string().min(1),
      expiresAtMs: z.number().int().nonnegative(),
      availableCount: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      outcome: z.enum(["unavailable", "no-credit"]),
      message: z.string().min(1),
    })
    .strict(),
]);

const resetConsumptionOutcomeSchema = z.enum([
  "reset",
  "nothingToReset",
  "noCredit",
  "alreadyRedeemed",
  "confirmation-invalid",
  "confirmation-expired",
]);

export const rpcContract = defineRpcContract({
  getFleet: {
    input: z.null(),
    output: fleetSnapshotSchema,
  },
  prepareReset: {
    input: z.null(),
    output: resetPrepareResultSchema,
  },
  consumeReset: {
    input: z
      .object({
        confirmationToken: z.string().trim().min(1).max(128),
      })
      .strict(),
    output: z
      .object({
        outcome: resetConsumptionOutcomeSchema,
      })
      .strict(),
  },
});

export type FleetSnapshot = z.infer<typeof fleetSnapshotSchema>;

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    enableCodex: {
      type: "boolean",
      label: "Codex",
      description: "Show Codex leftover windows and banked resets.",
      default: true,
    },
    enableClaudeCode: {
      type: "boolean",
      label: "Claude Code",
      description: "Show Claude Code leftover windows.",
      default: true,
    },
    enableCursor: {
      type: "boolean",
      label: "Cursor",
      description: "Show Cursor leftover windows.",
      default: true,
    },
    enableGrok: {
      type: "boolean",
      label: "Grok",
      description: "Show Grok leftover windows and the weekly reset time.",
      default: true,
    },
    enableOpenCode: {
      type: "boolean",
      label: "OpenCode",
      description: "Show OpenCode leftover windows.",
      default: true,
    },
    refreshIntervalSeconds: {
      type: "number",
      label: "Refresh interval (seconds)",
      description: "How often to reload usage while Reserve is open. 15 to 300.",
      experimental_schema: z.number().int().min(15).max(300),
      default: 60,
    },
  });

  const resetGate = createResetActionGate(consumeCodexRateLimitResetCredit);

  bb.rpc.register(rpcContract, {
    async getFleet() {
      const preferences = await settings.get();
      const fetchedAt = new Date();
      const readings = await loadFleetReadings(bb.sdk, fetchedAt);
      const enabled = enabledProviderIds(preferences);
      const localCodexOk = readings.some((reading) =>
        reading.snapshot?.providers.some(
          (provider) => provider.id === "codex" && provider.status === "ok",
        ),
      );
      if (enabled.includes("codex") && localCodexOk) {
        const readStartedAtMs = Date.now();
        try {
          resetGate.setAvailableCount(await readCodexResetCredits(), readStartedAtMs);
        } catch {
          bb.log.warn("Codex usage reset availability could not be loaded.");
        }
      } else {
        resetGate.setAvailableCount(null);
      }
      let view = assembleFleetView(readings, enabled, fetchedAt, {
        availableCount: resetGate.availableCount,
        accountEmail: localCodexEmail(readings, hostname()),
      });
      if (enabled.includes("cursor")) {
        try {
          view = withCursorPoolWindows(view, await readCursorModelWindows());
        } catch {
          bb.log.warn("Cursor model pools could not be loaded.");
        }
      }
      return {
        ...view,
        refreshIntervalMs: clampRefreshIntervalSeconds(preferences.refreshIntervalSeconds) * 1000,
      };
    },
    prepareReset(): ResetPrepareResult {
      return resetGate.prepare();
    },
    async consumeReset({ confirmationToken }) {
      return { outcome: await resetGate.consume(confirmationToken) };
    },
  });
}
