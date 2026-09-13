/** Strip a trailing slash, except on a bare root. */
export function normalizeRoot(root: string): string {
  if (root === "/") return root;
  return root.replace(/\/+$/u, "");
}

/**
 * Join a workspace-relative path onto the environment root.
 * Rejects absolute paths and `..` segments so a client cannot walk out.
 */
export function joinRoot(root: string, relative: string): string {
  const base = normalizeRoot(root);
  if (relative === "" || relative === ".") return base;
  if (relative.startsWith("/") || relative.startsWith("~")) {
    throw new Error("Path is outside the workspace root.");
  }
  const segments = relative.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Path is outside the workspace root.");
  }
  return `${base}/${relative}`;
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const base = normalizeRoot(root);
  return candidate === base || candidate.startsWith(`${base}/`);
}

/** Workspace-relative path, the identity FileLink needs. */
export function toRelative(root: string, absolute: string): string {
  const base = normalizeRoot(root);
  if (absolute === base) return "";
  if (absolute.startsWith(`${base}/`)) return absolute.slice(base.length + 1);
  throw new Error("Path is outside the workspace root.");
}

export type Kind = "directory" | "file";

export function compareEntries(
  a: { kind: Kind; name: string },
  b: { kind: Kind; name: string },
): number {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function folderIconName(open: boolean): "FolderOpen" | "Folder" {
  return open ? "FolderOpen" : "Folder";
}

const BY_NAME: Record<string, string> = {
  ".babelrc": "javascript",
  ".bash_profile": "bash",
  ".bashrc": "bash",
  ".dockerignore": "docker",
  ".eslintignore": "eslint",
  ".eslintrc": "eslint",
  ".eslintrc.cjs": "eslint",
  ".eslintrc.js": "eslint",
  ".eslintrc.json": "eslint",
  ".eslintrc.yaml": "eslint",
  ".eslintrc.yml": "eslint",
  ".gitattributes": "git",
  ".gitignore": "git",
  ".gitkeep": "git",
  ".gitmodules": "git",
  ".prettierignore": "prettier",
  ".prettierrc": "prettier",
  ".prettierrc.cjs": "prettier",
  ".prettierrc.js": "prettier",
  ".prettierrc.json": "prettier",
  ".prettierrc.mjs": "prettier",
  ".prettierrc.toml": "prettier",
  ".prettierrc.yaml": "prettier",
  ".prettierrc.yml": "prettier",
  ".zprofile": "bash",
  ".zshenv": "bash",
  ".zshrc": "bash",
  "biome.json": "json",
  "bun.lock": "json",
  "claude.md": "markdown",
  "compose.yaml": "docker",
  "compose.yml": "docker",
  "docker-compose.override.yml": "docker",
  "docker-compose.yaml": "docker",
  "docker-compose.yml": "docker",
  dockerfile: "docker",
  "eslint.config.cjs": "eslint",
  "eslint.config.js": "eslint",
  "eslint.config.mjs": "eslint",
  "eslint.config.ts": "eslint",
  gemfile: "ruby",
  "package.json": "json",
  "package-lock.json": "json",
  "pnpm-lock.yaml": "yml",
  "prettier.config.cjs": "prettier",
  "prettier.config.js": "prettier",
  "prettier.config.mjs": "prettier",
  "readme.md": "markdown",
  "tsconfig.json": "json",
};

const BY_EXT: Record<string, string> = {
  astro: "javascript",
  bash: "bash",
  cjs: "javascript",
  css: "css",
  csv: "text",
  cts: "typescript",
  env: "text",
  gif: "image",
  go: "go",
  htm: "html",
  html: "html",
  ico: "image",
  jpeg: "image",
  jpg: "image",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  less: "css",
  markdown: "markdown",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  mts: "typescript",
  png: "image",
  py: "python",
  pyi: "python",
  rb: "ruby",
  rs: "rust",
  scss: "css",
  sh: "bash",
  sql: "text",
  svg: "image",
  toml: "text",
  ts: "typescript",
  tsx: "typescript",
  txt: "text",
  webp: "image",
  yaml: "yml",
  yml: "yml",
  zsh: "bash",
};

export function fileIconToken(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  const name = slash === -1 ? relativePath : relativePath.slice(slash + 1);
  const lower = name.toLowerCase();
  const named = BY_NAME[lower];
  if (named !== undefined) return named;
  const dot = lower.lastIndexOf(".");
  const ext = dot <= 0 ? lower.replace(/^\./u, "") : lower.slice(dot + 1);
  return BY_EXT[ext] ?? "default";
}
