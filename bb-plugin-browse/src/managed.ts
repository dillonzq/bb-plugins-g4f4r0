import { existsSync, promises as fs } from "node:fs";
import { join, delimiter } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { runProcess } from "./process";
import { ensureRuntime, installed, runtimePath } from "./runtime";

export function managedEnv(root: string) {
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (k.startsWith("AGENT_BROWSER_") || k.startsWith("AI_GATEWAY_"))
      delete env[k];
  const libs = join(root, "linux-deps", "root");
  const arch =
    process.arch === "arm64" ? "aarch64-linux-gnu" : "x86_64-linux-gnu";
  env.LD_LIBRARY_PATH = [
    join(libs, "usr/lib", arch),
    join(libs, "lib", arch),
    join(libs, "usr/lib", arch, "pulseaudio"),
    join(libs, "usr/lib", arch, "blas"),
    join(libs, "usr/lib", arch, "lapack"),
    env.LD_LIBRARY_PATH,
  ]
    .filter(Boolean)
    .join(delimiter);
  env.PATH = [join(libs, "usr/bin"), env.PATH].filter(Boolean).join(delimiter);
  return env;
}
export async function diagnostics(root: string) {
  const runtime = await installed(root);
  let chromePath: string | undefined,
    chromeVersion: string | undefined,
    launchError: string | undefined;
  const env = managedEnv(root);
  if (runtime) {
    let out: string;
    try {
      out = await runProcess(
        runtimePath(root),
        ["doctor", "--offline", "--quick", "--json"],
        { env, signal: AbortSignal.timeout(15000) },
      );
    } catch (e) {
      out = e instanceof Error ? e.message : String(e);
    }
    try {
      const info = JSON.parse(out).checks?.find(
        (c: any) => c.id === "chrome.installed",
      );
      chromePath = info?.message?.match(/ at (.+?)(?: \(version .*)?$/)?.[1];
    } catch {}
    if (chromePath)
      try {
        chromeVersion = await runProcess(chromePath, ["--version"], {
          env,
          signal: AbortSignal.timeout(10000),
        });
      } catch (e) {
        launchError = e instanceof Error ? e.message : String(e);
      }
  }
  const ffmpeg = await runProcess("ffmpeg", ["-version"], {
    env,
    signal: AbortSignal.timeout(5000),
  }).then(
    () => true,
    () => false,
  );
  return {
    platform: process.platform,
    arch: process.arch,
    runtime,
    chromeInstalled: !!chromePath,
    chromeRunnable: !!chromeVersion,
    chromePath: chromePath ?? null,
    chromeVersion: chromeVersion ?? null,
    launchError: launchError ?? null,
    ffmpeg,
  };
}
let install: Promise<void> | undefined;
export async function installManaged(
  root: string,
  dependencies: boolean,
  signal: AbortSignal,
) {
  if (install) return install;
  if (activeProfiles.size)
    throw new Error(
      "Close managed browsers and wait for dependency checks before updating dependencies.",
    );
  install = (async () => {
    const binary = await ensureRuntime(root, signal);
    await runProcess(binary, ["install"], { env: managedEnv(root), signal });
    if (dependencies && process.platform === "linux") {
      const dir = join(root, "linux-deps"),
        archives = join(dir, "archives"),
        target = join(dir, "root");
      await fs.mkdir(join(archives, "partial"), { recursive: true });
      await fs.mkdir(target, { recursive: true });
      await runProcess(
        "apt-get",
        [
          "--download-only",
          "--yes",
          "--no-install-recommends",
          "-o",
          "Debug::NoLocking=1",
          "-o",
          `Dir::Cache::archives=${archives}`,
          "install",
          "libnss3",
          "libatk-bridge2.0-0",
          "libasound2",
          "libgbm1",
          "libcups2",
          "libpango-1.0-0",
          "libcairo2",
          "libxcomposite1",
          "libxdamage1",
          "libxrandr2",
          "libxkbcommon0",
          "fonts-liberation",
          "ffmpeg",
          "xvfb",
        ],
        { signal, limit: 1000000 },
      );
      for (const name of await fs.readdir(archives))
        if (name.endsWith(".deb"))
          await runProcess("dpkg-deb", ["-x", join(archives, name), target], {
            signal,
          });
    }
  })();
  try {
    await install;
  } finally {
    install = undefined;
  }
}
export function chromeArgs(profile: string) {
  return [
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--window-size=1280,800",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "about:blank",
  ];
}
function findOnPath(env: NodeJS.ProcessEnv, name: string) {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
}
let xvfb: { n: number; child: ChildProcess; users: number } | undefined;
async function acquireDisplay(
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<{ env: NodeJS.ProcessEnv; release: () => Promise<void> }> {
  if (process.env.DISPLAY)
    return {
      env: { ...env, DISPLAY: process.env.DISPLAY },
      release: async () => {},
    };
  if (xvfb) {
    xvfb.users++;
    return {
      env: { ...env, DISPLAY: `:${xvfb.n}` },
      release: releaseDisplay,
    };
  }
  const binary = findOnPath(env, "Xvfb");
  if (!binary)
    throw new Error(
      "Headed Chrome needs a display. On this Linux host install Xvfb via Browse Settings, then retry.",
    );
  let n = 90;
  while (n < 120 && (existsSync(`/tmp/.X${n}-lock`) || existsSync(`/tmp/.X11-unix/X${n}`)))
    n++;
  const child = spawn(
    binary,
    [`:${n}`, "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-ac"],
    { env, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr?.on("data", (b) => (stderr = (stderr + b.toString()).slice(-4000)));
  const deadline = Date.now() + 8000;
  while (!existsSync(`/tmp/.X11-unix/X${n}`)) {
    signal.throwIfAborted();
    if (child.exitCode !== null)
      throw new Error("Xvfb exited: " + stderr);
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error("Xvfb startup timed out: " + stderr);
    }
    await sleep(50, undefined, { signal });
  }
  xvfb = { n, child, users: 1 };
  child.once("exit", () => {
    if (xvfb?.child === child) xvfb = undefined;
  });
  return {
    env: { ...env, DISPLAY: `:${n}` },
    release: releaseDisplay,
  };
}
async function releaseDisplay() {
  if (!xvfb) return;
  xvfb.users--;
  if (xvfb.users > 0) return;
  const child = xvfb.child;
  xvfb = undefined;
  if (child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((r) => child.once("exit", () => r())),
    sleep(1500),
  ]);
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
}
export type ManagedBrowser = {
  process: ChildProcess;
  endpoint: string;
  profile: string;
  close: () => Promise<void>;
};
const activeProfiles = new Set<string>();
export async function launchManaged(
  root: string,
  profileId: string,
  signal: AbortSignal,
): Promise<ManagedBrowser> {
  signal.throwIfAborted();
  if (install)
    throw new Error(
      "Browser installation is in progress. Wait for its setup job.",
    );
  if (!/^ab-[a-z0-9-]+$/.test(profileId)) throw new Error("Invalid profile ID");
  const key = join(root, "profiles", profileId);
  if (activeProfiles.has(key))
    throw new Error("This browser profile is already running or connecting.");
  activeProfiles.add(key);
  try {
    const browser = await launchBrowser(root, profileId, signal);
    const stop = browser.close;
    let closing: Promise<void> | undefined;
    browser.process.once("exit", () => activeProfiles.delete(key));
    browser.close = () =>
      (closing ??= (async () => {
        try {
          await stop();
        } finally {
          activeProfiles.delete(key);
        }
      })());
    return browser;
  } catch (e) {
    activeProfiles.delete(key);
    throw e;
  }
}
async function launchBrowser(
  root: string,
  profileId: string,
  signal: AbortSignal,
): Promise<ManagedBrowser> {
  const info = await diagnostics(root);
  if (!info.chromeRunnable || !info.chromePath)
    throw new Error(
      "Chrome is not runnable on this thread host. Open Browse Settings and install the browser/dependencies. " +
        (info.launchError ?? ""),
    );
  if (!/^ab-[a-z0-9-]+$/.test(profileId)) throw new Error("Invalid profile ID");
  const profile = join(root, "profiles", profileId);
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  await fs.rm(join(profile, "DevToolsActivePort"), { force: true });
  const display = await acquireDisplay(managedEnv(root), signal);
  const child = spawn(info.chromePath, chromeArgs(profile), {
    env: display.env,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr?.on(
    "data",
    (b) => (stderr = (stderr + b.toString()).slice(-8000)),
  );
  let spawnError: Error | undefined;
  child.on("error", (e) => (spawnError = e));
  let released = false;
  const close = async () => {
    try {
      if (child.exitCode === null && !child.signalCode) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise<void>((r) => child.once("exit", () => r())),
          sleep(2000),
        ]);
        if (child.exitCode === null && !child.signalCode) {
          child.kill("SIGKILL");
          await Promise.race([
            new Promise<void>((r) => child.once("exit", () => r())),
            sleep(2000),
          ]);
        }
      }
    } finally {
      if (!released) {
        released = true;
        await display.release();
      }
    }
  };
  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      signal.throwIfAborted();
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error("Chrome exited: " + stderr);
      try {
        const [port, path] = (
          await fs.readFile(join(profile, "DevToolsActivePort"), "utf8")
        )
          .trim()
          .split("\n");
        if (/^\d+$/.test(port) && path.startsWith("/devtools/browser/")) {
          child.once("exit", () => {
            void close();
          });
          return {
            process: child,
            endpoint: `ws://127.0.0.1:${port}${path}`,
            profile,
            close,
          };
        }
      } catch {}
      if (Date.now() > deadline)
        throw new Error("Chrome startup timed out: " + stderr);
      await sleep(80, undefined, { signal });
    }
  } catch (e) {
    await close();
    throw e;
  }
}
