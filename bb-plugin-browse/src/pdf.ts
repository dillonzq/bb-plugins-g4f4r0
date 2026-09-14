import { PDFDocument } from "pdf-lib";
export async function pngToPdf(png: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setProducer("Browse for BB");
  doc.setTitle("Browser page capture");
  const img = await doc.embedPng(png);
  const width = 595.28,
    pageHeight = 841.89,
    height = (img.height * width) / img.width,
    pages = Math.max(1, Math.ceil(height / pageHeight));
  if (pages > 200)
    throw new Error(
      "Page capture exceeds 200 PDF pages. Narrow the page first.",
    );
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([width, pageHeight]);
    page.drawImage(img, {
      x: 0,
      y: pageHeight - height + i * pageHeight,
      width,
      height,
    });
  }
  return doc.save();
}
