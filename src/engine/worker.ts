/// <reference lib="webworker" />
// The PDF worker: owns the PDFium instance so parsing, rendering, search and
// saving never block the interface.

import { PdfCore, PdfError } from "./core";

declare const self: DedicatedWorkerGlobalScope;

type Req = { id: number; method: string; args: unknown[] } | { id: number; method: "__init"; wasm: string };

let core: PdfCore | null = null;

self.onmessage = async (ev: MessageEvent<Req>) => {
  const req = ev.data;
  try {
    if (req.method === "__init") {
      const r = await fetch((req as { wasm: string }).wasm);
      if (!r.ok) throw new Error(`Could not load the PDF engine (${r.status}).`);
      core = await PdfCore.create(await r.arrayBuffer());
      self.postMessage({ id: req.id, ok: true, value: null });
      return;
    }
    if (!core) throw new Error("The PDF engine is not ready.");
    const fn = (core as unknown as Record<string, (...a: unknown[]) => unknown>)[req.method];
    if (typeof fn !== "function" || req.method.startsWith("_")) throw new Error(`Unknown operation ${req.method}`);
    const value = await fn.apply(core, (req as { args: unknown[] }).args);
    const transfer: Transferable[] = [];
    if (value instanceof Uint8Array) transfer.push(value.buffer);
    else if (value && typeof value === "object" && "data" in value && (value as { data: unknown }).data instanceof Uint8ClampedArray)
      transfer.push((value as { data: Uint8ClampedArray }).data.buffer);
    self.postMessage({ id: req.id, ok: true, value }, transfer);
  } catch (e) {
    const err = e instanceof PdfError ? { code: e.code, message: e.message } : { code: "failed", message: (e as Error)?.message ?? String(e) };
    self.postMessage({ id: req.id, ok: false, error: err });
  }
};
