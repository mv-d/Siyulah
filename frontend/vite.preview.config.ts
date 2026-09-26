// Single-file build of the app for the static, fixture-backed preview.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  define: { "import.meta.env.VITE_PREVIEW": JSON.stringify("1") },
  build: {
    outDir: "dist-preview",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { input: "preview.html" },
  },
});
