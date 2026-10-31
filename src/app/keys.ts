import { activeTab, deletePages, redo, removeAnnotation, scrollToPage, toast, undo, useApp, type Tool } from "./store";
import { openDialog, printDocument, saveAs } from "./files";
import { setFit, setZoom, zoomBy } from "../ui/zoom";
import { requestClose } from "../ui/TopBar";

const TOOL_KEYS: Record<string, Tool> = { v: "select", h: "hand", t: "text", n: "note", p: "pen", r: "rect", o: "ellipse", l: "line", a: "arrow", x: "textbox", i: "image" };
const SHIFT_TOOL_KEYS: Record<string, Tool> = { h: "highlight", u: "underline", s: "strikeout" };

export function installKeys() {
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    const typing = !!el.closest("input, textarea, select, [contenteditable]");
    const s = useApp.getState();
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (mod && !e.altKey) {
      const act: Record<string, () => unknown> = {
        o: openDialog,
        s: saveAs,
        p: printDocument,
        w: () => s.active && requestClose(s.active),
        f: () => s.active && useApp.setState({ search: { ...s.search, open: true } }),
        d: () => s.active && useApp.setState({ dialog: "properties" }),
        "=": () => zoomBy(1.2),
        "+": () => zoomBy(1.2),
        "-": () => zoomBy(1 / 1.2),
        "0": () => setZoom(1),
        "1": () => setFit("width"),
        "2": () => setFit("page"),
      };
      if (k === "z" && !typing) return void (e.preventDefault(), e.shiftKey ? redo() : undo());
      if (k === "y" && !typing) return void (e.preventDefault(), redo());
      if (k === "c" && !typing && s.textSel) {
        e.preventDefault();
        navigator.clipboard.writeText(s.textSel.text).then(() => toast("Copied."), () => toast("Copy was blocked by the browser.", true));
        return;
      }
      if (act[k] && !(typing && "c,=,+,-,0,1,2".includes(k))) {
        e.preventDefault();
        act[k]!();
      }
      return;
    }
    if (typing || s.dialog) return;
    const t = activeTab();

    if (e.key === "Escape") {
      if (s.search.open) return useApp.setState({ search: { ...s.search, open: false, hits: [] } });
      return useApp.setState({ selection: null, textSel: null, tool: "select", pageSelection: [] });
    }
    if (e.key === "F4") return void (e.preventDefault(), useApp.setState({ sidebar: s.sidebar ? null : "pages" }));
    if (e.key === "?") return useApp.setState({ dialog: "shortcuts" });
    if (!t) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      if (s.selection) {
        const a = t.annos[s.selection.page]?.find((x) => x.id === s.selection!.annoId);
        if (a) removeAnnotation(s.selection.page, a);
      } else if (s.pageSelection.length && s.sidebar === "pages" && document.activeElement?.closest("#side")) deletePages(s.pageSelection);
      return;
    }
    const last = t.pages.length - 1;
    if (e.key === "PageDown" || (s.layout === "single" && e.key === "ArrowRight")) return void (e.preventDefault(), scrollToPage(Math.min(last, s.currentPage + 1)));
    if (e.key === "PageUp" || (s.layout === "single" && e.key === "ArrowLeft")) return void (e.preventDefault(), scrollToPage(Math.max(0, s.currentPage - 1)));
    if (e.key === "Home") return void (e.preventDefault(), scrollToPage(0));
    if (e.key === "End") return void (e.preventDefault(), scrollToPage(last));
    if (e.altKey) return;
    const tool = e.shiftKey ? SHIFT_TOOL_KEYS[k] : TOOL_KEYS[k];
    if (tool) useApp.setState({ tool, selection: null, textSel: null });
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
