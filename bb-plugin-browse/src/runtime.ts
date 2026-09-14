import { promises as fs } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { runProcess } from "./process";
import manifest from "../runtime/package.json";
import lock from "../runtime/package-lock.json";
import type * as StagehandSdk from "@browserbasehq/stagehand";

const revision = createHash("sha256")
  .update(JSON.stringify(lock))
  .digest("hex")
  .slice(0, 12);
export const CHROME_VERSION = "153.0.8010.36";
export function runtimePath(root: string) {
  return join(
    root,
    "runtime",
    `stagehand-${manifest.dependencies["@browserbasehq/stagehand"]}-${revision}`,
  );
}
export async function installed(root: string) {
  try {
    await fs.access(join(runtimePath(root), ".ready"));
    return true;
  } catch {
    return false;
  }
}
const installs = new Map<string, Promise<string>>();
export async function ensureRuntime(
  root: string,
  signal: AbortSignal,
): Promise<string> {
  const [major,minor]=process.versions.node.split(".").map(Number);
  if(major<22 || (major===22 && minor<18))throw new Error("Stagehand requires Node 22.18 or newer on this host.");
  if (await installed(root)) return runtimePath(root);
  const active = installs.get(root);
  if (active) return active;
  const promise = (async () => {
    const dir = runtimePath(root);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(join(dir, "package.json"), JSON.stringify(manifest), {
      mode: 0o600,
    });
    await fs.writeFile(join(dir, "package-lock.json"), JSON.stringify(lock), {
      mode: 0o600,
    });
    await runProcess(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: dir, signal },
    );
    await fs.writeFile(join(dir, ".ready"), revision, { mode: 0o600 });
    return dir;
  })();
  installs.set(root, promise);
  try {
    return await promise;
  } finally {
    installs.delete(root);
  }
}
export async function stagehandSdk(
  root: string,
  signal: AbortSignal,
): Promise<typeof StagehandSdk> {
  const dir = await ensureRuntime(root, signal);
  return import(
    pathToFileURL(
      join(dir, "node_modules/@browserbasehq/stagehand/dist/index.mjs"),
    ).href
  );
}
export async function browserInstaller(
  root: string,
  signal: AbortSignal,
): Promise<any> {
  const dir = await ensureRuntime(root, signal);
  return import(
    pathToFileURL(join(dir, "node_modules/@puppeteer/browsers/lib/main.js"))
      .href
  );
}
export async function chromeExecutable(
  root: string,
): Promise<string | undefined> {
  if (!(await installed(root))) return;
  const api = await browserInstaller(root, AbortSignal.timeout(15000));
  return api.computeExecutablePath({
    cacheDir: join(root, "browsers"),
    browser: api.Browser.CHROME,
    buildId: CHROME_VERSION,
  });
}
export async function installChrome(root: string, signal: AbortSignal) {
  const api = await browserInstaller(root, signal);
  signal.throwIfAborted();
  await api.install({
    cacheDir: join(root, "browsers"),
    browser: api.Browser.CHROME,
    buildId: CHROME_VERSION,
  });
  signal.throwIfAborted();
}

export function stagehandExtensionOrigin(root: string) {
  const path = join(
    runtimePath(root),
    "node_modules/@browserbasehq/stagehand/dist/extension",
  );
  // Chromium derives unpacked extension ids from the absolute extension path.
  const hash = createHash("sha256")
    .update(
      process.platform === "win32"
        ? path[0].toUpperCase() + path.slice(1)
        : path,
    )
    .digest("hex")
    .slice(0, 32);
  return (
    "chrome-extension://" +
    [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("")
  );
}
