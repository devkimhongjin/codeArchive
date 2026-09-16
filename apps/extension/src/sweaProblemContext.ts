import {
  SWEA_CONTEST_PROBLEM_ID_SELECTOR,
  SWEA_ORIGIN,
  SWEA_PROBLEM_DETAIL_PATHS,
  SWEA_SOLVING_PATH
} from "./adapters/sweaSelectors";

export interface SweaProblemContext {
  contestProbId: string;
  problemUrl: string;
  sourcePath: (typeof SWEA_PROBLEM_DETAIL_PATHS)[number];
  observedAt: number;
}

function normalizedUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function isDetailPath(pathname: string): pathname is SweaProblemContext["sourcePath"] {
  return SWEA_PROBLEM_DETAIL_PATHS.some((path) => path === pathname);
}

/** Reads one unambiguous, non-empty problem identity from the current DOM. */
export function readSweaContestProbId(document: Document): string | null {
  const candidates = new Set(document.querySelectorAll(SWEA_CONTEST_PROBLEM_ID_SELECTOR));
  if (candidates.size !== 1) return null;
  const candidate = candidates.values().next().value;
  if (!candidate || !("value" in candidate)) return null;
  const value = String((candidate as HTMLInputElement).value).trim();
  return value || null;
}

function singleQueryContestProbId(url: URL): string | null {
  const values = url.searchParams.getAll("contestProbId");
  if (values.length !== 1) return null;
  return values[0]?.trim() || null;
}

export function normalizeSweaDetailUrl(value: string): string | null {
  const url = normalizedUrl(value);
  if (!url || url.origin !== SWEA_ORIGIN || !isDetailPath(url.pathname)) return null;
  return singleQueryContestProbId(url) ? url.href : null;
}

export function createSweaProblemContext(
  document: Document,
  location: Location,
  observedAt = Date.now()
): SweaProblemContext | null {
  if (location.origin !== SWEA_ORIGIN || !isDetailPath(location.pathname)) return null;
  const url = normalizedUrl(location.href);
  if (!url) return null;
  const contestProbId = readSweaContestProbId(document);
  const urlContestProbId = singleQueryContestProbId(url);
  if (!contestProbId || !urlContestProbId || contestProbId !== urlContestProbId) return null;
  if (!Number.isFinite(observedAt)) return null;
  return {
    contestProbId,
    problemUrl: url.href,
    sourcePath: location.pathname,
    observedAt
  };
}

export function validateSweaProblemContext(value: unknown): SweaProblemContext | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SweaProblemContext>;
  if (
    typeof candidate.contestProbId !== "string" ||
    typeof candidate.problemUrl !== "string" ||
    typeof candidate.sourcePath !== "string" ||
    typeof candidate.observedAt !== "number" ||
    !Number.isFinite(candidate.observedAt)
  ) return null;

  const problemUrl = normalizeSweaDetailUrl(candidate.problemUrl);
  if (!problemUrl) return null;
  const parsed = new URL(problemUrl);
  const contestProbId = singleQueryContestProbId(parsed);
  if (
    !contestProbId ||
    contestProbId !== candidate.contestProbId.trim() ||
    parsed.pathname !== candidate.sourcePath
  ) return null;

  return {
    contestProbId,
    problemUrl,
    sourcePath: parsed.pathname as SweaProblemContext["sourcePath"],
    observedAt: candidate.observedAt
  };
}

/**
 * Resolves a stable original link without inventing a detail route. A stored
 * context is usable only when the browser referrer and current DOM identity
 * bind the solving page back to that exact source page.
 */
export function resolveSweaProblemUrl(
  document: Document,
  location: Location,
  referrer: string,
  storedContext: unknown
): string | null {
  if (location.origin !== SWEA_ORIGIN || location.pathname !== SWEA_SOLVING_PATH) return null;
  const currentContestProbId = readSweaContestProbId(document);
  if (!currentContestProbId) return null;

  const currentUrl = normalizedUrl(location.href);
  if (!currentUrl) return null;
  const currentQueryIds = currentUrl.searchParams.getAll("contestProbId");
  if (currentQueryIds.length > 1) return null;
  if (currentQueryIds.length === 1 && currentQueryIds[0]?.trim() !== currentContestProbId) return null;

  const context = validateSweaProblemContext(storedContext);
  const normalizedReferrer = normalizeSweaDetailUrl(referrer);
  if (
    context &&
    normalizedReferrer === context.problemUrl &&
    context.contestProbId === currentContestProbId
  ) return context.problemUrl;

  // Preserve the pre-existing direct-link behavior when the solving URL is
  // already self-identifying. Query-less pages require trusted source context.
  return currentQueryIds.length === 1 ? currentUrl.href : null;
}
