import { useEffect } from "react";
import { TopBar } from "./TopBar";
import { Toolbar } from "./Toolbar";
import { Sidebar } from "./Sidebar";
import { Viewer } from "./Viewer";
import { Properties } from "./Properties";
import { StatusBar } from "./StatusBar";
import { Dialogs } from "./Dialogs";
import { useApp } from "../app/store";
import { installKeys } from "../app/keys";
import { openFiles } from "../app/files";

export function App() {
  const sidebar = useApp((s) => s.sidebar);
  const toasts = useApp((s) => s.toasts);

  useEffect(() => installKeys(), []);

  // PDFs dropped anywhere open as new tabs
  useEffect(() => {
    const over = (e: DragEvent) => e.dataTransfer?.types.includes("Files") && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length || (e.target as HTMLElement).closest(".start")) return;
      e.preventDefault();
      openFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  // warn before leaving with unsaved edits (they are also kept for recovery)
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (useApp.getState().tabs.some((t) => t.dirty)) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);

  return (
    <>
      <TopBar />
      <Toolbar />
      <main id="mid" className={sidebar ? undefined : "noleft"}>
        <Sidebar />
        <Viewer />
        <Properties />
      </main>
      <StatusBar />
      <Dialogs />
      <div id="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.bad ? " bad" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
