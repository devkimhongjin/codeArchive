import type { Capture, EditorData, PerformanceData, PlatformAdapter, ProblemMetadata, SubmissionResultDetection, SubmissionSnapshot } from "../types";
import { mainWorldSyncFailed, normalizeText } from "./dom";
import {
  BAEKJOON_SOURCE_SELECTOR, BAEKJOON_STATUS_PATH, BAEKJOON_SUBMIT_PATH, baekjoonPerformance, baekjoonProblemUrl, baekjoonSelectedLanguage,
  baekjoonSubmitControl, baekjoonUsername, isBaekjoonOrigin, readBaekjoonStatusRows, utf8Length, type BaekjoonStatusRow
} from "./baekjoonSelectors";

/**
 * Baekjoon submits with a full page load: the click happens on /submit/{n}
 * and the result arrives later on /status, a different document. The submit
 * page records what was sent in the tab's sessionStorage; the status page
 * resumes that attempt and accepts only the one own row that matches it
 * (same id, problem, language, code length, a close server time) once the
 * site marks it 맞았습니다!!.
 */
export const BAEKJOON_ATTEMPT_TTL_MS = 15 * 60_000;
/** Allowed difference between this computer's clock and the judge's submission time. */
export const BAEKJOON_CLOCK_SKEW_MS = 2 * 60_000;
const ATTEMPT_KEY = "codearchive-baekjoon-attempt";
const CONSUMED_KEY = "codearchive-baekjoon-consumed";

export type BaekjoonAttempt = {
  version: 1; problemNumber: string; title: string; language: string; sourceCode: string; username: string; startedAt: number;
};

export interface BaekjoonAttemptStore {
  read(): unknown;
  write(attempt: BaekjoonAttempt): void;
  clear(): void;
  consumed(): string[];
  consume(submissionId: string): void;
}

/** Tab-scoped: the submit and status pages share one tab's sessionStorage. Never throws. */
export function sessionAttemptStore(storage: () => Storage | undefined): BaekjoonAttemptStore {
  const get = (key: string) => { try { const text = storage()?.getItem(key); return text ? JSON.parse(text) as unknown : null; } catch { return null; } };
  const set = (key: string, value: unknown) => { try { storage()?.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };
  return {
    read: () => get(ATTEMPT_KEY),
    write: attempt => set(ATTEMPT_KEY, attempt),
    clear: () => { try { storage()?.removeItem(ATTEMPT_KEY); } catch { /* storage unavailable */ } },
    consumed: () => { const value = get(CONSUMED_KEY); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []; },
    consume: id => set(CONSUMED_KEY, [...new Set([id, ...(() => { const value = get(CONSUMED_KEY); return Array.isArray(value) ? value : []; })()])].slice(0, 50))
  };
}

function validAttempt(value: unknown): value is BaekjoonAttempt {
  if (!value || typeof value !== "object") return false;
  const item = value as BaekjoonAttempt;
  return item.version === 1 && typeof item.problemNumber === "string" && /^\d{1,40}$/.test(item.problemNumber) &&
    typeof item.title === "string" && item.title.length > 0 && item.title.length <= 500 &&
    typeof item.language === "string" && item.language.length > 0 && item.language.length <= 100 &&
    typeof item.sourceCode === "string" && item.sourceCode.trim().length > 0 && item.sourceCode.length <= 1_000_000 &&
    typeof item.username === "string" && /^[A-Za-z0-9_]{1,40}$/.test(item.username) && Number.isSafeInteger(item.startedAt);
}

/** Baekjoon may store a source with surrounding whitespace removed. */
function lengthMatches(codeLength: number | undefined, sourceCode: string): boolean {
  if (codeLength === undefined) return false;
  return [sourceCode, sourceCode.trimEnd(), sourceCode.trim()].some(value => utf8Length(value) === codeLength);
}

/**
 * Rows this tab is capturing live, or has captured: the pending attempt's
 * possible rows and every consumed submission. Status-page sync leaves them
 * alone so one submission is never registered both live and as a past one.
 */
export function baekjoonLiveClaim(store: BaekjoonAttemptStore, now = Date.now()): (row: { submissionId: string; problemNumber: string; language: string; submittedAt?: string }) => boolean {
  const consumed = new Set(store.consumed());
  const value = store.read();
  const attempt = validAttempt(value) && now - value.startedAt <= BAEKJOON_ATTEMPT_TTL_MS ? value : null;
  return row => consumed.has(row.submissionId) || (!!attempt && row.problemNumber === attempt.problemNumber && row.language === attempt.language &&
    !!row.submittedAt && Date.parse(row.submittedAt) >= attempt.startedAt - BAEKJOON_CLOCK_SKEW_MS);
}

/** Submission ids grow over time; compare them as decimal strings. */
function newer(left: string, right: string): number { return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0); }

export class BaekjoonAdapter implements PlatformAdapter {
  readonly platform = "BAEKJOON" as const;
  private matched: BaekjoonStatusRow | null = null;
  private readonly tokens = new Map<string, object>();

  constructor(
    private readonly document: Document,
    private readonly location: Location,
    private readonly store: BaekjoonAttemptStore = sessionAttemptStore(() => globalThis.sessionStorage),
    private readonly clock: () => number = () => Date.now(),
    private readonly attemptTtlMs = BAEKJOON_ATTEMPT_TTL_MS
  ) {}

  private page(): "submit" | "status" | null {
    if (!isBaekjoonOrigin(this.location.origin)) return null;
    if (BAEKJOON_SUBMIT_PATH.test(this.location.pathname)) return "submit";
    return this.location.pathname === BAEKJOON_STATUS_PATH ? "status" : null;
  }

  /** The pending attempt for the signed-in user of this page, or null. Expired attempts are dropped. */
  private attempt(): BaekjoonAttempt | null {
    const value = this.store.read();
    if (!validAttempt(value)) { if (value !== null) this.store.clear(); return null; }
    const age = this.clock() - value.startedAt;
    if (age < -BAEKJOON_CLOCK_SKEW_MS || age > this.attemptTtlMs) { this.store.clear(); return null; }
    return baekjoonUsername(this.document) === value.username ? value : null;
  }

  private submitProblem(): ProblemMetadata | null {
    const number = this.location.pathname.match(BAEKJOON_SUBMIT_PATH)?.[1];
    const legends = this.document.querySelectorAll("#submit_form legend");
    const title = legends.length === 1 ? normalizeText(legends[0]!.textContent) : "";
    if (!number || !title || title.length > 500) return null;
    const field = this.document.querySelector<HTMLInputElement>('#submit_form input[name="problem_id"]');
    if (field && field.value !== number) return null;
    return { problemNumber: number, title, problemUrl: baekjoonProblemUrl(number) };
  }

  detectProblem(): ProblemMetadata | null {
    const page = this.page();
    if (page === "submit") return this.submitProblem();
    const attempt = page === "status" ? this.attempt() : null;
    return attempt ? { problemNumber: attempt.problemNumber, title: attempt.title, problemUrl: baekjoonProblemUrl(attempt.problemNumber) } : null;
  }

  detectEditor(): EditorData | null {
    const attempt = this.page() === "status" ? this.attempt() : null;
    return attempt ? { language: attempt.language, sourceCode: attempt.sourceCode } : null;
  }

  isSubmitControl(element: Element): boolean { return this.page() === "submit" && baekjoonSubmitControl(element); }

  beginSubmissionAttempt(now = new Date()): void {
    if (this.page() !== "submit") return;
    // A new click always replaces an older attempt, even when this one cannot be read.
    this.store.clear();
    this.matched = null;
    const problem = this.submitProblem();
    const username = baekjoonUsername(this.document);
    const language = baekjoonSelectedLanguage(this.document);
    // The MAIN-world click listener runs first and copies the editor into the textarea.
    const status = this.document.documentElement?.getAttribute("data-codearchive-editor-sync")?.match(/^synced:(\d+)$/);
    const syncedAt = Number(status?.[1]);
    const source = this.document.querySelector<HTMLTextAreaElement>(BAEKJOON_SOURCE_SELECTOR);
    if (!problem || !username || !language || !source || mainWorldSyncFailed(this.document) || !status ||
        !Number.isSafeInteger(syncedAt) || Math.abs(now.getTime() - syncedAt) > 1_000) return;
    const attempt: BaekjoonAttempt = { version: 1, problemNumber: problem.problemNumber, title: problem.title, language,
      sourceCode: source.value, username, startedAt: now.getTime() };
    if (validAttempt(attempt)) this.store.write(attempt);
  }

  /** Only the status page waits: the submit page leaves for it as soon as the form posts. */
  hasPendingSubmissionAttempt(): boolean { return this.page() === "status" && this.attempt() !== null; }

  getSubmissionSnapshot(): SubmissionSnapshot | null {
    const problem = this.page() === "status" ? this.detectProblem() : null;
    const editor = problem ? this.detectEditor() : null;
    return problem && editor ? { problem, editor } : null;
  }

  private matchingRow(attempt: BaekjoonAttempt): BaekjoonStatusRow | null {
    const consumed = new Set(this.store.consumed()), now = this.clock();
    const rows = readBaekjoonStatusRows(this.document).filter(row => {
      const time = row.submittedAt ? Date.parse(row.submittedAt) : NaN;
      return row.ownSource && row.username === attempt.username && row.problemNumber === attempt.problemNumber &&
        row.language === attempt.language && lengthMatches(row.codeLength, attempt.sourceCode) && !consumed.has(row.submissionId) &&
        Number.isFinite(time) && time >= attempt.startedAt - BAEKJOON_CLOCK_SKEW_MS && time <= now + BAEKJOON_CLOCK_SKEW_MS;
    });
    return rows.sort((left, right) => newer(right.submissionId, left.submissionId))[0] ?? null;
  }

  detectSubmissionResult(): SubmissionResultDetection | null {
    const attempt = this.page() === "status" ? this.attempt() : null;
    if (!attempt) return null;
    const row = this.matchingRow(attempt);
    if (!row) return null;
    // A wrong answer or compile error ends this attempt: nothing is captured.
    if (row.rejected) { this.store.clear(); this.matched = null; return null; }
    if (!row.accepted || (row.title && row.title !== attempt.title)) return null;
    this.matched = row;
    const token = this.tokens.get(row.submissionId) ?? {};
    this.tokens.set(row.submissionId, token);
    return { accepted: true, resultText: "맞았습니다!!", element: row.row, attemptToken: token };
  }

  collectPerformance(): PerformanceData | null { return this.matched ? baekjoonPerformance(this.matched) : null; }

  async confirmCaptureAsync(capture: Capture, detection: SubmissionResultDetection): Promise<Capture | null> {
    const attempt = this.attempt(), matched = this.matched;
    if (!attempt || !matched || !matched.submittedAt || detection.attemptToken !== this.tokens.get(matched.submissionId)) return null;
    // Read the row again: it must still be this attempt's accepted row.
    const current = this.matchingRow(attempt);
    if (!current || current.submissionId !== matched.submissionId || !current.accepted || current.submittedAt !== matched.submittedAt ||
        capture.problemNumber !== attempt.problemNumber || capture.sourceCode !== attempt.sourceCode || capture.language !== attempt.language) return null;
    return { ...capture, problemUrl: baekjoonProblemUrl(attempt.problemNumber), solvedAt: matched.submittedAt };
  }

  consumeSubmissionResult(detection: SubmissionResultDetection): void {
    const matched = this.matched;
    if (!matched || detection.attemptToken !== this.tokens.get(matched.submissionId)) return;
    this.store.consume(matched.submissionId);
    this.store.clear();
    this.matched = null;
  }
}
