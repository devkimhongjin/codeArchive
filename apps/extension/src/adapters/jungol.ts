import type { Capture, EditorData, PerformanceData, PlatformAdapter, ProblemMetadata, SubmissionResultDetection, SubmissionSnapshot } from "../types";
import { mainWorldSyncFailed, normalizeText } from "./dom";
import { JUNGOL_ORIGIN, JUNGOL_PROBLEM_PATH, JUNGOL_SOURCE_SELECTOR, jungolSubmitControl } from "./jungolSelectors";
import { jungolSignedInHandle, verifyJungolCapture } from "./jungolVerification";

export const JUNGOL_ATTEMPT_TTL_MS = 120_000;
const VERIFY_INTERVAL_MS = 3_000;

function problem(document: Document, location: Location): ProblemMetadata | null {
  const number = location.pathname.match(JUNGOL_PROBLEM_PATH)?.[1];
  if (location.origin !== JUNGOL_ORIGIN || !number) return null;
  const title = normalizeText(document.querySelector("h1 > span")?.textContent);
  if (!title) return null;
  return { problemNumber: number, title, problemUrl: `${JUNGOL_ORIGIN}/problem/${number}` };
}

function editor(document: Document, problemNumber: string, startedAt: number, now: number): EditorData | null {
  if (mainWorldSyncFailed(document)) return null;
  const status = document.documentElement.getAttribute("data-codearchive-editor-sync")?.match(/^synced:(\d+)$/);
  if (!status || Math.abs(now - Number(status[1])) > 5_000) return null;
  const source = document.querySelector<HTMLTextAreaElement>(JUNGOL_SOURCE_SELECTOR);
  const requestAt = Number(source?.dataset.codearchiveJungolRequestAt);
  if (!source || source.dataset.codearchiveJungolProblem !== problemNumber || !source.value.trim() ||
      !Number.isSafeInteger(requestAt) || requestAt < startedAt || requestAt > now + 1_000) return null;
  const language = source.dataset.codearchiveJungolLanguage;
  if (!language) return null;
  return { language, sourceCode: source.value };
}

interface PendingAttempt {
  startedAt: number;
  context: string;
  account: string | null;
  nextVerifyAt: number;
  snapshot: SubmissionSnapshot;
}

export class JungolAdapter implements PlatformAdapter {
  readonly platform = "JUNGOL" as const;
  private pendingAttempt: PendingAttempt | null = null;

  constructor(
    private readonly document: Document,
    private readonly location: Location,
    private readonly attemptTtlMs = JUNGOL_ATTEMPT_TTL_MS,
    private readonly clock: () => number = () => Date.now(),
    private readonly request: typeof fetch = fetch
  ) {}

  detectProblem(): ProblemMetadata | null { return problem(this.document, this.location); }

  detectEditor(): EditorData | null {
    const current = this.detectProblem();
    return current && this.pendingAttempt
      ? editor(this.document, current.problemNumber, this.pendingAttempt.startedAt, this.clock())
      : null;
  }

  isSubmitControl(element: Element): boolean { return jungolSubmitControl(element); }

  beginSubmissionAttempt(now = new Date()): void {
    // The authoritative source is the site's /judge POST, emitted after its
    // async Monaco model read. A click-time DOM snapshot can be stale.
    const snapshot: SubmissionSnapshot = { problem: this.detectProblem(), editor: null };
    const source = this.document.querySelector<HTMLTextAreaElement>(JUNGOL_SOURCE_SELECTOR);
    if (source) source.value = "";
    this.pendingAttempt = {
      startedAt: now.getTime(),
      context: this.location.href,
      account: jungolSignedInHandle(this.document),
      nextVerifyAt: now.getTime() + 500,
      snapshot
    };
  }

  detectSubmissionResult(): SubmissionResultDetection | null {
    this.expireAttempt();
    const attempt = this.pendingAttempt;
    if (attempt && !attempt.snapshot.editor) {
      attempt.snapshot.editor = this.detectEditor();
      if (attempt.snapshot.editor) {
        const source = this.document.querySelector<HTMLTextAreaElement>(JUNGOL_SOURCE_SELECTOR);
        if (source) source.value = "";
      }
    }
    if (!attempt?.account || !attempt.snapshot.problem || !attempt.snapshot.editor || this.clock() < attempt.nextVerifyAt) return null;
    attempt.nextVerifyAt = this.clock() + VERIFY_INTERVAL_MS;
    // This is a verification candidate, not acceptance. The actual record is
    // checked against the site's own submission ID/account/problem/code/verdict.
    return { accepted: true, resultText: "정답", attemptToken: attempt };
  }

  getSubmissionSnapshot(): SubmissionSnapshot | null {
    this.expireAttempt();
    return this.pendingAttempt?.snapshot ?? null;
  }

  hasPendingSubmissionAttempt(): boolean {
    this.expireAttempt();
    return this.pendingAttempt !== null;
  }

  collectPerformance(): PerformanceData | null { return null; }

  async confirmCaptureAsync(capture: Capture, detection: SubmissionResultDetection): Promise<Capture | null> {
    const attempt = this.pendingAttempt;
    if (!attempt?.account || detection.attemptToken !== attempt || !attempt.snapshot.problem || !attempt.snapshot.editor) return null;
    try {
      const confirmed = await verifyJungolCapture(capture, attempt.account, attempt.startedAt, this.request);
      this.expireAttempt();
      return this.pendingAttempt === attempt ? confirmed : null;
    } catch {
      return null;
    }
  }

  consumeSubmissionResult(detection: SubmissionResultDetection): void {
    if (this.pendingAttempt && detection.attemptToken === this.pendingAttempt) this.pendingAttempt = null;
  }

  private expireAttempt(now = this.clock()): void {
    if (this.pendingAttempt && (this.location.href !== this.pendingAttempt.context || now - this.pendingAttempt.startedAt > this.attemptTtlMs)) {
      this.pendingAttempt = null;
    }
  }
}
