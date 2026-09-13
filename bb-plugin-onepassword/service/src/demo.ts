/** Disposable approval demo. It has no account token, workers, or real secrets. */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createApp } from "./api.js";
import { Store, hash, secret } from "./store.js";
import { configSchema, mappingSchema, publicRequest } from "./schema.js";

export function createDemoApp(
  store: Store,
  origin: string,
  projectId: string,
  threadId: string,
  publicRoot: string,
) {
  const bootstrap = secret();
  const config = configSchema.parse({
    origin,
    allowLocalHttp: origin.startsWith("http://localhost:"),
    dataDir: "/unused-demo",
    keyFile: "/unused-demo",
    bootstrapHash: hash(bootstrap),
    clients: [],
    workers: [],
  });
  const mapping = mappingSchema.parse({
    id: "shopify-demo",
    label: "Shopify sign-in · simulation",
    kind: "demo",
    projectIds: [projectId],
    workerId: "demo",
    profile: "passkey-only",
    maxSeconds: 30,
  });
  store.saveMapping(mapping);
  const app = new Hono();
  // Reject these routes before the production router can accept any account token,
  // credential mapping, or worker. Hiding settings alone would not be a boundary.
  app.all("/owner/action/*", (c) =>
    c.json(
      {
        error: "This demo cannot accept account tokens or credential mappings.",
      },
      403,
    ),
  );
  app.all("/worker/*", (c) =>
    c.json({ error: "This demo has no credential workers." }, 403),
  );
  app.get("/demo/enrollment", (c) => {
    c.header("Cache-Control", "no-store");
    if (store.get<unknown[]>("passkeys")?.length)
      return c.json({ error: "Already enrolled." }, 409);
    return c.json({ bootstrap });
  });
  app.get("/demo/status", (c) => {
    store.expire();
    c.header("Cache-Control", "no-store");
    return c.json({
      demo: true,
      realCredentials: false,
      enrolled: !!store.get<unknown[]>("passkeys")?.length,
      requests: store.all().map((r) => publicRequest(r)),
    });
  });
  app.post("/demo/request", (c) => {
    if (
      c.req.header("origin") !== origin ||
      !store.authenticated(getCookie(c, "owner") ?? "")
    )
      return c.json(
        { error: "Create your demo passkey and unlock approvals first." },
        401,
      );
    store.expire();
    const pending = store.all().find((r) => r.status === "pending");
    if (pending) return c.json({ request: publicRequest(pending) });
    const now = Date.now();
    const request = {
      id: randomUUID(),
      clientId: "demo",
      input: {
        mappingId: mapping.id,
        projectId,
        threadId,
        reason:
          "Simulate a Shopify sign-in approval. This test does not contact Shopify or read your 1Password vault.",
        idempotencyKey: randomUUID(),
      },
      mapping,
      status: "pending" as const,
      createdAt: now,
      expiresAt: now + 300000,
      startedAt: null,
      endedAt: null,
      result: null,
    };
    store.insert(request);
    return c.json({ request: publicRequest(request) }, 201);
  });
  // Give the passkey a visibly different name from a future production enrollment.
  app.use("/auth/register/options", async (c, next) => {
    await next();
    if (c.res.ok) {
      const body = await c.res.json();
      body.options.rp.name = "BB 1Password approval demo";
      c.res = new Response(JSON.stringify(body), {
        status: c.res.status,
        headers: c.res.headers,
      });
    }
  });
  app.route(
    "/",
    createApp(config, store, async () => {
      throw Error("Real secrets are disabled in this demo.");
    }),
  );
  app.get("/", (c) => {
    const html = readFileSync(join(publicRoot, "index.html"), "utf8")
      .replace(
        "<title>1Password · BB approvals</title>",
        "<title>1Password approval demo</title>",
      )
      .replace(
        "</head>",
        '<link rel="stylesheet" href="/demo.css"><script type="module" src="/demo.js"></script></head>',
      )
      .replace(
        '<main id="app"',
        `<section class="notice demo-notice"><strong>Live passkey test · simulated Shopify login</strong><p>You will use a real passkey, which you can save in 1Password. This demo cannot access your vault or sign in to Shopify.</p><ol><li>Create a demo passkey in 1Password.</li><li>Unlock approvals with that passkey.</li><li>Start the request below, then choose “Approve with passkey”.</li></ol><button id="demo-request">Start Shopify approval test</button><p id="demo-message" role="status"></p></section><main id="app"`,
      );
    return c.html(html);
  });
  app.use("*", serveStatic({ root: publicRoot }));
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [origin, portString = "43820"] = process.argv.slice(2);
  if (!origin)
    throw Error("Usage: node dist/demo.js https://your-demo-origin [port]");
  const port = Number(portString);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Invalid port.");
  const dir = mkdtempSync(join(tmpdir(), "bb-onepassword-demo-")),
    store = new Store(dir, randomBytes(32));
  const app = createDemoApp(
    store,
    origin,
    process.env.BB_PROJECT_ID ?? "demo-project",
    process.env.BB_THREAD_ID ?? "demo-thread",
    fileURLToPath(new URL("./public", import.meta.url)),
  );
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    server.close(() => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
      if (process.env.ONEPASSWORD_DEMO_BB_SHARE === "1") {
        try {
          execFileSync("bb", ["connect", "unexpose", String(port)], {
            stdio: "ignore",
            timeout: 10000,
          });
        } catch {}
      }
      process.exit(0);
    });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  setTimeout(stop, 3600000).unref();
  console.log(
    "Credential-free approval demo ready at " +
      origin +
      " (expires in one hour).",
  );
}
