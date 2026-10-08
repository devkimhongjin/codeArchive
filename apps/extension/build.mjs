import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDefines, resolveBuildInfo } from "../../shared/build-info.mjs";
import { publishConfiguredBuild } from "./build-output.mjs";
import { execFileSync } from 'node:child_process';

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
    archive: resolve(root, "src/archive.ts"),
    history: resolve(root, "src/history.ts")
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
await cp(resolve(root, "src/history.html"), resolve(dist, "history.html"));
await cp(resolve(root, "src/history.css"), resolve(dist, "history.css"));

await cp(resolve(root, "icons"), resolve(dist, "icons"), { recursive: true });

// Build the existing React UI as a bundled extension page. No web deployment.
const dashboardRoot = resolve(root, '../dashboard');
execFileSync(process.execPath, [resolve(dashboardRoot, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'extension', '--outDir', resolve(dashboardRoot, 'dist-extension')], { cwd: dashboardRoot, stdio: 'inherit' });
await cp(resolve(dashboardRoot, 'dist-extension/assets'), resolve(dist, 'assets'), { recursive: true });
await cp(resolve(dashboardRoot, 'dist-extension/index.html'), resolve(dist, 'dashboard.html'));

const published = process.env.CODEARCHIVE_SKIP_INSTALLED_EXTENSION === 'true' ? { published: false } : await publishConfiguredBuild({ extensionRoot: root, dist, backupRoot: resolve(root, "../../output/extension-build-backups") });
if (published.published) console.log(`Updated installed extension (${published.files} files); backup: ${published.backup ?? "none"}`);
