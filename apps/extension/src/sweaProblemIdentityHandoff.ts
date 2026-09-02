export const SWEA_STORE_PROBLEM_CONTEST_ID = "CODEARCHIVE_SWEA_STORE_PROBLEM_CONTEST_ID" as const;
export const SWEA_CONSUME_PROBLEM_CONTEST_ID = "CODEARCHIVE_SWEA_CONSUME_PROBLEM_CONTEST_ID" as const;

export interface ProblemContestIdHandoff {
  problemContestId: string;
  issuedAt: number;
  sourceOrigin: "https://swexpertacademy.com";
  sourcePath: "/main/code/problem/problemDetail.do";
  sourceUrl: string;
}

export function createProblemContestIdHandoffStore(
  now: () => number = () => Date.now(),
  ttlMs = 60_000,
) {
  let pending: ProblemContestIdHandoff | null = null;

  const cleanupExpired = () => {
    if (pending && now() - pending.issuedAt > ttlMs) pending = null;
  };

  const parseTrustedSource = (problemContestId: string, sourceUrl: string): URL | null => {
    if (!problemContestId.trim()) return null;
      let parsedSource: URL;
      try { parsedSource = new URL(sourceUrl); } catch { return null; }
      if (parsedSource.origin !== "https://swexpertacademy.com" || parsedSource.pathname !== "/main/code/problem/problemDetail.do") return null;
      const sourceIds = parsedSource.searchParams.getAll("contestProbId").map((value) => value.trim()).filter(Boolean);
      if (sourceIds.length !== 1 || sourceIds[0] !== problemContestId.trim()) return null;
      return parsedSource;
  };

  return {
    issue(_tabId: number, problemContestId: string, sourceUrl: string): boolean {
      if (!Number.isInteger(_tabId)) return false;
      const parsedSource = parseTrustedSource(problemContestId, sourceUrl);
      if (!parsedSource) return false;
      pending = {
        problemContestId: problemContestId.trim(),
        issuedAt: now(),
        sourceOrigin: "https://swexpertacademy.com",
        sourcePath: "/main/code/problem/problemDetail.do",
        sourceUrl: parsedSource.href,
      };
      return true;
    },
    consume(_tabId: number, origin: string, path: string, referrer: string): string | null {
      if (origin !== "https://swexpertacademy.com" || path !== "/main/solvingProblem/solvingProblem.do") return null;
      cleanupExpired();
      if (!pending) return null;
      let normalizedReferrer: URL;
      try { normalizedReferrer = new URL(referrer); } catch { return null; }
      if (normalizedReferrer.origin !== pending.sourceOrigin || normalizedReferrer.pathname !== pending.sourcePath) return null;
      const referrerIds = normalizedReferrer.searchParams.getAll("contestProbId").map((value) => value.trim()).filter(Boolean);
      if (referrerIds.length !== 1 || referrerIds[0] !== pending.problemContestId) return null;
      if (normalizedReferrer.href !== pending.sourceUrl) return null;
      const result = pending.problemContestId;
      pending = null;
      return result;
    },
    size(): number { return pending ? 1 : 0; },
  };
}

export function detailProblemContestId(document: Document, url: URL): string | null {
  if (url.origin !== "https://swexpertacademy.com" || url.pathname !== "/main/code/problem/problemDetail.do") return null;
  const values = Array.from(document.querySelectorAll<HTMLInputElement>("#contestProbId, input[name='contestProbId']"))
    .map((input) => input.value.trim()).filter(Boolean);
  return values.at(-1) ?? (url.searchParams.get("contestProbId")?.trim() || null);
}
