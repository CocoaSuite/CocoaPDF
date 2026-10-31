import { useEffect, useRef, useState } from "react";
import { pdf } from "../engine/client";
import { PdfAnnotationSubtype, type Outline } from "../engine/core";
import {
  deletePages,
  duplicatePage,
  insertBlankPage,
  loadAnnotations,
  movePage,
  rotatePages,
  scrollToPage,
  useApp,
  type Tab,
} from "../app/store";
import { extractPages } from "../app/files";

const THUMB_W = 104;

export function Sidebar() {
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.active));
  const side = useApp((s) => s.sidebar);
  if (!side) return null;
  const notes = tab ? Object.values(tab.annos).reduce((k, l) => k + l.length, 0) : 0;
  return (
    <aside id="side" aria-label="Sidebar">
      <div className="seg" role="tablist" style={{ padding: "8px 8px 4px" }}>
        {(["pages", "outline", "notes"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={side === k} className={side === k ? "on" : undefined} onClick={() => useApp.setState({ sidebar: k })}>
            {k === "pages" ? "Pages" : k === "outline" ? "Outline" : `Notes${notes ? ` ${notes}` : ""}`}
          </button>
        ))}
      </div>
      {!tab ? <div className="empty">Open a PDF to see its pages.</div> : side === "pages" ? <Thumbs tab={tab} /> : side === "outline" ? <OutlineList items={tab.outline} /> : <Notes tab={tab} />}
    </aside>
  );
}

function Thumbs({ tab }: { tab: Tab }) {
  const sel = useApp((s) => s.pageSelection);
  const current = useApp((s) => s.currentPage);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ i: number; after: boolean } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const anchor = useRef<number>(0);

  // keep the current page's thumbnail in view
  useEffect(() => {
    list.current?.querySelector(`[data-i="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const click = (i: number, e: React.MouseEvent) => {
    let next: number[];
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      next = [...Array(b - a + 1).keys()].map((k) => a + k);
    } else if (e.ctrlKey || e.metaKey) {
      next = sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i];
      anchor.current = i;
    } else {
      next = [i];
      anchor.current = i;
      scrollToPage(i);
    }
    useApp.setState({ pageSelection: next.sort((a, b) => a - b) });
  };
  const target = sel.length ? sel : [current];

  return (
    <>
      <div className="ph">
        <span>
          {tab.pages.length} page{tab.pages.length === 1 ? "" : "s"}
        </span>
        <span>{sel.length > 1 ? `${sel.length} selected` : ""}</span>
      </div>
      <div className="scroll" ref={list} role="listbox" aria-label="Pages" aria-multiselectable="true">
        <div className="thumbs">
          {tab.pages.map((p, i) => {
            const k = THUMB_W / Math.max(p.width, p.height * 0.77);
            const cls = ["th", sel.includes(i) ? "on" : "", i === current ? "cur" : "", drop?.i === i ? (drop.after ? "drop-after" : "drop-before") : ""].filter(Boolean).join(" ");
            return (
              <button
                key={i}
                data-i={i}
                className={cls}
                role="option"
                aria-selected={sel.includes(i)}
                aria-label={`Page ${i + 1}`}
                draggable
                onClick={(e) => click(i, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!sel.includes(i)) useApp.setState({ pageSelection: [i] });
                  setMenu({ x: e.clientX, y: e.clientY });
                }}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragFrom(i);
                }}
                onDragOver={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setDrop({ i, after: e.clientY > r.top + r.height / 2 });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null && drop) {
                    let to = drop.after ? drop.i + 1 : drop.i;
                    if (dragFrom < to) to--;
                    movePage(dragFrom, to);
                  }
                  setDragFrom(null);
                  setDrop(null);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDrop(null);
                }}
              >
                <Thumb tab={tab} index={i} w={Math.round(p.width * k)} h={Math.round(p.height * k)} />
                <span>{i + 1}</span>
              </button>
            );
          })}
        </div>
      </div>
      {menu ? (
        <div className="modal" style={{ background: "transparent", display: "block", padding: 0 }} onPointerDown={() => setMenu(null)}>
          <div className="ctx" style={{ left: menu.x, top: Math.min(menu.y, window.innerHeight - 300) }} onPointerDown={(e) => e.stopPropagation()}>
            <div className="dd" role="menu">
              {(
                [
                  ["Rotate left", () => rotatePages(target, -90)],
                  ["Rotate right", () => rotatePages(target, 90)],
                  ["Duplicate", () => duplicatePage(target[0]!)],
                  ["Insert blank page after", () => insertBlankPage(target[target.length - 1]! + 1)],
                  ["-"],
                  [target.length > 1 ? `Extract ${target.length} pages…` : "Extract page…", () => extractPages(target)],
                  ["-"],
                  [target.length > 1 ? `Delete ${target.length} pages` : "Delete page", () => deletePages(target), true],
                ] as [string, (() => void)?, boolean?][]
              ).map(([label, run, danger], i) =>
                label === "-" ? (
                  <hr key={i} />
                ) : (
                  <button
                    key={i}
                    role="menuitem"
                    className={danger ? "danger" : undefined}
                    onClick={() => {
                      setMenu(null);
                      run!();
                    }}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Thumb({ tab, index, w, h }: { tab: Tab; index: number; w: number; h: number }) {
  const c = useRef<HTMLCanvasElement>(null);
  const rev = tab.rev[index] ?? 0;
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = c.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && setSeen(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen) return;
    let off = false;
    pdf.call("render", tab.id, index, (w / tab.pages[index]!.width) * Math.min(2, window.devicePixelRatio || 1)).then(
      (b) => {
        if (off || !c.current) return;
        c.current.width = b.width;
        c.current.height = b.height;
        c.current.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(b.data), b.width, b.height), 0, 0);
      },
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, [seen, rev, tab.id, index, w, tab.pages]);
  return <canvas ref={c} style={{ width: w, height: h }} />;
}

function OutlineList({ items }: { items: Outline[] }) {
  if (!items.length) return <div className="empty">This PDF has no outline (bookmarks).</div>;
  const row = (o: Outline, depth: number, key: string): React.ReactNode => (
    <div key={key}>
      <button className="ol" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => o.page !== null && scrollToPage(o.page)} disabled={o.page === null}>
        <span>{o.title}</span>
        {o.page !== null ? <span className="pg">{o.page + 1}</span> : null}
      </button>
      {o.children.map((c, i) => row(c, depth + 1, `${key}.${i}`))}
    </div>
  );
  return <div className="scroll outline">{items.map((o, i) => row(o, 0, String(i)))}</div>;
}

const KIND: Partial<Record<PdfAnnotationSubtype, string>> = {
  [PdfAnnotationSubtype.HIGHLIGHT]: "Highlight",
  [PdfAnnotationSubtype.UNDERLINE]: "Underline",
  [PdfAnnotationSubtype.STRIKEOUT]: "Strikethrough",
  [PdfAnnotationSubtype.SQUIGGLY]: "Squiggly",
  [PdfAnnotationSubtype.TEXT]: "Note",
  [PdfAnnotationSubtype.FREETEXT]: "Text",
  [PdfAnnotationSubtype.SQUARE]: "Rectangle",
  [PdfAnnotationSubtype.CIRCLE]: "Ellipse",
  [PdfAnnotationSubtype.LINE]: "Line",
  [PdfAnnotationSubtype.INK]: "Drawing",
  [PdfAnnotationSubtype.STAMP]: "Image",
  [PdfAnnotationSubtype.POLYGON]: "Polygon",
  [PdfAnnotationSubtype.POLYLINE]: "Polyline",
};
export const kindName = (t: PdfAnnotationSubtype) => KIND[t] ?? "Annotation";

function Notes({ tab }: { tab: Tab }) {
  const selection = useApp((s) => s.selection);
  // load every page's annotations once (cheap; text is not rendered)
  useEffect(() => {
    tab.pages.forEach((_, i) => loadAnnotations(i));
  }, [tab.id, tab.pages]);
  const rows = Object.entries(tab.annos)
    .flatMap(([p, list]) => list.map((a) => ({ page: Number(p), a })))
    .sort((x, y) => x.page - y.page || x.a.rect.origin.y - y.a.rect.origin.y);
  if (!rows.length) return <div className="empty">No annotations yet. Use the highlight, note or drawing tools in the toolbar.</div>;
  return (
    <div className="scroll" style={{ paddingTop: 4 }}>
      {rows.map(({ page, a }) => {
        const any = a as unknown as { color?: string; strokeColor?: string; custom?: { text?: string } };
        const text = a.contents || any.custom?.text || "";
        return (
          <button
            key={`${page}:${a.id}`}
            className={`nrow${selection?.annoId === a.id ? " on" : ""}`}
            onClick={() => {
              useApp.setState({ selection: { page, annoId: a.id }, tool: "select" });
              scrollToPage(page, a.rect.origin.y);
            }}
          >
            <small>
              <i style={{ background: any.color && any.color !== "transparent" ? any.color : any.strokeColor ?? "#888" }} />
              {kindName(a.type)} · page {page + 1}
              {a.author ? ` · ${a.author}` : ""}
            </small>
            {text ? <p>{text}</p> : null}
          </button>
        );
      })}
    </div>
  );
}
