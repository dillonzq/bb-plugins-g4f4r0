import { setTimeout as sleep } from "node:timers/promises";
import type { Cdp } from "./cdp";
import type { Operation } from "./contracts";
export async function drawStrokes(
  c: Pick<Cdp, "send">,
  op: Extract<Operation, { kind: "gesture" }>,
  signal: AbortSignal,
) {
  let x = 0,
    y = 0,
    down = false;
  const total = op.strokes.reduce((n, a) => n + a.length, 0);
  if (total > 15000) throw new Error("Maximum 15,000 points per gesture job.");
  try {
    for (const stroke of op.strokes) {
      signal.throwIfAborted();
      ({ x, y } = stroke[0]);
      await c.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        buttons: 0,
      });
      down = true;
      await c.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      for (const p of stroke.slice(1)) {
        signal.throwIfAborted();
        if (op.intervalMs) await sleep(op.intervalMs, undefined, { signal });
        ({ x, y } = p);
        await c.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y,
          button: "left",
          buttons: 1,
        });
      }
      await c.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      down = false;
    }
  } finally {
    if (down)
      await c
        .send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          buttons: 0,
          clickCount: 1,
        })
        .catch(() => {});
  }
  return `Drew ${op.strokes.length} continuous strokes (${total} points).`;
}
