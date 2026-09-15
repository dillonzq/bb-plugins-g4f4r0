import { expect, it } from "vitest";
import { AdaptiveStream, StreamDemands } from "../src/adaptive-stream";
it("reduces quality under sustained delivery delay and recovers slowly", () => {
  const a = new AdaptiveStream(0);
  let now = 0;
  const interval = (rtt: number, client: number) => {
    for (let i = 0; i < 10; i++) {
      now += 250;
      a.sample(rtt, client, now);
    }
  };
  interval(300, 10);
  expect(a.tier).toBe(1);
  interval(300, 10);
  expect(a.tier).toBe(2);
  interval(50, 10);
  expect(a.tier).toBe(2);
  for (let i = 0; i < 5; i++) interval(50, 10);
  expect(a.tier).toBeLessThan(2);
});
it("does not treat sparse static-page frames as poor throughput", () => {
  const a = new AdaptiveStream(0);
  a.sample(500, 10, 20000);
  expect(a.tier).toBe(0);
});
it("reduces quality for slow client decoding even with a fast network", () => {
  const a = new AdaptiveStream(0);
  for (let i = 1; i <= 8; i++) a.sample(60, 45, i * 300);
  expect(a.tier).toBe(1);
});
it("shares capture fairly and expires disconnected viewers", () => {
  const d = new StreamDemands();
  expect(d.update({ id: "slow", tier: 2 }, 0)).toBe(2);
  expect(d.update({ id: "fast", tier: 0 }, 100)).toBe(2);
  expect(d.update({ id: "fast", tier: 0 }, 13000)).toBe(0);
});
