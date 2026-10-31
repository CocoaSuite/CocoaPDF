// Opening and writing files. Documents never leave the device.
//
// Saving prefers, in order: a host bridge (window.cocoaHost — provided by the
// desktop shell, e.g. Tauri), the browser's save dialog (File System Access),
// then a plain download.

import { activeTab, appendPdf, currentBytes, markSaved, openBytes, toast, useApp } from "./store";
import { pdf } from "../engine/client";
import { zipStore } from "./zip";

interface HostBridge {
  save(name: string, bytes: Uint8Array): Promise<boolean>;
}
const host = () => (globalThis as { cocoaHost?: HostBridge }).cocoaHost;

const MAX_BYTES = 512 * 1024 * 1024;

export function isPdf(f: File) {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

export async function openFiles(files: FileList | File[]) {
  for (const f of Array.from(files)) {
    if (!isPdf(f)) {
      toast(`${f.name} is not a PDF.`, true);
      continue;
    }
    if (f.size > MAX_BYTES) {
      toast(`${f.name} is larger than 512 MB and was not opened.`, true);
      continue;
    }
    await openBytes(f.name, new Uint8Array(await f.arrayBuffer()));
  }
}

function pick(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export async function openDialog() {
  await openFiles(await pick(true));
}

export async function mergeDialog() {
  if (!activeTab()) return toast("Open a PDF first, then add others to it.", true);
  for (const f of await pick(true)) if (isPdf(f)) await appendPdf(f.name, new Uint8Array(await f.arrayBuffer()));
}

type SavePicker = (o: object) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;

export async function saveBytes(name: string, bytes: Uint8Array, mime = "application/pdf"): Promise<boolean> {
  const h = host();
  if (h) return h.save(name, bytes);
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const picker = (globalThis as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const ext = name.slice(name.lastIndexOf("."));
      const handle = await picker({ suggestedName: name, types: [{ description: ext === ".zip" ? "ZIP archive" : "PDF document", accept: { [mime]: [ext] } }] });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

const stem = (n: string) => n.replace(/\.pdf$/i, "");

/** Save the edited document as a new file; the original is left untouched. */
export async function saveAs() {
  const t = activeTab();
  if (!t) return;
  useApp.setState({ busy: "Saving…" });
  try {
    const bytes = await currentBytes();
    if (!bytes) return;
    const name = t.dirty ? `${stem(t.name)} (edited).pdf` : t.name;
    if (await saveBytes(name, bytes)) {
      markSaved(t.id);
      toast(`Saved ${name}.`);
    }
  } catch (e) {
    toast(`Saving failed: ${(e as Error).message}`, true);
  } finally {
    useApp.setState({ busy: null });
  }
}

export async function extractPages(pages: number[]) {
  const t = activeTab();
  if (!t || !pages.length) return toast("Select pages in the sidebar first.", true);
  const sorted = [...pages].sort((a, b) => a - b);
  const bytes = await pdf.call("extract", t.id, sorted);
  const label = sorted.length === 1 ? `page ${sorted[0]! + 1}` : `pages ${sorted.map((p) => p + 1).join(", ")}`;
  if (await saveBytes(`${stem(t.name)} — ${label}.pdf`, bytes)) toast(`Extracted ${label}.`);
}

/** Split into files of `every` pages (1 = single pages), or by explicit ranges like "1-3, 4, 5-9". */
export async function split(spec: { every: number } | { ranges: string }) {
  const t = activeTab();
  if (!t) return;
  const n = t.pages.length;
  let groups: number[][] = [];
  if ("every" in spec) {
    for (let i = 0; i < n; i += spec.every) groups.push([...Array(Math.min(spec.every, n - i)).keys()].map((k) => i + k));
  } else {
    groups = parseRanges(spec.ranges, n);
    if (!groups.length) return toast("Enter page ranges such as 1-3, 4, 5-9.", true);
  }
  useApp.setState({ busy: `Splitting into ${groups.length} files…` });
  try {
    const files: { name: string; data: Uint8Array }[] = [];
    for (const g of groups) {
      const label = g.length === 1 ? `p${g[0]! + 1}` : `p${g[0]! + 1}-${g[g.length - 1]! + 1}`;
      files.push({ name: `${stem(t.name)} ${label}.pdf`, data: await pdf.call("extract", t.id, g) });
    }
    if (await saveBytes(`${stem(t.name)} (split).zip`, new Uint8Array(await zipStore(files).arrayBuffer()), "application/zip"))
      toast(`Split into ${files.length} PDFs (one ZIP).`);
  } finally {
    useApp.setState({ busy: null });
  }
}

export function parseRanges(src: string, n: number): number[][] {
  const out: number[][] = [];
  for (const part of src.split(/[,;]+/)) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(part);
    if (!m) {
      if (part.trim()) return [];
      continue;
    }
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > n || a > b) return [];
    out.push([...Array(b - a + 1).keys()].map((k) => a - 1 + k));
  }
  return out;
}

/** Print through the browser: pages are rendered at print resolution into a print-only layer. */
export async function printDocument() {
  const t = activeTab();
  if (!t) return;
  if (t.pages.length > 300) toast("Preparing a large document for printing may take a while.");
  useApp.setState({ busy: "Preparing pages for printing…" });
  const layer = document.createElement("div");
  layer.id = "print-layer";
  try {
    for (let i = 0; i < t.pages.length; i++) {
      const bmp = await pdf.call("render", t.id, i, 2);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(bmp.data), bmp.width, bmp.height), 0, 0);
      const img = document.createElement("img");
      img.src = c.toDataURL("image/png");
      layer.appendChild(img);
    }
    document.body.appendChild(layer);
    useApp.setState({ busy: null });
    window.print();
  } finally {
    layer.remove();
    useApp.setState({ busy: null });
  }
}
