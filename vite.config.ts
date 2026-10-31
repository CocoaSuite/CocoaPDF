import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static build. PDFium ships as a separate .wasm asset (never inlined).
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    assetsInlineLimit: (file) => (file.endsWith(".wasm") ? false : undefined),
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: { exclude: ["@embedpdf/pdfium"] },
  test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 30000 },
} as Parameters<typeof defineConfig>[0]);
