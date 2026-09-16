import { expect, it, vi } from "vitest";
import { BrowserDriver } from "../src/driver";
import type { Cdp } from "../src/cdp";

function fixture() {
  const listeners: Array<(method: string, params: any) => void> = [];
  const send = vi.fn(async (method: string) => {
    if (method === "Accessibility.getFullAXTree")
      return {
        nodes: [
          {
            role: { value: "button" },
            name: { value: "Save" },
            backendDOMNodeId: 42,
            properties: [],
          },
          {
            role: { value: "InlineTextBox" },
            name: { value: "Large page text must not leak into interactive snapshots" },
            backendDOMNodeId: 43,
            properties: [],
          },
          {
            role: { value: "table" },
            name: { value: "A data table" },
            backendDOMNodeId: 44,
            properties: [],
          },
        ],
      };
    if (method === "DOM.getContentQuads") return { quads: [[0, 0, 20, 0, 20, 10, 0, 10]] };
    if (method === "DOM.resolveNode") return { object: { objectId: "node" } };
    if (method === "Runtime.callFunctionOn") return { result: { value: "Save" } };
    return {};
  });
  const cdp = {
    send,
    evaluate: vi.fn(async () => "complete"),
    onEvent: (listener: (method: string, params: any) => void) => {
      listeners.push(listener);
      return () => {};
    },
  } as unknown as Cdp;
  return { cdp, send, listeners };
}

it("binds accessibility refs without enabling Runtime event instrumentation", async () => {
  const { cdp, send } = fixture();
  const driver = await BrowserDriver.connect("/tmp", cdp, new AbortController().signal);
  const snapshot = JSON.parse(await driver.execute(["snapshot", "-i"]));
  expect(snapshot.data.snapshot).toContain('@0-0 button: "Save"');
  expect(snapshot.data.snapshot).not.toContain("Large page text");
  expect(snapshot.data.snapshot).not.toContain("data table");
  await driver.execute(["click", "@0-0"]);
  expect(send).toHaveBeenCalledWith("DOM.getContentQuads", { backendNodeId: 42 });
  expect(send.mock.calls.some(([method]) => method === "Runtime.enable")).toBe(false);
  await driver.execute(["console"]);
  expect(send.mock.calls.some(([method]) => method === "Runtime.enable")).toBe(true);
});

it("rejects stale accessibility references", async () => {
  const { cdp } = fixture();
  const driver = await BrowserDriver.connect("/tmp", cdp, new AbortController().signal);
  await expect(driver.execute(["click", "@missing"])).rejects.toThrow("Unknown or stale reference");
});

it("supplements interactive snapshots with visible non-semantic controls", async () => {
  const { cdp } = fixture();
  (cdp.evaluate as any).mockImplementation(async (expression: string) => expression.includes("DOM observations supplement") ? {
    elements: [
      { selector: "#save", tag: "button", label: "Save" },
      { selector: "#area span:nth-of-type(2)", tag: "span", role: "button", label: "Custom link", expanded: "false" },
    ],
  } : "complete");
  const driver = await BrowserDriver.connect("/tmp", cdp, new AbortController().signal);
  const snapshot = JSON.parse(await driver.execute(["snapshot", "-i"]));
  expect(snapshot.data.snapshot.match(/Save/g)).toHaveLength(1);
  expect(snapshot.data.snapshot).toContain('selector "#area span:nth-of-type(2)" button: "Custom link" (expanded=false)');
  expect(snapshot.data.referenceSyntax).toContain("DOM selectors");
});

it("drags through intermediate points and crosses the target midpoint", async () => {
  const { cdp, send } = fixture();
  (cdp.evaluate as any).mockImplementation(async (expression: string) => {
    if (expression.includes('const selector="#from"')) return { x: 10, y: 10, width: 100, height: 20 };
    if (expression.includes('const selector="#to"')) return { x: 10, y: 70, width: 100, height: 20 };
    return "complete";
  });
  const driver = await BrowserDriver.connect("/tmp", cdp, new AbortController().signal);
  const result = JSON.parse(await driver.execute(["drag", "#from", "#to"]));
  expect(result.data).toMatchObject({ placement: "auto", axis: "vertical" });
  const events = (send.mock.calls as any[]).filter(([method]) => method === "Input.dispatchMouseEvent").map(([, params]) => params);
  expect(events[0]).toMatchObject({ type: "mouseMoved", x: 60, y: 20, buttons: 0 });
  expect(events[1]).toMatchObject({ type: "mousePressed", x: 60, y: 20, buttons: 1 });
  expect(events.filter((event) => event.type === "mouseMoved" && event.buttons === 1)).toHaveLength(12);
  expect(events.at(-1)).toMatchObject({ type: "mouseReleased", x: 60, y: 87, buttons: 0 });
});

it("rejects unknown drag placement", async () => {
  const { cdp } = fixture();
  const driver = await BrowserDriver.connect("/tmp", cdp, new AbortController().signal);
  await expect(driver.execute(["drag", "#from", "#to", "near"])).rejects.toThrow("Drag placement must be auto, before, after, or center");
});

it("reports dialog state without dismissing it", async () => {
  const { cdp, send, listeners } = fixture();
  const driver = await BrowserDriver.connect("/tmp", cdp, new AbortController().signal);
  listeners[0]("Page.javascriptDialogOpening", {
    type: "confirm",
    message: "Continue?",
  });
  const status = JSON.parse(await driver.execute(["dialog", "status"]));
  expect(status.data).toEqual({ open: true, type: "confirm", message: "Continue?" });
  expect(send.mock.calls.some(([method]) => method === "Page.handleJavaScriptDialog")).toBe(false);
  await driver.execute(["dialog", "accept"]);
  expect(send).toHaveBeenCalledWith("Page.handleJavaScriptDialog", {
    accept: true,
    promptText: "",
  });
});
