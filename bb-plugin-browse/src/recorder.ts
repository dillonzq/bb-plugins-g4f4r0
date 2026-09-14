import { once } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import type { Cdp } from "./cdp";
/** Recording shares the live cast, avoiding a second Page.startScreencast owner. */
export class Recorder {
  private stopped = false;
  private failure?: Error;
  private done: Promise<void>;
  private exit: Promise<void>;
  private constructor(
    private child: ChildProcessWithoutNullStreams,
    cdp: Cdp,
    fps: number,
  ) {
    let stderr = "";
    child.stderr.on("data", (v) => {
      stderr = (stderr + String(v)).slice(-2000);
    });
    this.exit = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Recording encoder failed: ${stderr}`)),
      );
    });
    void this.exit.catch((e) => {
      this.failure = e;
      this.stopped = true;
    });
    this.done = (async () => {
      let next = Date.now();
      try {
        while (!this.stopped) {
          const frame = await cdp.nextLiveFrame(0, 2000);
          if (this.stopped) break;
          if (!child.stdin.write(Buffer.from(frame.data, "base64")))
            await once(child.stdin, "drain");
          next += 1000 / fps;
          await sleep(Math.max(0, next - Date.now()));
        }
      } catch (e) {
        this.failure = e instanceof Error ? e : new Error(String(e));
      } finally {
        child.stdin.end();
      }
    })();
    child.stdin.on("error", (e) => {
      this.failure = e;
      this.stopped = true;
    });
  }
  static async start(
    cdp: Cdp,
    path: string,
    fps = 30,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    await cdp.startLiveCast();
    await cdp.nextLiveFrame();
    const child = spawn(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-framerate",
        String(fps),
        "-i",
        "pipe:0",
        "-an",
        "-c:v",
        "libvpx-vp9",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        path,
      ],
      { env, stdio: "pipe" },
    );
    return new Recorder(child, cdp, fps);
  }
  async stop() {
    this.stopped = true;
    const timeout = setTimeout(() => this.child.kill("SIGKILL"), 8000);
    try {
      await this.done;
      await this.exit;
      if (this.failure) throw this.failure;
    } finally {
      clearTimeout(timeout);
    }
  }
}
