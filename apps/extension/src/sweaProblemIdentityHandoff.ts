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
  const entries = new Map<number, ProblemContestIdHandoff>();

  const cleanupExpired = () => {
    for (const [entryTabId, entry] of entries) {
      if (now() - entry.issuedAt > ttlMs) entries.delete(entryTabId);
    }
  };

  return {
    issue(tabId: number, problemContestId: string, sourceUrl: string): boolean {
      if (!Number.isInteger(tabId) || !problemContestId.trim()) return false;
      let parsedSource: URL;
      try { parsedSource = new URL(sourceUrl); } catch { return false; }
      if (parsedSource.origin !== "https://swexpertacademy.com" || parsedSource.pathname !== "/main/code/problem/problemDetail.do") return false;
      entries.set(tabId, {
        problemContestId: problemContestId.trim(),
        issuedAt: now(),
        sourceOrigin: "https://swexpertacademy.com",
        sourcePath: "/main/code/problem/problemDetail.do",
        sourceUrl: parsedSource.href,
      });
      return true;
    },
    consume(tabId: number, origin: string, path: string, referrer: string): string | null {
      if (origin !== "https://swexpertacademy.com" || path !== "/main/solvingProblem/solvingProblem.do") return null;
      cleanupExpired();
      let normalizedReferrer: string;
      try { normalizedReferrer = new URL(referrer).href; } catch { return null; }
      const sameTab = entries.get(tabId);
      const matches = sameTab?.sourceUrl === normalizedReferrer
        ? [[tabId, sameTab] as const]
        : Array.from(entries.entries()).filter(([, candidate]) => candidate.sourceUrl === normalizedReferrer);
      if (matches.length !== 1) return null;
      const [ownerTabId, entry] = matches[0];
      entries.delete(ownerTabId);
      return entry.problemContestId;
    },
    size(): number { return entries.size; },
  };
}

export function detailProblemContestId(document: Document, url: URL): string | null {
  if (url.origin !== "https://swexpertacademy.com" || url.pathname !== "/main/code/problem/problemDetail.do") return null;
  const values = Array.from(document.querySelectorAll<HTMLInputElement>("#contestProbId, input[name='contestProbId']"))
    .map((input) => input.value.trim()).filter(Boolean);
  return values.at(-1) ?? (url.searchParams.get("contestProbId")?.trim() || null);
}
