// Test-only server: loopback, dummy account values, no real 1Password connection.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { serve } from "../service/node_modules/@hono/node-server/dist/index.mjs";
import { serveStatic } from "../service/node_modules/@hono/node-server/dist/serve-static.mjs";
import { Store, hash } from "../service/src/store.ts";
import { configSchema, mappingSchema } from "../service/src/schema.ts";
import { createApp } from "../service/src/api.ts";
const dir = mkdtempSync(join(tmpdir(), "onepassword-e2e-")),
  store = new Store(dir, randomBytes(32));
const config = configSchema.parse({
  origin: "http://localhost:43819",
  allowLocalHttp: true,
  dataDir: dir,
  keyFile: join(dir, "key"),
  bootstrapHash: hash("test-enrollment-code"),
  clients: [
    {
      id: "bb",
      label: "Test BB",
      tokenHash: hash("test-client-token"),
      projectIds: ["test-project"],
    },
  ],
  workers: [
    {
      id: "worker",
      label: "Test worker",
      tokenHash: hash("test-worker-token"),
    },
  ],
});
store.saveMapping(
  mappingSchema.parse({
    id: "approval-test",
    label: "Try passkey approval",
    kind: "demo",
    projectIds: ["test-project"],
    workerId: "worker",
    profile: "demo",
  }),
);
const app = createApp(config, store, async () => ({
  PASSWORD: "dummy-only-password",
  USERNAME: "dummy-user",
}));
app.get("/fixture/login", (c) =>
  c.html(
    '<!doctype html><html><body><form action="/fixture/login" method="post"><input name="username" id="username"><input name="password" id="password" type="password"><button id="submit">Sign in</button></form></body></html>',
  ),
);
app.post("/fixture/login", async (c) => {
  const data = await c.req.parseBody();
  if (data.username !== "dummy-user" || data.password !== "dummy-only-password")
    return c.text("Rejected", 403);
  c.header(
    "Set-Cookie",
    "fixture=yes; HttpOnly; SameSite=Strict; Path=/fixture",
  );
  return c.redirect("/fixture/home");
});
app.get("/fixture/home", (c) => {
  if (!c.req.header("cookie")?.includes("fixture=yes"))
    return c.redirect("/fixture/login");
  return c.html(
    '<!doctype html><html><body><h1 id="success">Signed in</h1><p id="status">Private dummy-only-password</p><form action="/fixture/note" method="post"><input id="note" name="note"><button id="save">Save note</button></form></body></html>',
  );
});
app.post("/fixture/note", async (c) => {
  if (!c.req.header("cookie")?.includes("fixture=yes"))
    return c.text("Rejected", 403);
  return c.html(
    '<!doctype html><html><body><h1 id="success">Saved</h1><p id="status">Note saved</p></body></html>',
  );
});
app.use("*", serveStatic({ root: resolve("service/dist/public") }));
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 43819 });
process.on("SIGTERM", () =>
  server.close(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  }),
);
