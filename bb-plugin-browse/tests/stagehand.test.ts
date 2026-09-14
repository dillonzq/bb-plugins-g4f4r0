import { it, expect, vi } from "vitest";
const sdk = vi.hoisted(() => ({ connect: vi.fn(), create: vi.fn() }));
vi.mock("../src/runtime", () => ({
  stagehandSdk: async () => ({
    localBrowser: { connect: sdk.connect },
    Stagehand: { create: sdk.create },
  }),
  runtimePath: () => "/runtime",
}));
import { StagehandDriver } from "../src/stagehand";
function fixture() {
  const locator = {
    count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => true),
    click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    hover: vi.fn(async () => {}),
  };
  const page = {
    pageId: "wanted",
    locator: vi.fn(() => locator),
    snapshot: vi.fn(async () => ({
      formattedTree: "[0-19] button: Submit",
      xpathMap: { "0-19": "/html/body/button" },
      urlMap: {},
    })),
    goto: vi.fn(async () => {}),
    url: async () => "https://example.com/",
  };
  const browser = {
    context: { pages: async () => [{ ...page, pageId: "wrong" }, page] },
    close: vi.fn(async () => {}),
  };
  let event = (method: string, p: any) => {};
  const cdp = {
    targetId: "wanted",
    send: vi.fn(async () => {}),
    onEvent: vi.fn((fn: typeof event) => {
      event = fn;
      return () => {};
    }),
  };
  sdk.connect.mockResolvedValue(browser);
  sdk.create.mockResolvedValue({});
  return {
    page,
    browser,
    cdp,
    locator,
    event: (method: string, p: any) => event(method, p),
  };
}
it("pins the Chromium target and uses local deterministic APIs", async () => {
  const f = fixture();
  const driver = await StagehandDriver.connect(
    "/root",
    "ws://private",
    f.cdp as any,
    new AbortController().signal,
  );
  expect(driver.page).toBe(f.page);
  expect(sdk.create).toHaveBeenLastCalledWith({
    browser: f.browser,
    logging: { level: "off" },
  });
  await driver.execute(["snapshot", "-i"]);
  await driver.execute(["click", "@0-19"]);
  expect(f.page.locator).toHaveBeenLastCalledWith("/html/body/button");
  expect(f.locator.click).toHaveBeenCalledOnce();
  f.event("Page.frameNavigated", { frame: { id: "main" } });
  await expect(driver.execute(["click", "@0-19"])).rejects.toThrow(
    "stale reference",
  );
  await driver.close();
  expect(f.browser.close).toHaveBeenCalledOnce();
});
it("does not fall back to a different tab when the bound target is absent", async () => {
  const f = fixture();
  f.cdp.targetId = "gone";
  await expect(
    StagehandDriver.connect(
      "/root",
      "ws://private",
      f.cdp as any,
      new AbortController().signal,
    ),
  ).rejects.toThrow("bind");
  expect(f.browser.close).toHaveBeenCalledOnce();
});
it("rejects ambiguous elements and does not retry failed clicks", async () => {
  const f = fixture();
  const driver = await StagehandDriver.connect(
    "/root",
    "ws://private",
    f.cdp as any,
    new AbortController().signal,
  );
  f.locator.count.mockResolvedValue(2);
  await expect(driver.element("click", "button")).rejects.toThrow(
    "exactly one",
  );
  expect(f.locator.click).not.toHaveBeenCalled();
  f.locator.count.mockResolvedValue(1);
  f.locator.click.mockRejectedValue(new Error("Disconnected after click"));
  await expect(driver.element("click", "button")).rejects.toThrow(
    "Disconnected",
  );
  expect(f.locator.click).toHaveBeenCalledOnce();
  await driver.close();
});
