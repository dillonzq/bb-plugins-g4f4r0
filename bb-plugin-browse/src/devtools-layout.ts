import { setTimeout as sleep } from "node:timers/promises";

type BrowserCdp = {
  send(
    method: string,
    params?: Record<string, unknown>,
    page?: boolean,
    timeoutMs?: number,
  ): Promise<any>;
};

export const DEVTOOLS_LAYOUT = {
  displayWidth: 1280,
  displayHeight: 800,
  pageWidth: 720,
  devtoolsWidth: 560,
} as const;

function isDevToolsTarget(target: any) {
  return (
    target?.type === "page" &&
    typeof target.url === "string" &&
    target.url.startsWith("devtools://")
  );
}

async function targets(cdp: BrowserCdp) {
  const result = await cdp.send("Target.getTargets", {}, false, 2000);
  return Array.isArray(result?.targetInfos) ? result.targetInfos : [];
}

async function setWindow(
  cdp: BrowserCdp,
  windowId: number,
  left: number,
  width: number,
) {
  // Chrome rejects geometry alongside a minimized/maximized state. Normalize
  // first, then apply the exact Xvfb split.
  await cdp
    .send(
      "Browser.setWindowBounds",
      { windowId, bounds: { windowState: "normal" } },
      false,
      2000,
    )
    .catch(() => {});
  await cdp.send(
    "Browser.setWindowBounds",
    {
      windowId,
      bounds: {
        left,
        top: 0,
        width,
        height: DEVTOOLS_LAYOUT.displayHeight,
      },
    },
    false,
    2000,
  );
}

export type DevToolsLayoutState = {
  targetId: string;
  pageWindowId: number;
  devtoolsWindowId: number;
};

export async function openDevToolsLayout(
  cdp: BrowserCdp,
  pageTargetId: string,
  trigger: () => Promise<void>,
  signal: AbortSignal,
): Promise<DevToolsLayoutState> {
  signal.throwIfAborted();
  await cdp.send(
    "Target.setDiscoverTargets",
    { discover: true },
    false,
    2000,
  );
  let target = (await targets(cdp)).find(isDevToolsTarget);
  if (!target) {
    await trigger();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      target = (await targets(cdp)).find(isDevToolsTarget);
      if (target) break;
      await sleep(25, undefined, { signal });
    }
  }
  if (!target)
    throw new Error("DevTools did not open. Retry after the browser finishes loading.");

  const [pageWindow, devtoolsWindow] = await Promise.all([
    cdp.send(
      "Browser.getWindowForTarget",
      { targetId: pageTargetId },
      false,
      2000,
    ),
    cdp.send(
      "Browser.getWindowForTarget",
      { targetId: target.targetId },
      false,
      2000,
    ),
  ]);
  if (!Number.isInteger(pageWindow?.windowId) || !Number.isInteger(devtoolsWindow?.windowId))
    throw new Error("DevTools window could not be arranged.");

  await setWindow(cdp, pageWindow.windowId, 0, DEVTOOLS_LAYOUT.pageWidth);
  await setWindow(
    cdp,
    devtoolsWindow.windowId,
    DEVTOOLS_LAYOUT.pageWidth,
    DEVTOOLS_LAYOUT.devtoolsWidth,
  );
  await cdp.send(
    "Target.activateTarget",
    { targetId: target.targetId },
    false,
    2000,
  );
  return {
    targetId: target.targetId,
    pageWindowId: pageWindow.windowId,
    devtoolsWindowId: devtoolsWindow.windowId,
  };
}

export async function restorePageWindow(
  cdp: BrowserCdp,
  pageTargetId: string,
  windowId?: number,
) {
  const pageWindow = Number.isInteger(windowId)
    ? { windowId }
    : await cdp.send(
        "Browser.getWindowForTarget",
        { targetId: pageTargetId },
        false,
        2000,
      );
  if (!Number.isInteger(pageWindow?.windowId)) return;
  await setWindow(cdp, pageWindow.windowId, 0, DEVTOOLS_LAYOUT.displayWidth);
  await cdp
    .send(
      "Target.activateTarget",
      { targetId: pageTargetId },
      false,
      2000,
    )
    .catch(() => {});
}
