import { it, expect, vi } from "vitest";
import { capturePng } from "../src/capture";
import type { Cdp } from "../src/cdp";
it("uses a compositor frame after a native visible screenshot timeout", async () => {
  const frame = vi.fn(async () => "png-data");
  const c = {
    send: async () => {
      throw new Error("Native browser screenshot timed out");
    },
    captureFrame: frame,
  } as unknown as Cdp;
  expect(await capturePng(c, false)).toBe("png-data");
  expect(frame).toHaveBeenCalledOnce();
});
it("never reports a viewport fallback as a full scrollable page", async () => {
  const frame = vi.fn();
  const c = {
    send: async (method: string) => {
      if (method === "Page.getLayoutMetrics")
        return {
          cssContentSize: { width: 800, height: 2000 },
          cssLayoutViewport: { clientWidth: 800, clientHeight: 600 },
        };
      throw new Error("Native browser screenshot timed out");
    },
    captureFrame: frame,
  } as unknown as Cdp;
  await expect(capturePng(c, true)).rejects.toThrow("full-page");
  expect(frame).not.toHaveBeenCalled();
});

it("never starts or stops a screencast fallback during an active recording", async () => {
  const frame = vi.fn();
  const c = {
    send: async () => {
      throw new Error("Screenshot timed out");
    },
    captureFrame: frame,
  } as unknown as Cdp;
  await expect(capturePng(c, false, { recording: true })).rejects.toThrow(
    "Recording was preserved",
  );
  expect(frame).not.toHaveBeenCalled();
});
it("does not hide a permission or disconnect failure behind a fallback", async () => {
  const frame = vi.fn();
  const c = {
    send: async () => {
      throw new Error("Control revoked");
    },
    captureFrame: frame,
  } as unknown as Cdp;
  await expect(capturePng(c, false)).rejects.toThrow("revoked");
  expect(frame).not.toHaveBeenCalled();
});
