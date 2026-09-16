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
export type SweaProblemResolution =
  | { kind: "missing"; problemUrl: null }
  | { kind: "verified"; problemUrl: string }
  | { kind: "invalid"; problemUrl: null };

/** An extension runtime/storage failure is not evidence that no context exists. */
export const SWEA_CONTEXT_LOOKUP_ERROR = Symbol("SWEA_CONTEXT_LOOKUP_ERROR");

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
  return resolveSweaProblem(document, location, referrer, storedContext).problemUrl;
}

/** Keeps absent context distinct from corrupt or conflicting context. */
export function resolveSweaProblem(
  document: Document,
  location: Location,
  referrer: string,
  storedContext: unknown
): SweaProblemResolution {
  if (location.origin !== SWEA_ORIGIN || location.pathname !== SWEA_SOLVING_PATH) return { kind: "invalid", problemUrl: null };
  const currentContestProbId = readSweaContestProbId(document);
  if (!currentContestProbId) return { kind: "invalid", problemUrl: null };

  const currentUrl = normalizedUrl(location.href);
  if (!currentUrl) return { kind: "invalid", problemUrl: null };
  const currentQueryIds = currentUrl.searchParams.getAll("contestProbId");
  if (currentQueryIds.length > 1) return { kind: "invalid", problemUrl: null };
  if (currentQueryIds.length === 1 && currentQueryIds[0]?.trim() !== currentContestProbId) return { kind: "invalid", problemUrl: null };

  const absent = storedContext === null || storedContext === undefined;
  const context = validateSweaProblemContext(storedContext);
  const normalizedReferrer = normalizeSweaDetailUrl(referrer);
  if (
    context &&
    normalizedReferrer === context.problemUrl &&
    context.contestProbId === currentContestProbId
  ) return { kind: "verified", problemUrl: context.problemUrl };

  // A normalized detail referrer is itself an immutable page identity. It is
  // enough to bind a genuine no-row lookup to the current hidden ID; a
  // different ID is conflict evidence and must never enable fallback.
  if (absent && normalizedReferrer) {
    const referrerContestProbId = singleQueryContestProbId(new URL(normalizedReferrer));
    return referrerContestProbId === currentContestProbId
      ? { kind: "verified", problemUrl: normalizedReferrer }
      : { kind: "invalid", problemUrl: null };
  }

  // A supplied context (including malformed storage content) is evidence, not
  // an optional hint. Do not silently downgrade a conflicting page/referrer
  // binding into the query-less fallback.
  if (!absent) return { kind: "invalid", problemUrl: null };

  // Preserve the pre-existing direct-link behavior when the solving URL is
  // already self-identifying. Query-less pages require trusted source context.
  return currentQueryIds.length === 1
    ? { kind: "verified", problemUrl: currentUrl.href }
    : { kind: "missing", problemUrl: null };
}
