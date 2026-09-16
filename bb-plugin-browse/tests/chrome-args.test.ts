import { it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acquireDisplay,
  LINUX_DEP_PACKAGES,
  chromeArgs,
  videoChromeArgs,
  xvfbArgs,
  xvfbLaunch,
} from "../src/managed";

it("launches headed Chrome without a headless flag", () => {
  const args = chromeArgs("/tmp/browse-profile");
  expect(args.some((a) => a.includes("headless"))).toBe(false);
  expect(args).toContain("--remote-debugging-port=0");
  expect(args.some((a) => a.startsWith("--user-data-dir="))).toBe(true);
});
it("uses app presentation without Chrome's fullscreen exit toast or DevTools block", () => {
  const args = videoChromeArgs("/tmp/browse-profile", "https://example.com/");
  expect(args).toContain("--test-type");
  expect(args).not.toContain("--kiosk");
  expect(args).not.toContain("--start-fullscreen");
  expect(args.at(-1)).toBe("--app=https://example.com/");
});
it("can begin loading the requested page during browser startup", () => {
  expect(chromeArgs("/tmp/browse-profile", "https://example.com/").at(-1)).toBe(
    "https://example.com/",
  );
});
it("installs the headed display stack with other Linux dependencies", () => {
  expect(LINUX_DEP_PACKAGES).toContain("xvfb");
  expect(LINUX_DEP_PACKAGES).toContain("x11-xkb-utils");
  expect(LINUX_DEP_PACKAGES).toContain("xkb-data");
});
it("starts Xvfb on a private display", () => {
  expect(xvfbArgs(90)).toEqual([
    ":90",
    "-screen",
    "0",
    "1280x800x24",
    "-nolisten",
    "tcp",
    "-ac",
  ]);
});
it("wraps Xvfb so Debian can find xkbcomp without root", () => {
  const root = join(tmpdir(), `browse-xvfb-${process.pid}-${Date.now()}`);
  mkdirSync(join(root, "linux-deps/root/usr/bin"), { recursive: true });
  writeFileSync(join(root, "linux-deps/root/usr/bin/xkbcomp"), "");
  try {
    const launch = xvfbLaunch("/xvfb", 91, { PATH: "/bin" }, root);
    expect(launch.command).toMatch(/unshare$/);
    expect(launch.args).toContain("-rm");
    expect(launch.env?.BROWSE_XKBCOMP).toBe(
      join(root, "linux-deps/root/usr/bin/xkbcomp"),
    );
    expect(launch.env?.BROWSE_DISPLAY).toBe(":91");
    expect(launch.args.at(-1)).toContain("mount -t overlay");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each(["darwin", "win32"] as const)(
  "uses the %s desktop without requiring Linux Xvfb",
  async (platform) => {
    const env = { PATH: "" };
    const display = await acquireDisplay(
      "/no-linux-dependencies",
      env,
      new AbortController().signal,
      platform,
    );
    expect(display.env).toEqual(env);
    await display.release();
  },
);
