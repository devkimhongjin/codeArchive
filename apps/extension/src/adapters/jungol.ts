import type { Capture, EditorData, PerformanceData, PlatformAdapter, ProblemMetadata, SubmissionResultDetection, SubmissionSnapshot } from "../types";
import { mainWorldSyncFailed, normalizeText } from "./dom";
import { JUNGOL_ORIGIN, JUNGOL_PROBLEM_PATH, JUNGOL_SOURCE_SELECTOR, jungolSubmitControl } from "./jungolSelectors";
import { jungolAcceptedResult, type JungolAcceptedResult } from "./jungolResult";

export const JUNGOL_ATTEMPT_TTL_MS = 120_000;

function problem(document: Document, location: Location): ProblemMetadata | null {
  const number = location.pathname.match(JUNGOL_PROBLEM_PATH)?.[1];
  if (location.origin !== JUNGOL_ORIGIN || !number) return null;
  const title = normalizeText(document.querySelector("h1 .name")?.textContent ?? document.querySelector("h1 > span")?.textContent);
  if (!title) return null;
  return { problemNumber: number, title, problemUrl: `${JUNGOL_ORIGIN}/problem/${number}` };
}

function editor(document: Document, problemNumber: string, startedAt: number, now: number, requireRequest: boolean): EditorData | null {
  if (mainWorldSyncFailed(document)) return null;
  const status = document.documentElement.getAttribute("data-codearchive-editor-sync")?.match(/^synced:(\d+)$/);
  const syncedAt = Number(status?.[1]);
  if (!status || !Number.isSafeInteger(syncedAt) ||
      (requireRequest ? Math.abs(now - syncedAt) > 5_000 : Math.abs(startedAt - syncedAt) > 1_000)) return null;
  const source = document.querySelector<HTMLTextAreaElement>(JUNGOL_SOURCE_SELECTOR);
  const requestAt = Number(source?.dataset.codearchiveJungolRequestAt);
  if (!source || source.dataset.codearchiveJungolProblem !== problemNumber || !source.value.trim() ||
      (requireRequest && (!Number.isSafeInteger(requestAt) || requestAt < startedAt || requestAt > now + 1_000))) return null;
  const language = source.dataset.codearchiveJungolLanguage;
  if (!language) return null;
  return { language, sourceCode: source.value };
}

interface PendingAttempt {
  startedAt: number;
  context: string;
  baselineResult: JungolAcceptedResult | null;
  result: JungolAcceptedResult | null;
  requestAt: number | null;
  snapshot: SubmissionSnapshot;
}

export class JungolAdapter implements PlatformAdapter {
  readonly platform = "JUNGOL" as const;
  private pendingAttempt: PendingAttempt | null = null;

  constructor(
    private readonly document: Document,
    private readonly location: Location,
    private readonly attemptTtlMs = JUNGOL_ATTEMPT_TTL_MS,
    private readonly clock: () => number = () => Date.now()
  ) {}

  detectProblem(): ProblemMetadata | null { return problem(this.document, this.location); }

  detectEditor(): EditorData | null {
    const current = this.detectProblem();
    return current && this.pendingAttempt
      ? editor(this.document, current.problemNumber, this.pendingAttempt.startedAt, this.clock(), true)
      : null;
  }

  isSubmitControl(element: Element): boolean { return jungolSubmitControl(element); }

  beginSubmissionAttempt(now = new Date()): void {
    const snapshot: SubmissionSnapshot = { problem: this.detectProblem(), editor: null };
    // MAIN world reads the matching Monaco model before this click listener.
    // Keep that exact source for site revisions that no longer send the old
    // /judge JSON shape. A matching observed request still takes precedence.
    if (snapshot.problem) {
      snapshot.editor = editor(this.document, snapshot.problem.problemNumber, now.getTime(), this.clock(), false);
    }
    const source = this.document.querySelector<HTMLTextAreaElement>(JUNGOL_SOURCE_SELECTOR);
    if (source) source.value = "";
    this.pendingAttempt = {
      startedAt: now.getTime(),
      context: this.location.href,
      baselineResult: jungolAcceptedResult(this.document),
      result: null,
      requestAt: snapshot.editor ? now.getTime() : null,
      snapshot
    };
  }

  detectSubmissionResult(): SubmissionResultDetection | null {
    this.expireAttempt();
    const attempt = this.pendingAttempt;
    if (attempt) {
      const requestEditor = this.detectEditor();
      if (requestEditor) {
        attempt.snapshot.editor = requestEditor;
        const source = this.document.querySelector<HTMLTextAreaElement>(JUNGOL_SOURCE_SELECTOR);
        if (source) {
          attempt.requestAt = Number(source.dataset.codearchiveJungolRequestAt);
          source.value = "";
        }
      }
    }
    if (!attempt?.snapshot.problem || !attempt.snapshot.editor || attempt.requestAt === null) return null;
    const source = this.document.querySelector<HTMLTextAreaElement>(JUNGOL_SOURCE_SELECTOR);
    if (!source || source.dataset.codearchiveJungolProblem !== attempt.snapshot.problem.problemNumber ||
        source.dataset.codearchiveJungolLanguage !== attempt.snapshot.editor.language ||
        (Number(source.dataset.codearchiveJungolRequestAt) >= attempt.startedAt &&
          Number(source.dataset.codearchiveJungolRequestAt) !== attempt.requestAt) ||
        (source.value !== "" && source.value !== attempt.snapshot.editor.sourceCode)) return null;
    const result = jungolAcceptedResult(this.document);
    if (!result || (result.element === attempt.baselineResult?.element && result.signature === attempt.baselineResult.signature)) return null;
    attempt.result = result;
    return { accepted: true, resultText: "정답 100점", element: result.element, attemptToken: attempt };
  }

  getSubmissionSnapshot(): SubmissionSnapshot | null {
    this.expireAttempt();
    return this.pendingAttempt?.snapshot ?? null;
  }

  hasPendingSubmissionAttempt(): boolean {
    this.expireAttempt();
    return this.pendingAttempt !== null;
  }

  collectPerformance(): PerformanceData | null { return this.pendingAttempt?.result?.performance ?? null; }

  async confirmCaptureAsync(capture: Capture, detection: SubmissionResultDetection): Promise<Capture | null> {
    const attempt = this.pendingAttempt;
    const requestAt = attempt?.requestAt;
    if (!attempt || detection.attemptToken !== attempt || !attempt.snapshot.problem || !attempt.snapshot.editor || !attempt.result ||
        requestAt === null || requestAt === undefined || !Number.isSafeInteger(requestAt) ||
        requestAt < attempt.startedAt || requestAt > this.clock() + 1_000 ||
        capture.problemNumber !== attempt.snapshot.problem.problemNumber || capture.sourceCode !== attempt.snapshot.editor.sourceCode ||
        capture.language !== attempt.snapshot.editor.language) return null;
    this.expireAttempt();
    return this.pendingAttempt === attempt
      ? { ...capture, ...attempt.result.performance, solvedAt: new Date(requestAt).toISOString() }
      : null;
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
