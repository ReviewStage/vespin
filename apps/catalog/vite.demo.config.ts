import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** vite.demo.config.ts -- THROWAWAY: builds the computer preview demo to one folder whose assets are all inlined. */
export default defineConfig({
  root: "demo",
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "/tmp/cpo-demo-build",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
  },
});
