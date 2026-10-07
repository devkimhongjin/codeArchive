import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-expect-error Build helper is executed directly by Node, not compiled by tsc.
import { publishBuildOutput, publishConfiguredBuild } from "../build-output.mjs";

const manifest = { manifest_version: 3, name: "CodeArchive", key: "public-key", version: "0.2.1" };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codearchive-build-output-"));
  const extensionRoot = join(root, "extension"), dist = join(extensionRoot, "dist"), installed = join(root, "installed"), backups = join(root, "backups");
  await mkdir(dist, { recursive: true }); await mkdir(installed, { recursive: true });
  await writeFile(join(dist, "manifest.json"), JSON.stringify(manifest)); await writeFile(join(dist, "content.js"), "new bytes");
  await writeFile(join(installed, "manifest.json"), JSON.stringify(manifest)); await writeFile(join(installed, "content.js"), "old bytes"); await writeFile(join(installed, "unrelated.txt"), "keep me");
  return { root, extensionRoot, dist, installed, backups };
}

test("publication replaces generated files, preserves unrelated files, and backs up prior bytes", async () => {
  const paths = await fixture();
  try {
    const result = await publishBuildOutput({ extensionRoot: paths.extensionRoot, dist: paths.dist, installedExtensionDir: paths.installed, backupRoot: paths.backups });
    assert.equal(result.published, true); assert.equal(await readFile(join(paths.installed, "content.js"), "utf8"), "new bytes");
    assert.equal(await readFile(join(paths.installed, "unrelated.txt"), "utf8"), "keep me");
    assert.ok(result.backup); assert.equal(await readFile(join(result.backup!, "content.js"), "utf8"), "old bytes");
  } finally { await rm(paths.root, { recursive: true, force: true }); }
});

test("wrong manifests and source overlap are rejected before overwriting", async () => {
  const paths = await fixture();
  try {
    await writeFile(join(paths.installed, "manifest.json"), JSON.stringify({ ...manifest, key: "wrong" }));
    await assert.rejects(() => publishBuildOutput({ extensionRoot: paths.extensionRoot, dist: paths.dist, installedExtensionDir: paths.installed, backupRoot: paths.backups }), /does not match/);
    assert.equal(await readFile(join(paths.installed, "content.js"), "utf8"), "old bytes");
    await assert.rejects(() => publishBuildOutput({ extensionRoot: paths.extensionRoot, dist: paths.dist, installedExtensionDir: paths.dist, backupRoot: paths.backups }), /outside/);
  } finally { await rm(paths.root, { recursive: true, force: true }); }
});

test("no local configuration leaves the standard build output unpublished", async () => {
  const paths = await fixture();
  try { assert.deepEqual(await publishConfiguredBuild({ extensionRoot: paths.extensionRoot, dist: paths.dist, backupRoot: paths.backups }), { published: false }); }
  finally { await rm(paths.root, { recursive: true, force: true }); }
});
