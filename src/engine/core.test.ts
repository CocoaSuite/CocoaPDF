import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "@cantoo/pdf-lib";
import { PdfCore, PdfAnnotationSubtype, PdfError, type PdfAnnotationObject } from "./core";
import { SAMPLE_PNG, largeDocument, sampleContract } from "../test/fixtures";

const wasm = readFileSync(fileURLToPath(new URL("../../node_modules/@embedpdf/pdfium/dist/pdfium.wasm", import.meta.url)));
let core: PdfCore;
beforeAll(async () => {
  core = await PdfCore.create(wasm);
}, 60000);

const rect = (x: number, y: number, w: number, h: number) => ({ origin: { x, y }, size: { width: w, height: h } });

/** Independent re-read of saved bytes with pdf-lib: page order, sizes, rotations. */
async function inspect(bytes: Uint8Array) {
  const d = await PDFDocument.load(bytes);
  return d.getPages().map((p) => {
    const { width, height } = p.getSize();
    return `${Math.round(width)}x${Math.round(height)}@${p.getRotation().angle}`;
  });
}

describe("opening and reading", () => {
  it("opens a PDF and reads pages, metadata and outline", async () => {
    const info = await core.open(await sampleContract());
    expect(info.pages).toHaveLength(4);
    expect(info.pages[2]).toMatchObject({ width: 792, height: 612 });
    expect(info.pages[3]!.rotation).toBe(90);
    expect(info.metadata.title).toBe("Supplier Agreement");
    expect(info.metadata.author).toBe("Cocoa Test Suite");
    core.close(info.id);
  });

  it("renders a page to pixels", async () => {
    const info = await core.open(await sampleContract());
    const bmp = await core.render(info.id, 0, 1);
    expect(bmp.width).toBe(612);
    expect(bmp.height).toBe(792);
    // some dark text pixels must exist
    let dark = 0;
    for (let i = 0; i < bmp.data.length; i += 4) if (bmp.data[i]! < 80) dark++;
    expect(dark).toBeGreaterThan(200);
    core.close(info.id);
  });

  it("extracts text with per-character boxes", async () => {
    const info = await core.open(await sampleContract());
    const runs = await core.text(info.id, 1);
    const all = runs.map((r) => r.text).join(" ");
    expect(all).toContain("termination fee");
    for (const r of runs) expect(r.boxes).toHaveLength(r.text.length);
    core.close(info.id);
  });

  it("searches phrases across pages, with case sensitivity", async () => {
    const info = await core.open(await sampleContract());
    const hits = await core.search(info.id, "termination fee");
    expect(hits.map((h) => h.page)).toEqual([1]);
    expect(hits[0]!.rects.length).toBeGreaterThan(0);
    expect((await core.search(info.id, "payment is due")).length).toBe(4);
    expect((await core.search(info.id, "payment is due", { caseSensitive: true })).length).toBe(0);
    core.close(info.id);
  });

  it("refuses damaged files clearly", async () => {
    await expect(core.open(new TextEncoder().encode("%PDF-1.7 garbage"))).rejects.toBeInstanceOf(PdfError);
    await expect(core.open(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: "format" });
  });
});

describe("annotations survive save and reopen", () => {
  it("writes standard annotations into the PDF", async () => {
    const info = await core.open(await sampleContract());
    const id = info.id;
    const hit = (await core.search(id, "termination fee"))[0]!;
    const segs = hit.rects.map(([x, y, w, h]) => rect(x, y, w, h));
    const base = { id: "", pageIndex: 1, author: "Tester" };
    const annos: PdfAnnotationObject[] = [
      { ...base, type: PdfAnnotationSubtype.HIGHLIGHT, rect: segs[0]!, segmentRects: segs, color: "#F2D44A", opacity: 0.5, contents: "Check this fee" } as never,
      { ...base, type: PdfAnnotationSubtype.TEXT, rect: rect(540, 100, 24, 24), contents: "Ask legal", color: "#F2D44A", opacity: 1 } as never,
      { ...base, type: PdfAnnotationSubtype.SQUARE, rect: rect(60, 110, 450, 60), color: "transparent", strokeColor: "#E5534B", strokeWidth: 2, opacity: 1, flags: ["print"] } as never,
      { ...base, type: PdfAnnotationSubtype.FREETEXT, rect: rect(72, 400, 260, 40), contents: "Approved with changes", fontFamily: 4, fontSize: 14, fontColor: "#1D3F8A", textAlign: 0, opacity: 1, backgroundColor: "transparent" } as never,
      { ...base, type: PdfAnnotationSubtype.INK, rect: rect(300, 500, 120, 60), inkList: [{ points: [{ x: 300, y: 560 }, { x: 340, y: 500 }, { x: 380, y: 560 }, { x: 420, y: 500 }] }], strokeColor: "#4B9CFF", color: "#4B9CFF", strokeWidth: 3, opacity: 1 } as never,
    ];
    for (const a of annos) expect(await core.addAnnotation(id, 1, a)).toBeTruthy();
    // image stamp
    expect(
      await core.addAnnotation(id, 1, { ...base, type: PdfAnnotationSubtype.STAMP, rect: rect(400, 600, 80, 80) } as never, { data: SAMPLE_PNG.slice().buffer, mimeType: "image/png" }),
    ).toBeTruthy();

    const bytes = core.save(id);
    core.close(id);
    const again = await core.open(bytes);
    const list = await core.annotations(again.id, 1);
    const types = list.map((a) => a.type).sort((a, b) => a - b);
    expect(types).toEqual(
      [PdfAnnotationSubtype.TEXT, PdfAnnotationSubtype.FREETEXT, PdfAnnotationSubtype.SQUARE, PdfAnnotationSubtype.HIGHLIGHT, PdfAnnotationSubtype.STAMP, PdfAnnotationSubtype.INK].sort((a, b) => a - b),
    );
    const note = list.find((a) => a.type === PdfAnnotationSubtype.TEXT)!;
    expect(note.contents).toBe("Ask legal");
    const ft = list.find((a) => a.type === PdfAnnotationSubtype.FREETEXT)!;
    expect(ft.contents).toBe("Approved with changes");
    // independent reader sees them as /Annots on page 2
    const lib = await PDFDocument.load(bytes);
    expect(lib.getPage(1).node.Annots()?.size()).toBeGreaterThanOrEqual(6);
    core.close(again.id);
  });

  it("updates and removes annotations", async () => {
    const info = await core.open(await sampleContract());
    await core.addAnnotation(info.id, 0, { id: "", pageIndex: 0, type: PdfAnnotationSubtype.SQUARE, rect: rect(100, 100, 50, 50), color: "transparent", strokeColor: "#000000", strokeWidth: 1, opacity: 1, flags: ["print"] } as never);
    let [sq] = await core.annotations(info.id, 0);
    await core.updateAnnotation(info.id, 0, { ...sq!, rect: rect(200, 200, 80, 40) } as never);
    [sq] = await core.annotations(info.id, 0);
    expect(Math.round(sq!.rect.origin.x)).toBe(200);
    await core.removeAnnotation(info.id, 0, sq!);
    expect(await core.annotations(info.id, 0)).toHaveLength(0);
    core.close(info.id);
  });
});

describe("page management", () => {
  it("rotates, moves, duplicates, inserts and deletes pages — and the saved file agrees", async () => {
    const info = await core.open(await sampleContract());
    const id = info.id;
    // mark pages by size/rotation: p0 612x792@0, p1 612x792@0, p2 792x612@0, p3 612x792@90
    core.rotatePage(id, 0, 180);
    core.movePages(id, [2], 0); // landscape page first
    core.duplicatePage(id, 0);
    core.insertBlank(id, 5, 300, 300);
    const key = await core.deletePage(id, 2); // the rotated-180 original page 0
    expect(core.pageCount(id)).toBe(5);
    const saved = await inspect(core.save(id));
    expect(saved).toEqual(["792x612@0", "792x612@0", "612x792@0", "612x792@90", "300x300@0"]);
    // undo the deletion: the exact page comes back
    core.restorePage(id, key, 2);
    expect(await inspect(core.save(id))).toEqual(["792x612@0", "792x612@0", "612x792@180", "612x792@0", "612x792@90", "300x300@0"]);
    core.close(id);
  });

  it("extracts pages into a new PDF and merges documents", async () => {
    const a = await core.open(await sampleContract());
    const part = await core.extract(a.id, [3, 1]);
    expect(await inspect(part)).toEqual(["612x792@90", "612x792@0"]);
    const b = await core.open(await sampleContract(2));
    core.importPages(a.id, b.id, [0, 1], 4); // append
    expect(core.pageCount(a.id)).toBe(6);
    const merged = await core.open(core.save(a.id));
    expect((await core.search(merged.id, "This is page 1")).map((h) => h.page)).toEqual([0, 4]);
    for (const d of [a, b, merged]) core.close(d.id);
  });

  it("keeps annotations attached to their page when pages move", async () => {
    const info = await core.open(await sampleContract());
    await core.addAnnotation(info.id, 1, { id: "", pageIndex: 1, type: PdfAnnotationSubtype.TEXT, rect: rect(500, 80, 24, 24), contents: "on page 2", color: "#F2D44A", opacity: 1 } as never);
    core.movePages(info.id, [1], 3);
    const again = await core.open(core.save(info.id));
    expect((await core.annotations(again.id, 3)).map((a) => a.contents)).toEqual(["on page 2"]);
    expect(await core.annotations(again.id, 1)).toHaveLength(0);
    core.close(info.id);
    core.close(again.id);
  });
});

describe("metadata", () => {
  it("edits and preserves document properties", async () => {
    const info = await core.open(await sampleContract());
    await core.setMetadata(info.id, { title: "Signed agreement", keywords: "contract, signed" });
    const again = await core.open(core.save(info.id));
    expect(again.metadata).toMatchObject({ title: "Signed agreement", keywords: "contract, signed", author: "Cocoa Test Suite" });
    core.close(info.id);
    core.close(again.id);
  });
});

describe("large documents", () => {
  it("opens 300 pages and renders one quickly without touching the rest", async () => {
    const bytes = await largeDocument(300);
    const t0 = performance.now();
    const info = await core.open(bytes);
    const opened = performance.now() - t0;
    const t1 = performance.now();
    await core.render(info.id, 250, 0.5);
    const rendered = performance.now() - t1;
    expect(info.pages).toHaveLength(300);
    expect(opened).toBeLessThan(3000);
    expect(rendered).toBeLessThan(1500);
    const hits = await core.search(info.id, "Line 30 of page 299");
    expect(hits.map((h) => h.page)).toEqual([298]);
    core.close(info.id);
  }, 60000);
});
