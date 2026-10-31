// Test PDFs built with pdf-lib: several pages, text, different sizes, a rotated
// page, an image, a form, metadata. Used by unit and end-to-end tests.

import { PDFDocument, StandardFonts, degrees, rgb } from "@cantoo/pdf-lib";

// 2×2 red/blue PNG
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwnwEKmJiZGRiYGAAqKgMDtx0EZQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
export const SAMPLE_PNG = PNG;

export async function sampleContract(pages = 4): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Supplier Agreement");
  doc.setAuthor("Cocoa Test Suite");
  doc.setSubject("Fixture");
  doc.setKeywords(["contract", "fixture"]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const png = await doc.embedPng(PNG);
  for (let i = 0; i < pages; i++) {
    const landscape = i === 2;
    const page = doc.addPage(landscape ? [792, 612] : [612, 792]);
    const { height } = page.getSize();
    page.drawText(`Section ${i + 1}`, { x: 72, y: height - 90, size: 20, font: bold });
    const lines = [
      `This is page ${i + 1} of the supplier agreement.`,
      i === 1 ? "If the Buyer terminates, it shall pay a termination fee." : "The parties agree to the terms below.",
      "Payment is due within thirty days of invoice.",
    ];
    lines.forEach((t, k) => page.drawText(t, { x: 72, y: height - 130 - k * 20, size: 12, font: serif }));
    if (i === 0) page.drawImage(png, { x: 72, y: 300, width: 80, height: 80 });
    if (i === 3) page.setRotation(degrees(90));
  }
  // a simple form on the first page
  const form = doc.getForm();
  const name = form.createTextField("buyer.name");
  name.setText("");
  name.addToPage(doc.getPage(0), { x: 72, y: 200, width: 220, height: 22, textColor: rgb(0, 0, 0) });
  const agree = form.createCheckBox("buyer.agree");
  agree.addToPage(doc.getPage(0), { x: 72, y: 160, width: 16, height: 16 });
  return doc.save();
}

/** A long document for performance checks. */
export async function largeDocument(pages = 300): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Page ${i + 1}`, { x: 60, y: 780, size: 18, font: f });
    for (let k = 0; k < 30; k++) p.drawText(`Line ${k + 1} of page ${i + 1}. The quick brown fox jumps over the lazy dog.`, { x: 60, y: 740 - k * 22, size: 11, font: f });
  }
  return doc.save();
}
