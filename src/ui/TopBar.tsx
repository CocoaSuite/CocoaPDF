import { useEffect, useRef, useState } from "react";
import { BrandMark, Icon } from "./icons";
import {
  closeTab,
  deletePages,
  duplicatePage,
  insertBlankPage,
  redo,
  rotatePages,
  undo,
  useApp,
  type Tab,
} from "../app/store";
import { extractPages, mergeDialog, openDialog, printDocument, saveAs, split } from "../app/files";
import { zoomBy, setFit } from "./zoom";

type Item = { label: string; key?: string; run: () => void; disabled?: boolean } | "-";

export function TopBar() {
  const tabs = useApp((s) => s.tabs);
  const active = useApp((s) => s.active);
  const busy = useApp((s) => s.busy);
  const engineReady = useApp((s) => s.engineReady);
  const engineError = useApp((s) => s.engineError);
  const pageSel = useApp((s) => s.pageSelection);
  const current = useApp((s) => s.currentPage);
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const t = tabs.find((x) => x.id === active);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const sel = pageSel.length ? pageSel : [current];
  const none = !t;
  const menus: { id: string; label: string; items: Item[] }[] = [
    {
      id: "file",
      label: "File",
      items: [
        { label: "Open…", key: "Ctrl+O", run: openDialog },
        { label: "Add PDFs to this document…", run: mergeDialog, disabled: none },
        "-",
        { label: "Save as…", key: "Ctrl+S", run: saveAs, disabled: none },
        { label: "Print…", key: "Ctrl+P", run: printDocument, disabled: none },
        "-",
        { label: "Document properties…", key: "Ctrl+D", run: () => useApp.setState({ dialog: "properties" }), disabled: none },
        "-",
        { label: "Close document", key: "Ctrl+W", run: () => t && requestClose(t.id), disabled: none },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { label: t?.undo.length ? `Undo ${t.undo[t.undo.length - 1]!.label}` : "Undo", key: "Ctrl+Z", run: undo, disabled: !t?.undo.length },
        { label: t?.redo.length ? `Redo ${t.redo[t.redo.length - 1]!.label}` : "Redo", key: "Ctrl+Shift+Z", run: redo, disabled: !t?.redo.length },
        "-",
        { label: "Find…", key: "Ctrl+F", run: () => useApp.setState((s) => ({ search: { ...s.search, open: true } })), disabled: none },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        { label: "Zoom in", key: "Ctrl++", run: () => zoomBy(1.2), disabled: none },
        { label: "Zoom out", key: "Ctrl+−", run: () => zoomBy(1 / 1.2), disabled: none },
        { label: "Actual size", key: "Ctrl+0", run: () => useApp.setState({ zoom: 1, fit: null }), disabled: none },
        { label: "Fit width", key: "Ctrl+1", run: () => setFit("width"), disabled: none },
        { label: "Fit page", key: "Ctrl+2", run: () => setFit("page"), disabled: none },
        "-",
        { label: "Continuous", run: () => useApp.setState({ layout: "continuous" }), disabled: none },
        { label: "Single page", run: () => useApp.setState({ layout: "single" }), disabled: none },
        { label: "Facing pages", run: () => useApp.setState({ layout: "facing" }), disabled: none },
        "-",
        { label: "Show or hide sidebar", key: "F4", run: () => useApp.setState((s) => ({ sidebar: s.sidebar ? null : "pages" })) },
        { label: "Full screen", key: "F11", run: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined) },
      ],
    },
    {
      id: "pages",
      label: "Pages",
      items: [
        { label: "Rotate left", key: "Ctrl+Shift+L", run: () => rotatePages(sel, -90), disabled: none },
        { label: "Rotate right", key: "Ctrl+Shift+R", run: () => rotatePages(sel, 90), disabled: none },
        { label: "Duplicate page", run: () => duplicatePage(sel[0]!), disabled: none },
        { label: "Insert blank page after", run: () => insertBlankPage(sel[sel.length - 1]! + 1), disabled: none },
        { label: sel.length > 1 ? `Delete ${sel.length} pages` : "Delete page", run: () => deletePages(sel), disabled: none },
        "-",
        { label: sel.length > 1 ? `Extract ${sel.length} pages…` : "Extract page…", run: () => extractPages(sel), disabled: none },
        { label: "Split into single pages…", run: () => split({ every: 1 }), disabled: none },
        { label: "Split by ranges…", run: () => useApp.setState({ dialog: "split" }), disabled: none },
      ],
    },
    {
      id: "help",
      label: "Help",
      items: [
        { label: "Keyboard shortcuts", key: "?", run: () => useApp.setState({ dialog: "shortcuts" }) },
        { label: "About CocoaPDF", run: () => useApp.setState({ dialog: "about" }) },
      ],
    },
  ];

  const status = engineError
    ? { cls: "warn", text: engineError }
    : !engineReady
      ? { cls: "busy", text: "Loading the PDF engine…" }
      : busy
        ? { cls: "busy", text: busy }
        : t?.dirty
          ? { cls: "warn", text: "Unsaved changes · kept on this device · original unchanged" }
          : t
            ? { cls: "", text: t.savedAt ? "Saved" : "Original unchanged" }
            : { cls: "", text: "Files stay on this device" };

  return (
    <header id="top" ref={ref}>
      <div className="brand">
        <BrandMark />
        <b>CocoaPDF</b>
      </div>
      <nav style={{ display: "flex", gap: 2 }}>
        {menus.map((m) => (
          <div key={m.id} className={`mn${open === m.id ? " on" : ""}`}>
            <button className="mt" aria-haspopup="menu" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)} onPointerEnter={() => open && setOpen(m.id)}>
              {m.label}
            </button>
            {open === m.id ? (
              <div className="dd" role="menu">
                {m.items.map((it, i) =>
                  it === "-" ? (
                    <hr key={i} />
                  ) : (
                    <button
                      key={i}
                      role="menuitem"
                      disabled={it.disabled}
                      onClick={() => {
                        setOpen(null);
                        it.run();
                      }}
                    >
                      <span>{it.label}</span>
                      {it.key ? <kbd>{it.key}</kbd> : null}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ))}
      </nav>
      <div className="tabs" role="tablist" aria-label="Open documents">
        {tabs.map((x) => (
          <TabButton key={x.id} t={x} on={x.id === active} />
        ))}
        <button className="ghost" aria-label="Open a PDF" title="Open a PDF (Ctrl+O)" onClick={openDialog} style={{ height: 30, padding: "0 8px", border: 0 }}>
          <Icon name="plus" />
        </button>
      </div>
      <div className="spacer" />
      <div className="pill" role="status" aria-live="polite" title={status.text}>
        <i className={status.cls} />
        {status.text}
      </div>
      <div className="spacer" />
      <button className="ic ghost" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={!t?.undo.length}>
        <Icon name="undo" />
      </button>
      <button className="ic ghost" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!t?.redo.length}>
        <Icon name="redo" />
      </button>
      <button onClick={saveAs} disabled={none} title="Save the edited PDF as a new file (Ctrl+S)">
        Save as…
      </button>
      <button className="pri" onClick={saveAs} disabled={none}>
        Export PDF
      </button>
    </header>
  );
}

/** Closing a document with unsaved edits asks first; nothing is discarded silently. */
export function requestClose(id: string) {
  const t = useApp.getState().tabs.find((x) => x.id === id);
  if (!t) return;
  if (t.dirty) useApp.setState({ active: id, dialog: { close: id } });
  else closeTab(id);
}

function TabButton({ t, on }: { t: Tab; on: boolean }) {
  return (
    <div
      className={`tab${on ? " on" : ""}`}
      role="tab"
      aria-selected={on}
      tabIndex={0}
      title={t.name}
      onClick={() => useApp.setState({ active: t.id, selection: null, pageSelection: [], currentPage: 0 })}
      onKeyDown={(e) => e.key === "Enter" && useApp.setState({ active: t.id })}
    >
      <span>{t.name}</span>
      {t.dirty ? <i className="dot" aria-label="Unsaved changes" /> : null}
      <button
        className="x"
        aria-label={`Close ${t.name}`}
        onClick={(e) => {
          e.stopPropagation();
          requestClose(t.id);
        }}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
