import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
export async function runProcess(
  binary: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    stdin?: string;
    limit?: number;
  } = {},
): Promise<string> {
  opts.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const p = spawn(binary, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const out = new StringDecoder("utf8"),
      err = new StringDecoder("utf8");
    let stdout = "",
      stderr = "",
      bytes = 0,
      overflow = false,
      killTimer: ReturnType<typeof setTimeout> | undefined;
    const limit = opts.limit ?? 512000;
    const stop = () => {
      p.kill("SIGTERM");
      killTimer ??= setTimeout(() => p.kill("SIGKILL"), 1000);
      killTimer.unref();
    };
    const cleanup = () => {
      opts.signal?.removeEventListener("abort", stop);
      clearTimeout(killTimer);
    };
    opts.signal?.addEventListener("abort", stop, { once: true });
    p.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) {
        overflow = true;
        stop();
      } else stdout += out.write(chunk);
    });
    p.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + err.write(chunk)).slice(-16000);
    });
    p.on("error", (error) => {
      cleanup();
      reject(error);
    });
    p.on("close", (code) => {
      cleanup();
      stdout += out.end();
      stderr += err.end();
      if (opts.signal?.aborted) reject(new Error("Cancelled"));
      else if (overflow)
        reject(
          new Error(
            `Output exceeds ${limit} bytes. Narrow the snapshot or query.`,
          ),
        );
      else if (code !== 0)
        reject(
          new Error(
            (stdout || stderr || `Process exited ${code}`).slice(0, 16000),
          ),
        );
      else resolve(stdout.trim());
    });
    p.stdin.on("error", () => {});
    p.stdin.end(opts.stdin);
  });
}
