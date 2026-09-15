import assert from "node:assert/strict";
import test from "node:test";
import { buildFleetView, type HostUsageReading } from "../lib/fleet.ts";
import { normalizeUsage, remainingPercent, type RawUsageResponse } from "../lib/usage.ts";

function okWindows(email: string, windows: Array<{ label: string; usedPercent: number; resetsAt: string | null }>): RawUsageResponse {
  return {
    codex: {
      status: "ok",
      accountEmail: email,
      planLabel: "Plus",
      windows,
    },
    "claude-code": { status: "not_installed" },
    "acp-cursor": { status: "not_installed" },
    "acp-grok": { status: "not_installed" },
    "acp-opencode": { status: "not_installed" },
  };
}

function reading(
  id: string,
  name: string,
  response: RawUsageResponse,
  status: "connected" | "disconnected" = "connected",
): HostUsageReading {
  return {
    host: { id, name, status },
    error: null,
    snapshot: status === "connected"
      ? normalizeUsage(response, { id, name }, new Date("2026-09-14T12:00:00.000Z"))
      : null,
  };
}

test("remaining percent clamps over-quota use to zero left", () => {
  assert.equal(remainingPercent(17.25), 82.75);
  assert.equal(remainingPercent(120), 0);
  assert.equal(remainingPercent(0), 100);
});

test("same login on two machines is one total, not a summed leftover", () => {
  const view = buildFleetView(
    [
      reading("host_server", "server", okWindows("a@x", [
        { label: "Weekly limit", usedPercent: 40, resetsAt: "2026-09-20T12:00:00.000Z" },
      ])),
      reading("host_pro", "pro", okWindows("a@x", [
        { label: "Weekly limit", usedPercent: 40, resetsAt: "2026-09-20T12:00:00.000Z" },
      ])),
    ],
    ["codex"],
    "2026-09-14T12:00:00.000Z",
  );

  assert.equal(view.totals.length, 1);
  assert.equal(view.totals[0]?.remainingPercent, 60);
  assert.deepEqual(view.totals[0]?.hosts.map((host) => host.name), ["server", "pro"]);
});

test("divergent readings for one login keep the higher used percent", () => {
  const view = buildFleetView(
    [
      reading("host_server", "server", okWindows("a@x", [
        { label: "Weekly limit", usedPercent: 10, resetsAt: "2026-09-21T12:00:00.000Z" },
      ])),
      reading("host_pro", "pro", okWindows("a@x", [
        { label: "Weekly limit", usedPercent: 70, resetsAt: "2026-09-20T12:00:00.000Z" },
      ])),
    ],
    ["codex"],
    "2026-09-14T12:00:00.000Z",
  );

  assert.equal(view.totals.length, 1);
  assert.equal(view.totals[0]?.windows[0]?.usedPercent, 70);
  assert.equal(view.totals[0]?.remainingPercent, 30);
});

test("different logins stay separate totals", () => {
  const view = buildFleetView(
    [
      reading("host_server", "server", okWindows("a@x", [
        { label: "Weekly limit", usedPercent: 20, resetsAt: null },
      ])),
      reading("host_pro", "pro", okWindows("b@x", [
        { label: "Weekly limit", usedPercent: 20, resetsAt: null },
      ])),
    ],
    ["codex"],
    "2026-09-14T12:00:00.000Z",
  );

  assert.equal(view.totals.length, 2);
  assert.equal(view.totals[0]?.accountEmail, "a@x");
  assert.equal(view.totals[1]?.accountEmail, "b@x");
});

test("anonymous login on one host joins the named login for that window", () => {
  const named: RawUsageResponse = {
    cursor: {
      status: "ok",
      accountEmail: "a@x",
      planLabel: null,
      windows: [{ label: "Plan usage", usedPercent: 21, resetsAt: "2026-09-20T12:00:00.000Z" }],
    },
  };
  const anonymous: RawUsageResponse = {
    cursor: {
      status: "ok",
      accountEmail: null,
      planLabel: null,
      windows: [{ label: "Plan usage", usedPercent: 21, resetsAt: "2026-09-20T12:00:00.000Z" }],
    },
  };
  const view = buildFleetView(
    [
      reading("host_server", "server", anonymous),
      reading("host_pro", "pro", named),
    ],
    ["cursor"],
    "2026-09-14T12:00:00.000Z",
  );

  assert.equal(view.totals.length, 1);
  assert.equal(view.totals[0]?.accountEmail, "a@x");
  assert.deepEqual(view.totals[0]?.hosts.map((host) => host.name).sort(), ["pro", "server"]);
});

test("disconnected machines appear without adding fake leftover", () => {
  const view = buildFleetView(
    [
      reading("host_server", "server", okWindows("a@x", [
        { label: "Weekly limit", usedPercent: 25, resetsAt: null },
      ])),
      reading("host_neo", "neo", okWindows("a@x", []), "disconnected"),
    ],
    ["codex"],
    "2026-09-14T12:00:00.000Z",
  );

  assert.equal(view.totals.length, 1);
  assert.equal(view.totals[0]?.hosts.length, 2);
  assert.equal(view.totals[0]?.hosts[1]?.name, "neo");
  assert.equal(view.totals[0]?.hosts[1]?.status, "disconnected");
});

test("windows on one login stay nested, not sibling totals", () => {
  const view = buildFleetView(
    [
      reading("host_server", "server", okWindows("a@x", [
        { label: "Weekly limit", usedPercent: 40, resetsAt: "2026-09-20T12:00:00.000Z" },
        { label: "Five-hour limit", usedPercent: 10, resetsAt: "2026-09-14T18:00:00.000Z" },
      ])),
    ],
    ["codex"],
    "2026-09-14T12:00:00.000Z",
  );

  assert.equal(view.totals.length, 1);
  assert.deepEqual(view.totals[0]?.windows.map((window) => window.label), [
    "5-hour",
    "Weekly",
  ]);
  assert.equal(view.totals[0]?.remainingPercent, 60);
});

test("Codex CLI windows and resets attach only to the matching BB email", () => {
  const view = buildFleetView(
    [
      reading("host_server", "server", okWindows("a@x", [
        { label: "Weekly limit", usedPercent: 10, resetsAt: null },
      ])),
      reading("host_pro", "pro", okWindows("b@x", [
        { label: "Weekly limit", usedPercent: 10, resetsAt: null },
      ])),
    ],
    ["codex"],
    "2026-09-14T12:00:00.000Z",
    {
      availableCount: 1,
      accountEmail: "A@x",
      coreWindows: [{
        label: "5-hour",
        usedPercent: 12,
        barPercent: 12,
        resetsAt: null,
        cost: null,
      }],
      extraWindows: [{
        label: "Luna Reserve · Weekly",
        usedPercent: 5,
        barPercent: 5,
        resetsAt: null,
        cost: null,
      }],
    },
  );
  const owner = view.totals.find((total) => total.accountEmail === "a@x");
  const other = view.totals.find((total) => total.accountEmail === "b@x");
  assert.deepEqual(owner?.windows.map((window) => window.label), [
    "5-hour",
    "Luna Reserve · Weekly",
    "Weekly",
  ]);
  assert.deepEqual(owner?.resetCredits, { availableCount: 1 });
  assert.deepEqual(other?.windows.map((window) => window.label), ["Weekly"]);
  assert.equal(other?.resetCredits, null);
});

test("Codex CLI with no matching BB email leaves BB windows and hides reset", () => {
  const view = buildFleetView(
    [
      reading("host_server", "server", okWindows("a@x", [
        { label: "Weekly limit", usedPercent: 10, resetsAt: null },
      ])),
    ],
    ["codex"],
    "2026-09-14T12:00:00.000Z",
    {
      availableCount: 2,
      accountEmail: "other@x",
      coreWindows: [{
        label: "5-hour",
        usedPercent: 40,
        barPercent: 40,
        resetsAt: null,
        cost: null,
      }],
    },
  );
  assert.deepEqual(view.totals[0]?.windows.map((window) => window.label), ["Weekly"]);
  assert.equal(view.totals[0]?.resetCredits, null);
});
