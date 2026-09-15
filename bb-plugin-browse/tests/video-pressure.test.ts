import { expect, it } from "vitest";
import { VideoPressure } from "../src/video-pressure";
it("ignores fast delivery, invalid samples and brief spikes", () => {
  const p = new VideoPressure();
  for (let t = 0; t < 10000; t += 100) expect(p.sample(160, t)).toBeUndefined();
  expect(p.sample(NaN, 10001)).toBeUndefined();
  expect(p.sample(1200, 10100)).toBeUndefined();
  expect(p.sample(160, 10200)).toBeUndefined();
});
it("reduces sustained traffic with cooldown and a stable quality floor", () => {
  const p = new VideoPressure();
  const changes: { at: number; bitrate: number }[] = [];
  for (let t = 0; t < 30000; t += 100) {
    const bitrate = p.sample(700, t);
    if (bitrate !== undefined) changes.push({ at: t, bitrate });
  }
  expect(changes.map((x) => x.bitrate)).toEqual([3000, 2250, 2000]);
  expect(changes[0].at).toBeGreaterThanOrEqual(2000);
  expect(changes[1].at - changes[0].at).toBeGreaterThanOrEqual(5000);
  for (let t = 30000; t < 60000; t += 100)
    expect(p.sample(30, t)).toBeUndefined();
});
it("does not react to only a handful of idle frames", () => {
  const p = new VideoPressure();
  for (let t = 0; t < 25000; t += 5000)
    expect(p.sample(900, t)).toBeUndefined();
});
