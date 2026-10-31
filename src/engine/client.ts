// Typed proxy to the PDF worker: pdf.call("render", id, page, scale) mirrors PdfCore.

import type { PdfCore } from "./core";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";

type Methods = {
  [K in keyof PdfCore as PdfCore[K] extends (...a: never[]) => unknown ? K : never]: PdfCore[K];
};
type Fn<K extends keyof Methods> = Methods[K] extends (...a: infer A) => infer R ? { args: A; ret: Awaited<R> } : never;

export class EngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class PdfClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly ready: Promise<void>;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "cocoapdf-engine" });
    this.worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: { code: string; message: string } }>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.value);
      else p.reject(new EngineError(ev.data.error!.code, ev.data.error!.message));
    };
    this.worker.onerror = (ev) => {
      for (const p of this.pending.values()) p.reject(new EngineError("crashed", ev.message || "The PDF engine stopped unexpectedly."));
      this.pending.clear();
    };
    this.ready = this.post({ method: "__init", wasm: new URL(wasmUrl, location.href).href }, []).then(() => undefined);
  }

  private post(msg: object, transfer: Transferable[]): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  async call<K extends keyof Methods>(method: K, ...args: Fn<K>["args"]): Promise<Fn<K>["ret"]> {
    await this.ready;
    return this.post({ method, args }, []) as Promise<Fn<K>["ret"]>;
  }

  /** Open bytes; the copy sent to the worker is transferred, the caller keeps its own. */
  async open(bytes: Uint8Array, password = "") {
    await this.ready;
    const copy = bytes.slice();
    return this.post({ method: "open", args: [copy, password] }, [copy.buffer]) as Promise<Fn<"open">["ret"]>;
  }
}

export const pdf = new PdfClient();
