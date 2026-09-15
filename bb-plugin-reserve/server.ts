import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  consumeCodexRateLimitResetCredit,
  EMPTY_CODEX_CLI,
  readCodexCliEnrichment,
} from "./lib/codex-reset-credits.ts";
import { assembleFleetView, loadFleetReadings } from "./lib/load-fleet.ts";
import { createCachedLoader } from "./lib/usage-cache.ts";
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

const usageSnapshotSchema = z
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
  getUsage: {
    input: z.object({ force: z.boolean().optional() }).strict(),
    output: usageSnapshotSchema,
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

export type UsageSnapshot = z.infer<typeof usageSnapshotSchema>;

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

  const SNAPSHOT_KEY = "usage:last";
  const loadUsage = createCachedLoader({
    async load() {
      const preferences = await settings.get();
      const enabled = enabledProviderIds(preferences);
      const fetchedAt = new Date();
      const extrasStartedAtMs = Date.now();
      const cli = enabled.includes("codex")
        ? readCodexCliEnrichment().catch(() => {
            bb.log.warn("Codex CLI usage was unavailable; showing BB windows only.");
            return EMPTY_CODEX_CLI;
          })
        : Promise.resolve(EMPTY_CODEX_CLI);
      const readings = await loadFleetReadings(bb.sdk, fetchedAt);
      const enrichment = await cli;
      resetGate.setAvailableCount(
        enrichment.accountEmail === null ? null : enrichment.availableCount,
        extrasStartedAtMs,
      );
      const view = assembleFleetView(readings, enabled, fetchedAt, {
        accountEmail: enrichment.accountEmail,
        availableCount: resetGate.availableCount,
        coreWindows: enrichment.coreWindows,
        extraWindows: enrichment.extraWindows,
      });
      const snapshot = {
        ...view,
        refreshIntervalMs: clampRefreshIntervalSeconds(preferences.refreshIntervalSeconds) * 1000,
      };
      void bb.storage.kv.set(SNAPSHOT_KEY, snapshot);
      return snapshot;
    },
    ttlMs: (snapshot) => snapshot.refreshIntervalMs,
  });
  const restored = bb.storage.kv.get<unknown>(SNAPSHOT_KEY).then((stored) => {
    const parsed = usageSnapshotSchema.safeParse(stored);
    if (!parsed.success) return;
    const at = Date.parse(parsed.data.fetchedAt);
    loadUsage.hydrate(parsed.data, Number.isFinite(at) ? at : 0);
  }).catch(() => {});
  void restored.then(() => loadUsage.get());

  bb.rpc.register(rpcContract, {
    async getUsage({ force }) {
      await restored;
      return loadUsage.get(force === true);
    },
    prepareReset(): ResetPrepareResult {
      return resetGate.prepare();
    },
    async consumeReset({ confirmationToken }) {
      const outcome = await resetGate.consume(confirmationToken);
      if (outcome !== "confirmation-invalid" && outcome !== "confirmation-expired") {
        loadUsage.invalidate();
        void bb.storage.kv.delete(SNAPSHOT_KEY);
      }
      return { outcome };
    },
  });
}
