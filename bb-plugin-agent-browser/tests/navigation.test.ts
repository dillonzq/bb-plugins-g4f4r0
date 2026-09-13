import { it, expect, vi } from "vitest";
import { navigateHistory } from "../src/navigation";
it("waits through destroyed execution contexts without replaying navigation", async () => {
  const entries = [
    { id: 1, url: "https://example.test/a" },
    { id: 2, url: "https://example.test/b" },
  ];
  let moved = false;
  const send = vi.fn(async (method) => {
    if (method === "Page.navigateToHistoryEntry") {
      moved = true;
      return {};
    }
    return { currentIndex: moved ? 0 : 1, entries };
  });
  const evaluate = vi
    .fn()
    .mockRejectedValueOnce(new Error("Execution context was destroyed"))
    .mockResolvedValue({ url: entries[0].url, title: "A", ready: "complete" });
  const result = JSON.parse(
    await navigateHistory(
      { send, evaluate },
      "back",
      new AbortController().signal,
    ),
  );
  expect(result.data.url).toBe(entries[0].url);
  expect(
    send.mock.calls.filter((x) => x[0] === "Page.navigateToHistoryEntry"),
  ).toHaveLength(1);
});
it("does not navigate when there is no destination", async () => {
  const send = vi.fn(async () => ({
    currentIndex: 0,
    entries: [{ id: 1, url: "about:blank" }],
  }));
  const evaluate = vi.fn();
  await expect(
    navigateHistory({ send, evaluate }, "back", new AbortController().signal),
  ).rejects.toThrow("No back");
  expect(send).toHaveBeenCalledOnce();
  expect(evaluate).not.toHaveBeenCalled();
});

it("verifies the destination after a lost navigation acknowledgement without sending Back twice", async () => {
  const entries = [
    { id: 1, url: "about:blank" },
    { id: 2, url: "https://example.test/" },
  ];
  let moved = false;
  const send = vi.fn(async (method) => {
    if (method === "Page.navigateToHistoryEntry") {
      moved = true;
      throw new Error("Not attached to an active page");
    }
    return { currentIndex: moved ? 0 : 1, entries };
  });
  const evaluate = vi
    .fn()
    .mockRejectedValueOnce(new Error("Not attached to an active page"))
    .mockResolvedValue({ url: "about:blank", title: "", ready: "complete" });
  expect(
    JSON.parse(
      await navigateHistory(
        { send, evaluate },
        "back",
        new AbortController().signal,
      ),
    ).success,
  ).toBe(true);
  expect(
    send.mock.calls.filter((c) => c[0] === "Page.navigateToHistoryEntry"),
  ).toHaveLength(1);
});
