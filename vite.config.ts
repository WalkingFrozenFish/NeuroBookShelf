import { cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

function pdfjsAssets(): Plugin {
  const wasmSource = resolve("node_modules/pdfjs-dist/wasm");
  const wasmDestination = resolve("public/pdfjs-wasm");
  const fontSource = resolve("node_modules/pdfjs-dist/standard_fonts");
  const fontDestination = resolve("public/pdfjs-standard-fonts");
  const copy = () => {
    rmSync(wasmDestination, { recursive: true, force: true });
    cpSync(wasmSource, wasmDestination, { recursive: true });
    rmSync(fontDestination, { recursive: true, force: true });
    cpSync(fontSource, fontDestination, { recursive: true });
  };
  return {
    name: "pdfjs-assets",
    buildStart: copy,
    configureServer: copy,
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), pdfjsAssets()],
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
