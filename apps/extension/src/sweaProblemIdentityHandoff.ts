export const SWEA_STORE_PROBLEM_CONTEST_ID = "CODEARCHIVE_SWEA_STORE_PROBLEM_CONTEST_ID" as const;
export const SWEA_CONSUME_PROBLEM_CONTEST_ID = "CODEARCHIVE_SWEA_CONSUME_PROBLEM_CONTEST_ID" as const;

const CONTEXT_DB_NAME = "codearchive-swea-problem-context";
const CONTEXT_DB_VERSION = 1;
const CONTEXT_STORE_NAME = "context";
const CURRENT_CONTEXT_KEY = "current";

export interface ProblemContestIdHandoff {
  problemContestId: string;
  issuedAt: number;
  sourceOrigin: "https://swexpertacademy.com";
  sourcePath: "/main/code/problem/problemDetail.do";
  sourceUrl: string;
}

export interface ProblemContestIdContextPersistence {
  read(): Promise<unknown | null>;
  write(context: ProblemContestIdHandoff): Promise<void>;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function openContextDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONTEXT_DB_NAME, CONTEXT_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CONTEXT_STORE_NAME)) request.result.createObjectStore(CONTEXT_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("SWEA problem context database open failed."));
  });
}

export const indexedDbProblemContestIdContextPersistence: ProblemContestIdContextPersistence = {
  async read() {
    const db = await openContextDatabase();
    try {
      const transaction = db.transaction(CONTEXT_STORE_NAME, "readonly");
      const done = transactionDone(transaction);
      const value = await requestToPromise(transaction.objectStore(CONTEXT_STORE_NAME).get(CURRENT_CONTEXT_KEY));
      await done;
      return value ?? null;
    } finally { db.close(); }
  },
  async write(context) {
    const db = await openContextDatabase();
    try {
      const transaction = db.transaction(CONTEXT_STORE_NAME, "readwrite");
      transaction.objectStore(CONTEXT_STORE_NAME).put(context, CURRENT_CONTEXT_KEY);
      await transactionDone(transaction);
    } finally { db.close(); }
  },
};

function parseTrustedSource(problemContestId: string, sourceUrl: string): URL | null {
  if (!problemContestId.trim()) return null;
  let parsedSource: URL;
  try { parsedSource = new URL(sourceUrl); } catch { return null; }
  if (parsedSource.origin !== "https://swexpertacademy.com" || parsedSource.pathname !== "/main/code/problem/problemDetail.do") return null;
  const rawIds = parsedSource.searchParams.getAll("contestProbId");
  if (rawIds.length !== 1) return null;
  const sourceId = rawIds[0].trim();
  if (!sourceId || sourceId !== problemContestId.trim()) return null;
  return parsedSource;
}

function trustedContext(value: unknown): ProblemContestIdHandoff | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ProblemContestIdHandoff>;
  if (typeof candidate.problemContestId !== "string" || typeof candidate.sourceUrl !== "string" || typeof candidate.issuedAt !== "number" || !Number.isFinite(candidate.issuedAt)) return null;
  const source = parseTrustedSource(candidate.problemContestId, candidate.sourceUrl);
  if (!source || candidate.sourceOrigin !== "https://swexpertacademy.com" || candidate.sourcePath !== "/main/code/problem/problemDetail.do") return null;
  return {
    problemContestId: candidate.problemContestId.trim(),
    issuedAt: candidate.issuedAt,
    sourceOrigin: "https://swexpertacademy.com",
    sourcePath: "/main/code/problem/problemDetail.do",
    sourceUrl: source.href,
  };
}

export function createProblemContestIdHandoffStore(
  now: () => number = () => Date.now(),
  persistence: ProblemContestIdContextPersistence = indexedDbProblemContestIdContextPersistence,
) {
  return {
    async issue(_tabId: number, problemContestId: string, sourceUrl: string): Promise<boolean> {
      if (!Number.isInteger(_tabId)) return false;
      const parsedSource = parseTrustedSource(problemContestId, sourceUrl);
      if (!parsedSource) return false;
      await persistence.write({
        problemContestId: problemContestId.trim(),
        issuedAt: now(),
        sourceOrigin: "https://swexpertacademy.com",
        sourcePath: "/main/code/problem/problemDetail.do",
        sourceUrl: parsedSource.href,
      });
      return true;
    },
    async consume(_tabId: number, origin: string, path: string, referrer: string): Promise<string | null> {
      if (!Number.isInteger(_tabId) || origin !== "https://swexpertacademy.com" || path !== "/main/solvingProblem/solvingProblem.do") return null;
      const current = trustedContext(await persistence.read());
      if (!current) return null;
      let normalizedReferrer: URL;
      try { normalizedReferrer = new URL(referrer); } catch { return null; }
      if (normalizedReferrer.origin !== current.sourceOrigin || normalizedReferrer.pathname !== current.sourcePath) return null;
      const rawIds = normalizedReferrer.searchParams.getAll("contestProbId");
      if (rawIds.length !== 1) return null;
      const referrerId = rawIds[0].trim();
      if (!referrerId || referrerId !== current.problemContestId) return null;
      if (normalizedReferrer.href !== current.sourceUrl) return null;
      return current.problemContestId;
    },
    async size(): Promise<number> { return trustedContext(await persistence.read()) ? 1 : 0; },
  };
}

export function detailProblemContestId(document: Document, url: URL): string | null {
  if (url.origin !== "https://swexpertacademy.com" || url.pathname !== "/main/code/problem/problemDetail.do") return null;
  const values = Array.from(document.querySelectorAll<HTMLInputElement>("#contestProbId, input[name='contestProbId']"))
    .map((input) => input.value.trim()).filter(Boolean);
  return values.at(-1) ?? (url.searchParams.get("contestProbId")?.trim() || null);
}
