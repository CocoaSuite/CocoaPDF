// PdfCore: every PDF operation CocoaPDF performs, on one PDFium instance.
// Framework-free; runs in the PDF worker in the browser and in Node for tests.
//
// High-level work (rendering, text, search, annotations, metadata, bookmarks)
// goes through @embedpdf/engines' PdfiumNative. Page-structure operations the
// engine does not offer (rotate, move, insert blank, duplicate, merge) call
// PDFium directly on the same document handle, then refresh the engine's view.

import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import { PdfiumNative } from "@embedpdf/engines/pdfium";
import {
  MatchFlag,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfPageObject,
  type Rect,
} from "@embedpdf/models";

export type { PdfAnnotationObject, Rect };
export { PdfAnnotationSubtype };

export interface PageInfo {
  /** Size in PDF points, after the page's /Rotate is applied. */
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface Outline {
  title: string;
  page: number | null;
  children: Outline[];
}

export interface Metadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  creationDate: string | null;
  modificationDate: string | null;
}

export interface DocInfo {
  id: string;
  pages: PageInfo[];
  metadata: Metadata;
  outline: Outline[];
  encrypted: boolean;
  attachments: { name: string; size: number }[];
  hasJavaScript: boolean;
  signatures: number;
}

export interface TextRun {
  text: string;
  /** Glyph boxes in page points (top-left origin), one per character of `text`. */
  boxes: [number, number, number, number][];
}

export interface SearchHit {
  page: number;
  rects: [number, number, number, number][];
  context: string;
}

export interface Bitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export class PdfError extends Error {
  constructor(
    readonly code: "password" | "format" | "notfound" | "failed",
    message: string,
  ) {
    super(message);
  }
}

interface Open {
  doc: PdfDocumentObject;
  /** Pages removed by deletePage, kept so the deletion can be undone exactly. */
  stash: Map<string, PdfDocumentObject>;
}

const ROT = [0, 90, 180, 270] as const;
let seq = 0;

/** Await an engine Task, turning its rejection into a PdfError. */
async function run<T>(task: { toPromise(): Promise<T> }, what: string): Promise<T> {
  try {
    return await task.toPromise();
  } catch (e) {
    const reason = e as { reason?: { code?: number; message?: string }; message?: string };
    const msg = reason?.reason?.message ?? reason?.message ?? String(e);
    throw new PdfError("failed", `${what}: ${msg}`);
  }
}

export class PdfCore {
  private docs = new Map<string, Open>();
  private constructor(
    private pdf: WrappedPdfiumModule,
    private engine: PdfiumNative,
  ) {}

  static async create(wasmBinary: ArrayBuffer | Uint8Array): Promise<PdfCore> {
    const bin = wasmBinary instanceof Uint8Array ? wasmBinary : new Uint8Array(wasmBinary);
    const pdf = await init({ wasmBinary: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) } as never);
    // fontFallback: null — never fetch fonts from the network (documents stay private).
    const engine = new PdfiumNative(pdf, { fontFallback: null });
    return new PdfCore(pdf, engine);
  }

  /* ───────── documents ───────── */

  async open(bytes: ArrayBuffer | Uint8Array, password = ""): Promise<DocInfo> {
    const id = `doc${++seq}`;
    const content = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes.slice(0);
    let doc: PdfDocumentObject;
    try {
      doc = await this.engine.openDocumentBuffer({ id, content }, { password }).toPromise();
    } catch (e) {
      const code = (e as { reason?: { code?: number } }).reason?.code;
      // PdfErrorCode.Password = 4 in @embedpdf/models
      if (code === 4 || /password/i.test(JSON.stringify(e))) throw new PdfError("password", "This PDF is protected by a password.");
      throw new PdfError("format", "This file could not be opened as a PDF. It may be damaged.");
    }
    this.docs.set(id, { doc, stash: new Map() });
    return this.info(id);
  }

  /** A new empty document (used for merge targets and extraction). */
  async create(): Promise<string> {
    const doc = await run(this.engine.createDocument(`doc${++seq}`), "Create document");
    this.docs.set(doc.id, { doc, stash: new Map() });
    return doc.id;
  }

  close(id: string) {
    const o = this.docs.get(id);
    if (!o) return;
    for (const s of o.stash.values()) this.engine.closeDocument(s);
    this.engine.closeDocument(o.doc);
    this.docs.delete(id);
  }

  async info(id: string): Promise<DocInfo> {
    const { doc } = this.get(id);
    const meta = await run(this.engine.getMetadata(doc), "Read metadata");
    const marks = await run(this.engine.getBookmarks(doc), "Read outline").catch(() => ({ bookmarks: [] }));
    const atts = await run(this.engine.getAttachments(doc), "Read attachments").catch(() => []);
    const js = await run(this.engine.getDocumentJavaScriptActions(doc), "Read scripts").catch(() => []);
    const sigs = await run(this.engine.getSignatures(doc), "Read signatures").catch(() => []);
    const toOutline = (b: { title: string; target?: unknown; children?: unknown[] }): Outline => {
      const t = b.target as { type?: string; destination?: { pageIndex?: number }; action?: { destination?: { pageIndex?: number } } } | undefined;
      const page = t?.destination?.pageIndex ?? t?.action?.destination?.pageIndex ?? null;
      return { title: b.title, page, children: (b.children ?? []).map((c) => toOutline(c as never)) };
    };
    const d = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" && v ? v : null);
    const m = meta as unknown as Record<string, unknown>;
    return {
      id,
      pages: this.pageInfos(id),
      metadata: {
        title: (m.title as string) ?? "",
        author: (m.author as string) ?? "",
        subject: (m.subject as string) ?? "",
        keywords: (m.keywords as string) ?? "",
        creator: (m.creator as string) ?? "",
        producer: (m.producer as string) ?? "",
        creationDate: d(m.creationDate),
        modificationDate: d(m.modificationDate),
      },
      outline: ((marks as { bookmarks: unknown[] }).bookmarks ?? []).map((b) => toOutline(b as never)),
      encrypted: doc.isEncrypted,
      attachments: (atts as { name: string; size?: number }[]).map((a) => ({ name: a.name, size: a.size ?? 0 })),
      hasJavaScript: (js as unknown[]).length > 0,
      signatures: (sigs as unknown[]).length,
    };
  }

  pageInfos(id: string): PageInfo[] {
    return this.get(id).doc.pages.map((p) => {
      const r = ROT[p.rotation] ?? 0;
      return { width: p.size.width, height: p.size.height, rotation: r };
    });
  }

  async setMetadata(id: string, patch: Partial<Metadata>) {
    const { doc } = this.get(id);
    const m: Record<string, string | null> = {};
    for (const k of ["title", "author", "subject", "keywords", "creator", "producer"] as const) if (patch[k] !== undefined) m[k] = patch[k]!;
    await run(this.engine.setMetadata(doc, m as never), "Write metadata");
  }

  /** Serialize the working document. The original bytes are never modified. */
  save(id: string): Uint8Array {
    const { doc } = this.get(id);
    const ctx = this.ctx(doc.id);
    const P = this.pdf;
    const w = P.PDFiumExt_OpenFileWriter();
    try {
      if (!P.PDFiumExt_SaveAsCopy(ctx.docPtr, w)) throw new PdfError("failed", "The document could not be saved.");
      const size = P.PDFiumExt_GetFileWriterSize(w);
      const ptr = P.pdfium.wasmExports.malloc(size);
      P.PDFiumExt_GetFileWriterData(w, ptr, size);
      const out = (P.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8.slice(ptr, ptr + size);
      P.pdfium.wasmExports.free(ptr);
      return out;
    } finally {
      P.PDFiumExt_CloseFileWriter(w);
    }
  }

  /* ───────── rendering & text ───────── */

  async render(id: string, page: number, scale: number, withAnnotations = true): Promise<Bitmap> {
    const { doc } = this.get(id);
    const img = await run(
      this.engine.renderPageRaw(doc, this.page(doc, page), { scaleFactor: scale, withAnnotations, withForms: true }),
      "Render page",
    );
    return { width: img.width, height: img.height, data: img.data as Uint8ClampedArray };
  }

  async text(id: string, page: number): Promise<TextRun[]> {
    const { doc } = this.get(id);
    const p = this.page(doc, page);
    const [runs, glyphs] = await Promise.all([
      run(this.engine.getPageTextRuns(doc, p), "Read text"),
      run(this.engine.getPageGlyphs(doc, p), "Read glyphs"),
    ]);
    return runs.runs.map((r) => {
      const boxes: TextRun["boxes"] = [];
      for (let i = 0; i < r.charCount; i++) {
        const g = glyphs[r.charIndex + i];
        boxes.push(g ? [g.origin.x, g.origin.y, g.size.width, g.size.height] : [r.rect.origin.x, r.rect.origin.y, 0, r.rect.size.height]);
      }
      return { text: r.text, boxes };
    });
  }

  async search(id: string, query: string, opts: { caseSensitive?: boolean; wholeWord?: boolean } = {}): Promise<SearchHit[]> {
    const { doc } = this.get(id);
    if (!query.trim()) return [];
    let flags = MatchFlag.None as number;
    if (opts.caseSensitive) flags |= MatchFlag.MatchCase;
    if (opts.wholeWord) flags |= MatchFlag.MatchWholeWord;
    const hits: SearchHit[] = [];
    for (const p of doc.pages) {
      const res = await run(this.engine.searchInPage(doc, p, query, flags), "Search");
      for (const r of res)
        hits.push({
          page: p.index,
          rects: r.rects.map((x) => [x.origin.x, x.origin.y, x.size.width, x.size.height]),
          context: `${r.context.before}${r.context.match}${r.context.after}`.replace(/\s+/g, " ").trim(),
        });
    }
    return hits;
  }

  /* ───────── annotations ───────── */

  async annotations(id: string, page: number): Promise<PdfAnnotationObject[]> {
    const { doc } = this.get(id);
    const list = await run(this.engine.getPageAnnotations(doc, this.page(doc, page)), "Read annotations");
    // Form fields (widgets), links and popups are handled elsewhere, not as markup.
    const skip = new Set([PdfAnnotationSubtype.POPUP, PdfAnnotationSubtype.LINK, PdfAnnotationSubtype.WIDGET]);
    return (list as PdfAnnotationObject[]).filter((a) => !skip.has(a.type));
  }

  async addAnnotation(id: string, page: number, anno: PdfAnnotationObject, image?: { data: ArrayBuffer; mimeType: "image/png" | "image/jpeg" }): Promise<string> {
    const { doc } = this.get(id);
    const ctx = image ? ({ data: image.data, mimeType: image.mimeType } as never) : undefined;
    return run(this.engine.createPageAnnotation(doc, this.page(doc, page), { ...anno, pageIndex: page }, ctx), "Add annotation");
  }

  async updateAnnotation(id: string, page: number, anno: PdfAnnotationObject) {
    const { doc } = this.get(id);
    await run(this.engine.updatePageAnnotation(doc, this.page(doc, page), anno, { regenerateAppearance: true }), "Update annotation");
  }

  async removeAnnotation(id: string, page: number, anno: PdfAnnotationObject) {
    const { doc } = this.get(id);
    await run(this.engine.removePageAnnotation(doc, this.page(doc, page), anno), "Remove annotation");
  }

  /* ───────── pages (direct PDFium) ───────── */

  rotatePage(id: string, page: number, rotation: 0 | 90 | 180 | 270) {
    this.withPage(id, page, (pagePtr) => this.pdf.FPDFPage_SetRotation(pagePtr, rotation / 90));
    this.refresh(id);
  }

  /** Move pages (given indices, in that order) so the first lands at `dest` in the result. */
  movePages(id: string, indices: number[], dest: number) {
    const ctx = this.ctx(id);
    const P = this.pdf;
    const ptr = P.pdfium.wasmExports.malloc(indices.length * 4);
    indices.forEach((v, i) => P.pdfium.setValue(ptr + i * 4, v, "i32"));
    this.flush(id);
    const ok = P.FPDF_MovePages(ctx.docPtr, ptr, indices.length, dest);
    P.pdfium.wasmExports.free(ptr);
    if (!ok) throw new PdfError("failed", "The pages could not be moved.");
    this.refresh(id);
  }

  insertBlank(id: string, at: number, width = 612, height = 792) {
    const ctx = this.ctx(id);
    this.flush(id);
    const p = this.pdf.FPDFPage_New(ctx.docPtr, at, width, height);
    if (!p) throw new PdfError("failed", "A blank page could not be inserted.");
    this.pdf.FPDF_ClosePage(p);
    this.refresh(id);
  }

  /** Copy pages from `srcId` (or the same document) into `id` at `at`. */
  importPages(id: string, srcId: string, indices: number[], at: number) {
    const dst = this.ctx(id);
    const src = this.ctx(srcId);
    const P = this.pdf;
    const ptr = P.pdfium.wasmExports.malloc(Math.max(1, indices.length) * 4);
    indices.forEach((v, i) => P.pdfium.setValue(ptr + i * 4, v, "i32"));
    this.flush(id);
    const ok = P.FPDF_ImportPagesByIndex(dst.docPtr, src.docPtr, ptr, indices.length, at);
    P.pdfium.wasmExports.free(ptr);
    if (!ok) throw new PdfError("failed", "The pages could not be copied.");
    this.refresh(id);
  }

  duplicatePage(id: string, page: number) {
    this.importPages(id, id, [page], page + 1);
  }

  /** Delete a page, keeping an exact copy so the deletion can be undone. Returns the stash key. */
  async deletePage(id: string, page: number): Promise<string> {
    const o = this.get(id);
    if (o.doc.pages.length <= 1) throw new PdfError("failed", "A PDF needs at least one page.");
    const keep = await this.create();
    this.importPages(keep, id, [page], 0);
    const keepDoc = this.get(keep).doc;
    this.docs.delete(keep);
    const key = `stash${++seq}`;
    o.stash.set(key, keepDoc);
    this.flush(id);
    this.pdf.FPDFPage_Delete(this.ctx(id).docPtr, page);
    this.refresh(id);
    return key;
  }

  /** Undo a deletePage. */
  restorePage(id: string, key: string, at: number) {
    const o = this.get(id);
    const s = o.stash.get(key);
    if (!s) throw new PdfError("notfound", "That deleted page is no longer available.");
    this.docs.set(s.id, { doc: s, stash: new Map() });
    try {
      this.importPages(id, s.id, [0], at);
    } finally {
      this.docs.delete(s.id);
    }
  }

  /** Bytes of a new PDF holding only the given pages (extract / split). */
  async extract(id: string, indices: number[]): Promise<Uint8Array> {
    const out = await this.create();
    try {
      this.importPages(out, id, indices, 0);
      return this.save(out);
    } finally {
      this.close(out);
    }
  }

  pageCount(id: string) {
    return this.get(id).doc.pages.length;
  }

  /* ───────── internals ───────── */

  private get(id: string): Open {
    const o = this.docs.get(id);
    if (!o) throw new PdfError("notfound", "That document is not open.");
    return o;
  }

  private page(doc: PdfDocumentObject, index: number): PdfPageObject {
    const p = doc.pages[index];
    if (!p) throw new PdfError("notfound", `Page ${index + 1} does not exist.`);
    return p;
  }

  private ctx(id: string): { docPtr: number } {
    const c = (this.engine as unknown as { cache: { getContext(id: string): { docPtr: number } | undefined } }).cache.getContext(this.get(id).doc.id);
    if (!c) throw new PdfError("notfound", "That document is not open.");
    return c;
  }

  /** Drop the engine's cached page handles; indices change after structural edits. */
  private flush(id: string) {
    const c = this.ctx(id) as unknown as { pageCache?: { forceReleaseAll(): void } };
    c.pageCache?.forceReleaseAll();
  }

  private withPage(id: string, page: number, fn: (pagePtr: number) => void) {
    const ctx = this.ctx(id);
    this.flush(id);
    const p = this.pdf.FPDF_LoadPage(ctx.docPtr, page);
    if (!p) throw new PdfError("notfound", `Page ${page + 1} does not exist.`);
    try {
      fn(p);
    } finally {
      this.pdf.FPDF_ClosePage(p);
    }
  }

  /** Rebuild the engine's page list from PDFium after a structural change. */
  private refresh(id: string) {
    const { doc } = this.get(id);
    const ctx = this.ctx(id);
    const P = this.pdf;
    this.flush(id);
    const n = P.FPDF_GetPageCount(ctx.docPtr);
    const pages: PdfPageObject[] = [];
    const sz = P.pdfium.wasmExports.malloc(8);
    const box = P.pdfium.wasmExports.malloc(16);
    const eng = this.engine as unknown as { readPageBoxes(d: number, i: number, b: number): unknown };
    for (let i = 0; i < n; i++) {
      // Same construction as the engine's openDocumentBuffer, so its other calls stay valid.
      P.FPDF_GetPageSizeByIndexF(ctx.docPtr, i, sz);
      pages.push({
        index: i,
        size: { width: P.pdfium.getValue(sz, "float"), height: P.pdfium.getValue(sz + 4, "float") },
        rotation: P.EPDF_GetPageRotationByIndex(ctx.docPtr, i),
        objectNumber: P.EPDFDoc_GetPageObjectNumberByIndex(ctx.docPtr, i),
        boxes: eng.readPageBoxes(ctx.docPtr, i, box),
      } as PdfPageObject);
    }
    P.pdfium.wasmExports.free(sz);
    P.pdfium.wasmExports.free(box);
    doc.pages = pages;
    doc.pageCount = n;
  }
}
