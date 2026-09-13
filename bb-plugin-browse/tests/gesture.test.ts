import { it, expect } from "vitest";
import { drawStrokes } from "../src/gesture";
it("keeps a continuous stroke pressed and releases at the actual final coordinate", async () => {
  const events: any[] = [];
  await drawStrokes(
    {
      send: async (_, p) => {
        events.push(p);
      },
    },
    {
      kind: "gesture",
      strokes: [
        [
          { x: 12, y: 14 },
          { x: 15, y: 20 },
          { x: 18, y: 24 },
        ],
      ],
      intervalMs: 0,
    },
    new AbortController().signal,
  );
  expect(events.map((p) => p.type)).toEqual([
    "mouseMoved",
    "mousePressed",
    "mouseMoved",
    "mouseMoved",
    "mouseReleased",
  ]);
  expect(events.at(-1)).toMatchObject({ x: 18, y: 24, buttons: 0 });
  expect(events[2].buttons).toBe(1);
});
it("releases the pointer on cancellation without drawing the remaining path", async () => {
  const events: any[] = [];
  const controller = new AbortController();
  await expect(
    drawStrokes(
      {
        send: async (_, p) => {
          events.push(p);
          if (p?.type === "mousePressed") controller.abort();
        },
      },
      {
        kind: "gesture",
        strokes: [
          [
            { x: 12, y: 14 },
            { x: 15, y: 20 },
          ],
        ],
        intervalMs: 8,
      },
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(events.at(-1)).toMatchObject({
    type: "mouseReleased",
    x: 12,
    y: 14,
    buttons: 0,
  });
  expect(events).toHaveLength(3);
});
it("releases even when a pressed event acknowledgement fails", async () => {
  const events: any[] = [];
  await expect(
    drawStrokes(
      {
        send: async (_, p) => {
          events.push(p);
          if (p?.type === "mousePressed")
            throw new Error("connection interrupted");
        },
      },
      { kind: "gesture", strokes: [[{ x: 12, y: 14 }]], intervalMs: 0 },
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(events.at(-1).type).toBe("mouseReleased");
});
