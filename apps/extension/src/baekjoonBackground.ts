import { normalizeDifficulty, solvedAcProblemSource, solvedAcTierLabel, type ProblemDifficulty } from "../../../shared/difficulty";
import { baekjoonProblemUrl } from "./adapters/baekjoonSelectors";
import { createCapture } from "./capture";
import type { BaekjoonHistoryCandidate } from "./historicalBaekjoon";
import type { BaekjoonTabResult } from "./baekjoonHistoryTask";
import { CAPTURE_RESULT, type Capture } from "./types";

const SOLVED_AC_CACHE_MS = 6 * 60 * 60_000;
const SOLVED_AC_CACHE_SIZE = 2_000;

/**
 * The solved.ac tier of a Baekjoon problem, from its public problem API.
 * Only the problem number is sent, without cookies. A failed lookup leaves the
 * difficulty blank and is retried next time; it never blocks a capture.
 */
export class SolvedAcDifficulty {
  private readonly cache = new Map<string, { value: ProblemDifficulty | undefined; at: number }>();
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args), private readonly now: () => number = () => Date.now()) {}

  async lookup(problemNumber: string): Promise<ProblemDifficulty | undefined> {
    if (!/^\d{1,9}$/.test(problemNumber)) return undefined;
    const cached = this.cache.get(problemNumber);
    if (cached && this.now() - cached.at < SOLVED_AC_CACHE_MS) return cached.value;
    try {
      const response = await this.fetcher(solvedAcProblemSource(problemNumber), {
        credentials: "omit", cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) return undefined;
      const body = await response.json() as { problemId?: unknown; level?: unknown } | null;
      const label = body?.problemId === Number(problemNumber) ? solvedAcTierLabel(body.level) : undefined;
      const value = label ? normalizeDifficulty("BAEKJOON", problemNumber, baekjoonProblemUrl(problemNumber),
        { label, problemNumber, sourceUrl: solvedAcProblemSource(problemNumber) }) : undefined;
      this.cache.delete(problemNumber);
      this.cache.set(problemNumber, { value, at: this.now() });
      if (this.cache.size > SOLVED_AC_CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
      return value;
    } catch { return undefined; }
  }

  async enrich(capture: Capture): Promise<Capture> {
    if (capture.platform !== "BAEKJOON" || capture.difficulty) return capture;
    const difficulty = await this.lookup(capture.problemNumber);
    return difficulty ? { ...capture, difficulty } : capture;
  }
}

/** A verified past submission: the listing row's metadata and its own source page's code. */
export function baekjoonHistoricalCapture(candidate: BaekjoonHistoryCandidate, sourceCode: string, difficulty?: ProblemDifficulty, now = new Date()): Capture | null {
  return createCapture({
    platform: "BAEKJOON", problemNumber: candidate.problemNumber, title: candidate.title, problemUrl: baekjoonProblemUrl(candidate.problemNumber),
    language: candidate.language, sourceCode, result: CAPTURE_RESULT, observedAt: now, solvedAt: candidate.solvedAt,
    historicalImport: true, historicalSubmissionId: candidate.submissionId,
    ...(candidate.executionTime === undefined ? {} : { executionTime: candidate.executionTime }),
    ...(candidate.memoryValue === undefined ? {} : { memoryValue: candidate.memoryValue, memoryUnit: "KB" as const, memoryUsage: candidate.memoryValue / 1024 }),
    ...(difficulty ? { difficulty } : {})
  });
}

export type BaekjoonTabApi = {
  create(url: string): Promise<number | undefined>;
  /** False when the tab no longer exists. */
  update(tabId: number, url: string): Promise<boolean>;
  get(tabId: number): Promise<{ url?: string; pendingUrl?: string; status?: string } | null>;
  remove(tabId: number): Promise<void>;
  send(tabId: number, message: object): Promise<unknown>;
  inject(tabId: number): Promise<void>;
  sleep(ms: number): Promise<void>;
};

const noReceiver = (error: unknown) => /receiving end does not exist|could not establish connection|no receiver/i.test(error instanceof Error ? error.message : String(error));

/**
 * One inactive tab the extension opened itself, never a tab of the user's.
 * Each load waits for that exact address to finish loading; a redirect (for
 * example to the login page) fails the load instead of reading another page.
 */
export class BaekjoonTab {
  private tabId: number | null = null;
  constructor(private readonly api: BaekjoonTabApi, private readonly timeoutMs = 30_000) {}

  get id(): number | null { return this.tabId; }
  owns(tabId: number): boolean { return this.tabId === tabId; }
  /** The user closed it: never reopen it behind their back within this run. */
  forget(tabId: number): void { if (this.tabId === tabId) this.tabId = null; }

  async load(url: string): Promise<BaekjoonTabResult<number>> {
    const target = new URL(url).href;
    if (this.tabId === null) {
      const created = await this.api.create(target).catch(() => undefined);
      if (created === undefined || !Number.isSafeInteger(created)) return { ok: false, reason: "OPEN_FAILED" };
      this.tabId = created;
    } else if (!await this.api.update(this.tabId, target).catch(() => false)) {
      this.tabId = null;
      return { ok: false, reason: "OPEN_FAILED" };
    }
    const tabId = this.tabId;
    for (let waited = 0; waited <= this.timeoutMs; waited += 100) {
      const tab = await this.api.get(tabId).catch(() => null);
      if (!tab || this.tabId !== tabId) return { ok: false, reason: "OPEN_FAILED" };
      if (tab.status === "complete" && !tab.pendingUrl && tab.url === target) return { ok: true, value: tabId };
      // Chrome can report the previous address for a moment after a new load starts.
      if (waited >= 1_000 && tab.status === "complete" && !tab.pendingUrl && tab.url && tab.url !== "about:blank" && tab.url !== target) {
        return { ok: false, reason: "LOAD_FAILED" };
      }
      await this.api.sleep(100);
    }
    return { ok: false, reason: "LOAD_FAILED" };
  }

  async ask(tabId: number, message: object): Promise<BaekjoonTabResult<unknown>> {
    if (tabId !== this.tabId) return { ok: false, reason: "NO_RECEIVER" };
    // The declared content script starts right after the page's load event; give it a moment before injecting another.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { return { ok: true, value: await this.api.send(tabId, message) }; }
      catch (error) { if (!noReceiver(error)) return { ok: false, reason: "NO_RECEIVER" }; }
      await this.api.sleep(200);
    }
    try {
      await this.api.inject(tabId);
      return { ok: true, value: await this.api.send(tabId, message) };
    } catch { return { ok: false, reason: "NO_RECEIVER" }; }
  }

  async close(): Promise<void> {
    const tabId = this.tabId;
    this.tabId = null;
    if (tabId !== null) await this.api.remove(tabId).catch(() => undefined);
  }
}

export function chromeBaekjoonTabApi(): BaekjoonTabApi {
  return {
    async create(url) {
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab.id !== undefined) await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
      return tab.id;
    },
    async update(tabId, url) { try { await chrome.tabs.update(tabId, { url }); return true; } catch { return false; } },
    async get(tabId) { try { return await chrome.tabs.get(tabId); } catch { return null; } },
    async remove(tabId) { await chrome.tabs.remove(tabId); },
    send: (tabId, message) => chrome.tabs.sendMessage(tabId, message, { frameId: 0 }),
    async inject(tabId) { await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content.js"], world: "ISOLATED" }); },
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
  };
}
