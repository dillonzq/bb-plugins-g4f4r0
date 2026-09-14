import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAbsoluteHostPath,
  compareEntries,
  defaultFolderToOpen,
  fileIconToken,
  folderIconName,
  isImagePath,
  isMarkdownPath,
  isInsideRoot,
  joinRoot,
  languageIdForPath,
  OPENER_EXTENSIONS,
  toRelative,
} from "./tree.ts";

test("joinRoot stays under the workspace", () => {
  assert.equal(joinRoot("/repo", ""), "/repo");
  assert.equal(joinRoot("/repo/", "src/app.ts"), "/repo/src/app.ts");
  assert.throws(() => joinRoot("/repo", "../secret"));
  assert.throws(() => joinRoot("/repo", "/etc/passwd"));
  assert.throws(() => joinRoot("/repo", "src/../etc"));
});

test("isInsideRoot and toRelative agree", () => {
  assert.equal(isInsideRoot("/repo", "/repo"), true);
  assert.equal(isInsideRoot("/repo", "/repo/src"), true);
  assert.equal(isInsideRoot("/repo", "/repo-other"), false);
  assert.equal(toRelative("/repo", "/repo"), "");
  assert.equal(toRelative("/repo", "/repo/src/a.ts"), "src/a.ts");
  assert.throws(() => toRelative("/repo", "/elsewhere"));
});

test("directories sort before files", () => {
  const names = [
    { kind: "file" as const, name: "a.ts" },
    { kind: "directory" as const, name: "src" },
    { kind: "file" as const, name: "B.ts" },
  ];
  names.sort(compareEntries);
  assert.deepEqual(
    names.map((entry) => entry.name),
    ["src", "a.ts", "B.ts"],
  );
});

test("default folder opens only when it is the sole root entry", () => {
  assert.equal(
    defaultFolderToOpen([
      { kind: "directory", relativePath: "bb-plugin-sidetree" },
    ]),
    "bb-plugin-sidetree",
  );
  assert.equal(
    defaultFolderToOpen([
      { kind: "directory", relativePath: "a" },
      { kind: "directory", relativePath: "b" },
    ]),
    null,
  );
  assert.equal(
    defaultFolderToOpen([{ kind: "file", relativePath: "README.md" }]),
    null,
  );
});

test("opener extensions are unique lowercase tokens", () => {
  assert.equal(new Set(OPENER_EXTENSIONS).size, OPENER_EXTENSIONS.length);
  for (const ext of OPENER_EXTENSIONS) {
    assert.match(ext, /^[a-z0-9]+$/);
  }
});

test("assertAbsoluteHostPath rejects traversal", () => {
  assert.equal(assertAbsoluteHostPath("/repo/a.ts"), "/repo/a.ts");
  assert.throws(() => assertAbsoluteHostPath("../a.ts"));
  assert.throws(() => assertAbsoluteHostPath("/repo/../etc/passwd"));
  assert.throws(() => assertAbsoluteHostPath("//etc/passwd"));
  assert.equal(isImagePath("shot.png"), true);
  assert.equal(isImagePath("app.ts"), false);
});

test("file icons follow BB filename and extension tokens", () => {
  assert.equal(folderIconName(false), "Folder");
  assert.equal(folderIconName(true), "FolderOpen");
  assert.equal(fileIconToken("README.md"), "markdown");
  assert.equal(fileIconToken("docs/guide.markdown"), "markdown");
  assert.equal(fileIconToken("index.html"), "html");
  assert.equal(fileIconToken("src/app.ts"), "typescript");
  assert.equal(fileIconToken(".gitignore"), "git");
  assert.equal(fileIconToken("Dockerfile"), "docker");
  assert.equal(fileIconToken("unknown.bin"), "default");
});

test("language ids follow filename and extension", () => {
  assert.equal(languageIdForPath("src/app.ts"), "ts");
  assert.equal(languageIdForPath("src/app.tsx"), "tsx");
  assert.equal(languageIdForPath("README.md"), "md");
  assert.equal(languageIdForPath("Dockerfile"), "dockerfile");
  assert.equal(languageIdForPath("notes.txt"), null);
});

test("pretty markdown is .md and .markdown only", () => {
  assert.equal(isMarkdownPath("README.md"), true);
  assert.equal(isMarkdownPath("docs/guide.markdown"), true);
  assert.equal(isMarkdownPath("page.mdx"), false);
  assert.equal(isMarkdownPath("src/app.ts"), false);
});
