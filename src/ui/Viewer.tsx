// The central viewer: virtualized pages rendered on demand by the PDF worker,
// with a per-page interaction layer for every tool.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pdf } from "../engine/client";
import type { PageInfo, PdfAnnotationObject } from "../engine/core";
import {
  addAnnotation,
  loadAnnotations,
  pageText,
  scrollToPage,
  toast,
  updateAnnotation,
  useApp,
  type Tab,
  type Tool,
} from "../app/store";
import * as A from "../app/annots";
import { setZoom } from "./zoom";
import { Search } from "./Search";
import { Start } from "./Start";

const GAP = 16;
const PAD = 24;
const AUTHOR = "You";

export function Viewer() {
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.active));
  const zoomState = useApp((s) => s.zoom);
  const fit = useApp((s) => s.fit);
  const layout = useApp((s) => s.layout);
  const tool = useApp((s) => s.tool);
  const current = useApp((s) => s.currentPage);
  const scrollReq = useApp((s) => s.scrollRequest);
  const searchOpen = useApp((s) => s.search.open);
  const scroller = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [visible, setVisible] = useState<Set<number>>(new Set([0]));

  // track viewport size
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab?.id]);

  // fit modes compute the zoom
  const zoom = useMemo(() => {
    if (!tab || !fit) return zoomState;
    const ref = tab.pages[current] ?? tab.pages[0]!;
    const cols = layout === "facing" ? 2 : 1;
    const maxW = Math.max(...tab.pages.map((p) => p.width)) * cols + (cols - 1) * 12;
    const zw = (size.w - PAD * 2 - 12) / maxW;
    if (fit === "width") return Math.max(0.1, zw);
    return Math.max(0.1, Math.min(zw, (size.h - PAD * 2) / ref.height));
  }, [tab, fit, zoomState, size, current, layout]);

  useEffect(() => {
    if (fit && Math.abs(zoom - zoomState) > 0.001) useApp.setState({ zoom });
  }, [zoom, fit, zoomState]);

  const pages = tab?.pages ?? [];
  const shown = layout === "single" ? [current] : pages.map((_, i) => i);

  // visibility (virtualization): which pages are near the viewport
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el || !tab) return;
    const vis = new Set<number>();
    let best = -1;
    let bestD = Infinity;
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    for (const node of el.querySelectorAll<HTMLElement>(".page")) {
      const i = Number(node.dataset.i);
      const y0 = node.offsetTop;
      const y1 = y0 + node.offsetHeight;
      if (y1 > top - 800 && y0 < bottom + 800) vis.add(i);
      const d = Math.abs(y0 - top - el.clientHeight * 0.15);
      if (y0 < bottom && y1 > top && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setVisible((prev) => (prev.size === vis.size && [...vis].every((v) => prev.has(v)) ? prev : vis));
    if (best >= 0 && layout !== "single" && best !== useApp.getState().currentPage) useApp.setState({ currentPage: best });
  }, [tab, layout]);

  useEffect(() => {
    onScroll();
  }, [onScroll, zoom, pages.length, layout]);

  // scroll requests (navigation, search)
  useEffect(() => {
    if (!scrollReq || !scroller.current) return;
    const el = scroller.current;
    requestAnimationFrame(() => {
      const node = el.querySelector<HTMLElement>(`.page[data-i="${scrollReq.page}"]`);
      if (!node) return;
      const y = node.offsetTop + (scrollReq.y !== undefined ? scrollReq.y * zoom - el.clientHeight / 3 : -PAD / 2);
      el.scrollTo({ top: Math.max(0, y), behavior: "auto" });
      onScroll();
    });
  }, [scrollReq, zoom, onScroll]);

  // keep the point under the cursor fixed when zooming with Ctrl/⌘+wheel or a pinch
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    const mx = e.clientX - r.left + el.scrollLeft;
    const my = e.clientY - r.top + el.scrollTop;
    const k = Math.exp(-e.deltaY * 0.0025);
    const z0 = zoom;
    setZoom(z0 * k);
    requestAnimationFrame(() => {
      const z1 = useApp.getState().zoom;
      el.scrollLeft = (mx * z1) / z0 - (e.clientX - r.left);
      el.scrollTop = (my * z1) / z0 - (e.clientY - r.top);
    });
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const block = (e: WheelEvent) => (e.ctrlKey || e.metaKey) && e.preventDefault();
    el.addEventListener("wheel", block, { passive: false });
    return () => el.removeEventListener("wheel", block);
  }, [tab?.id]);

  // hand tool: drag to pan
  const pan = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const [panning, setPanning] = useState(false);

  if (!tab) return <section id="viewer"><Start /></section>;

  return (
    <section id="viewer" aria-label="Document">
      {searchOpen ? <Search /> : null}
      <div
        id="scroller"
        ref={scroller}
        tabIndex={-1}
        className={`${tool === "hand" ? "hand" : ""}${panning ? " dragging" : ""}`}
        onScroll={onScroll}
        onWheel={onWheel}
        onPointerDown={(e) => {
          if (tool !== "hand" && e.button !== 1) return;
          const el = scroller.current!;
          pan.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
          setPanning(true);
          el.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!pan.current) return;
          const el = scroller.current!;
          el.scrollLeft = pan.current.l - (e.clientX - pan.current.x);
          el.scrollTop = pan.current.t - (e.clientY - pan.current.y);
        }}
        onPointerUp={() => {
          pan.current = null;
          setPanning(false);
        }}
      >
        <div className={`pages${layout === "facing" ? " facing" : ""}`} style={{ gap: layout === "facing" ? `${GAP}px 12px` : GAP }}>
          {shown.map((i) => (
            <PageView key={`${tab.id}:${i}`} tab={tab} index={i} info={pages[i]!} zoom={zoom} visible={visible.has(i) || layout === "single"} tool={tool} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────── one page ───────── */

function PageView({ tab, index, info, zoom, visible, tool }: { tab: Tab; index: number; info: PageInfo; zoom: number; visible: boolean; tool: Tool }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const rev = tab.rev[index] ?? 0;
  const [rendered, setRendered] = useState<string | null>(null);
  const w = Math.round(info.width * zoom);
  const h = Math.round(info.height * zoom);

  useEffect(() => {
    if (!visible) return;
    const key = `${zoom.toFixed(3)}:${rev}`;
    if (rendered === key) return;
    let cancelled = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // cap at ~16 MP per page to bound memory
    const scale = Math.min(zoom * dpr, Math.sqrt(16e6 / (info.width * info.height)));
    const timer = setTimeout(async () => {
      try {
        const bmp = await pdf.call("render", tab.id, index, scale);
        if (cancelled || !canvas.current) return;
        const c = canvas.current;
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(bmp.data), bmp.width, bmp.height), 0, 0);
        setRendered(key);
      } catch (e) {
        if (!cancelled) toast(`Page ${index + 1} could not be displayed: ${(e as Error).message}`, true);
      }
    }, rendered ? 60 : 0); // debounce re-renders while zooming
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, zoom, rev, tab.id, index, info.width, info.height, rendered]);

  // release pixels of pages far off screen
  useEffect(() => {
    if (visible || !canvas.current || !rendered) return;
    canvas.current.width = canvas.current.height = 0;
    setRendered(null);
  }, [visible, rendered]);

  useEffect(() => {
    if (visible) loadAnnotations(index);
  }, [visible, index, rev]);

  return (
    <div className={`page ${toolClass(tool)}`} data-i={index} style={{ width: w, height: h }} aria-label={`Page ${index + 1}`}>
      <canvas ref={canvas} className="render" />
      {!rendered ? <div className="loading">Page {index + 1}</div> : null}
      {visible ? <Overlay tab={tab} page={index} zoom={zoom} tool={tool} /> : null}
    </div>
  );
}

const toolClass = (t: Tool) =>
  t === "select" ? "tool-select" : t === "hand" ? "" : t === "text" || t === "highlight" || t === "underline" || t === "strikeout" ? "tool-text" : "tool-draw";

/* ───────── interaction layer ───────── */

type Drag =
  | { kind: "text"; a: number; b: number }
  | { kind: "shape"; from: A.Pt; to: A.Pt }
  | { kind: "ink"; pts: A.Pt[] }
  | { kind: "move"; anno: PdfAnnotationObject; from: A.Pt; to: A.Pt }
  | { kind: "resize"; anno: PdfAnnotationObject; corner: number; to: A.Box };

function Overlay({ tab, page, zoom, tool }: { tab: Tab; page: number; zoom: number; tool: Tool }) {
  const ref = useRef<HTMLDivElement>(null);
  const annos = tab.annos[page] ?? [];
  const selection = useApp((s) => s.selection);
  const styles = useApp((s) => s.styles);
  const search = useApp((s) => s.search);
  const textSel = useApp((s) => s.textSel);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [chars, setChars] = useState<ReturnType<typeof A.flatten> | null>(null);
  const [selRects, setSelRects] = useState<A.Box[]>([]);
  const [typing, setTyping] = useState<A.Pt | null>(null);

  // drop this page's text selection when another page takes it
  useEffect(() => {
    if (textSel?.page !== page) setSelRects([]);
  }, [textSel, page]);

  const pt = (e: React.PointerEvent | React.MouseEvent): A.Pt => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  };
  const textTools = tool === "text" || tool === "highlight" || tool === "underline" || tool === "strikeout";
  const ensureChars = async () => {
    if (chars) return chars;
    const c = A.flatten(await pageText(page));
    setChars(c);
    return c;
  };
  useEffect(() => setChars(null), [tab.rev[page]]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = selection?.page === page ? annos.find((a) => a.id === selection.annoId) : undefined;

  const down = async (e: React.PointerEvent) => {
    if (e.button !== 0 || tool === "hand") return;
    const p = pt(e);
    useApp.setState({ currentPage: page });
    ref.current!.setPointerCapture(e.pointerId);
    if (tool === "select") {
      const hit = A.hitTest(annos, p);
      if (hit) {
        useApp.setState({ selection: { page, annoId: hit.id }, textSel: null });
        setDrag({ kind: "move", anno: hit, from: p, to: p });
      } else useApp.setState({ selection: null });
      return;
    }
    if (textTools) {
      const c = await ensureChars();
      const i = A.nearestChar(c, p);
      if (i < 0) return toast("This page has no selectable text. It may be a scanned image.", true);
      setDrag({ kind: "text", a: i, b: i });
      return;
    }
    if (tool === "note") {
      await addAnnotation(page, A.note(page, p, styles.note, AUTHOR), "Add note");
      useApp.setState({ tool: "select" });
      return;
    }
    if (tool === "textbox") return setTyping(p);
    if (tool === "image") return placeImage(page, p);
    if (tool === "pen") return setDrag({ kind: "ink", pts: [p] });
    setDrag({ kind: "shape", from: p, to: p });
  };

  const move = (e: React.PointerEvent) => {
    const p = pt(e);
    if (!drag) {
      if (tool === "select") setHover(A.hitTest(annos, p)?.id ?? null);
      return;
    }
    if (drag.kind === "text" && chars) {
      const b = A.nearestChar(chars, p);
      setDrag({ ...drag, b });
      setSelRects(A.selection(chars, drag.a, b).rects);
    } else if (drag.kind === "shape") setDrag({ ...drag, to: shiftConstrain(drag.from, p, e.shiftKey, tool) });
    else if (drag.kind === "ink") setDrag({ ...drag, pts: [...drag.pts, p] });
    else if (drag.kind === "move") setDrag({ ...drag, to: p });
    else if (drag.kind === "resize") {
      const [x, y, w, h] = A.boxOf(drag.anno.rect);
      const c = drag.corner; // 0 tl, 1 tr, 2 br, 3 bl
      const ax = c === 0 || c === 3 ? x + w : x;
      const ay = c === 0 || c === 1 ? y + h : y;
      let box = A.norm([ax, ay], p);
      if (drag.anno.type === 13 || e.shiftKey) {
        // keep aspect ratio for images, or with Shift
        const k = Math.max(box[2] / w, box[3] / h);
        box = [c === 0 || c === 3 ? ax - w * k : ax, c === 0 || c === 1 ? ay - h * k : ay, w * k, h * k];
      }
      setDrag({ ...drag, to: box });
    }
  };

  const up = async (e: React.PointerEvent) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === "text" && chars) {
      const sel = A.selection(chars, d.a, d.b);
      if (!sel.text.trim()) return setSelRects([]);
      if (tool === "text") {
        useApp.setState({ textSel: { page, text: sel.text }, selection: null });
        setSelRects(sel.rects);
      } else {
        setSelRects([]);
        const k = tool as "highlight" | "underline" | "strikeout";
        await addAnnotation(page, A.markup(k, page, sel.rects, styles[k], AUTHOR, sel.text), tool === "highlight" ? "Highlight" : tool === "underline" ? "Underline" : "Strikethrough");
      }
    } else if (d.kind === "shape") {
      const p = shiftConstrain(d.from, pt(e), e.shiftKey, tool);
      const box = A.norm(d.from, p);
      if (box[2] < 3 && box[3] < 3) return;
      const s = styles.shape;
      if (tool === "rect" || tool === "ellipse") await addAnnotation(page, A.shape(tool, page, box, s, AUTHOR), tool === "rect" ? "Rectangle" : "Ellipse");
      else if (tool === "line" || tool === "arrow") await addAnnotation(page, A.line(tool, page, d.from, p, s, AUTHOR), tool === "line" ? "Line" : "Arrow");
    } else if (d.kind === "ink" && d.pts.length > 1) {
      await addAnnotation(page, A.ink(page, [simplify(d.pts, 0.6 / zoom)], styles.pen, AUTHOR), "Draw");
    } else if (d.kind === "move") {
      const dx = d.to[0] - d.from[0];
      const dy = d.to[1] - d.from[1];
      if (Math.hypot(dx, dy) * zoom > 2) await updateAnnotation(page, d.anno, A.moved(d.anno, dx, dy), "Move annotation");
    } else if (d.kind === "resize") {
      if (d.to[2] > 2 && d.to[3] > 2) await updateAnnotation(page, d.anno, A.resized(d.anno, d.to), "Resize annotation");
    }
  };

  // live geometry for the drag preview
  const live = drag && (drag.kind === "move" || drag.kind === "resize") ? drag : null;
  const liveBox = (a: PdfAnnotationObject): A.Box => {
    if (live?.kind === "move" && live.anno.id === a.id) return A.boxOf(A.moved(a, live.to[0] - live.from[0], live.to[1] - live.from[1]).rect);
    if (live?.kind === "resize" && live.anno.id === a.id) return live.to;
    return A.boxOf(a.rect);
  };
  const px = (b: A.Box) => ({ left: b[0] * zoom, top: b[1] * zoom, width: b[2] * zoom, height: b[3] * zoom });

  const hits = search.hits.filter((h) => h.page === page);
  const curHit = search.hits[search.index];

  return (
    <div ref={ref} className="ov" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)}>
      {hits.map((h, i) =>
        h.rects.map((r, k) => <div key={`${i}:${k}`} className={`hit${h === curHit ? " cur" : ""}`} style={px(r)} />),
      )}
      {selRects.map((r, i) => (
        <div key={i} className="tsel" style={px(r)} />
      ))}
      {hover && !selected && tool === "select" ? (() => {
        const a = annos.find((x) => x.id === hover);
        return a ? <div className="abox hover" style={px(A.boxOf(a.rect))} /> : null;
      })() : null}
      {selected ? (
        <>
          <div className="abox" style={px(liveBox(selected))} />
          {A.resizable(selected) && tool === "select"
            ? corners(liveBox(selected)).map(([x, y], c) => (
                <div
                  key={c}
                  className="handle"
                  style={{ left: x * zoom, top: y * zoom, cursor: c % 2 ? "nesw-resize" : "nwse-resize" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    ref.current!.setPointerCapture(e.pointerId);
                    setDrag({ kind: "resize", anno: selected, corner: c, to: A.boxOf(selected.rect) });
                  }}
                />
              ))
            : null}
        </>
      ) : null}
      {drag && (drag.kind === "shape" || drag.kind === "ink") ? <Preview drag={drag} tool={tool} zoom={zoom} color={(tool === "pen" ? styles.pen : styles.shape).color} width={(tool === "pen" ? styles.pen : styles.shape).width} /> : null}
      {typing ? (
        <TextEntry
          at={typing}
          zoom={zoom}
          fontSize={styles.text.fontSize}
          color={styles.text.color}
          onDone={async (text) => {
            setTyping(null);
            if (text.trim()) {
              await addAnnotation(page, A.freeText(page, typing, text, styles.text, AUTHOR), "Add text");
              useApp.setState({ tool: "select" });
            }
          }}
        />
      ) : null}
    </div>
  );
}

const corners = ([x, y, w, h]: A.Box): A.Pt[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** Shift: squares/circles, and 45° steps for lines. */
function shiftConstrain(a: A.Pt, b: A.Pt, shift: boolean, tool: Tool): A.Pt {
  if (!shift) return b;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (tool === "line" || tool === "arrow") {
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len];
  }
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return [a[0] + Math.sign(dx || 1) * s, a[1] + Math.sign(dy || 1) * s];
}

/** Drop points closer than `tol` to keep ink compact. */
function simplify(pts: A.Pt[], tol: number): A.Pt[] {
  const out: A.Pt[] = [pts[0]!];
  for (const p of pts.slice(1)) {
    const q = out[out.length - 1]!;
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= tol) out.push(p);
  }
  if (out.length === 1) out.push(pts[pts.length - 1]!);
  return out;
}

function Preview({ drag, tool, zoom, color, width }: { drag: Drag; tool: Tool; zoom: number; color: string; width: number }) {
  const sw = Math.max(1, width * zoom);
  let el: React.ReactNode = null;
  if (drag.kind === "ink") el = <polyline points={drag.pts.map(([x, y]) => `${x * zoom},${y * zoom}`).join(" ")} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />;
  else if (drag.kind === "shape") {
    const [x, y, w, h] = A.norm(drag.from, drag.to);
    if (tool === "rect") el = <rect x={x * zoom} y={y * zoom} width={w * zoom} height={h * zoom} fill="none" stroke={color} strokeWidth={sw} />;
    else if (tool === "ellipse") el = <ellipse cx={(x + w / 2) * zoom} cy={(y + h / 2) * zoom} rx={(w / 2) * zoom} ry={(h / 2) * zoom} fill="none" stroke={color} strokeWidth={sw} />;
    else el = <line x1={drag.from[0] * zoom} y1={drag.from[1] * zoom} x2={drag.to[0] * zoom} y2={drag.to[1] * zoom} stroke={color} strokeWidth={sw} strokeLinecap="round" />;
  }
  return (
    <svg className="preview" style={{ inset: 0, width: "100%", height: "100%" }} aria-hidden="true">
      {el}
    </svg>
  );
}

function TextEntry({ at, zoom, fontSize, color, onDone }: { at: A.Pt; zoom: number; fontSize: number; color: string; onDone: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <textarea
      className="textedit"
      autoFocus
      aria-label="New text"
      value={v}
      placeholder="Type text"
      style={{ left: at[0] * zoom, top: at[1] * zoom, fontSize: fontSize * zoom, color, width: 220 * zoom, height: (fontSize * 1.25 * Math.max(1, v.split("\n").length) + 8) * zoom }}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onDone("");
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onDone(v);
      }}
      onBlur={() => onDone(v)}
    />
  );
}

/** Image tool: pick a PNG/JPEG and place it at the click point, aspect ratio kept. */
async function placeImage(page: number, at: A.Pt) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg";
  const file: File | undefined = await new Promise((resolve) => {
    input.onchange = () => resolve(input.files?.[0]);
    input.click();
  });
  if (!file) return;
  if (!/^image\/(png|jpeg)$/.test(file.type)) return toast("Use a PNG or JPEG image.", true);
  const data = await file.arrayBuffer();
  const bmp = await createImageBitmap(new Blob([data], { type: file.type }));
  const k = Math.min(1, 220 / Math.max(bmp.width, bmp.height));
  const w = bmp.width * k;
  const h = bmp.height * k;
  bmp.close();
  await addAnnotation(page, A.image(page, [at[0], at[1], w, h], AUTHOR), "Insert image", { data, mimeType: file.type as "image/png" | "image/jpeg" });
  useApp.setState({ tool: "select" });
}

export { scrollToPage };
