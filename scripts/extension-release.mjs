import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = readJson(resolve(root, "release.json"));
const manifest = readJson(resolve(root, "apps/extension/manifest.json"));
const extensionPackage = readJson(resolve(root, "apps/extension/package.json"));
const dashboardPackage = readJson(resolve(root, "apps/dashboard/package.json"));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function fail(message) {
  throw new Error(`Extension release validation failed: ${message}`);
}

function semver(value, field) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) fail(`${field} must be a semantic version`);
  return value;
}

function validate() {
  const version = semver(release.version, "release.version");
  if (manifest.version !== version) fail("manifest version must match release.version");
  if (extensionPackage.version !== version) fail("extension package version must match release.version");
  if (dashboardPackage.version !== version) fail("dashboard package version must match release.version");
  if (manifest.minimum_chrome_version !== release.extension?.minimumChromeVersion) fail("minimum Chrome version must match manifest");
  if (typeof release.extension?.id !== "string" || !/^[a-p]{32}$/.test(release.extension.id)) fail("extension id is invalid");
  const compatibility = release.extension?.compatibility;
  semver(compatibility?.minimumDashboardVersion, "minimumDashboardVersion");
  semver(compatibility?.minimumApiVersion, "minimumApiVersion");
  semver(compatibility?.dashboardMinimumExtensionVersion, "dashboardMinimumExtensionVersion");
  for (const field of ["releaseListUrl", "releaseHistoryUrl"]) {
    const value = release.extension?.[field];
    if (typeof value !== "string" || new URL(value).protocol !== "https:") fail(`${field} must be an HTTPS URL`);
  }
  if (release.extension.releaseListUrl !== "https://api.github.com/repos/devkimhongjin/codeArchive/releases?per_page=20") fail("releaseListUrl must target the pinned public repository");
  if (release.extension.releaseHistoryUrl !== "https://github.com/devkimhongjin/codeArchive/releases") fail("releaseHistoryUrl must target the pinned public repository");
  return version;
}

function gitValue(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function metadata(archivePath, outputPath) {
  const version = validate();
  const archive = readFileSync(archivePath);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  const commit = process.env.CODEARCHIVE_BUILD_SHA || process.env.GITHUB_SHA || gitValue(["rev-parse", "HEAD"]);
  const releasedAt = process.env.CODEARCHIVE_BUILD_DATE || (commit && gitValue(["show", "-s", "--format=%cs", commit]));
  if (!/^[a-fA-F0-9]{40}$/.test(commit)) fail("a full source commit SHA is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releasedAt)) fail("a source commit date is required");
  const payload = {
    schemaVersion: 1,
    version,
    releasedAt,
    commit,
    extensionId: release.extension.id,
    minimumChromeVersion: release.extension.minimumChromeVersion,
    compatibility: release.extension.compatibility,
    artifact: { name: "codearchive-extension.zip", sha256 }
  };
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return sha256;
}

const [command, archiveArg, outputArg] = process.argv.slice(2);
if (command === "verify") {
  validate();
  process.stdout.write(`${release.version}\n`);
} else if (command === "metadata") {
  if (!archiveArg || !outputArg) fail("metadata requires archive and output paths");
  process.stdout.write(`${metadata(resolve(archiveArg), resolve(outputArg))}\n`);
} else {
  fail("expected verify or metadata command");
}
