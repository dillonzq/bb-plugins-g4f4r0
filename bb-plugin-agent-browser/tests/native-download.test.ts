import { it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadFromClick } from "../src/native-download";
it("subscribes before the one click and handles an immediate download", async () => {
  const root = await mkdtemp(join(tmpdir(), "browse-download-"));
  let listener: any;
  const off = vi.fn(),
    send = vi.fn(async () => ({}));
  const c: any = {
    onEvent: (fn: any) => {
      listener = fn;
      return off;
    },
    send,
  };
  const click = vi.fn(async () => {
    listener("Browser.downloadWillBegin", { guid: "file-123" });
    listener("Browser.downloadProgress", {
      guid: "file-123",
      state: "completed",
      totalBytes: 12,
    });
  });
  try {
    expect(
      await downloadFromClick(c, root, click, new AbortController().signal),
    ).toBe(join(root, "file-123"));
    expect(click).toHaveBeenCalledOnce();
    expect(off).toHaveBeenCalledOnce();
    expect(send).toHaveBeenLastCalledWith(
      "Browser.setDownloadBehavior",
      { behavior: "deny" },
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("rejects cancelled and oversized downloads without replaying the click", async () => {
  const root = await mkdtemp(join(tmpdir(), "browse-download-"));
  try {
    for (const mode of ["cancel", "size"]) {
      let listener: any;
      const off = vi.fn(),
        controller = new AbortController(),
        send = vi.fn(async () => ({}));
      const c: any = {
        onEvent: (fn: any) => {
          listener = fn;
          return off;
        },
        send,
      };
      const click = vi.fn(async () => {
        listener("Browser.downloadWillBegin", { guid: "file-123" });
        if (mode === "cancel") controller.abort();
        else
          listener("Browser.downloadProgress", {
            guid: "file-123",
            state: "inProgress",
            totalBytes: 129 * 1024 * 1024,
          });
      });
      await expect(
        downloadFromClick(c, root, click, controller.signal),
      ).rejects.toThrow(mode === "cancel" ? "cancelled" : "128 MB");
      expect(click).toHaveBeenCalledOnce();
      expect(off).toHaveBeenCalledOnce();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
