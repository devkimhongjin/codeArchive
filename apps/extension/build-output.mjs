import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const CONFIG_NAME = "build.local.json";

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !path.includes(":"));
}

async function readJson(path, message) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { throw new Error(message); }
}

async function filesIn(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(join(directory, entry.name), name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

function validateManifest(source, installed) {
  if (source?.name !== installed?.name || typeof source?.key !== "string" || source.key !== installed?.key) {
    throw new Error("Installed extension manifest does not match this CodeArchive extension.");
  }
}

export async function publishBuildOutput({ extensionRoot, dist, installedExtensionDir, backupRoot }) {
  const source = resolve(dist), target = resolve(installedExtensionDir), root = resolve(extensionRoot);
  if (isInside(root, target) || isInside(target, root) || source === target || isInside(source, target) || isInside(target, source)) {
    throw new Error("Installed extension directory must be an existing folder outside the extension source and dist directories.");
  }
  let targetStat;
  try { targetStat = await stat(target); } catch { throw new Error("Configured installedExtensionDir does not exist."); }
  if (!targetStat.isDirectory()) throw new Error("Configured installedExtensionDir must be a directory.");
  const [sourceManifest, installedManifest] = await Promise.all([
    readJson(join(source, "manifest.json"), "Built extension manifest is missing or invalid."),
    readJson(join(target, "manifest.json"), "Installed extension manifest is missing or invalid.")
  ]);
  validateManifest(sourceManifest, installedManifest);
  const files = await filesIn(source);
  const backup = join(resolve(backupRoot), `extension-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  let createdBackup = false;
  for (const file of files) {
    try {
      const existing = await stat(join(target, file));
      if (!existing.isFile()) continue;
      if (!createdBackup) { await mkdir(backup, { recursive: true }); createdBackup = true; }
      await mkdir(dirname(join(backup, file)), { recursive: true });
      await cp(join(target, file), join(backup, file), { force: false });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  for (const file of files) {
    await mkdir(dirname(join(target, file)), { recursive: true });
    await cp(join(source, file), join(target, file), { force: true });
  }
  return { published: true, backup: createdBackup ? backup : null, files: files.length };
}

export async function publishConfiguredBuild({ extensionRoot, dist, backupRoot }) {
  const configPath = join(extensionRoot, CONFIG_NAME);
  let configText;
  try { configText = await readFile(configPath, "utf8"); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { published: false };
    throw new Error("Could not read build.local.json.");
  }
  let config;
  try { config = JSON.parse(configText); } catch { throw new Error("build.local.json must contain valid JSON with installedExtensionDir."); }
  if (!config || typeof config !== "object" || typeof config.installedExtensionDir !== "string" || !config.installedExtensionDir.trim()) {
    throw new Error("build.local.json must contain a non-empty installedExtensionDir string.");
  }
  return publishBuildOutput({ extensionRoot, dist, installedExtensionDir: config.installedExtensionDir, backupRoot });
}
