import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // Two pages: the app, and pop-out panel windows (ADR 0004).
  build: { target: "es2022", sourcemap: true, rollupOptions: { input: { main: resolve(__dirname, "index.html"), panel: resolve(__dirname, "panel.html") } } },
});
