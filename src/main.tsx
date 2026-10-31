import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { useApp } from "./app/store";
import "./styles.css";

// Automated end-to-end tests read state through this hook (only with ?e2e).
if (location.search.includes("e2e")) (window as unknown as { __pdfapp: unknown }).__pdfapp = { store: useApp };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
