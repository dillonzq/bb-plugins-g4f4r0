import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(
    join(packageRoot, "benchmarks/agent-capability/tasks.json"),
    "utf8",
  ),
);
const cache = join(packageRoot, ".benchmarks/miniwob-plusplus");
const portArg = process.argv.find((value) => value.startsWith("--port="));
const port = Number(portArg?.slice(7) ?? 39115);

function run(command: string, args: string[], cwd = packageRoot) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

async function install() {
  if (existsSync(join(cache, ".git"))) {
    const revision = await new Promise<string>((resolve, reject) => {
      const child = spawn("git", ["rev-parse", "HEAD"], { cwd: cache });
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve(output.trim())
          : reject(new Error("Cannot inspect MiniWoB++")),
      );
    });
    if (revision === manifest.revision) return;
    throw new Error(
      `MiniWoB++ cache is at ${revision}; expected ${manifest.revision}. Remove .benchmarks and retry.`,
    );
  }
  await mkdir(dirname(cache), { recursive: true });
  const partial = `${cache}.partial-${process.pid}`;
  await rm(partial, { recursive: true, force: true });
  try {
    await run("git", [
      "clone",
      "--no-checkout",
      "--filter=blob:none",
      manifest.source,
      partial,
    ]);
    await run(
      "git",
      ["fetch", "--depth=1", "origin", manifest.revision],
      partial,
    );
    await run("git", ["checkout", "--detach", manifest.revision], partial);
    await rename(partial, cache);
  } finally {
    await rm(partial, { recursive: true, force: true });
  }
}

await install();
if (process.argv.includes("--install-only")) {
  console.log(
    JSON.stringify({ installed: true, revision: manifest.revision, cache }),
  );
  process.exit(0);
}

const root = join(cache, "miniwob/html");
const types: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://local").pathname,
    );
    const relative =
      pathname === "/"
        ? "miniwob/click-test-2.html"
        : pathname.replace(/^\/+/, "");
    const path = normalize(join(root, relative));
    if (!path.startsWith(`${root}/`) || !existsSync(path)) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.setHeader("cache-control", "no-store");
    response.setHeader(
      "content-type",
      types[extname(path)] ?? "application/octet-stream",
    );
    createReadStream(path).pipe(response);
  } catch (error) {
    response
      .writeHead(500)
      .end(error instanceof Error ? error.message : String(error));
  }
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});
const baseUrl = `http://127.0.0.1:${port}`;
console.log(
  JSON.stringify({
    ready: true,
    baseUrl,
    revision: manifest.revision,
    tasks: manifest.tasks.map((task: { id: string }) => ({
      id: task.id,
      url: `${baseUrl}/miniwob/${task.id}.html`,
    })),
  }),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => server.close(() => process.exit(0)));
