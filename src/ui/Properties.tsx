import { useEffect, useState } from "react";
import { PdfAnnotationSubtype, type PdfAnnotationObject } from "../engine/core";
import {
  addAnnotation,
  duplicatePage,
  deletePages,
  insertBlankPage,
  pageText,
  removeAnnotation,
  rotatePages,
  styleKey,
  toast,
  updateAnnotation,
  useApp,
  type Style,
} from "../app/store";
import * as A from "../app/annots";
import { kindName } from "./Sidebar";
import { Icon } from "./icons";

const COLORS = ["#F2D44A", "#8FD18F", "#8CC0FF", "#F39AB8", "#E5534B", "#4B9CFF", "#1D3F8A", "#111111"];

export function Properties() {
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.active));
  const sel = useApp((s) => s.selection);
  const tool = useApp((s) => s.tool);
  const textSel = useApp((s) => s.textSel);
  const anno = sel && tab ? tab.annos[sel.page]?.find((a) => a.id === sel.annoId) : undefined;
  const key = styleKey(tool);

  let title = "Properties";
  let body: React.ReactNode;
  if (!tab) body = <div className="hint">Open a PDF to see its properties.</div>;
  else if (anno && sel) {
    title = kindName(anno.type);
    body = <AnnoProps anno={anno} page={sel.page} />;
  } else if (textSel) {
    title = "Selected text";
    body = <TextSelProps />;
  } else if (key) {
    title = `New ${toolName(tool)}`;
    body = <DefaultStyle k={key} />;
  } else body = <PageAndDoc />;

  return (
    <aside id="props" aria-label="Properties">
      <div className="ph">
        <span>{title}</span>
      </div>
      <div className="pbody">{body}</div>
    </aside>
  );
}

const toolName = (t: string) => ({ highlight: "highlight", underline: "underline", strikeout: "strikethrough", pen: "drawing", note: "note", rect: "rectangle", ellipse: "ellipse", line: "line", arrow: "arrow", textbox: "text" })[t] ?? t;

/* ───────── controls ───────── */

function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Colour">
      {COLORS.map((c) => (
        <button key={c} role="radio" aria-checked={value.toUpperCase() === c} aria-label={c} className={value.toUpperCase() === c ? "on" : undefined} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
      <input type="color" aria-label="Custom colour" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} style={{ width: 22, height: 22, padding: 0, border: 0, background: "none" }} />
    </div>
  );
}

function Slider({ value, min, max, step, onChange, onCommit, fmt, label }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; onCommit?: (v: number) => void; fmt: (v: number) => string; label: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <div className="fill" style={{ width: `${pct}%` }} />
      <div className="thumb" style={{ left: `calc(${pct}% - 1px)` }} />
      <span className="v">{fmt(value)}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

/* ───────── selected annotation ───────── */

function AnnoProps({ anno, page }: { anno: PdfAnnotationObject; page: number }) {
  const a = anno as unknown as Record<string, unknown> & { color?: string; strokeColor?: string; opacity?: number; strokeWidth?: number; fontSize?: number; fontColor?: string; contents?: string; custom?: { text?: string } };
  const isShape = [PdfAnnotationSubtype.SQUARE, PdfAnnotationSubtype.CIRCLE, PdfAnnotationSubtype.LINE, PdfAnnotationSubtype.INK].includes(anno.type);
  const isText = anno.type === PdfAnnotationSubtype.FREETEXT;
  const isImage = anno.type === PdfAnnotationSubtype.STAMP;
  const colorKey = isText ? "fontColor" : isShape ? "strokeColor" : "color";
  const color = (a[colorKey] as string) || a.color || "#F2D44A";
  const [opacity, setOpacity] = useState(a.opacity ?? 1);
  const [width, setWidth] = useState(a.strokeWidth ?? 2);
  const [size, setSize] = useState(a.fontSize ?? 14);
  const [contents, setContents] = useState(a.contents ?? "");
  useEffect(() => {
    setOpacity(a.opacity ?? 1);
    setWidth(a.strokeWidth ?? 2);
    setSize(a.fontSize ?? 14);
    setContents(a.contents ?? "");
  }, [anno.id, a.opacity, a.strokeWidth, a.fontSize, a.contents]);

  const save = (patch: Record<string, unknown>, label: string) => updateAnnotation(page, anno, { ...anno, ...patch, modified: new Date() } as PdfAnnotationObject, label);

  return (
    <>
      {!isImage ? (
        <div className="fld">
          <span>Colour</span>
          <Swatches value={color} onChange={(c) => save(colorKey === "color" ? { color: c, strokeColor: c } : { [colorKey]: c, ...(anno.type === PdfAnnotationSubtype.INK ? { color: c } : {}) }, "Change colour")} />
        </div>
      ) : null}
      <div className="fld">
        <span>Opacity</span>
        <Slider label="Opacity" value={opacity} min={0.1} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={setOpacity} onCommit={(v) => v !== a.opacity && save({ opacity: v }, "Change opacity")} />
      </div>
      {isShape ? (
        <div className="fld">
          <span>Stroke</span>
          <Slider label="Stroke width" value={width} min={0.5} max={12} step={0.5} fmt={(v) => `${v} pt`} onChange={setWidth} onCommit={(v) => v !== a.strokeWidth && save({ strokeWidth: v }, "Change stroke")} />
        </div>
      ) : null}
      {isText ? (
        <div className="fld">
          <span>Text size</span>
          <Slider label="Text size" value={size} min={6} max={48} step={1} fmt={(v) => `${v} pt`} onChange={setSize} onCommit={(v) => v !== a.fontSize && save({ fontSize: v }, "Change text size")} />
        </div>
      ) : null}
      {!isImage ? (
        <>
          <label className="psec" htmlFor="anno-text">
            {isText ? "Text" : "Comment"}
          </label>
          <textarea
            id="anno-text"
            rows={isText ? 4 : 3}
            value={contents}
            placeholder={isText ? "Text" : "Add a comment"}
            onChange={(e) => setContents(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onBlur={() => contents !== (a.contents ?? "") && save({ contents }, isText ? "Edit text" : "Edit comment")}
          />
        </>
      ) : null}
      {a.custom?.text ? <div className="hint">Marks: “{a.custom.text.slice(0, 160)}”</div> : null}
      <div className="psec">Saved into the PDF as</div>
      <div className="stat">
        <span>Annotation</span>
        <span>/{subtypeName(anno.type)}</span>
      </div>
      <div className="stat">
        <span>Page</span>
        <span>{page + 1}</span>
      </div>
      {anno.author ? (
        <div className="stat">
          <span>Author</span>
          <span>{anno.author}</span>
        </div>
      ) : null}
      <div className="hint">A standard PDF annotation: it stays visible and editable in Acrobat, Preview and browsers.</div>
      <div className="actions" style={{ marginTop: 6 }}>
        <button onClick={() => addAnnotation(page, A.moved({ ...anno, id: "" }, 12, 12), "Duplicate annotation")} disabled={isImage}>
          Duplicate
        </button>
        <button className="danger" onClick={() => removeAnnotation(page, anno)}>
          Delete
        </button>
      </div>
    </>
  );
}

const subtypeName = (t: PdfAnnotationSubtype) =>
  ({ [PdfAnnotationSubtype.HIGHLIGHT]: "Highlight", [PdfAnnotationSubtype.UNDERLINE]: "Underline", [PdfAnnotationSubtype.STRIKEOUT]: "StrikeOut", [PdfAnnotationSubtype.TEXT]: "Text", [PdfAnnotationSubtype.FREETEXT]: "FreeText", [PdfAnnotationSubtype.SQUARE]: "Square", [PdfAnnotationSubtype.CIRCLE]: "Circle", [PdfAnnotationSubtype.LINE]: "Line", [PdfAnnotationSubtype.INK]: "Ink", [PdfAnnotationSubtype.STAMP]: "Stamp" })[t as number] ?? "Annot";

/* ───────── defaults for the active tool ───────── */

function DefaultStyle({ k }: { k: keyof ReturnType<typeof useApp.getState>["styles"] }) {
  const style = useApp((s) => s.styles[k]);
  const setStyle = (p: Partial<Style>) => useApp.setState((s) => ({ styles: { ...s.styles, [k]: { ...s.styles[k], ...p } } }));
  const hint: Record<string, string> = {
    highlight: "Drag across text to highlight it.",
    underline: "Drag across text to underline it.",
    strikeout: "Drag across text to strike it through.",
    shape: "Drag on the page. Hold Shift for squares, circles and 45° lines.",
    pen: "Draw freehand on the page.",
    text: "Click where the text should go, type, then click elsewhere. Ctrl+Enter also finishes.",
    note: "Click where the note should go, then type your comment here.",
  };
  return (
    <>
      <div className="hint">{hint[k]}</div>
      <div className="fld">
        <span>Colour</span>
        <Swatches value={style.color} onChange={(color) => setStyle({ color })} />
      </div>
      {k !== "note" ? (
        <div className="fld">
          <span>Opacity</span>
          <Slider label="Opacity" value={style.opacity} min={0.1} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => setStyle({ opacity })} />
        </div>
      ) : null}
      {k === "shape" || k === "pen" ? (
        <div className="fld">
          <span>Stroke</span>
          <Slider label="Stroke width" value={style.width} min={0.5} max={12} step={0.5} fmt={(v) => `${v} pt`} onChange={(width) => setStyle({ width })} />
        </div>
      ) : null}
      {k === "text" ? (
        <div className="fld">
          <span>Text size</span>
          <Slider label="Text size" value={style.fontSize} min={6} max={48} step={1} fmt={(v) => `${v} pt`} onChange={(fontSize) => setStyle({ fontSize })} />
        </div>
      ) : null}
    </>
  );
}

/* ───────── text selection ───────── */

function TextSelProps() {
  const sel = useApp((s) => s.textSel)!;
  const styles = useApp((s) => s.styles);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sel.text);
      toast("Copied.");
    } catch {
      toast("Copy was blocked by the browser. Use Ctrl+C.", true);
    }
  };
  const mark = async (k: "highlight" | "underline" | "strikeout") => {
    const chars = A.flatten(await pageText(sel.page));
    const rects = selectionRects(chars, sel.text);
    if (!rects.length) return toast("Select the text again with the highlight tool.", true);
    await addAnnotation(sel.page, A.markup(k, sel.page, rects, styles[k], "You", sel.text), k === "highlight" ? "Highlight" : k === "underline" ? "Underline" : "Strikethrough");
    useApp.setState({ textSel: null });
  };
  return (
    <>
      <div className="hint" style={{ maxHeight: 140, overflow: "auto", color: "var(--fg)", whiteSpace: "pre-wrap" }}>
        {sel.text}
      </div>
      <div className="actions">
        <button onClick={copy}>
          <Icon name="copy" /> Copy
        </button>
      </div>
      <div className="actions">
        <button onClick={() => mark("highlight")}>Highlight</button>
        <button onClick={() => mark("underline")}>Underline</button>
        <button onClick={() => mark("strikeout")}>Strike</button>
      </div>
    </>
  );
}

/** Find the selected text again in the page's characters and return its line rects. */
function selectionRects(chars: ReturnType<typeof A.flatten>, text: string): A.Box[] {
  const squash = (s: string) => s.replace(/\s+/g, "");
  const want = squash(text);
  const idx: number[] = [];
  let flat = "";
  chars.forEach((c, i) => {
    if (/\s/.test(c.c)) return;
    flat += c.c;
    idx.push(i);
  });
  const at = flat.indexOf(want);
  if (at < 0) return [];
  return A.selection(chars, idx[at]!, idx[at + want.length - 1]!).rects;
}

/* ───────── page & document ───────── */

function PageAndDoc() {
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.active))!;
  const current = useApp((s) => s.currentPage);
  const pageSel = useApp((s) => s.pageSelection);
  const target = pageSel.length ? pageSel : [current];
  const p = tab.pages[current];
  const mm = (pt: number) => Math.round((pt / 72) * 25.4);
  return (
    <>
      <div className="psec" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
        {target.length > 1 ? `${target.length} pages selected` : `Page ${current + 1}`}
      </div>
      {p && target.length === 1 ? (
        <>
          <div className="stat">
            <span>Size</span>
            <span>
              {Math.round(p.width)} × {Math.round(p.height)} pt ({mm(p.width)} × {mm(p.height)} mm)
            </span>
          </div>
          <div className="stat">
            <span>Rotation</span>
            <span>{p.rotation}°</span>
          </div>
        </>
      ) : null}
      <div className="actions">
        <button aria-label="Rotate left" title="Rotate left" onClick={() => rotatePages(target, -90)}>
          <Icon name="rotl" />
        </button>
        <button aria-label="Rotate right" title="Rotate right" onClick={() => rotatePages(target, 90)}>
          <Icon name="rotr" />
        </button>
        <button aria-label="Duplicate page" title="Duplicate" onClick={() => duplicatePage(target[0]!)} disabled={target.length > 1}>
          <Icon name="copy" />
        </button>
        <button aria-label="Insert blank page after" title="Insert blank page after" onClick={() => insertBlankPage(target[target.length - 1]! + 1)}>
          <Icon name="plus" />
        </button>
        <button aria-label="Delete page" title="Delete" className="danger" onClick={() => deletePages(target)}>
          <Icon name="trash" />
        </button>
      </div>
      <div className="psec">Document</div>
      <div className="stat">
        <span>Pages</span>
        <span>{tab.pages.length}</span>
      </div>
      <div className="stat">
        <span>Title</span>
        <span title={tab.meta.title}>{tab.meta.title || "—"}</span>
      </div>
      <div className="stat">
        <span>Author</span>
        <span title={tab.meta.author}>{tab.meta.author || "—"}</span>
      </div>
      <button onClick={() => useApp.setState({ dialog: "properties" })}>Edit properties…</button>
      {tab.notices.map((n) => (
        <div key={n} className="notice">
          {n}
        </div>
      ))}
      <div className="hint">Edits are applied to a working copy. “Save as” writes a new PDF; the file you opened is never changed.</div>
    </>
  );
}
