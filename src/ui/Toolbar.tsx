import { Icon } from "./icons";
import { useApp, type Tool } from "../app/store";

export const TOOLS: { id: Tool; label: string; key: string }[][] = [
  [
    { id: "select", label: "Select and move", key: "V" },
    { id: "hand", label: "Hand", key: "H" },
    { id: "text", label: "Select text", key: "T" },
  ],
  [
    { id: "highlight", label: "Highlight", key: "Shift+H" },
    { id: "underline", label: "Underline", key: "Shift+U" },
    { id: "strikeout", label: "Strikethrough", key: "Shift+S" },
    { id: "note", label: "Sticky note", key: "N" },
  ],
  [
    { id: "pen", label: "Pen", key: "P" },
    { id: "rect", label: "Rectangle", key: "R" },
    { id: "ellipse", label: "Ellipse", key: "O" },
    { id: "line", label: "Line", key: "L" },
    { id: "arrow", label: "Arrow", key: "A" },
  ],
  [
    { id: "textbox", label: "Add text", key: "X" },
    { id: "image", label: "Insert image (then click the page)", key: "I" },
  ],
];

export function Toolbar() {
  const tool = useApp((s) => s.tool);
  const hasDoc = useApp((s) => !!s.active);
  return (
    <div id="tbar" role="toolbar" aria-label="Tools">
      {TOOLS.map((group, g) => (
        <span key={g} style={{ display: "contents" }}>
          {g ? <span className="vs" /> : null}
          {group.map((t) => (
            <button
              key={t.id}
              className={`ic${tool === t.id ? " on" : ""}`}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              title={`${t.label} (${t.key})`}
              disabled={!hasDoc && t.id !== "select"}
              onClick={() => useApp.setState({ tool: t.id, selection: null, textSel: null })}
            >
              <Icon name={t.id} />
            </button>
          ))}
        </span>
      ))}
    </div>
  );
}
