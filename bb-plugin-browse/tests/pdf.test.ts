import { it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pngToPdf } from "../src/pdf";
it("exports a valid PDF containing the captured image", async () => {
  // Keep the unit test independent of screenshots from an archived live run.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
    "base64",
  );
  const bytes = await pngToPdf(png);
  expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
  expect(doc.getProducer()).toBe("Agent Browser for BB");
});
