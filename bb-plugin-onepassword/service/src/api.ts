import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Passkeys } from "./passkeys.js";
import { Store, hash, matches } from "./store.js";
import {
  mappingSchema,
  requestSchema,
  resultSchema,
  publicRequest,
  type Config,
  type CredentialRequest,
} from "./schema.js";
import { resolveSecrets, type ResolveSecrets } from "./provider.js";
const proofSchema = z.object({
  challengeId: z.string().uuid(),
  response: z.any(),
});
const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mapping"), mapping: mappingSchema }).strict(),
  z
    .object({ kind: z.literal("token"), token: z.string().min(20).max(10000) })
    .strict(),
  z.object({ kind: z.literal("disconnect") }).strict(),
  z
    .object({ kind: z.literal("deleteMapping"), id: z.string().max(100) })
    .strict(),
]);
function recent(requests: CredentialRequest[]) {
  return [
    ...requests.filter((r) =>
      ["pending", "approved", "running"].includes(r.status),
    ),
    ...requests
      .filter((r) => !["pending", "approved", "running"].includes(r.status))
      .slice(0, 30),
  ];
}
export function createApp(
  config: Config,
  store: Store,
  resolve: ResolveSecrets = resolveSecrets,
) {
  const app = new Hono(),
    passkeys = new Passkeys(store, config.origin);
  const rates = new Map<string, { at: number; count: number }>();
  app.use(
    "*",
    bodyLimit({
      maxSize: 65536,
      onError: (c) => c.json({ error: "Request too large." }, 413),
    }),
  );
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
    );
    if (config.origin.startsWith("https:"))
      c.header("Strict-Transport-Security", "max-age=31536000");
    // No proxy IP trust: a bounded global budget plus per-token budgets fail closed.
    const budget =
      c.req.path.startsWith("/owner") || c.req.path.startsWith("/auth")
        ? "owner"
        : hash(c.req.header("authorization") ?? "anonymous");
    if (rates.size > 1000) rates.clear();
    const now = Date.now();
    let rate = rates.get(budget);
    if (!rate || now - rate.at > 60000) {
      rate = { at: now, count: 0 };
      rates.set(budget, rate);
    }
    if (++rate.count > (c.req.path.startsWith("/worker/") ? 600 : 180))
      return c.json({ error: "Too many requests. Try again shortly." }, 429);
    if (
      c.req.method !== "GET" &&
      (c.req.path.startsWith("/owner") || c.req.path.startsWith("/auth")) &&
      c.req.header("origin") !== config.origin
    )
      return c.json({ error: "Origin rejected." }, 403);
    store.expire();
    await next();
  });
  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof z.ZodError
            ? "Invalid request."
            : "Request could not be completed. Check configuration or retry verification.",
      },
      400,
    ),
  );
  const bearer = (c: { req: { header: (s: string) => string | undefined } }) =>
    c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
  const client = (c: Parameters<typeof bearer>[0]) =>
    config.clients.find((x) => matches(bearer(c), x.tokenHash));
  const worker = (c: Parameters<typeof bearer>[0]) =>
    config.workers.find((x) => matches(bearer(c), x.tokenHash));
  app.use("/v1/*", async (c, next) => {
    if (!client(c))
      return c.json({ error: "Client authentication required." }, 401);
    await next();
  });
  app.use("/worker/*", async (c, next) => {
    if (!worker(c))
      return c.json({ error: "Worker authentication required." }, 401);
    await next();
  });
  app.use("/owner/*", async (c, next) => {
    if (!store.authenticated(getCookie(c, "owner") ?? ""))
      return c.json({ error: "Unlock with your passkey." }, 401);
    await next();
  });
  app.get("/health", (c) => c.json({ ok: true, version: "0.1.0-alpha.1" }));
  app.get("/auth/status", (c) =>
    c.json({
      enrolled: passkeys.credentials().length > 0,
      authenticated: store.authenticated(getCookie(c, "owner") ?? ""),
      origin: config.origin,
    }),
  );
  app.post("/auth/register/options", async (c) => {
    const body = z
      .object({ bootstrap: z.string().max(200) })
      .parse(await c.req.json());
    if (
      passkeys.credentials().length ||
      !matches(body.bootstrap, config.bootstrapHash)
    )
      return c.json({ error: "Enrollment unavailable." }, 403);
    return c.json(await passkeys.registration());
  });
  app.post("/auth/register/verify", async (c) => {
    const body = proofSchema
      .extend({ bootstrap: z.string().max(200) })
      .parse(await c.req.json());
    if (
      passkeys.credentials().length ||
      !matches(body.bootstrap, config.bootstrapHash)
    )
      return c.json({ error: "Enrollment unavailable." }, 403);
    await passkeys.register(body.challengeId, body.response);
    return c.json({ ok: true });
  });
  app.post("/auth/login/options", async (c) => {
    if (!passkeys.credentials().length)
      return c.json({ error: "Set up the service first." }, 409);
    return c.json(await passkeys.options("login", "owner"));
  });
  app.post("/auth/login/verify", async (c) => {
    const b = proofSchema.parse(await c.req.json());
    await passkeys.verify("login", "owner", b.challengeId, b.response);
    setCookie(c, "owner", store.session(), {
      httpOnly: true,
      secure: config.origin.startsWith("https:"),
      sameSite: "Strict",
      path: "/",
      maxAge: 900,
    });
    return c.json({ ok: true });
  });
  app.post("/owner/logout", (c) => {
    store.logout(getCookie(c, "owner") ?? "");
    deleteCookie(c, "owner", { path: "/" });
    return c.json({ ok: true });
  });
  app.get("/owner/state", (c) =>
    c.json({
      connected: !!store.token(),
      mappings: store.mappings(),
      requests: recent(store.all()).map((r) => publicRequest(r)),
      workers: config.workers.map(({ id, label }) => ({ id, label })),
      clients: config.clients.map(({ id, label, projectIds }) => ({
        id,
        label,
        projectIds,
      })),
      audit: store.db
        .prepare(
          "SELECT at,event,subject FROM audit ORDER BY id DESC LIMIT 100",
        )
        .all(),
    }),
  );
  app.post("/owner/action/options", async (c) => {
    const action = actionSchema.parse(await c.req.json());
    return c.json(
      await passkeys.options("admin", hash(JSON.stringify(action))),
    );
  });
  app.post("/owner/action/verify", async (c) => {
    const b = proofSchema
      .extend({ action: actionSchema })
      .parse(await c.req.json());
    await passkeys.verify(
      "admin",
      hash(JSON.stringify(b.action)),
      b.challengeId,
      b.response,
    );
    const a = b.action;
    if (a.kind === "token") store.setToken(a.token);
    if (a.kind === "mapping") {
      if (
        !config.workers.some((w) => w.id === a.mapping.workerId) &&
        a.mapping.kind !== "demo"
      )
        return c.json({ error: "Unknown worker." }, 400);
      store.saveMapping(a.mapping);
    }
    if (a.kind === "disconnect") {
      store.del("token");
      for (const r of store.all())
        if (["pending", "approved", "running"].includes(r.status))
          store.transition(r.id, [r.status], "cancelled");
      store.audit("connection.disconnected", "1password");
    }
    if (a.kind === "deleteMapping") {
      store.set(
        "mappings",
        store.mappings().filter((m) => m.id !== a.id),
      );
      for (const r of store.all())
        if (
          r.mapping.id === a.id &&
          ["pending", "approved", "running"].includes(r.status)
        )
          store.transition(r.id, [r.status], "cancelled");
      store.audit("mapping.deleted", a.id);
    }
    return c.json({ ok: true });
  });
  app.post("/owner/requests/:id/options", async (c) => {
    const r = store.request(c.req.param("id"));
    if (!r || r.status !== "pending")
      return c.json({ error: "Request is no longer pending." }, 409);
    return c.json(await passkeys.options("approve", r.id));
  });
  app.post("/owner/requests/:id/approve", async (c) => {
    const b = proofSchema.parse(await c.req.json()),
      id = c.req.param("id");
    await passkeys.verify("approve", id, b.challengeId, b.response);
    let r = store.transition(id, ["pending"], "approved");
    if (!r || r.status !== "approved")
      return c.json({ error: "Request expired or changed." }, 409);
    if (r.mapping.kind === "demo") {
      store.transition(id, ["approved"], "running");
      r = store.transition(id, ["running"], "succeeded", {
        ok: true,
        summary: "Passkey verified. No credentials were accessed.",
        exitCode: 0,
        output: "",
      });
    }
    return c.json({ request: r ? publicRequest(r) : null });
  });
  app.post("/owner/requests/:id/deny", (c) => {
    const r = store.transition(
      c.req.param("id"),
      ["pending", "approved", "running"],
      "denied",
    );
    return c.json({ ok: !!r });
  });
  app.get("/v1/status", (c) =>
    c.json({
      connected: !!store.token(),
      enrolled: passkeys.credentials().length > 0,
      approvalOrigin: config.origin,
      version: "0.1.0-alpha.1",
    }),
  );
  app.get("/v1/mappings", (c) => {
    const cl = client(c)!;
    return c.json({
      mappings: store
        .mappings()
        .filter((m) => m.projectIds.some((p) => cl.projectIds.includes(p)))
        .map(({ fields, environmentId, ...m }) => ({
          ...m,
          variables: [
            ...new Set([
              ...(environmentId ? m.variables : []),
              ...Object.keys(fields),
            ]),
          ],
        })),
    });
  });
  app.get("/v1/requests", (c) =>
    c.json({
      requests: recent(
        store.all().filter((r) => r.clientId === client(c)!.id),
      ).map((r) => publicRequest(r)),
    }),
  );
  app.get("/v1/requests/:id", (c) => {
    const r = store.request(c.req.param("id"));
    if (!r || r.clientId !== client(c)!.id)
      return c.json({ error: "Request not found." }, 404);
    return c.json({ request: publicRequest(r, true) });
  });
  app.post("/v1/requests", async (c) => {
    const input = requestSchema.parse(await c.req.json()),
      cl = client(c)!;
    if (!cl.projectIds.includes(input.projectId))
      return c.json({ error: "Project is not authorized." }, 403);
    const old = store.duplicate(cl.id, input.idempotencyKey);
    if (old) {
      if (JSON.stringify(old.input) !== JSON.stringify(input))
        return c.json(
          { error: "Idempotency key was used for a different request." },
          409,
        );
      return c.json({
        request: publicRequest(old),
        approvalUrl: config.origin + "/#request=" + old.id,
      });
    }
    if (
      store
        .all()
        .filter((r) => ["pending", "approved", "running"].includes(r.status))
        .length >= 20
    )
      return c.json({ error: "Too many active requests." }, 429);
    const mapping = store
      .mappings()
      .find(
        (m) =>
          m.id === input.mappingId && m.projectIds.includes(input.projectId),
      );
    if (!mapping)
      return c.json({ error: "Mapping is unavailable for this project." }, 404);
    if (mapping.kind !== "demo" && !store.token())
      return c.json(
        { error: "Connect a service account on the approval site." },
        409,
      );
    if (mapping.kind === "browser") {
      if (
        !input.url ||
        !mapping.origins.includes(new URL(input.url).origin) ||
        new URL(input.url).username ||
        new URL(input.url).password
      )
        return c.json({ error: "Browser destination is not allowed." }, 403);
    } else if (input.url)
      return c.json({ error: "Only browser requests accept a URL." }, 400);
    const r: CredentialRequest = {
      id: randomUUID(),
      clientId: cl.id,
      input,
      mapping,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + 300000,
      startedAt: null,
      endedAt: null,
      result: null,
    };
    store.insert(r);
    return c.json(
      {
        request: publicRequest(r),
        approvalUrl: config.origin + "/#request=" + r.id,
      },
      201,
    );
  });
  app.post("/v1/requests/:id/cancel", (c) => {
    const r = store.request(c.req.param("id"));
    if (!r || r.clientId !== client(c)!.id)
      return c.json({ error: "Request not found." }, 404);
    return c.json({
      request: publicRequest(
        store.transition(
          r.id,
          ["pending", "approved", "running"],
          "cancelled",
        ) ?? r,
      ),
    });
  });
  app.post("/worker/claim", async (c) => {
    const w = worker(c)!,
      candidate = store
        .all()
        .reverse()
        .find((r) => r.mapping.workerId === w.id && r.status === "approved");
    if (!candidate) return c.json({ job: null });
    const r = store.transition(candidate.id, ["approved"], "running");
    if (!r || r.status !== "running") return c.json({ job: null });
    try {
      const token = store.token();
      if (!token) throw Error("Disconnected");
      const values = await resolve(
        r.mapping.kind === "browser"
          ? {
              ...r.mapping,
              fields: Object.fromEntries(
                Object.entries(r.mapping.fields).filter(
                  ([key]) => key !== "TOTP",
                ),
              ),
            }
          : r.mapping,
        token,
      );
      if (
        store.request(r.id)?.status !== "running" ||
        Date.now() >= r.startedAt! + r.mapping.maxSeconds * 1000
      ) {
        store.transition(r.id, ["running"], "expired");
        return c.json({ job: null });
      }
      return c.json({
        job: {
          requestId: r.id,
          mapping: r.mapping,
          input: r.input,
          values,
          deadline: r.startedAt! + r.mapping.maxSeconds * 1000,
        },
      });
    } catch {
      store.transition(r.id, ["running"], "failed", {
        ok: false,
        summary:
          "1Password could not resolve the selected credentials. Check account access and mapping.",
        exitCode: null,
        output: "",
      });
      return c.json({ job: null });
    }
  });
  app.post("/worker/requests/:id/totp", async (c) => {
    const r = store.request(c.req.param("id"));
    if (
      !r ||
      r.status !== "running" ||
      r.mapping.kind !== "browser" ||
      r.mapping.workerId !== worker(c)!.id ||
      !r.mapping.fields.TOTP ||
      store.get("totp:" + r.id)
    )
      return c.json({ error: "TOTP unavailable." }, 409);
    store.set("totp:" + r.id, true);
    const token = store.token();
    if (!token) return c.json({ error: "Disconnected." }, 409);
    const values = await resolve(
      {
        ...r.mapping,
        environmentId: undefined,
        variables: [],
        fields: { TOTP: r.mapping.fields.TOTP },
      },
      token,
    );
    if (
      store.request(r.id)?.status !== "running" ||
      Date.now() >= r.startedAt! + r.mapping.maxSeconds * 1000
    )
      return c.json({ error: "Session expired." }, 409);
    return c.json({ code: values.TOTP });
  });
  app.get("/worker/requests/:id", (c) => {
    const r = store.request(c.req.param("id"));
    if (!r || r.mapping.workerId !== worker(c)!.id)
      return c.json({ error: "Request not found." }, 404);
    return c.json({ status: r.status });
  });
  app.post("/worker/requests/:id/result", async (c) => {
    const result = resultSchema.parse(await c.req.json()),
      r = store.request(c.req.param("id"));
    if (!r || r.mapping.workerId !== worker(c)!.id)
      return c.json({ error: "Request not found." }, 404);
    return c.json({
      accepted: !!store.transition(
        r.id,
        ["running"],
        result.ok ? "succeeded" : "failed",
        result,
      ),
    });
  });
  const browserActionSchema = z
    .object({
      kind: z.enum(["inspect", "click", "fill", "navigate", "close"]),
      control: z.string().max(100).optional(),
      value: z.string().max(4000).optional(),
      url: z.string().url().max(2000).optional(),
    })
    .strict();
  app.get("/v1/browser/:id", (c) => {
    const r = store.request(c.req.param("id"));
    if (!r || r.clientId !== client(c)!.id)
      return c.json({ error: "Session not found." }, 404);
    return c.json({
      status: r.status,
      session: store.get("browser:" + r.id),
      action: store.get("action:" + r.id),
    });
  });
  app.post("/v1/browser/:id/actions", async (c) => {
    const r = store.request(c.req.param("id"));
    if (
      !r ||
      r.clientId !== client(c)!.id ||
      r.status !== "running" ||
      !store.get("browser:" + r.id)
    )
      return c.json({ error: "Session unavailable." }, 409);
    const a = browserActionSchema.parse(await c.req.json());
    if (
      a.url &&
      (!r.mapping.origins.includes(new URL(a.url).origin) ||
        new URL(a.url).username ||
        new URL(a.url).password)
    )
      return c.json({ error: "Destination rejected." }, 403);
    const old = store.get<{ status: string }>("action:" + r.id);
    if (old && ["pending", "running"].includes(old.status))
      return c.json({ error: "An action is already pending." }, 409);
    const action = { ...a, id: randomUUID(), status: "pending" };
    store.set("action:" + r.id, action);
    return c.json({ action });
  });
  app.post("/worker/browser/:id/ready", async (c) => {
    const r = store.request(c.req.param("id"));
    if (!r || r.mapping.workerId !== worker(c)!.id || r.status !== "running")
      return c.json({ error: "Session unavailable." }, 409);
    const b = z
      .object({
        controls: z
          .array(
            z.object({
              id: z.string().max(100),
              kind: z.enum(["click", "fill", "text"]),
            }),
          )
          .max(50),
        url: z.string().url().max(2000),
      })
      .parse(await c.req.json());
    store.set("browser:" + r.id, b);
    return c.json({ ok: true });
  });
  app.get("/worker/browser/:id/next", (c) => {
    const r = store.request(c.req.param("id"));
    if (!r || r.mapping.workerId !== worker(c)!.id || r.status !== "running")
      return c.json({ error: "Session unavailable." }, 409);
    const action = store.get<{ status: string }>("action:" + r.id);
    if (!action || action.status !== "pending") return c.json({ action: null });
    store.set("action:" + r.id, { ...action, status: "running" });
    return c.json({ action });
  });
  app.post("/worker/browser/:id/result", async (c) => {
    const r = store.request(c.req.param("id"));
    if (!r || r.mapping.workerId !== worker(c)!.id || r.status !== "running")
      return c.json({ error: "Session unavailable." }, 409);
    const b = z
        .object({
          id: z.string().uuid(),
          ok: z.boolean(),
          text: z.string().max(16000),
        })
        .strict()
        .parse(await c.req.json()),
      a = store.get<{ id: string; status: string }>("action:" + r.id);
    if (!a || a.id !== b.id || a.status !== "running")
      return c.json({ error: "Action unavailable." }, 409);
    store.set("action:" + r.id, {
      id: b.id,
      status: "complete",
      ok: b.ok,
      text: b.text,
    });
    return c.json({ ok: true });
  });
  return app;
}
