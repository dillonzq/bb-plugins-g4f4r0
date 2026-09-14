import assert from "node:assert/strict";
import test from "node:test";
import { createVisiblePoller } from "../lib/visible-poller.ts";

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("refresh discards an in-flight sample and fetches again", async () => {
  let loads = 0;
  let received = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const poller = createVisiblePoller({
    async load() {
      loads += 1;
      if (loads === 1) await gate;
      return { refreshIntervalMs: 60_000, n: loads };
    },
    receive() { received += 1; },
    error() {},
    clear() {},
    intervalMs: (value) => value.refreshIntervalMs,
  });

  assert.equal(poller.refresh(), false);
  poller.setActive(true);
  await wait(20);
  assert.equal(loads, 1);
  assert.equal(poller.refresh(), true);
  release();
  await wait(40);
  poller.dispose();
  assert.equal(loads, 2);
  assert.equal(received, 1);
});
