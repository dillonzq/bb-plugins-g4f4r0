import assert from "node:assert/strict";
import test from "node:test";
import { fileSyncAction } from "./file-sync.ts";

test("same hash is a no-op", () => {
  assert.equal(fileSyncAction("aaa", "aaa", false), "same");
  assert.equal(fileSyncAction("aaa", "aaa", true), "same");
});

test("no current hash is a no-op until the first load", () => {
  assert.equal(fileSyncAction(null, "bbb", false), "same");
});

test("clean buffer reloads when disk changes", () => {
  assert.equal(fileSyncAction("aaa", "bbb", false), "reload");
});

test("dirty buffer does not clobber local edits", () => {
  assert.equal(fileSyncAction("aaa", "bbb", true), "conflict");
});
