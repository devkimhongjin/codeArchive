import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDefines, resolveBuildInfo } from "../../shared/build-info.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, "dist");
const buildInfo = resolveBuildInfo({ cwd: resolve(root, "../..") });

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    background: resolve(root, "src/background.ts"),
    content: resolve(root, "src/content.ts"),
    mainWorld: resolve(root, "src/mainWorld.ts"),
    popup: resolve(root, "src/popup.ts"),
    archive: resolve(root, "src/archive.ts")
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  define: buildDefines(buildInfo),
  outdir: dist,
  sourcemap: true,
  logLevel: "info"
});

const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
manifest.version = buildInfo.version;
await writeFile(resolve(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(resolve(root, "src/popup.html"), resolve(dist, "popup.html"));
await cp(resolve(root, "src/popup.css"), resolve(dist, "popup.css"));
await cp(resolve(root, "src/popup-layout.css"), resolve(dist, "popup-layout.css"));
await cp(resolve(root, "src/archive.html"), resolve(dist, "archive.html"));
await cp(resolve(root, "src/archive.css"), resolve(dist, "archive.css"));
await cp(resolve(root, "src/archive-viewer.css"), resolve(dist, "archive-viewer.css"));
