import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { kstCalendarDate, resolveBuildInfo } from "../../../shared/build-info.mjs";
import { isVersionAtLeast } from "../../../shared/extensionRelease";
import { buildLabel, updatedLabel } from "../../../shared/buildMetadata";

const readJson = (url: URL) => JSON.parse(readFileSync(url, "utf8").replace(/^\uFEFF/, ""));

test("release version is shared by packages and the extension manifest", () => {
  const release = readJson(new URL("../../../release.json", import.meta.url));
  const manifest = readJson(new URL("../manifest.json", import.meta.url));
  const extensionPackage = readJson(new URL("../package.json", import.meta.url));
  const dashboardPackage = readJson(new URL("../../dashboard/package.json", import.meta.url));
  assert.equal(manifest.version, release.version);
  assert.equal(extensionPackage.version, release.version);
  assert.equal(dashboardPackage.version, release.version);
  assert.equal(manifest.minimum_chrome_version, release.extension.minimumChromeVersion);
  assert.match(release.extension.id, /^[a-p]{32}$/);
  assert.ok(isVersionAtLeast(release.version, release.extension.compatibility.dashboardMinimumExtensionVersion));
});

test("local metadata is explicitly dev while release metadata uses injected source identity", () => {
  const local = resolveBuildInfo({ env: {}, cwd: fileURLToPath(new URL("../../..", import.meta.url)) });
  assert.equal(local.version, readJson(new URL("../../../release.json", import.meta.url)).version);
  assert.match(local.buildId, /^dev\+/);
  assert.equal(local.updatedDate, "dev");

  const release = resolveBuildInfo({
    env: {
      CODEARCHIVE_RELEASE_BUILD: "true",
      CODEARCHIVE_BUILD_SHA: "abcdef0123456789",
      CODEARCHIVE_BUILD_DATE: "2026-09-18"
    }
  });
  assert.deepEqual(release, { version: readJson(new URL("../../../release.json", import.meta.url)).version, buildId: "abcdef0", updatedDate: "2026-09-18" });
});

test("source fallback labels never render a blank production-looking value", () => {
  assert.equal(buildLabel(), "vdev · dev+source-unknown");
  assert.equal(updatedLabel(), "Updated dev");
});

test("build and release dates use the Korean day at UTC year/month boundaries", () => {
  assert.equal(kstCalendarDate("2025-12-31T15:00:00Z"), "2026-01-01");
  assert.equal(kstCalendarDate("2026-01-31T16:05:06-00:00"), "2026-02-01");
  assert.equal(kstCalendarDate("2026-01-01T00:00:00+09:00"), "2026-01-01");
  assert.equal(kstCalendarDate("invalid"), "");
});
