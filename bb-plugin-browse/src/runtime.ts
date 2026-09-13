import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { runProcess } from "./process";
import { VERSION } from "./contracts";
const INTEGRITY =
  "NDojTSXrIq7zS090T0VwI1uzBryZWvewgxXvS0swj8/5GGnziBZLmyhEkfETO8n4n3DsJpZbZkq9F/MV2rIQKw==";
export function binaryName() {
  let os: string = process.platform;
  if (
    os === "linux" &&
    (process.report?.getReport() as any)?.header?.glibcVersionRuntime ===
      undefined
  )
    os = "linux-musl";
  const arch =
    process.platform === "win32" && process.arch === "arm64"
      ? "x64"
      : process.arch;
  return `agent-browser-${os}-${arch}${process.platform === "win32" ? ".exe" : ""}`;
}
export function runtimePath(root: string) {
  return join(root, "runtime", VERSION, binaryName());
}
export async function installed(root: string) {
  try {
    await fs.access(runtimePath(root));
    return true;
  } catch {
    return false;
  }
}
let setup: Promise<string> | undefined;
export async function ensureRuntime(
  root: string,
  signal: AbortSignal,
): Promise<string> {
  if (await installed(root)) return runtimePath(root);
  if (setup) return setup;
  setup = (async () => {
    const dir = join(root, "runtime", VERSION),
      temp = join(root, "runtime", `install-${randomUUID()}`);
    await fs.mkdir(temp, { recursive: true, mode: 0o700 });
    try {
      const response = await fetch(
        `https://registry.npmjs.org/agent-browser/-/agent-browser-${VERSION}.tgz`,
        { signal },
      );
      if (!response.ok || !response.body)
        throw new Error(`Runtime download failed (${response.status})`);
      const archive = join(temp, "package.tgz");
      const file = await fs.open(archive, "wx", 0o600);
      const hash = createHash("sha512");
      let bytes = 0;
      try {
        for await (const chunk of response.body as any) {
          bytes += chunk.byteLength;
          if (bytes > 180 * 1024 * 1024)
            throw new Error("Unexpected runtime archive size");
          hash.update(chunk);
          await file.write(chunk);
        }
      } finally {
        await file.close();
      }
      if (hash.digest("base64") !== INTEGRITY)
        throw new Error("Runtime integrity check failed");
      await runProcess(
        "tar",
        ["-xzf", archive, "-C", temp, `package/bin/${binaryName()}`],
        { signal },
      );
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.chmod(join(temp, "package", "bin", binaryName()), 0o700);
      await fs.rename(
        join(temp, "package", "bin", binaryName()),
        runtimePath(root),
      );
      return runtimePath(root);
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  })();
  try {
    return await setup;
  } finally {
    setup = undefined;
  }
}
