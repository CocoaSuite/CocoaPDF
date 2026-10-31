import { useEffect, useState } from "react";
import { BrandMark, Icon } from "./icons";
import { openBytes, toast, useApp } from "../app/store";
import { openDialog, openFiles } from "../app/files";
import { recovery, type RecoveryEntry } from "../app/recovery";

export function Start() {
  const [items, setItems] = useState<RecoveryEntry[] | null>(null);
  const [drag, setDrag] = useState(false);
  const ready = useApp((s) => s.engineReady);
  useEffect(() => {
    recovery.list().then(setItems, () => setItems([]));
  }, []);
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div
      className={`start${drag ? " drag" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        openFiles(e.dataTransfer.files);
      }}
    >
      <div className="startbox">
        <div className="brand" style={{ gap: 10 }}>
          <span style={{ width: 32, display: "inline-flex" }}>
            <BrandMark />
          </span>
          <h1>CocoaPDF</h1>
        </div>
        <p>Read, annotate, edit and organize PDFs. Files are opened on this device and never uploaded. Your originals are never changed: edits are saved as new files.</p>
        <div className="drop">Drop PDF files here</div>
        <div className="row" style={{ justifyContent: "flex-start" }}>
          <button className="pri" onClick={openDialog} disabled={!ready}>
            Open PDF…
          </button>
          <button
            disabled={!ready}
            onClick={async () => {
              try {
                const r = await fetch(new URL("sample.pdf", location.href));
                await openBytes("Sample agreement.pdf", new Uint8Array(await r.arrayBuffer()));
              } catch {
                toast("The sample document could not be loaded.", true);
              }
            }}
          >
            Try a sample document
          </button>
        </div>
        {items?.length ? (
          <>
            <div className="sec" style={{ marginTop: 8 }}>
              Unsaved work you can recover
            </div>
            {items.map((r) => (
              <div key={r.key} className="rec">
                <Icon name="file" />
                <div>
                  <b>{r.name}</b>
                  <small>Last edited {fmt.format(r.savedAt)}</small>
                </div>
                <button onClick={() => openBytes(r.name, r.bytes, "", r.key)} disabled={!ready}>
                  Recover
                </button>
                <button
                  className="ghost danger"
                  onClick={async () => {
                    await recovery.remove(r.key);
                    setItems((x) => x?.filter((y) => y.key !== r.key) ?? null);
                  }}
                >
                  Discard
                </button>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
