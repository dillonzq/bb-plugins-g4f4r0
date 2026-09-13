import { it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
const mock = vi.hoisted(() => ({
  events: [] as string[],
  send: vi.fn(),
  close: vi.fn(),
  evaluate: vi.fn(),
}));
vi.mock("../src/runtime", () => ({
  ensureRuntime: async () => "/binary",
  installed: async () => true,
  runtimePath: () => "/binary",
}));
vi.mock("../src/process", () => ({
  runProcess: async () => '{"success":true,"data":{}}',
}));
vi.mock("../src/bridge", () => ({
  Bridge: {
    open: async () => ({
      endpoint: "ws://private",
      close: () => mock.events.push("bridge-close"),
    }),
  },
}));
vi.mock("../src/cdp", () => ({
  Cdp: {
    connect: async () => ({
      targetId: "tab",
      send: mock.send,
      evaluate: mock.evaluate,
      close: () => mock.events.push("cdp-close"),
    }),
  },
}));
import entry from "../host";
it("cancels a nested stroke, releases the pointer before disconnect, and releases worker leases", async () => {
  const root = await mkdtemp(join(tmpdir(), "ab-host-test-"));
  const h = experimental_createHostEntryHarness(entry, {
    experimental_paths: { dataDir: root, tempDir: root },
  });
  mock.events.length = 0;
  mock.send.mockImplementation(async (_method, params) => {
    mock.events.push(params.type);
    return {};
  });
  try {
    const connection = await h.experimental_call("connect", {
      id: "ab-host-test",
      endpoint: "ws://private",
      expiresAt: Date.now() + 60000,
    });
    for (;;) {
      const j = await h.experimental_call("job", { id: connection.id });
      if (j.status !== "running") {
        expect(j.status).toBe("succeeded");
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    const j = await h.experimental_call("submit", {
      id: "ab-host-test",
      operation: {
        kind: "sequence",
        steps: [
          {
            kind: "gesture",
            strokes: [Array.from({ length: 100 }, (_, i) => ({ x: i, y: i }))],
            intervalMs: 30,
          },
          { kind: "command", args: ["get", "title"] },
        ],
      },
    });
    expect(j.status).toBe("running");
    await h.experimental_call("cancel", { id: j.id });
    let result;
    for (;;) {
      result = await h.experimental_call("job", { id: j.id });
      if (result.status !== "running") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(result.status).toBe("cancelled");
    expect(mock.events.indexOf("mouseReleased")).toBeGreaterThan(
      mock.events.indexOf("mousePressed"),
    );
    expect(mock.events.indexOf("bridge-close")).toBeGreaterThan(
      mock.events.indexOf("mouseReleased"),
    );
    await vi.waitFor(() =>
      expect(h.experimental_getRetainedWorkerLeaseCount()).toBe(0),
    );
    const state = await h.experimental_call("inspect", { id: "ab-host-test" });
    expect(state.status).toBe("released");
  } finally {
    await h.experimental_dispose();
    expect(h.experimental_getRetainedWorkerLeaseCount()).toBe(0);
    await rm(root, { recursive: true, force: true });
  }
});
