import { setTimeout as sleep } from "node:timers/promises";
import type { Cdp } from "./cdp";
const transientNavigation = (error: unknown) =>
  /context.*destroyed|target navigated|cannot find context|not attached to an active page/i.test(
    error instanceof Error ? error.message : String(error),
  );
/** Use navigation history commands, never JS history.back() across a destroyed execution context. */
export async function navigateHistory(
  c: Pick<Cdp, "send" | "evaluate">,
  direction: "back" | "forward",
  signal: AbortSignal,
) {
  const before = await c.send("Page.getNavigationHistory");
  const index = before.currentIndex + (direction === "back" ? -1 : 1),
    entry = before.entries[index];
  if (!entry) throw new Error(`No ${direction} history entry is available.`);
  signal.throwIfAborted();
  try {
    await c.send("Page.navigateToHistoryEntry", { entryId: entry.id });
  } catch (error) {
    if (!transientNavigation(error)) throw error;
  }
  // A navigation acknowledgement can fail after the action. Only read from here onward.
  const deadline = Date.now() + 25000;
  for (;;) {
    signal.throwIfAborted();
    try {
      const history = await c.send("Page.getNavigationHistory");
      const page = await c.evaluate(
        "({url:location.href,title:document.title,ready:document.readyState})",
      );
      if (
        history.entries[history.currentIndex]?.id === entry.id &&
        page.url === entry.url &&
        page.ready !== "loading"
      )
        return JSON.stringify({
          success: true,
          data: { url: page.url, title: page.title },
          error: null,
        });
    } catch (error) {
      if (!transientNavigation(error)) throw error;
    }
    if (Date.now() >= deadline)
      throw new Error(
        "Navigation was requested but did not settle before the deadline. Inspect the page before retrying.",
      );
    await sleep(50, undefined, { signal });
  }
}
