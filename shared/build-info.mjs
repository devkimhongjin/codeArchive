import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const release = JSON.parse(readFileSync(new URL("../release.json", import.meta.url), "utf8"));

function gitValue(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : "";
}

/** Resolve public, non-sensitive build identity for Vite and extension builds. */
export function resolveBuildInfo({ env = process.env, cwd = process.cwd() } = {}) {
  if (typeof release.version !== "string" || !/^\d+\.\d+\.\d+$/.test(release.version)) {
    throw new Error("release.json must contain a semantic version");
  }
  const releaseBuild = env.CODEARCHIVE_RELEASE_BUILD === "true"
    || (env.NETLIFY === "true" && Boolean(env.CONTEXT) && Boolean(env.COMMIT_REF));
  const revision = safeId(env.CODEARCHIVE_BUILD_SHA)
    || safeId(env.COMMIT_REF)
    || safeId(env.GITHUB_SHA)
    || safeId(gitValue(["rev-parse", "HEAD"], cwd));
  const shortRevision = revision ? revision.slice(0, 7) : "source-unknown";
  const explicitDate = typeof env.CODEARCHIVE_BUILD_DATE === "string" && /^\d{4}-\d{2}-\d{2}$/.test(env.CODEARCHIVE_BUILD_DATE)
    ? env.CODEARCHIVE_BUILD_DATE
    : "";
  const commitDate = releaseBuild && revision ? gitValue(["show", "-s", "--format=%cs", revision], cwd) : "";
  const updatedDate = releaseBuild ? (explicitDate || (/^\d{4}-\d{2}-\d{2}$/.test(commitDate) ? commitDate : "unknown")) : "dev";
  const releaseId = shortRevision === "source-unknown"
    ? (safeId(env.DEPLOY_ID) || safeId(env.BUILD_ID) || "release").slice(0, 12)
    : shortRevision;
  return {
    version: release.version,
    buildId: releaseBuild ? releaseId : `dev+${shortRevision}`,
    updatedDate
  };
}

export function buildDefines(info) {
  return {
    __CODEARCHIVE_VERSION__: JSON.stringify(info.version),
    __CODEARCHIVE_BUILD_ID__: JSON.stringify(info.buildId),
    __CODEARCHIVE_UPDATED_DATE__: JSON.stringify(info.updatedDate)
  };
}
