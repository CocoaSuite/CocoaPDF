// Pure helpers: build standard PDF annotation objects from tool input, move and
// resize them, and select text from glyph boxes. Coordinates are PDF points with
// a top-left origin (as the engine reports them).

import { PdfAnnotationSubtype, type PdfAnnotationObject, type Rect, type TextRun } from "../engine/core";

export type Pt = [number, number];
export type Box = [number, number, number, number]; // x, y, w, h

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ origin: { x, y }, size: { width: w, height: h } });
export const boxOf = (r: Rect): Box => [r.origin.x, r.origin.y, r.size.width, r.size.height];
export const norm = (a: Pt, b: Pt): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];

const base = (page: number, author: string) => ({ id: "", pageIndex: page, author, created: new Date(), modified: new Date() });

export interface Style {
  color: string;
  opacity: number;
  width: number;
  fontSize: number;
}

export function markup(kind: "highlight" | "underline" | "strikeout", page: number, rects: Box[], style: Style, author: string, text: string): PdfAnnotationObject {
  const type = kind === "highlight" ? PdfAnnotationSubtype.HIGHLIGHT : kind === "underline" ? PdfAnnotationSubtype.UNDERLINE : PdfAnnotationSubtype.STRIKEOUT;
  const all = union(rects);
  return {
    ...base(page, author),
    type,
    rect: rect(...all),
    segmentRects: rects.map((r) => rect(...r)),
    color: style.color,
    strokeColor: style.color,
    opacity: style.opacity,
    custom: { text },
  } as never;
}

export function note(page: number, at: Pt, style: Style, author: string): PdfAnnotationObject {
  return { ...base(page, author), type: PdfAnnotationSubtype.TEXT, rect: rect(at[0] - 12, at[1] - 12, 24, 24), contents: "", color: style.color, strokeColor: style.color, opacity: 1 } as never;
}

export function shape(kind: "rect" | "ellipse", page: number, b: Box, style: Style, author: string): PdfAnnotationObject {
  return {
    ...base(page, author),
    type: kind === "rect" ? PdfAnnotationSubtype.SQUARE : PdfAnnotationSubtype.CIRCLE,
    rect: rect(...b),
    color: "transparent",
    strokeColor: style.color,
    strokeWidth: style.width,
    opacity: style.opacity,
    flags: ["print"],
  } as never;
}

export function line(kind: "line" | "arrow", page: number, a: Pt, b: Pt, style: Style, author: string): PdfAnnotationObject {
  const pad = style.width * 4 + 4;
  const [x, y, w, h] = norm(a, b);
  return {
    ...base(page, author),
    type: PdfAnnotationSubtype.LINE,
    rect: rect(x - pad, y - pad, w + pad * 2, h + pad * 2),
    linePoints: { start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] } },
    lineEndings: { start: 0, end: kind === "arrow" ? 4 : 0 }, // PdfAnnotationLineEnding: 0 None, 4 OpenArrow
    color: "transparent",
    strokeColor: style.color,
    strokeWidth: style.width,
    opacity: style.opacity,
    flags: ["print"],
  } as never;
}

export function ink(page: number, strokes: Pt[][], style: Style, author: string): PdfAnnotationObject {
  const pts = strokes.flat();
  const pad = style.width;
  const [x, y, w, h] = union(pts.map(([px, py]) => [px, py, 0, 0] as Box));
  return {
    ...base(page, author),
    type: PdfAnnotationSubtype.INK,
    rect: rect(x - pad, y - pad, w + pad * 2, h + pad * 2),
    inkList: strokes.map((s) => ({ points: s.map(([px, py]) => ({ x: px, y: py })) })),
    color: style.color,
    strokeColor: style.color,
    strokeWidth: style.width,
    opacity: style.opacity,
    flags: ["print"],
  } as never;
}

export function freeText(page: number, at: Pt, text: string, style: Style, author: string): PdfAnnotationObject {
  const lines = text.split("\n");
  const w = Math.max(40, Math.min(480, Math.max(...lines.map((l) => l.length)) * style.fontSize * 0.55 + 8));
  const h = lines.length * style.fontSize * 1.25 + 6;
  return {
    ...base(page, author),
    type: PdfAnnotationSubtype.FREETEXT,
    rect: rect(at[0], at[1], w, h),
    contents: text,
    fontFamily: 4, // Helvetica
    fontSize: style.fontSize,
    fontColor: style.color,
    textAlign: 0,
    opacity: style.opacity,
    backgroundColor: "transparent",
    flags: ["print"],
  } as never;
}

export function image(page: number, b: Box, author: string): PdfAnnotationObject {
  return { ...base(page, author), type: PdfAnnotationSubtype.STAMP, rect: rect(...b), flags: ["print"] } as never;
}

/** Move an annotation by (dx, dy), including its point lists. */
export function moved(a: PdfAnnotationObject, dx: number, dy: number): PdfAnnotationObject {
  const r = (q: Rect) => rect(q.origin.x + dx, q.origin.y + dy, q.size.width, q.size.height);
  const p = (q: { x: number; y: number }) => ({ x: q.x + dx, y: q.y + dy });
  const out: Record<string, unknown> = { ...a, rect: r(a.rect) };
  const any = a as unknown as Record<string, unknown>;
  if (Array.isArray(any.segmentRects)) out.segmentRects = (any.segmentRects as Rect[]).map(r);
  if (Array.isArray(any.inkList)) out.inkList = (any.inkList as { points: { x: number; y: number }[] }[]).map((s) => ({ points: s.points.map(p) }));
  if (any.linePoints) {
    const lp = any.linePoints as { start: { x: number; y: number }; end: { x: number; y: number } };
    out.linePoints = { start: p(lp.start), end: p(lp.end) };
  }
  if (any.unrotatedRect) out.unrotatedRect = r(any.unrotatedRect as Rect);
  return out as unknown as PdfAnnotationObject;
}

/** Resize a box-shaped annotation to a new rectangle (scales ink and lines with it). */
export function resized(a: PdfAnnotationObject, to: Box): PdfAnnotationObject {
  const [x0, y0, w0, h0] = boxOf(a.rect);
  const sx = w0 ? to[2] / w0 : 1;
  const sy = h0 ? to[3] / h0 : 1;
  const map = (q: { x: number; y: number }) => ({ x: to[0] + (q.x - x0) * sx, y: to[1] + (q.y - y0) * sy });
  const out: Record<string, unknown> = { ...a, rect: rect(...to) };
  const any = a as unknown as Record<string, unknown>;
  if (Array.isArray(any.inkList)) out.inkList = (any.inkList as { points: { x: number; y: number }[] }[]).map((s) => ({ points: s.points.map(map) }));
  if (any.linePoints) {
    const lp = any.linePoints as { start: { x: number; y: number }; end: { x: number; y: number } };
    out.linePoints = { start: map(lp.start), end: map(lp.end) };
  }
  delete out.unrotatedRect;
  return out as unknown as PdfAnnotationObject;
}

export const resizable = (a: PdfAnnotationObject) =>
  [PdfAnnotationSubtype.SQUARE, PdfAnnotationSubtype.CIRCLE, PdfAnnotationSubtype.FREETEXT, PdfAnnotationSubtype.STAMP, PdfAnnotationSubtype.INK].includes(a.type);

export function union(boxes: Box[]): Box {
  if (!boxes.length) return [0, 0, 0, 0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y, w, h] of boxes) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  }
  return [x0, y0, x1 - x0, y1 - y0];
}

export const inBox = ([px, py]: Pt, [x, y, w, h]: Box, pad = 0) => px >= x - pad && px <= x + w + pad && py >= y - pad && py <= y + h + pad;

/** Topmost annotation under a point. */
export function hitTest(list: PdfAnnotationObject[], p: Pt, pad = 3): PdfAnnotationObject | null {
  for (let i = list.length - 1; i >= 0; i--) if (inBox(p, boxOf(list[i]!.rect), pad)) return list[i]!;
  return null;
}

/* ───────── text selection ───────── */

interface Ch {
  c: string;
  b: Box;
  run: number;
}

export function flatten(runs: TextRun[]): Ch[] {
  const out: Ch[] = [];
  runs.forEach((r, ri) => [...r.text].forEach((c, i) => out.push({ c, b: r.boxes[i] ?? [0, 0, 0, 0], run: ri })));
  return out;
}

/** Index of the character nearest a point (containing box wins). */
export function nearestChar(chars: Ch[], p: Pt): number {
  let best = -1;
  let bd = Infinity;
  chars.forEach((ch, i) => {
    const [x, y, w, h] = ch.b;
    if (w === 0 && h === 0) return;
    const dx = p[0] < x ? x - p[0] : p[0] > x + w ? p[0] - x - w : 0;
    const dy = p[1] < y ? y - p[1] : p[1] > y + h ? p[1] - y - h : 0;
    const d = dy * 4 + dx; // prefer the right line
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Selected text and one rectangle per line between two character indices. */
export function selection(chars: Ch[], a: number, b: number): { text: string; rects: Box[] } {
  if (a < 0 || b < 0 || !chars.length) return { text: "", rects: [] };
  const [s, e] = a <= b ? [a, b] : [b, a];
  const rects: Box[] = [];
  let text = "";
  let cur: Box | null = null;
  for (let i = s; i <= e; i++) {
    const ch = chars[i]!;
    const prev = chars[i - 1];
    if (i > s && prev && prev.run !== ch.run) {
      const sameLine = Math.abs(prev.b[1] - ch.b[1]) < Math.max(prev.b[3], ch.b[3]) * 0.5;
      text += sameLine ? (/\s$/.test(text) || /^\s/.test(ch.c) ? "" : " ") : "\n";
    }
    text += ch.c;
    const [x, y, w, h] = ch.b;
    if (w === 0 && h === 0) continue;
    if (cur && Math.abs(cur[1] - y) < Math.max(cur[3], h) * 0.5 && x >= cur[0] - 1) {
      const x1 = Math.max(cur[0] + cur[2], x + w);
      const y0 = Math.min(cur[1], y);
      const y1 = Math.max(cur[1] + cur[3], y + h);
      cur = [cur[0], y0, x1 - cur[0], y1 - y0];
      rects[rects.length - 1] = cur;
    } else {
      cur = [x, y, w, h];
      rects.push(cur);
    }
  }
  return { text: text.replace(/[ \t]+\n/g, "\n"), rects };
}
