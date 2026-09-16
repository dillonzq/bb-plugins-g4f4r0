import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnWatched } from "../src/watched-process";

describe("watched process", () => {
  it("terminates its owned child when the parent pipe closes", async () => {
    const root = await mkdtemp(join(tmpdir(), "browse-watchdog-"));
    const pidFile = join(root, "child.pid");
    const wrapper = spawnWatched(process.execPath, [
      "-e",
      "require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",
      pidFile,
    ]);
    try {
      let pid = 0;
      await expect
        .poll(async () => {
          try {
            pid = Number(await readFile(pidFile, "utf8"));
            return pid;
          } catch {
            return 0;
          }
        })
        .toBeGreaterThan(0);
      wrapper.stdin?.end();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("watchdog did not exit")), 4_000);
        wrapper.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await expect
        .poll(() => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(false);
    } finally {
      if (wrapper.exitCode === null) wrapper.kill("SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  });
});
