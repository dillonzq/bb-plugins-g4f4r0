import { it, expect } from "vitest";
import { liveFrameFromEvent } from "../src/cdp";
import { viewerHtml } from "../src/viewer";

it("reads viewport size from a screencast event", () => {
  expect(
    liveFrameFromEvent(
      {
        data: "abc",
        metadata: { deviceWidth: 390.4, deviceHeight: 600.9 },
      },
      3,
    ),
  ).toEqual({ data: "abc", width: 390, height: 601, seq: 3 });
});
it("opens a same-origin screencast websocket from the viewer", () => {
  expect(viewerHtml).toContain("WebSocket");
  expect(viewerHtml).toContain("/cast");
  expect(viewerHtml).not.toContain("setTimeout(refresh,800)");
});
