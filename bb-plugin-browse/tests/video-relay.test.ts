import { it, expect, vi } from "vitest";
import { videoRelay, connectVideoRelay } from "../src/video-relay";
import type { SelkiesStream } from "../src/selkies";

it("authenticates the relay, pipelines a bounded window, and releases it on disconnect", async () => {
  const stream = {
    isClosed: false,
    onStop: undefined as (() => void) | undefined,
    readPackets: vi.fn(async (limit: number) =>
      Array.from({ length: limit }, () =>
        Buffer.from([4, 1, 0, 0, 0, 0, 5, 0, 3, 32, 1]),
      ),
    ),
    stop: vi.fn(async () => {
      stream.isClosed = true;
      stream.onStop?.();
    }),
  };
  const relay = await videoRelay(
    stream as unknown as SelkiesStream,
    async () => ({ url: "https://example.com", loading: false }),
  );
  let ws: Awaited<ReturnType<typeof connectVideoRelay>> | undefined;
  try {
    await expect(
      connectVideoRelay({ ...relay, token: "invalid" }),
    ).rejects.toThrow();
    expect(stream.readPackets).not.toHaveBeenCalled();
    ws = await connectVideoRelay(relay);
    let frames = 0;
    ws.on("message", (_data, binary) => {
      if (binary) frames++;
    });
    ws.send("start");
    await vi.waitFor(() => expect(frames).toBe(6));
    await new Promise((r) => setTimeout(r, 40));
    expect(frames).toBe(6);
    ws.send("ack");
    await vi.waitFor(() => expect(frames).toBe(7));
    // One ACK permits another frame without waiting for all six old frames.
    await expect(connectVideoRelay(relay)).rejects.toThrow();
    ws.close();
    await vi.waitFor(() => expect(stream.stop).toHaveBeenCalled());
    await expect(connectVideoRelay(relay)).rejects.toThrow();
  } finally {
    ws?.terminate();
    await stream.stop();
  }
});
