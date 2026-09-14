import { describe, it, expect, vi } from "vitest";
import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
const base = {
  mode: "native",
  hostId: "host_pro",
  instanceId: "desktop",
  generation: "generation",
  threadId: "thread_one",
};
async function fixture(
  options: {
    held?: boolean;
    personal?: boolean;
    connectFails?: boolean;
    executionHost?: string;
    busyOnce?: boolean;
    credentialFailure?: boolean;
  } = {},
) {
  const paneAction = vi.fn(async () => ({ delivered: 1 })),
    release = vi.fn(async () => ({ ok: true })),
    close = vi.fn(async () => ({ ok: true })),
    create = vi.fn(async () => ({ tab: { tabId: "tab_new" } }));
  const calls: any[] = [];
  let inspected = 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: "browse",
    sdk: {
      threads: {
        get: async () => ({ environmentId: "env_thread" }) as any,
        paneAction,
      },
      environments: {
        get: async () =>
          ({ hostId: options.executionHost ?? "host_thread" }) as any,
      },
      hosts: {
        list: async () => [makeHostResponse({ id: "host_pro", name: "pro" })],
      },
      experimental_desktopBrowsers: {
        listInstances: async () => ({
          instances: [{ ...base, label: "Desktop" }],
        }),
        listTabs: async () => ({
          tabs: [
            {
              tabId: "tab_existing",
              title: "Example",
              url: "https://example.com",
              profile: options.personal
                ? { kind: "personal" }
                : { kind: "automation", id: "profile" },
              control: options.held
                ? {
                    controllerLabel: "Another controller",
                    leaseId: "other",
                    expiresAt: Date.now() + 1000,
                  }
                : null,
              presentation: "reveal",
              threadId: base.threadId,
            },
          ],
        }),
        createTab: create,
        acquireControl: async () => ({
          ...base,
          leaseId: "private-lease",
          tabIds: ["tab_new"],
          controllerLabel: "Agent Browser",
          expiresAt: Date.now() + 1800000,
        }),
        openConnection: async () => ({
          hostId: base.hostId,
          wsEndpoint: "ws://127.0.0.1:1234/private-secret",
          expiresAt: Date.now() + 1800000,
        }),
        releaseControl: release,
        closeTab: close,
        revealTab: async () => ({ ok: true }),
      },
    },
    experimental_callHostRpc: async (call) => {
      calls.push(call);
      const input = call.input as any;
      if (call.method === "connect") {
        if (options.connectFails) throw new Error("Connection failed");
        return {
          id: "job_connect",
          sessionId: input.id,
          kind: "connect",
          status: "running",
          startedAt: Date.now(),
          durationMs: 0,
          artifacts: [],
        };
      }
      if (call.method === "inspect")
        return {
          ...(options.busyOnce && inspected++ === 0
            ? { busy: "finished-connect" }
            : {}),
          id: input.id,
          status: "ready",
          recording: false,
          artifactRoot: "/private/artifacts/session",
        };
      if (call.method === "frame")
        return {
          data: "qq",
          url: "https://example.com/",
          width: 1280,
          height: 800,
          seq: input.after ? input.after : 1,
        };
      if (call.method === "submit")
        return {
          id: "job_run",
          sessionId: input.id,
          kind: "command",
          status: "succeeded",
          startedAt: Date.now(),
          durationMs: 1,
          artifacts: [],
        };
      if (call.method === "release") return { released: true };
      if (call.method === "credentialPrepare")
        return {
          token: "private-request",
          origin: "https://accounts.shopify.com",
        };
      if (call.method === "credentialCancel") return { cancelled: true };
      if (call.method === "credentialFill") {
        if (options.credentialFailure)
          throw Error("Downstream error containing dummy-secret");
        return { filled: true, count: input.values.length };
      }
      throw new Error(`Unexpected host method ${call.method}`);
    },
  });
  await plugin(bb);
  return { harness, release, close, create, calls, paneAction };
}
describe("BB browser lifecycle", () => {
  it("routes attachment to the selected browser host without exposing CDP credentials", async () => {
    const f = await fixture();
    const r: any = await f.harness.behavior.callRpc("start", {
      ...base,
      url: "https://example.com",
    });
    expect(f.calls.find((c) => c.method === "connect").hostId).toBe("host_pro");
    expect(JSON.stringify(r)).not.toContain("private-secret");
    expect(r.session.tabId).toBe("tab_new");
    await f.harness.lifecycle.dispose();
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.close).not.toHaveBeenCalled();
  });
  it("releases the lease after a failed host connection and preserves the tab", async () => {
    const f = await fixture({ connectFails: true });
    await expect(
      f.harness.behavior.callRpc("start", {
        ...base,
        url: "https://example.com",
      }),
    ).rejects.toThrow("Connection failed");
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.close).not.toHaveBeenCalled();
    await f.harness.lifecycle.dispose();
  });
  it("does not steal another controller’s tab", async () => {
    const f = await fixture({ held: true });
    await expect(
      f.harness.behavior.callRpc("start", { ...base, tabId: "tab_existing" }),
    ).rejects.toThrow("Another controller");
    expect(f.calls).toHaveLength(0);
    expect(f.create).not.toHaveBeenCalled();
    await f.harness.lifecycle.dispose();
  });
  it("requires explicit personal tab handoff", async () => {
    const f = await fixture({ personal: true });
    await expect(
      f.harness.behavior.callRpc("start", { ...base, tabId: "tab_existing" }),
    ).rejects.toThrow("allowPersonal");
    await f.harness.lifecycle.dispose();
  });
  it("prevents an agent from acting on another thread’s session", async () => {
    const f = await fixture();
    const r: any = await f.harness.behavior.callRpc("start", { ...base });
    const result: any = await f.harness.behavior
      .callAgentTool(
        "browse_action",
        {
          id: r.session.id,
          operation: { kind: "command", args: ["snapshot", "-i"] },
        },
        { threadId: "other_thread" },
      )
      .catch((e) => e);
    expect(JSON.stringify(result) + String(result)).toMatch(/another thread/);
    await f.harness.lifecycle.dispose();
  });
  it("rejects invalid URLs before creating tabs", async () => {
    const f = await fixture();
    await expect(
      f.harness.behavior.callRpc("start", {
        ...base,
        url: "file:///etc/passwd",
      }),
    ).rejects.toThrow("https");
    expect(f.create).not.toHaveBeenCalled();
    await f.harness.lifecycle.dispose();
  });
  it("returns actionable CLI validation errors", async () => {
    const f = await fixture();
    const r = await f.harness.behavior.runCli(["run", "{not json}"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBeTruthy();
    await f.harness.lifecycle.dispose();
  });
});

describe("Thread-host routing", () => {
  it("starts on the thread host without creating a client tab or leaking an endpoint", async () => {
    const f = await fixture();
    const r: any = await f.harness.behavior.callRpc("start", {
      threadId: "thread_one",
      url: "https://example.com",
    });
    expect(f.calls.find((c) => c.method === "connect").hostId).toBe(
      "host_thread",
    );
    expect(r.session.mode).toBe("managed");
    expect(r.session.expiresAt).toBeGreaterThan(Date.now() + 7 * 60 * 60 * 1000);
    expect(r.session.viewerUrl).toContain("/http/viewer?id=");
    expect(f.create).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("ws://");
    f.paneAction.mockClear();
    await f.harness.behavior.callRpc("run", {
      id: r.session.id,
      operation: { kind: "command", args: ["true"] },
    });
    expect(f.paneAction).toHaveBeenCalledWith({
      threadId: "thread_one",
      action: "spotlight",
    });
    const ws = await f.harness.behavior.experimental_openWebSocket(
      `/cast?id=${r.session.id}`,
    );
    const deadline = Date.now() + 2000;
    while (!ws.sent.length && Date.now() < deadline)
      await new Promise((res) => setTimeout(res, 20));
    expect(JSON.parse(String(ws.sent[0]))).toMatchObject({
      data: "qq",
      seq: 1,
      width: 1280,
    });
    await ws.close();
    await f.harness.lifecycle.dispose();
    expect(f.release).not.toHaveBeenCalled();
  });
  it("rejects a client host override rather than silently changing placement", async () => {
    const f = await fixture();
    await expect(
      f.harness.behavior.callRpc("start", {
        threadId: "thread_one",
        hostId: "host_pro",
      }),
    ).rejects.toThrow("execution host");
    expect(f.calls).toHaveLength(0);
    await f.harness.lifecycle.dispose();
  });
  it("cleans up a failed managed connection without falling back to desktop", async () => {
    const f = await fixture({ connectFails: true });
    await expect(
      f.harness.behavior.callRpc("start", { threadId: "thread_one" }),
    ).rejects.toThrow("Connection failed");
    expect(f.calls.some((c) => c.method === "release")).toBe(true);
    expect(f.create).not.toHaveBeenCalled();
    await f.harness.lifecycle.dispose();
  });
  it("reconnects managed profiles on the thread host and stops on close", async () => {
    const f = await fixture();
    const r: any = await f.harness.behavior.callRpc("start", {
      threadId: "thread_one",
    });
    const next: any = await f.harness.behavior.callRpc("reconnect", {
      id: r.session.id,
    });
    expect(next.session.profileId).toBe(r.session.id);
    expect(next.session.id).not.toBe(r.session.id);
    await f.harness.behavior.callRpc("close", { id: next.session.id });
    expect(f.close).not.toHaveBeenCalled();
    await f.harness.lifecycle.dispose();
  });
});

it("stops old managed placement after the thread moves instead of submitting there", async () => {
  const options = { executionHost: "host_thread" };
  const f = await fixture(options);
  const r: any = await f.harness.behavior.callRpc("start", {
    threadId: "thread_one",
  });
  options.executionHost = "host_new";
  await expect(
    f.harness.behavior.callRpc("run", {
      id: r.session.id,
      operation: { kind: "command", args: ["get", "title"] },
    }),
  ).rejects.toThrow("moved to another host");
  expect(f.calls.some((c) => c.method === "submit")).toBe(false);
  expect(
    f.calls.some((c) => c.method === "release" && c.hostId === "host_thread"),
  ).toBe(true);
  await f.harness.lifecycle.dispose();
});

it("reuses concurrent starts at the same URL, while explicit new tabs and other threads stay isolated", async () => {
  const f = await fixture();
  const input = { threadId: "thread_one", url: "https://example.com" };
  const results: any[] = await Promise.all(
    Array.from({ length: 8 }, () => f.harness.behavior.callRpc("start", input)),
  );
  expect(new Set(results.map((r) => r.session.id)).size).toBe(1);
  expect(f.calls.filter((c) => c.method === "connect")).toHaveLength(1);
  const fresh: any = await f.harness.behavior.callRpc("start", {
    ...input,
    newTab: true,
  });
  expect(fresh.session.id).not.toBe(results[0].session.id);
  const other: any = await f.harness.behavior.callRpc("start", {
    ...input,
    threadId: "thread_other",
  });
  expect(other.session.id).not.toBe(fresh.session.id);
  expect(f.calls.filter((c) => c.method === "connect")).toHaveLength(3);
  await f.harness.lifecycle.dispose();
});
it("does not replace an existing page when another URL is requested", async () => {
  const f = await fixture();
  const first: any = await f.harness.behavior.callRpc("start", {
    threadId: "thread_one",
    url: "https://example.com/a",
  });
  const next: any = await f.harness.behavior.callRpc("start", {
    threadId: "thread_one",
    url: "https://example.com/b",
  });
  expect(next.session.id).not.toBe(first.session.id);
  expect(
    f.calls.some((c) => c.method === "release" || c.method === "submit"),
  ).toBe(false);
  await f.harness.lifecycle.dispose();
});

it("clears a finished job’s busy indicator when the host omits optional fields", async () => {
  const f = await fixture({ busyOnce: true });
  const input = { threadId: "thread_one", url: "https://example.com" };
  const first: any = await f.harness.behavior.callRpc("start", input);
  expect(first.session.busy).toBe("finished-connect");
  const reused: any = await f.harness.behavior.callRpc("start", input);
  expect(reused.session.id).toBe(first.session.id);
  expect(reused.session.busy).toBeUndefined();
  expect(reused.job.output).not.toContain("Wait for active job");
  await f.harness.lifecycle.dispose();
});

describe("private browser credential requests", () => {
  const request = (id: string) => ({
    id,
    purpose: "Sign in for the requested task",
    fields: [{ selector: "#password", label: "Password", kind: "password" }],
    submitSelector: "button",
  });
  it.each(["submit", "cancel", "error"])(
    "handles %s without putting values in the result",
    async (outcome) => {
      const f = await fixture({ credentialFailure: outcome === "error" });
      try {
        const started: any = await f.harness.behavior.callRpc("start", {
          threadId: base.threadId,
          mode: "managed",
          url: "https://accounts.shopify.com",
        });
        const result = f.harness.behavior.runCli(
          ["credentials", JSON.stringify(request(started.session.id))],
          { threadId: base.threadId },
        );
        await vi.waitFor(() =>
          expect(f.harness.inspection.pendingInteractions).toHaveLength(1),
        );
        const interaction = f.harness.inspection.pendingInteractions[0];
        expect(interaction.payload).toEqual({
          origin: "https://accounts.shopify.com",
          purpose: "Sign in for the requested task",
          fields: [{ label: "Password", kind: "password" }],
        });
        if (outcome === "cancel")
          f.harness.behavior.cancelInteraction(interaction.id);
        else
          f.harness.behavior.submitInteraction(interaction.id, [
            "dummy-secret",
          ]);
        const completed = await result;
        expect(JSON.stringify(completed)).not.toContain("dummy-secret");
        expect(completed.exitCode).toBe(outcome === "error" ? 1 : 0);
        expect(
          f.calls.filter((c) => c.method === "credentialFill"),
        ).toHaveLength(outcome === "cancel" ? 0 : 1);
        expect(
          f.calls.filter((c) => c.method === "credentialCancel"),
        ).toHaveLength(1);
      } finally {
        await f.harness.lifecycle.dispose();
      }
    },
  );
  it("refuses another thread before preparing credentials", async () => {
    const f = await fixture();
    try {
      const started: any = await f.harness.behavior.callRpc("start", {
        threadId: base.threadId,
        mode: "managed",
      });
      const result = await f.harness.behavior.runCli(
        ["credentials", JSON.stringify(request(started.session.id))],
        { threadId: "another-thread" },
      );
      expect(result.exitCode).toBe(1);
      expect(f.calls.some((c) => c.method === "credentialPrepare")).toBe(false);
    } finally {
      await f.harness.lifecycle.dispose();
    }
  });
  it("returns a running credentials job that the agent can poll", async () => {
    const f = await fixture();
    try {
      const started: any = await f.harness.behavior.callRpc("start", {
        threadId: base.threadId,
        mode: "managed",
        url: "https://accounts.shopify.com",
      });
      const job: any = await f.harness.behavior.callRpc(
        "credentials",
        request(started.session.id),
      );
      expect(job.status).toBe("running");
      expect(job.kind).toBe("credentials");
      expect(JSON.stringify(job)).not.toContain("dummy-secret");
      await vi.waitFor(() =>
        expect(f.harness.inspection.pendingInteractions).toHaveLength(1),
      );
      f.harness.behavior.submitInteraction(
        f.harness.inspection.pendingInteractions[0].id,
        ["dummy-secret"],
      );
      await vi.waitFor(async () => {
        const polled: any = await f.harness.behavior.callRpc("job", {
          hostId: started.session.hostId,
          id: job.id,
        });
        expect(polled.status).toBe("succeeded");
        expect(polled.output).toContain('"filled":true');
        expect(polled.output).toContain("not a successful login");
        expect(JSON.stringify(polled)).not.toContain("dummy-secret");
      });
    } finally {
      await f.harness.lifecycle.dispose();
    }
  });
});
