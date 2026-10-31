import { useEffect, useState } from "react";
import { scrollToPage, useApp } from "../app/store";
import { setFit, setZoom, ZOOM_STEPS } from "./zoom";
import { TOOLS } from "./Toolbar";

const HINTS: Record<string, string> = {
  select: "Click an annotation to select it · drag to move · corners resize",
  hand: "Drag to scroll",
  text: "Drag across text to select it · Ctrl+C copies",
  highlight: "Drag across text to highlight · Esc to stop",
  underline: "Drag across text to underline · Esc to stop",
  strikeout: "Drag across text to strike through · Esc to stop",
  note: "Click to place a sticky note",
  pen: "Draw freehand",
  rect: "Drag to draw · Shift for a square",
  ellipse: "Drag to draw · Shift for a circle",
  line: "Drag to draw · Shift for 45° steps",
  arrow: "Drag to draw · Shift for 45° steps",
  textbox: "Click to type new text",
  image: "Click where the image should go",
};

export function StatusBar() {
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.active));
  const current = useApp((s) => s.currentPage);
  const zoom = useApp((s) => s.zoom);
  const fit = useApp((s) => s.fit);
  const layout = useApp((s) => s.layout);
  const tool = useApp((s) => s.tool);
  const [page, setPage] = useState(String(current + 1));
  useEffect(() => setPage(String(current + 1)), [current]);
  const toolLabel = TOOLS.flat().find((t) => t.id === tool)?.label;

  if (!tab) return <footer id="status">Ready</footer>;
  const n = tab.pages.length;
  return (
    <footer id="status">
      <span>
        Page{" "}
        <label htmlFor="pg" className="sr">
          Page number
        </label>
        <input
          id="pg"
          type="text"
          inputMode="numeric"
          value={page}
          onChange={(e) => setPage(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              const v = Math.min(n, Math.max(1, Number(page) || 1));
              scrollToPage(v - 1);
              setPage(String(v));
              e.currentTarget.blur();
            }
          }}
          onBlur={() => setPage(String(current + 1))}
        />{" "}
        / {n}
      </span>
      <span className="sep" />
      <span>
        <b>{toolLabel}</b> · {HINTS[tool]}
      </span>
      <span className="spacer" />
      <label htmlFor="layout" className="sr">
        Page layout
      </label>
      <select id="layout" value={layout} onChange={(e) => useApp.setState({ layout: e.target.value as typeof layout })}>
        <option value="continuous">Continuous</option>
        <option value="single">Single page</option>
        <option value="facing">Facing pages</option>
      </select>
      <label htmlFor="zoom" className="sr">
        Zoom
      </label>
      <select
        id="zoom"
        value={fit ?? String(zoom)}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "width" || v === "page") setFit(v);
          else setZoom(Number(v));
        }}
      >
        <option value="width">Fit width</option>
        <option value="page">Fit page</option>
        {!fit && !ZOOM_STEPS.includes(zoom) ? <option value={String(zoom)}>{Math.round(zoom * 100)}%</option> : null}
        {ZOOM_STEPS.map((z) => (
          <option key={z} value={String(z)}>
            {Math.round(z * 100)}%
          </option>
        ))}
      </select>
      <span className="mono" style={{ color: "var(--fg)", minWidth: 40, textAlign: "right" }}>
        {Math.round(zoom * 100)}%
      </span>
    </footer>
  );
}
