import { it, expect } from "vitest";
import { chromeArgs } from "../src/managed";

it("launches headed Chrome without a headless flag", () => {
  const args = chromeArgs("/tmp/browse-profile");
  expect(args.some((a) => a.includes("headless"))).toBe(false);
  expect(args).toContain("--remote-debugging-port=0");
  expect(args.some((a) => a.startsWith("--user-data-dir="))).toBe(true);
});
