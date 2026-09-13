import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist/public", { recursive: true });
await build({
  entryPoints: [
    "src/main.ts",
    "src/worker.ts",
    "src/init.ts",
    "src/fingerprint.ts",
  ],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node24",
});
await build({
  entryPoints: ["web/app.ts"],
  outfile: "dist/public/app.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
});
await Promise.all(
  ["index.html", "style.css"].map((f) =>
    copyFile("web/" + f, "dist/public/" + f),
  ),
);
