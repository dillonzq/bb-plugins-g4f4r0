import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "../service/src/store";
import { createDemoApp } from "../service/src/demo";
it("demo rejects account credentials, mappings and worker access independently of the UI", async () => {
  const dir = mkdtempSync(join(tmpdir(), "op-demo-test-")),
    store = new Store(dir, randomBytes(32));
  try {
    const app = createDemoApp(
      store,
      "https://demo.example.com",
      "p1",
      "t1",
      resolve("service/dist/public"),
    );
    for (const path of [
      "/owner/action/options",
      "/owner/action/verify",
      "/worker/claim",
    ])
      expect(
        (
          await app.request(path, {
            method: "POST",
            headers: {
              origin: "https://demo.example.com",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              kind: "token",
              token: "never-store-this-dummy-token",
            }),
          })
        ).status,
      ).toBe(403);
    expect(store.token()).toBeNull();
    expect(store.mappings().every((m) => m.kind === "demo")).toBe(true);
    expect(
      (await app.request("/demo/request", { method: "POST" })).status,
    ).toBe(401);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("demo uses real owner sessions and creates only credential-free requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "op-demo-test-")),
    store = new Store(dir, randomBytes(32));
  try {
    const app = createDemoApp(
        store,
        "https://demo.example.com",
        "p1",
        "t1",
        resolve("service/dist/public"),
      ),
      session = store.session();
    const response = await app.request("/demo/request", {
      method: "POST",
      headers: {
        origin: "https://demo.example.com",
        cookie: "owner=" + session,
      },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as any;
    expect(body.request.kind).toBe("demo");
    expect(body.request.variables).toEqual([]);
    expect(body.request.reason).toContain("does not contact Shopify");
    const again = await app.request("/demo/request", {
      method: "POST",
      headers: {
        origin: "https://demo.example.com",
        cookie: "owner=" + session,
      },
    });
    expect(((await again.json()) as any).request.id).toBe(body.request.id);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
