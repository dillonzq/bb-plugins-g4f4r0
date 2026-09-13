import { it, expect, vi } from "vitest";
import { actOnElement } from "../src/element";
const signal = () => new AbortController().signal;
it("waits for preconditions but sends a successful click only once", async () => {
  const evaluate = vi
    .fn()
    .mockRejectedValueOnce(new Error("AB_WAIT: Target is moving"))
    .mockResolvedValue({ x: 10, y: 20 });
  const send = vi.fn(async () => ({}));
  await actOnElement(
    { evaluate, send },
    { kind: "element", action: "click", selector: "#button", waitMs: 500 },
    signal(),
  );
  expect(evaluate).toHaveBeenCalledTimes(2);
  expect(
    send.mock.calls.filter((c: any) => c[1]?.type === "mousePressed"),
  ).toHaveLength(1);
});
it("does not retry a mutation that may already have reached the browser", async () => {
  const evaluate = vi.fn(async () => ({ x: 10, y: 20 }));
  const send = vi.fn(async (method, params) => {
    if (params.type === "mousePressed") throw new Error("Input timed out");
    return {};
  });
  await expect(
    actOnElement(
      { evaluate, send },
      { kind: "element", action: "click", selector: "#button", waitMs: 500 },
      signal(),
    ),
  ).rejects.toThrow("Input timed out");
  expect(
    send.mock.calls.filter((c: any) => c[1]?.type === "mousePressed"),
  ).toHaveLength(1);
  expect(send.mock.calls.at(-1)?.[1].type).toBe("mouseReleased");
});
it("fills without pointer events and detects transformed values", async () => {
  const evaluate = vi
    .fn()
    .mockResolvedValueOnce({ token: "test" })
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce("transformed");
  const send = vi.fn(async () => ({}));
  await expect(
    actOnElement(
      { evaluate, send },
      {
        kind: "element",
        action: "fill",
        selector: "#field",
        value: "requested",
        waitMs: 0,
      },
      signal(),
    ),
  ).rejects.toThrow("did not retain");
  expect(send).toHaveBeenCalledExactlyOnceWith("Input.insertText", {
    text: "requested",
  });
});
it("stops waiting immediately when cancelled", async () => {
  const control = new AbortController();
  const evaluate = vi.fn(async () => {
    control.abort();
    throw new Error("AB_WAIT: covered");
  });
  const send = vi.fn();
  await expect(
    actOnElement(
      { evaluate, send },
      { kind: "element", action: "click", selector: "#button", waitMs: 5000 },
      control.signal,
    ),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
it("does not retry ambiguous targets", async () => {
  const evaluate = vi.fn(async () => {
    throw new Error("Selector must identify one element; matched 2");
  });
  const send = vi.fn();
  await expect(
    actOnElement(
      { evaluate, send },
      { kind: "element", action: "click", selector: ".button", waitMs: 5000 },
      signal(),
    ),
  ).rejects.toThrow("matched 2");
  expect(evaluate).toHaveBeenCalledOnce();
});
