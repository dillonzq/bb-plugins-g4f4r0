import { describe, expect, it, vi } from "vitest";
import {
  DEVTOOLS_LAYOUT,
  openDevToolsLayout,
  restorePageWindow,
} from "../src/devtools-layout";

describe("DevTools window layout", () => {
  it("opens once, docks both windows, and focuses the inspector", async () => {
    let opened = false;
    const send = vi.fn(async (method: string, params: any) => {
      if (method === "Target.getTargets")
        return {
          targetInfos: [
            { type: "page", targetId: "page", url: "https://example.com" },
            ...(opened
              ? [{ type: "page", targetId: "devtools", url: "devtools://devtools/bundled/inspector.html" }]
              : []),
          ],
        };
      if (method === "Browser.getWindowForTarget")
        return { windowId: params.targetId === "page" ? 1 : 2 };
      return {};
    });
    const trigger = vi.fn(async () => {
      opened = true;
    });
    const state = await openDevToolsLayout(
      { send },
      "page",
      trigger,
      new AbortController().signal,
    );
    expect(trigger).toHaveBeenCalledOnce();
    expect(state).toEqual({
      targetId: "devtools",
      pageWindowId: 1,
      devtoolsWindowId: 2,
    });
    expect(send).toHaveBeenCalledWith(
      "Browser.setWindowBounds",
      {
        windowId: 1,
        bounds: {
          left: 0,
          top: 0,
          width: DEVTOOLS_LAYOUT.pageWidth,
          height: DEVTOOLS_LAYOUT.displayHeight,
        },
      },
      false,
      2000,
    );
    expect(send).toHaveBeenCalledWith(
      "Browser.setWindowBounds",
      {
        windowId: 2,
        bounds: {
          left: DEVTOOLS_LAYOUT.pageWidth,
          top: 0,
          width: DEVTOOLS_LAYOUT.devtoolsWidth,
          height: DEVTOOLS_LAYOUT.displayHeight,
        },
      },
      false,
      2000,
    );
    expect(send).toHaveBeenCalledWith(
      "Target.activateTarget",
      { targetId: "devtools" },
      false,
      2000,
    );
  });

  it("reuses an existing inspector without sending the shortcut", async () => {
    const send = vi.fn(async (method: string, params: any) => {
      if (method === "Target.getTargets")
        return {
          targetInfos: [
            { type: "page", targetId: "page", url: "https://example.com" },
            { type: "page", targetId: "devtools", url: "devtools://devtools/inspector" },
          ],
        };
      if (method === "Browser.getWindowForTarget")
        return { windowId: params.targetId === "page" ? 1 : 2 };
      return {};
    });
    const trigger = vi.fn(async () => {});
    await openDevToolsLayout(
      { send },
      "page",
      trigger,
      new AbortController().signal,
    );
    expect(trigger).not.toHaveBeenCalled();
  });

  it("restores the browser window to the full display", async () => {
    const send = vi.fn(async () => ({}));
    await restorePageWindow({ send }, "page", 7);
    expect(send).toHaveBeenCalledWith(
      "Browser.setWindowBounds",
      {
        windowId: 7,
        bounds: {
          left: 0,
          top: 0,
          width: DEVTOOLS_LAYOUT.displayWidth,
          height: DEVTOOLS_LAYOUT.displayHeight,
        },
      },
      false,
      2000,
    );
    expect(send).toHaveBeenCalledWith(
      "Target.activateTarget",
      { targetId: "page" },
      false,
      2000,
    );
  });
});
