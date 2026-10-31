// Application state (Zustand) and every editing operation. Each edit is a
// Command that applies itself in the PDF engine and knows its exact inverse;
// undo/redo replay those, never snapshots of UI state.

import { create } from "zustand";
import { pdf, EngineError } from "../engine/client";
import type { DocInfo, Metadata, PageInfo, PdfAnnotationObject, SearchHit, TextRun } from "../engine/core";
import { recovery } from "./recovery";

export type Tool =
  | "select"
  | "hand"
  | "text"
  | "highlight"
  | "underline"
  | "strikeout"
  | "note"
  | "pen"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "textbox"
  | "image";

export interface Style {
  color: string;
  opacity: number;
  width: number;
  fontSize: number;
}
export type StyleKey = "highlight" | "underline" | "strikeout" | "shape" | "pen" | "text" | "note";

export function styleKey(tool: Tool): StyleKey | null {
  switch (tool) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "pen":
    case "note":
      return tool;
    case "rect":
    case "ellipse":
    case "line":
    case "arrow":
      return "shape";
    case "textbox":
      return "text";
    default:
      return null;
  }
}

export interface Command {
  label: string;
  apply(t: Tab): Promise<void>;
  invert(t: Tab): Promise<void>;
  /** Pages whose pixels change; "all" for structural changes. */
  touches: number[] | "all";
}

export interface Tab {
  id: string; // engine document id
  name: string;
  /** Bytes as opened. Never modified; "Save as" writes a new file. */
  original: Uint8Array;
  pages: PageInfo[];
  meta: Metadata;
  outline: DocInfo["outline"];
  notices: string[];
  /** Per-page render revision; bump to re-render. */
  rev: number[];
  annos: Record<number, PdfAnnotationObject[]>;
  undo: Command[];
  redo: Command[];
  dirty: boolean;
  savedAt: number | null;
  recoveryKey: string;
}

export interface Selection {
  page: number;
  annoId: string;
}

export interface SearchState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  hits: SearchHit[];
  index: number;
  busy: boolean;
}

interface State {
  tabs: Tab[];
  active: string | null;
  tool: Tool;
  zoom: number;
  fit: "width" | "page" | null;
  layout: "continuous" | "single" | "facing";
  currentPage: number;
  pageSelection: number[];
  sidebar: "pages" | "outline" | "notes" | null;
  selection: Selection | null;
  textSel: { page: number; text: string } | null;
  search: SearchState;
  toasts: { id: number; text: string; bad?: boolean }[];
  dialog: null | "shortcuts" | "about" | "properties" | "split" | { password: { name: string; bytes: Uint8Array; retry: boolean } } | { close: string };
  busy: string | null;
  engineReady: boolean;
  engineError: string | null;
  /** Default styles for new annotations, per tool family. */
  styles: Record<StyleKey, Style>;
  scrollRequest: { page: number; y?: number; n: number } | null;
}

export const useApp = create<State>(() => ({
  tabs: [],
  active: null,
  tool: "select",
  zoom: 1,
  fit: "width",
  layout: "continuous",
  currentPage: 0,
  pageSelection: [],
  sidebar: "pages",
  selection: null,
  textSel: null,
  search: { open: false, query: "", caseSensitive: false, hits: [], index: 0, busy: false },
  toasts: [],
  dialog: null,
  busy: null,
  engineReady: false,
  engineError: null,
  styles: {
    highlight: { color: "#F2D44A", opacity: 0.5, width: 1, fontSize: 14 },
    underline: { color: "#E5534B", opacity: 1, width: 1, fontSize: 14 },
    strikeout: { color: "#E5534B", opacity: 1, width: 1, fontSize: 14 },
    shape: { color: "#E5534B", opacity: 1, width: 2, fontSize: 14 },
    pen: { color: "#4B9CFF", opacity: 1, width: 2, fontSize: 14 },
    text: { color: "#1D3F8A", opacity: 1, width: 1, fontSize: 14 },
    note: { color: "#F2D44A", opacity: 1, width: 1, fontSize: 14 },
  },
  scrollRequest: null,
}));

const set = useApp.setState;
const get = useApp.getState;

pdf.ready.then(
  () => set({ engineReady: true }),
  (e: Error) => set({ engineError: e.message }),
);

let toastSeq = 0;
export function toast(text: string, bad = false) {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts, { id, text, bad }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), bad ? 5500 : 2600);
}

export const activeTab = (): Tab | undefined => {
  const s = get();
  return s.tabs.find((t) => t.id === s.active);
};

function patchTab(id: string, fn: (t: Tab) => Partial<Tab>) {
  set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)) }));
}

export function scrollToPage(page: number, y?: number) {
  set((s) => ({ scrollRequest: { page, y, n: (s.scrollRequest?.n ?? 0) + 1 }, currentPage: page }));
}

/* ───────── opening & closing ───────── */

export async function openBytes(name: string, bytes: Uint8Array, password = "", recoveryKey?: string) {
  set({ busy: `Opening ${name}…` });
  try {
    const info = await pdf.open(bytes, password);
    const notices: string[] = [];
    if (info.hasJavaScript) notices.push("This PDF contains JavaScript. CocoaPDF never runs it.");
    if (info.signatures) notices.push(`This PDF has ${info.signatures} digital signature(s). Editing it will invalidate them; the original file is not changed.`);
    if (info.encrypted) notices.push("This PDF is encrypted. Saved copies are written without the password.");
    const tab: Tab = {
      id: info.id,
      name,
      original: bytes,
      pages: info.pages,
      meta: info.metadata,
      outline: info.outline,
      notices,
      rev: info.pages.map(() => 0),
      annos: {},
      undo: [],
      redo: [],
      dirty: !!recoveryKey,
      savedAt: null,
      recoveryKey: recoveryKey ?? `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    };
    set((s) => ({ tabs: [...s.tabs, tab], active: tab.id, currentPage: 0, selection: null, pageSelection: [], dialog: null, search: { ...s.search, hits: [], index: 0 } }));
    scrollToPage(0);
    for (const n of notices) toast(n);
    return tab;
  } catch (e) {
    if (e instanceof EngineError && e.code === "password") {
      set({ dialog: { password: { name, bytes, retry: !!password } } });
      return null;
    }
    toast(e instanceof Error ? e.message : `Could not open ${name}.`, true);
    return null;
  } finally {
    set({ busy: null });
  }
}

export async function closeTab(id: string, opts: { keepRecovery?: boolean } = {}) {
  const t = get().tabs.find((x) => x.id === id);
  if (!t) return;
  await pdf.call("close", id);
  if (!opts.keepRecovery) recovery.remove(t.recoveryKey).catch(() => undefined);
  set((s) => {
    const tabs = s.tabs.filter((x) => x.id !== id);
    return { tabs, active: s.active === id ? (tabs[tabs.length - 1]?.id ?? null) : s.active, selection: null, pageSelection: [] };
  });
}

/* ───────── command execution ───────── */

let queue: Promise<unknown> = Promise.resolve();
/** Engine edits run one at a time, in order. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

async function afterChange(t: Tab, touches: number[] | "all") {
  if (touches === "all") {
    const pages = await pdf.call("pageInfos", t.id);
    patchTab(t.id, (x) => ({ pages, rev: pages.map((_, i) => (x.rev[i] ?? 0) + 1), annos: {}, dirty: true }));
  } else {
    const annos: Record<number, PdfAnnotationObject[]> = {};
    for (const p of touches) annos[p] = await pdf.call("annotations", t.id, p);
    patchTab(t.id, (x) => ({ rev: x.rev.map((r, i) => (touches.includes(i) ? r + 1 : r)), annos: { ...x.annos, ...annos }, dirty: true }));
  }
  scheduleRecovery(t.id);
}

export function exec(cmd: Command): Promise<boolean> {
  return serial(async () => {
    const t = activeTab();
    if (!t) return false;
    try {
      await cmd.apply(t);
    } catch (e) {
      toast(`${cmd.label} failed: ${(e as Error).message}`, true);
      return false;
    }
    patchTab(t.id, (x) => ({ undo: [...x.undo.slice(-199), cmd], redo: [] }));
    await afterChange(t, cmd.touches);
    return true;
  });
}

export function undo() {
  return serial(async () => {
    const t = activeTab();
    const cmd = t?.undo[t.undo.length - 1];
    if (!t || !cmd) return;
    try {
      await cmd.invert(t);
    } catch (e) {
      toast(`Undo failed: ${(e as Error).message}`, true);
      return;
    }
    patchTab(t.id, (x) => ({ undo: x.undo.slice(0, -1), redo: [...x.redo, cmd] }));
    set({ selection: null });
    await afterChange(t, cmd.touches);
  });
}

export function redo() {
  return serial(async () => {
    const t = activeTab();
    const cmd = t?.redo[t.redo.length - 1];
    if (!t || !cmd) return;
    try {
      await cmd.apply(t);
    } catch (e) {
      toast(`Redo failed: ${(e as Error).message}`, true);
      return;
    }
    patchTab(t.id, (x) => ({ redo: x.redo.slice(0, -1), undo: [...x.undo, cmd] }));
    await afterChange(t, cmd.touches);
  });
}

/* ───────── annotations ───────── */

export async function loadAnnotations(page: number) {
  const t = activeTab();
  if (!t || t.annos[page]) return;
  const list = await pdf.call("annotations", t.id, page);
  patchTab(t.id, (x) => ({ annos: { ...x.annos, [page]: list } }));
}

/** Engine-assigned ids change when an annotation is re-created by undo/redo; track the live one. */
class Ref {
  constructor(public id: string) {}
}

async function findAnno(t: Tab, page: number, id: string): Promise<PdfAnnotationObject> {
  const list = await pdf.call("annotations", t.id, page);
  const a = list.find((x) => x.id === id);
  if (!a) throw new Error("That annotation no longer exists.");
  return a;
}

export function addAnnotation(page: number, anno: PdfAnnotationObject, label: string, image?: { data: ArrayBuffer; mimeType: "image/png" | "image/jpeg" }) {
  const ref = new Ref("");
  return exec({
    label,
    touches: [page],
    apply: async (t) => {
      ref.id = await pdf.call("addAnnotation", t.id, page, anno, image ? { data: image.data.slice(0), mimeType: image.mimeType } : undefined);
      set({ selection: { page, annoId: ref.id } });
    },
    invert: async (t) => {
      await pdf.call("removeAnnotation", t.id, page, await findAnno(t, page, ref.id));
      set({ selection: null });
    },
  });
}

export function updateAnnotation(page: number, before: PdfAnnotationObject, after: PdfAnnotationObject, label = "Edit annotation") {
  const ref = new Ref(before.id);
  return exec({
    label,
    touches: [page],
    apply: async (t) => pdf.call("updateAnnotation", t.id, page, { ...after, id: ref.id }),
    invert: async (t) => pdf.call("updateAnnotation", t.id, page, { ...before, id: ref.id }),
  });
}

export function removeAnnotation(page: number, anno: PdfAnnotationObject) {
  const ref = new Ref(anno.id);
  return exec({
    label: "Delete annotation",
    touches: [page],
    apply: async (t) => {
      await pdf.call("removeAnnotation", t.id, page, await findAnno(t, page, ref.id));
      set({ selection: null });
    },
    invert: async (t) => {
      ref.id = await pdf.call("addAnnotation", t.id, page, { ...anno, id: "" });
    },
  });
}

/* ───────── pages ───────── */

export function rotatePages(pages: number[], delta: 90 | -90) {
  const t = activeTab();
  if (!t || !pages.length) return;
  const before = pages.map((p) => t.pages[p]!.rotation);
  const norm = (r: number) => (((r % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  return exec({
    label: "Rotate pages",
    touches: "all",
    apply: async (x) => {
      for (const [i, p] of pages.entries()) await pdf.call("rotatePage", x.id, p, norm(before[i]! + delta));
    },
    invert: async (x) => {
      for (const [i, p] of pages.entries()) await pdf.call("rotatePage", x.id, p, before[i]!);
    },
  });
}

/** Move one page from `from` to final position `to`. */
export function movePage(from: number, to: number) {
  if (from === to) return;
  return exec({
    label: "Move page",
    touches: "all",
    apply: async (x) => pdf.call("movePages", x.id, [from], to),
    invert: async (x) => pdf.call("movePages", x.id, [to], from),
  }).then((ok) => {
    if (ok) set({ pageSelection: [to], currentPage: to });
  });
}

export function duplicatePage(page: number) {
  return exec({
    label: "Duplicate page",
    touches: "all",
    apply: async (x) => pdf.call("duplicatePage", x.id, page),
    invert: async (x) => {
      await pdf.call("deletePage", x.id, page + 1);
    },
  });
}

export function insertBlankPage(at: number) {
  const t = activeTab();
  const ref = t?.pages[Math.min(at, t.pages.length - 1)] ?? { width: 612, height: 792 };
  return exec({
    label: "Insert blank page",
    touches: "all",
    apply: async (x) => pdf.call("insertBlank", x.id, at, ref.width, ref.height),
    invert: async (x) => {
      await pdf.call("deletePage", x.id, at);
    },
  });
}

export async function deletePages(pages: number[]) {
  const t = activeTab();
  if (!t) return;
  if (pages.length >= t.pages.length) return toast("A PDF needs at least one page.", true);
  // delete from the end so indices stay valid; restore in ascending order
  const order = [...pages].sort((a, b) => b - a);
  const keys: string[] = [];
  const ok = await exec({
    label: pages.length > 1 ? "Delete pages" : "Delete page",
    touches: "all",
    apply: async (x) => {
      keys.length = 0;
      for (const p of order) keys.push(await pdf.call("deletePage", x.id, p));
    },
    invert: async (x) => {
      for (let i = order.length - 1; i >= 0; i--) await pdf.call("restorePage", x.id, keys[i]!, order[i]!);
    },
  });
  if (ok) set({ pageSelection: [], selection: null });
}

/** Append pages from another PDF (merge). */
export async function appendPdf(name: string, bytes: Uint8Array) {
  const t = activeTab();
  if (!t) return;
  let srcId = "";
  try {
    const src = await pdf.open(bytes);
    srcId = src.id;
    const n = src.pages.length;
    const at = t.pages.length;
    const ok = await exec({
      label: `Merge ${name}`,
      touches: "all",
      apply: async (x) => {
        const again = await pdf.open(bytes);
        try {
          await pdf.call("importPages", x.id, again.id, [...Array(n).keys()], at);
        } finally {
          await pdf.call("close", again.id);
        }
      },
      invert: async (x) => {
        for (let i = at + n - 1; i >= at; i--) await pdf.call("deletePage", x.id, i);
      },
    });
    if (ok) toast(`Added ${n} page${n === 1 ? "" : "s"} from ${name}.`);
  } catch (e) {
    toast(`Could not merge ${name}: ${(e as Error).message}`, true);
  } finally {
    if (srcId) await pdf.call("close", srcId);
  }
}

export function setMetadata(before: Metadata, after: Metadata) {
  return exec({
    label: "Edit document properties",
    touches: [],
    apply: async (x) => {
      await pdf.call("setMetadata", x.id, after);
      patchTab(x.id, () => ({ meta: after }));
    },
    invert: async (x) => {
      await pdf.call("setMetadata", x.id, before);
      patchTab(x.id, () => ({ meta: before }));
    },
  });
}

/* ───────── search ───────── */

let searchSeq = 0;
export async function runSearch(query: string, caseSensitive = get().search.caseSensitive) {
  const t = activeTab();
  set((s) => ({ search: { ...s.search, query, caseSensitive, busy: true } }));
  if (!t || !query.trim()) return set((s) => ({ search: { ...s.search, hits: [], index: 0, busy: false } }));
  const my = ++searchSeq;
  const hits = await pdf.call("search", t.id, query, { caseSensitive });
  if (my !== searchSeq) return;
  set((s) => ({ search: { ...s.search, hits, index: 0, busy: false } }));
  if (hits[0]) scrollToPage(hits[0].page, hits[0].rects[0]?.[1]);
}

export function stepSearch(d: 1 | -1) {
  const s = get().search;
  if (!s.hits.length) return;
  const index = (s.index + d + s.hits.length) % s.hits.length;
  set({ search: { ...s, index } });
  const h = s.hits[index]!;
  scrollToPage(h.page, h.rects[0]?.[1]);
}

/* ───────── text ───────── */

const textCache = new Map<string, TextRun[]>();
export async function pageText(page: number): Promise<TextRun[]> {
  const t = activeTab();
  if (!t) return [];
  const key = `${t.id}:${page}:${t.rev[page]}`;
  let runs = textCache.get(key);
  if (!runs) {
    runs = await pdf.call("text", t.id, page);
    textCache.set(key, runs);
  }
  return runs;
}

/* ───────── saving ───────── */

export async function currentBytes(): Promise<Uint8Array | null> {
  const t = activeTab();
  if (!t) return null;
  return serial(() => pdf.call("save", t.id));
}

export function markSaved(id: string) {
  patchTab(id, () => ({ dirty: false, savedAt: Date.now() }));
}

/* ───────── crash recovery (local only) ───────── */

const recTimers = new Map<string, number>();
function scheduleRecovery(id: string) {
  clearTimeout(recTimers.get(id));
  recTimers.set(
    id,
    window.setTimeout(async () => {
      const t = get().tabs.find((x) => x.id === id);
      if (!t || !t.dirty) return;
      try {
        const bytes = await serial(() => pdf.call("save", id));
        await recovery.put({ key: t.recoveryKey, name: t.name, bytes, savedAt: Date.now() });
      } catch {
        /* storage full or blocked: recovery is best effort */
      }
    }, 1500),
  );
}
