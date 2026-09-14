import assert from "node:assert/strict";
import { test } from "node:test";
import { Text } from "@codemirror/state";
import {
  buildLineSelectionText,
  formatLineRange,
  lineRangeForDoc,
  lineRangeForOffsets,
  quoteSelectedText,
} from "./quote-selection.ts";

test("formatLineRange matches BB source preview", () => {
  assert.equal(formatLineRange(4, 4), "4");
  assert.equal(formatLineRange(4, 8), "4-8");
});

test("buildLineSelectionText quotes full lines with a path header", () => {
  const contents = "one\ntwo\nthree\n";
  assert.equal(
    buildLineSelectionText({ contents, path: "src/a.ts", start: 2, end: 3 }),
    "src/a.ts:2-3\ntwo\nthree",
  );
  assert.equal(
    buildLineSelectionText({ contents, path: "src/a.ts", start: 1, end: 1 }),
    "src/a.ts:1\none",
  );
  assert.equal(
    buildLineSelectionText({ contents, path: "src/a.ts", start: 4, end: 4 }),
    null,
  );
});

test("lineRangeForOffsets drops a trailing line-start caret", () => {
  const contents = "one\ntwo\nthree";
  assert.deepEqual(lineRangeForOffsets(contents, 0, 3), { start: 1, end: 1 });
  assert.deepEqual(lineRangeForOffsets(contents, 0, 4), { start: 1, end: 1 });
  assert.deepEqual(lineRangeForOffsets(contents, 0, 7), { start: 1, end: 2 });
  assert.deepEqual(lineRangeForOffsets(contents, 4, 8), { start: 2, end: 2 });
  assert.equal(lineRangeForOffsets(contents, 2, 2), null);
});

test("lineRangeForDoc matches offsets without scanning the file", () => {
  const doc = Text.of(["one", "two", "three"]);
  assert.deepEqual(lineRangeForDoc(doc, 0, 3), { start: 1, end: 1 });
  assert.deepEqual(lineRangeForDoc(doc, 0, 4), { start: 1, end: 1 });
  assert.deepEqual(lineRangeForDoc(doc, 0, 7), { start: 1, end: 2 });
  assert.deepEqual(lineRangeForDoc(doc, 4, 8), { start: 2, end: 2 });
  assert.equal(lineRangeForDoc(doc, 2, 2), null);
});

test("quoteSelectedText quotes source lines like the code editor", () => {
  const contents = "# Title\n\nA file tree in the BB thread side panel.\nHello **world**.\n";
  assert.equal(
    quoteSelectedText(
      "README.md",
      contents,
      "A file tree in the BB thread side panel.",
    ),
    "README.md:3\nA file tree in the BB thread side panel.",
  );
  assert.equal(
    quoteSelectedText("README.md", contents, "Title"),
    "README.md:1\n# Title",
  );
  assert.equal(
    quoteSelectedText("README.md", contents, "Hello **world**."),
    "README.md:4\nHello **world**.",
  );
  assert.equal(
    quoteSelectedText("README.md", contents, "not in the file"),
    "README.md\nnot in the file",
  );
  assert.equal(quoteSelectedText("README.md", contents, "   "), null);
});
