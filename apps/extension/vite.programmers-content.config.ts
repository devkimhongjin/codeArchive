import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/content/programmersContent.ts"),
      formats: ["iife"],
      name: "CodeArchiveProgrammersContent",
      fileName: () => "content/programmers.js",
    },
  },
});
