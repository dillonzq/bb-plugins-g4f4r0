import assert from "node:assert/strict";
import test from "node:test";
import {
  bbAgentProviderId,
  clampPercent,
  formatRemainingPercent,
  formatResetTime,
  formatUsedPercent,
  normalizeUsage,
  type RawUsageResponse,
} from "../lib/usage.ts";
import { assembleFleetView, loadFleetReadings, type FleetSdk } from "../lib/load-fleet.ts";
import { clampRefreshIntervalSeconds, enabledProviderIds } from "../lib/preferences.ts";

function healthyResponse(): RawUsageResponse {
  return {
    codex: {
      status: "ok",
      accountEmail: "mateo@example.com",
      planLabel: "Plus",
      windows: [
        {
          label: "Weekly limit",
          usedPercent: 17.25,
          resetsAt: "2026-08-17T00:44:00.000Z",
        },
        {
          label: "Five-hour limit",
          usedPercent: 120,
          resetsAt: null,
          cost: { usedUsdCents: 125, limitUsdCents: 500 },
        },
      ],
    },
    "claude-code": { status: "expired" },
    "acp-cursor": { status: "unauthenticated" },
    "acp-grok": {
      status: "ok",
      accountEmail: "grok@example.com",
      planLabel: "SuperGrok",
      windows: [
        { label: "Weekly limit", usedPercent: 39, resetsAt: "2026-08-16T16:00:00.000Z" },
      ],
    },
    "acp-opencode": { status: "unauthenticated" },
  };
}

test("normalizes providers in stable order with every usage window", () => {
  const snapshot = normalizeUsage(
    healthyResponse(),
    { id: "host_1", name: "server" },
    new Date("2026-08-11T17:00:00.000Z"),
  );

  assert.equal(snapshot.fetchedAt, "2026-08-11T17:00:00.000Z");
  assert.deepEqual(
    snapshot.providers.map((provider) => provider.id),
    ["codex", "claudeCode", "cursor", "grok", "openCode"],
  );
  assert.equal(snapshot.providers[0]?.windows.length, 2);
  assert.equal(snapshot.providers[0]?.windows[0]?.barPercent, 17.25);
  assert.equal(snapshot.providers[0]?.windows[1]?.usedPercent, 120);
  assert.equal(snapshot.providers[0]?.windows[1]?.barPercent, 100);
  assert.equal(snapshot.providers[3]?.status, "ok");
  assert.equal(snapshot.providers[3]?.windows[0]?.resetsAt, "2026-08-16T16:00:00.000Z");
});

test("formats leftover and reset copy without summing", () => {
  assert.equal(formatUsedPercent(17.25), "17.3");
  assert.equal(formatRemainingPercent(17.25), "82.8% left");
  assert.equal(formatRemainingPercent(120), "0% left");
  assert.equal(clampPercent(120), 100);
  assert.match(formatResetTime("2026-08-16T16:00:00.000Z", "en-US"), /Resets/);
  assert.equal(formatResetTime(null), "Reset unavailable");
  assert.equal(bbAgentProviderId("cursor"), "acp-cursor");
  assert.equal(bbAgentProviderId("claudeCode"), "claude-code");
});

test("enables providers independently", () => {
  assert.deepEqual(
    enabledProviderIds({
      enableCodex: true,
      enableClaudeCode: false,
      enableCursor: false,
      enableGrok: true,
      enableOpenCode: false,
    }),
    ["codex", "grok"],
  );
  assert.equal(clampRefreshIntervalSeconds(8), 15);
  assert.equal(clampRefreshIntervalSeconds(900), 300);
  assert.equal(clampRefreshIntervalSeconds(60), 60);
});

test("loads connected hosts and skips usage on disconnected ones", async () => {
  const calls: Array<string | undefined> = [];
  const sdk: FleetSdk = {
    hosts: {
      async list() {
        return [
          { id: "host_server", name: "server", status: "connected", type: "persistent" },
          { id: "host_neo", name: "neo", status: "disconnected", type: "persistent" },
          { id: "host_tmp", name: "sandbox", status: "connected", type: "ephemeral" },
        ];
      },
    },
    system: {
      async usageLimits(args) {
        calls.push(args?.hostId);
        return healthyResponse();
      },
    },
  };

  const readings = await loadFleetReadings(sdk, new Date("2026-09-14T12:00:00.000Z"));
  assert.deepEqual(calls, ["host_server"]);
  assert.equal(readings.length, 2);
  assert.equal(readings[0]?.snapshot?.host.name, "server");
  assert.equal(readings[1]?.snapshot, null);

  const view = assembleFleetView(readings, ["codex", "grok"], new Date("2026-09-14T12:00:00.000Z"), {
    availableCount: 1,
    accountEmail: "mateo@example.com",
  });
  assert.ok(view.totals.some((total) => total.providerId === "grok"));
  const codex = view.totals.find((total) => total.providerId === "codex");
  assert.equal(codex?.windows.some((window) => window.label === "Weekly limit"), true);
  assert.equal(codex?.resetCredits?.availableCount, 1);
});
