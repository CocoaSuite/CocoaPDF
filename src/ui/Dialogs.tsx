import { useEffect, useState } from "react";
import { closeTab, openBytes, setMetadata, useApp } from "../app/store";
import { saveAs, split, parseRanges } from "../app/files";
import { BrandMark } from "./icons";
import { TOOLS } from "./Toolbar";

function Modal({ label, wide, onClose, children }: { label: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={label} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`box${wide ? " wide" : ""}`} onKeyDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Dialogs() {
  const d = useApp((s) => s.dialog);
  const close = () => useApp.setState({ dialog: null });
  if (!d) return null;
  if (d === "shortcuts") return <Shortcuts onClose={close} />;
  if (d === "about") return <About onClose={close} />;
  if (d === "properties") return <DocProps onClose={close} />;
  if (d === "split") return <Split onClose={close} />;
  if ("password" in d) return <Password {...d.password} onClose={close} />;
  if ("close" in d) return <ConfirmClose id={d.close} onClose={close} />;
  return null;
}

function ConfirmClose({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useApp((s) => s.tabs.find((x) => x.id === id));
  if (!t) return null;
  return (
    <Modal label="Unsaved changes" onClose={onClose}>
      <h2>Save changes to {t.name}?</h2>
      <p className="hint">Your edits are only in this working copy. The original file stays as it was either way.</p>
      <div className="row">
        <button className="danger" onClick={() => (onClose(), closeTab(id))}>
          Close without saving
        </button>
        <button onClick={onClose}>Cancel</button>
        <button
          className="pri"
          autoFocus
          onClick={async () => {
            onClose();
            await saveAs();
            if (!useApp.getState().tabs.find((x) => x.id === id)?.dirty) closeTab(id);
          }}
        >
          Save as…
        </button>
      </div>
    </Modal>
  );
}

function Password({ name, bytes, retry, onClose }: { name: string; bytes: Uint8Array; retry: boolean; onClose: () => void }) {
  const [pw, setPw] = useState("");
  return (
    <Modal label="Password" onClose={onClose}>
      <h2>{name} is protected</h2>
      <p className="hint">{retry ? "That password was not accepted. Try again." : "Enter the document's password to open it. It is used only on this device."}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          openBytes(name, bytes, pw);
        }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <label htmlFor="pdfpw" className="sr">
          Password
        </label>
        <input id="pdfpw" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 5, padding: "4px 6px" }} />
        <div className="row">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="pri" type="submit">
            Open
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DocProps({ onClose }: { onClose: () => void }) {
  const t = useApp((s) => s.tabs.find((x) => x.id === s.active));
  const [m, setM] = useState(t?.meta);
  if (!t || !m) return null;
  const fields = ["title", "author", "subject", "keywords", "creator", "producer"] as const;
  const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");
  const sizes = [...new Set(t.pages.map((p) => `${Math.round(p.width)} × ${Math.round(p.height)} pt`))];
  return (
    <Modal label="Document properties" onClose={onClose} wide>
      <h2>Document properties</h2>
      {fields.map((f) => (
        <div className="fld" key={f}>
          <label htmlFor={`m-${f}`}>{f[0]!.toUpperCase() + f.slice(1)}</label>
          <input id={`m-${f}`} type="text" value={m[f]} onChange={(e) => setM({ ...m, [f]: e.target.value })} />
        </div>
      ))}
      <div className="stat">
        <span>Created</span>
        <span>{fmt(m.creationDate)}</span>
      </div>
      <div className="stat">
        <span>Modified</span>
        <span>{fmt(m.modificationDate)}</span>
      </div>
      <div className="stat">
        <span>Pages</span>
        <span>{t.pages.length}</span>
      </div>
      <div className="stat">
        <span>Page sizes</span>
        <span>{sizes.slice(0, 3).join(", ")}{sizes.length > 3 ? ` +${sizes.length - 3}` : ""}</span>
      </div>
      <div className="row">
        <button onClick={onClose}>Cancel</button>
        <button
          className="pri"
          onClick={() => {
            onClose();
            if (fields.some((f) => m[f] !== t.meta[f])) setMetadata(t.meta, m);
          }}
        >
          Apply
        </button>
      </div>
    </Modal>
  );
}

function Split({ onClose }: { onClose: () => void }) {
  const n = useApp((s) => s.tabs.find((x) => x.id === s.active)?.pages.length ?? 0);
  const [mode, setMode] = useState<"ranges" | "every">("ranges");
  const [ranges, setRanges] = useState(n > 1 ? `1-${Math.ceil(n / 2)}, ${Math.ceil(n / 2) + 1}-${n}` : "1");
  const [every, setEvery] = useState(2);
  const groups = mode === "ranges" ? parseRanges(ranges, n) : null;
  const ok = mode === "every" ? every >= 1 : !!groups?.length;
  return (
    <Modal label="Split document" onClose={onClose}>
      <h2>Split into separate PDFs</h2>
      <div className="seg">
        <button className={mode === "ranges" ? "on" : undefined} onClick={() => setMode("ranges")}>
          By page ranges
        </button>
        <button className={mode === "every" ? "on" : undefined} onClick={() => setMode("every")}>
          Every N pages
        </button>
      </div>
      {mode === "ranges" ? (
        <>
          <label htmlFor="ranges" className="hint">
            Page ranges, one file each (this document has {n} pages)
          </label>
          <input id="ranges" type="text" value={ranges} onChange={(e) => setRanges(e.target.value)} className={ok ? undefined : "bad"} />
          <div className="hint">{ok ? `${groups!.length} file${groups!.length === 1 ? "" : "s"}` : "Use ranges like 1-3, 4, 5-9 within the page count."}</div>
        </>
      ) : (
        <div className="fld">
          <label htmlFor="every">Pages per file</label>
          <input id="every" type="number" min={1} max={n} value={every} onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))} />
        </div>
      )}
      <div className="hint">The files are saved together in one ZIP. The open document is not changed.</div>
      <div className="row">
        <button onClick={onClose}>Cancel</button>
        <button
          className="pri"
          disabled={!ok}
          onClick={() => {
            onClose();
            split(mode === "every" ? { every } : { ranges });
          }}
        >
          Split
        </button>
      </div>
    </Modal>
  );
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["Open", "Ctrl+O"],
    ["Save as", "Ctrl+S"],
    ["Print", "Ctrl+P"],
    ["Find", "Ctrl+F"],
    ["Undo / Redo", "Ctrl+Z / Ctrl+Shift+Z"],
    ["Copy selected text", "Ctrl+C"],
    ["Delete selection", "Delete"],
    ["Zoom in / out", "Ctrl++ / Ctrl+−"],
    ["Actual size / Fit width / Fit page", "Ctrl+0 / 1 / 2"],
    ["Next / previous page", "PgDn / PgUp"],
    ["First / last page", "Home / End"],
    ["Sidebar", "F4"],
    ["Close document", "Ctrl+W"],
  ];
  return (
    <Modal label="Keyboard shortcuts" onClose={onClose} wide>
      <h2>Keyboard shortcuts</h2>
      <table className="kt">
        <tbody>
          <tr>
            <td colSpan={2}>
              <h3>General</h3>
            </td>
          </tr>
          {rows.map(([a, k]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>
                <kbd>{k}</kbd>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={2}>
              <h3>Tools</h3>
            </td>
          </tr>
          {TOOLS.flat().map((t) => (
            <tr key={t.id}>
              <td>{t.label}</td>
              <td>
                <kbd>{t.key}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">Ctrl/⌘ + scroll zooms at the pointer. Middle-drag pans with any tool.</div>
      <div className="row">
        <button className="pri" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function About({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="About CocoaPDF" onClose={onClose}>
      <div className="brand">
        <span style={{ width: 26, display: "inline-flex" }}>
          <BrandMark />
        </span>
        <b>CocoaPDF</b>
      </div>
      <p className="hint">Version 0.1 — part of CocoaSuite. Documents are processed on this device only.</p>
      <p className="hint">PDF engine: PDFium (BSD-3-Clause / Apache-2.0) via EmbedPDF (MIT). Interface: React, Zustand (MIT). See THIRD_PARTY_NOTICES.md.</p>
      <div className="row">
        <button className="pri" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
