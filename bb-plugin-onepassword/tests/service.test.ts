import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Store, hash } from "../service/src/store";
import {
  configSchema,
  mappingSchema,
  type CredentialRequest,
} from "../service/src/schema";
import { createApp } from "../service/src/api";
import { runCommand, redact } from "../service/src/worker";
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "op-test-")),
    store = new Store(dir, randomBytes(32));
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const config = configSchema.parse({
    origin: "https://approve.example.test",
    dataDir: dir,
    keyFile: join(dir, "key"),
    bootstrapHash: hash("bootstrap"),
    clients: [
      { id: "bb", label: "BB", tokenHash: hash("client"), projectIds: ["p1"] },
      {
        id: "other",
        label: "Other",
        tokenHash: hash("other"),
        projectIds: ["p1"],
      },
    ],
    workers: [
      { id: "worker", label: "Worker", tokenHash: hash("worker") },
      { id: "wrong", label: "Wrong", tokenHash: hash("wrong") },
    ],
  });
  let reads = 0;
  const app = createApp(config, store, async () => {
    reads++;
    return { PASSWORD: "dummy-secret", USERNAME: "dummy-user" };
  });
  const mapping = mappingSchema.parse({
    id: "m1",
    label: "Development",
    kind: "environment",
    projectIds: ["p1"],
    workerId: "worker",
    profile: "test",
    profileDigest: "a".repeat(64),
    fields: { API_KEY: "op://automation/dev/key" },
  });
  store.saveMapping(mapping);
  const call = async (
    path: string,
    body?: unknown,
    token = "client",
    extra: Record<string, string> = {},
  ) => {
    const response = await app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: (await response.json()) as any };
  };
  const request = () => ({
    mappingId: "m1",
    projectId: "p1",
    threadId: "t1",
    reason: "Run integration check",
    idempotencyKey: randomUUID(),
  });
  return {
    dir,
    store,
    config,
    app,
    call,
    mapping,
    request,
    reads: () => reads,
  };
}
describe("approval service boundaries", () => {
  it("rejects unauthorized clients, cross-project requests, and owner CSRF", async () => {
    const f = fixture();
    expect((await f.call("/v1/status", undefined, "bad")).status).toBe(401);
    expect(
      (await f.call("/v1/requests", { ...f.request(), projectId: "other" }))
        .status,
    ).toBe(403);
    expect((await f.call("/owner/requests/x/deny", {})).status).toBe(403);
    expect(
      (
        await f.call("/owner/requests/x/deny", {}, "client", {
          origin: f.config.origin,
        })
      ).status,
    ).toBe(401);
  });
  it("cannot reveal values or claim before approval; idempotency does not duplicate execution", async () => {
    const f = fixture();
    f.store.setToken("dummy-token");
    const input = f.request(),
      a = await f.call("/v1/requests", input),
      b = await f.call("/v1/requests", input);
    expect(a.status).toBe(201);
    expect(a.data.request.id).toBe(b.data.request.id);
    expect(
      (await f.call("/v1/requests", { ...input, reason: "Different intent" }))
        .status,
    ).toBe(409);
    expect(f.store.all()).toHaveLength(1);
    expect((await f.call("/worker/claim", {}, "worker")).data.job).toBeNull();
    expect(f.reads()).toBe(0);
    expect(JSON.stringify(await f.call("/v1/mappings"))).not.toContain("op://");
    expect(JSON.stringify(await f.call("/v1/requests"))).not.toContain(
      "dummy-token",
    );
  });
  it("claims an approval once and confines workers and clients", async () => {
    const f = fixture();
    f.store.setToken("dummy-token");
    const { data } = await f.call("/v1/requests", f.request()),
      id = data.request.id;
    f.store.transition(id, ["pending"], "approved");
    expect((await f.call("/worker/claim", {}, "wrong")).data.job).toBeNull();
    const results = await Promise.all([
      f.call("/worker/claim", {}, "worker"),
      f.call("/worker/claim", {}, "worker"),
    ]);
    expect(results.filter((x) => x.data.job)).toHaveLength(1);
    expect(f.reads()).toBe(1);
    expect(
      (await f.call("/v1/requests/" + id + "/cancel", {}, "other")).status,
    ).toBe(404);
    expect(
      (
        await f.call(
          "/worker/requests/" + id + "/result",
          { ok: true, summary: "Done", exitCode: 0, output: "" },
          "wrong",
        )
      ).status,
    ).toBe(404);
    await f.call("/v1/requests/" + id + "/cancel", {});
    expect(
      (
        await f.call(
          "/worker/requests/" + id + "/result",
          { ok: true, summary: "Done", exitCode: 0, output: "" },
          "worker",
        )
      ).data.accepted,
    ).toBe(false);
  });
  it("expires approvals and invalidates mappings without resolving secrets", async () => {
    const f = fixture();
    f.store.setToken("dummy-token");
    const { data } = await f.call("/v1/requests", f.request()),
      id = data.request.id;
    f.store.saveMapping({ ...f.mapping, label: "Changed" });
    expect(f.store.request(id)?.status).toBe("cancelled");
    const r: CredentialRequest = {
      ...f.store.request(id)!,
      id: randomUUID(),
      input: { ...f.request() },
      status: "pending",
      expiresAt: Date.now() - 1,
    };
    f.store.insert(r);
    expect(f.store.transition(r.id, ["pending"], "approved")?.status).toBe(
      "expired",
    );
    expect((await f.call("/worker/claim", {}, "worker")).data.job).toBeNull();
  });
  it("stores the account token encrypted and challenges expire, bind, and consume once", () => {
    const f = fixture(),
      value = "sensitive-dummy-value";
    f.store.setToken(value);
    expect(f.store.token()).toBe(value);
    expect(f.store.get("token")).not.toBe(value);
    const c = f.store.challenge("approve", "r1", "random");
    expect(f.store.takeChallenge(c, "approve", "r2")).toBeUndefined();
    expect(f.store.takeChallenge(c, "approve", "r1")).toBe("random");
    expect(f.store.takeChallenge(c, "approve", "r1")).toBeUndefined();
    const expired = f.store.challenge("approve", "r1", "expired");
    f.store.db
      .prepare("UPDATE challenges SET expires=0 WHERE id=?")
      .run(expired);
    expect(f.store.takeChallenge(expired, "approve", "r1")).toBeUndefined();
    expect(
      readFileSync(join(f.dir, "onepassword.sqlite")).includes(
        Buffer.from(value),
      ),
    ).toBe(false);
  });
  it("disallows unauthenticated or mismatched-origin enrollment", async () => {
    const f = fixture();
    expect(
      (await f.call("/auth/register/options", { bootstrap: "bootstrap" }))
        .status,
    ).toBe(403);
    expect(
      (
        await f.call(
          "/auth/register/options",
          { bootstrap: "wrong" },
          "client",
          { origin: f.config.origin },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.call(
          "/auth/register/options",
          { bootstrap: "bootstrap" },
          "client",
          { origin: f.config.origin },
        )
      ).data.options.authenticatorSelection.userVerification,
    ).toBe("required");
  });
  it("does not expose protected browser controls before login or across clients", async () => {
    const f = fixture();
    f.store.setToken("token");
    const { data } = await f.call("/v1/requests", f.request()),
      id = data.request.id;
    f.store.transition(id, ["pending"], "approved");
    f.store.transition(id, ["approved"], "running");
    expect(
      (await f.call("/v1/browser/" + id + "/actions", { kind: "inspect" }))
        .status,
    ).toBe(409);
    f.store.set("browser:" + id, { controls: [], url: "https://example.test" });
    expect((await f.call("/v1/browser/" + id, undefined, "other")).status).toBe(
      404,
    );
    await f.call("/v1/browser/" + id + "/actions", { kind: "inspect" });
    expect(
      (await f.call("/v1/browser/" + id + "/actions", { kind: "inspect" }))
        .status,
    ).toBe(409);
    expect(
      (await f.call("/worker/browser/" + id + "/next", undefined, "worker"))
        .data.action.kind,
    ).toBe("inspect");
    expect(
      (await f.call("/worker/browser/" + id + "/next", undefined, "worker"))
        .data.action,
    ).toBeNull();
  });
});
describe("protected process", () => {
  const job = () => ({
    requestId: randomUUID(),
    mapping: mappingSchema.parse({
      id: "test",
      label: "Test",
      projectIds: ["p1"],
      kind: "environment",
      workerId: "worker",
      profile: "test",
      profileDigest: "a".repeat(64),
      fields: { API_KEY: "op://test/key/value" },
    }),
    input: {
      mappingId: "test",
      projectId: "p1",
      threadId: "t1",
      reason: "Test",
      idempotencyKey: randomUUID(),
    },
    values: { API_KEY: "dummy-secret" },
    deadline: Date.now() + 10000,
  });
  it("injects only selected values, masks output, and does not inherit service environment", async () => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "never-inherit";
    try {
      const result = await runCommand(
        job(),
        {
          kind: "environment",
          executable: process.execPath,
          args: [
            "-e",
            'console.log(process.env.API_KEY); console.log(process.env.OP_SERVICE_ACCOUNT_TOKEN ?? "absent")',
          ],
          cwd: tmpdir(),
          uid: process.getuid!(),
          gid: process.getgid!(),
          baseEnv: {},
          returnOutput: true,
        },
        new AbortController().signal,
      );
      expect(result.ok).toBe(true);
      expect(result.output).toContain("[redacted]");
      expect(result.output).toContain("absent");
      expect(result.output).not.toContain("dummy-secret");
    } finally {
      delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
    }
  });
  it("withholds output by default and kills cancelled commands", async () => {
    const controller = new AbortController();
    const promise = runCommand(
      job(),
      {
        kind: "environment",
        executable: process.execPath,
        args: ["-e", 'console.log("private output");setInterval(()=>{},1000)'],
        cwd: tmpdir(),
        uid: process.getuid!(),
        gid: process.getgid!(),
        baseEnv: {},
        returnOutput: false,
      },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 100);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.output).toBe("");
  });
  it("rejects reserved variables and masks common encodings", async () => {
    expect(
      redact("dummy%20secret ZHVtbXkgc2VjcmV0", { KEY: "dummy secret" }),
    ).toBe("[redacted] [redacted]");
    const result = await runCommand(
      { ...job(), values: { NODE_OPTIONS: "--inspect" } },
      {
        kind: "environment",
        executable: process.execPath,
        args: [],
        cwd: tmpdir(),
        uid: process.getuid!(),
        gid: process.getgid!(),
        baseEnv: {},
        returnOutput: false,
      },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("reserved");
  });
});
