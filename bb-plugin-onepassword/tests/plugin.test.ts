import { expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { serviceOrigin } from "../src/client";
it("loads all surfaces with no credentials and gives useful onboarding", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "onepassword" });
  try {
    await plugin(bb);
    const state = await harness.behavior.callRpc("state", null);
    expect(state).toMatchObject({
      configured: false,
      available: false,
      requests: [],
    });
    const cli = await harness.behavior.runCli(["status", "--json"]);
    expect(cli.exitCode).toBe(0);
    expect(JSON.parse(cli.stdout!)).toMatchObject({ configured: false });
    expect(
      (await harness.behavior.runCli(["request", "map", "reason"])).exitCode,
    ).toBe(1);
  } finally {
    await harness.lifecycle.dispose();
  }
});
it("rejects insecure or deceptive broker addresses", () => {
  for (const value of [
    "http://approve.example.com",
    "https://user:pass@approve.example.com",
    "https://approve.example.com/path",
    "https://approve.example.com/",
  ])
    expect(() => serviceOrigin(value)).toThrow();
  expect(serviceOrigin("https://approve.example.com")).toBe(
    "https://approve.example.com",
  );
});
it("does not leak errors containing a token from transport", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(Error("private-token-in-network-error")),
  );
  const { bb, harness } = createFakePluginHost({
    pluginId: "onepassword",
    settings: {
      approvalOrigin: "https://approve.example.com",
      clientToken: "private-token",
    },
  });
  try {
    await plugin(bb);
    const result = await harness.behavior.callRpc("state", null);
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(result).toMatchObject({ configured: true, available: false });
  } finally {
    vi.unstubAllGlobals();
    await harness.lifecycle.dispose();
  }
});
it("uses public SDK surfaces", async () => {
  const result = await experimental_scanPublicSdkOnly(process.cwd(), {
    allow: [
      /^@simplewebauthn\//,
      /^@1password\//,
      /^@hono\//,
      /^hono(?:\/|$)/,
      /^playwright-core$/,
      /^vitest(?:\/|$)/,
      /^@playwright\/test$/,
      /^@testing-library\//,
      /^esbuild$/,
      /^react(?:-dom)?(?:\/|$)/,
      /^@\//,
      /^@hugeicons\//,
      /^@radix-ui\//,
      /^(class-variance-authority|clsx|tailwind-merge)$/,
    ],
  });
  expect(result.violations).toEqual([]);
  expect(result.privateDependencies).toEqual([]);
});
