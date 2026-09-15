import assert from "node:assert/strict";
import test from "node:test";
import { createCachedLoader } from "../lib/usage-cache.ts";

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("fresh hits skip a second load and share one inflight", async () => {
  let loads = 0;
  let now = 1_000;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const cache = createCachedLoader({
    async load() {
      loads += 1;
      if (loads === 1) await gate;
      return { n: loads, ttl: 1_000 };
    },
    ttlMs: (value) => value.ttl,
    now: () => now,
  });

  const first = cache.get();
  const second = cache.get();
  release();
  assert.equal((await first).n, 1);
  assert.equal((await second).n, 1);
  assert.equal(loads, 1);
  now = 1_500;
  assert.equal((await cache.get()).n, 1);
  now = 2_100;
  assert.equal((await cache.get()).n, 1);
  assert.equal(loads, 2);
  await wait(0);
  assert.equal((await cache.get()).n, 2);
  cache.invalidate();
  assert.equal((await cache.get(true)).n, 3);
  assert.equal(loads, 3);
});

test("hydrate serves immediately and refreshes in the background", async () => {
  let loads = 0;
  let now = 5_000;
  const cache = createCachedLoader({
    async load() {
      loads += 1;
      return { n: loads, ttl: 1_000 };
    },
    ttlMs: (value) => value.ttl,
    now: () => now,
  });

  cache.hydrate({ n: 0, ttl: 1_000 }, 0);
  assert.equal((await cache.get()).n, 0);
  assert.equal(loads, 1);
  await wait(0);
  assert.equal((await cache.get()).n, 1);
  cache.hydrate({ n: 99, ttl: 1_000 }, 0);
  assert.equal((await cache.get()).n, 1);
});
