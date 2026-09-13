import type { Cdp } from "./cdp";
export async function capturePng(
  c: Cdp,
  fullPage: boolean,
  options: { recording?: boolean } = {},
): Promise<string> {
  let metrics: any;
  const args: Record<string, unknown> = {
    format: "png",
    captureBeyondViewport: fullPage,
  };
  if (fullPage) {
    metrics = await c.send("Page.getLayoutMetrics");
    const r = metrics.cssContentSize ?? metrics.contentSize;
    args.clip = { x: 0, y: 0, width: r.width, height: r.height, scale: 1 };
  }
  try {
    return (await c.send("Page.captureScreenshot", args)).data;
  } catch (e) {
    if (
      !/screenshot.*timed out|capture.*timed out/i.test(
        e instanceof Error ? e.message : String(e),
      )
    )
      throw e;
    if (options.recording)
      throw new Error(
        "Screenshot timed out during recording. Recording was preserved; retry the screenshot with the tab visible.",
      );
    if (fullPage) {
      const size = metrics.cssContentSize ?? metrics.contentSize;
      const viewport = metrics.cssLayoutViewport ?? metrics.layoutViewport;
      if (
        size.height > viewport.clientHeight + 2 ||
        size.width > viewport.clientWidth + 2
      )
        throw new Error(
          "Native full-page capture timed out. Keep the tab visible in BB Desktop or request a visible-page screenshot.",
        );
    }
    return c.captureFrame();
  }
}
