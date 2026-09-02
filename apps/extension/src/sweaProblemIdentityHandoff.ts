export const SWEA_STORE_PROBLEM_CONTEST_ID = "CODEARCHIVE_SWEA_STORE_PROBLEM_CONTEST_ID" as const;
export const SWEA_CONSUME_PROBLEM_CONTEST_ID = "CODEARCHIVE_SWEA_CONSUME_PROBLEM_CONTEST_ID" as const;

export interface ProblemContestIdHandoff {
  problemContestId: string;
  issuedAt: number;
  sourceOrigin: "https://swexpertacademy.com";
  sourcePath: "/main/code/problem/problemDetail.do";
}

export function createProblemContestIdHandoffStore(
  now: () => number = () => Date.now(),
  ttlMs = 60_000,
) {
  const entries = new Map<number, ProblemContestIdHandoff>();

  const cleanup = (tabId: number) => {
    const entry = entries.get(tabId);
    if (entry && now() - entry.issuedAt > ttlMs) entries.delete(tabId);
  };

  return {
    issue(tabId: number, problemContestId: string): boolean {
      if (!Number.isInteger(tabId) || !problemContestId.trim()) return false;
      entries.set(tabId, {
        problemContestId: problemContestId.trim(),
        issuedAt: now(),
        sourceOrigin: "https://swexpertacademy.com",
        sourcePath: "/main/code/problem/problemDetail.do",
      });
      return true;
    },
    consume(tabId: number, origin: string, path: string): string | null {
      cleanup(tabId);
      const entry = entries.get(tabId);
      entries.delete(tabId);
      if (!entry || origin !== "https://swexpertacademy.com" || path !== "/main/solvingProblem/solvingProblem.do") return null;
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
