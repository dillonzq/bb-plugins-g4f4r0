import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareEntries,
  fileIconToken,
  folderIconName,
  isInsideRoot,
  joinRoot,
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
