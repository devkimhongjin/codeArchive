import type { EditorData, PerformanceData, PlatformAdapter, ProblemMetadata, SubmissionResultDetection, SubmissionSnapshot } from "../types";
import { elementText, isVisible, mainWorldSyncFailed, normalizeText } from "./dom";
import { JUNGOL_ORIGIN, JUNGOL_PROBLEM_PATH, JUNGOL_SOURCE_SELECTOR, jungolSubmitControl } from "./jungolSelectors";

export const JUNGOL_ATTEMPT_TTL_MS = 120_000;

export function isJungolAccepted(text: string): boolean {
  return normalizeText(text) === "정답이에요!";
}

function resultCandidates(document: Document): Element[] {
  return [...document.querySelectorAll("main,section,article,div,span,h1,h2,h3,h4,h5,h6,p,strong")]
    .filter((element) => isJungolAccepted(elementText(element)))
    .filter((element) => ![...element.querySelectorAll("*")].some((child) => isJungolAccepted(elementText(child))));
}

function resultElement(document: Document): Element | null {
  const visible = resultCandidates(document).filter(isVisible);
  return visible.length === 1 ? visible[0] ?? null : null;
}

function problem(document: Document, location: Location): ProblemMetadata | null {
  const number = location.pathname.match(JUNGOL_PROBLEM_PATH)?.[1];
  if (location.origin !== JUNGOL_ORIGIN || !number) return null;
  const title = normalizeText(document.querySelector("h1 > span")?.textContent);
  if (!title) return null;
  return { problemNumber: number, title, problemUrl: `${JUNGOL_ORIGIN}/problem/${number}` };
}

function editor(document: Document, problemNumber: string, now: number): EditorData | null {
  if (mainWorldSyncFailed(document)) return null;
  const status = document.documentElement.getAttribute("data-codearchive-editor-sync")?.match(/^synced:(\d+)$/);
  if (!status || Math.abs(now - Number(status[1])) > 5_000) return null;
  const source = document.querySelector<HTMLTextAreaElement>(JUNGOL_SOURCE_SELECTOR);
  if (!source || source.dataset.codearchiveJungolProblem !== problemNumber || !source.value.trim()) return null;
  const language = source.dataset.codearchiveJungolLanguage;
  if (!language) return null;
  return { language, sourceCode: source.value };
}

interface PendingAttempt {
  startedAt: number;
  context: string;
  baseline: WeakSet<Element>;
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
    return current ? editor(this.document, current.problemNumber, this.clock()) : null;
  }

  isSubmitControl(element: Element): boolean { return jungolSubmitControl(element); }

  beginSubmissionAttempt(now = new Date()): void {
    const baseline = new WeakSet<Element>();
    for (const existing of resultCandidates(this.document)) baseline.add(existing);
    const snapshot = { problem: this.detectProblem(), editor: this.detectEditor() };
    const source = this.document.querySelector<HTMLTextAreaElement>(JUNGOL_SOURCE_SELECTOR);
    if (source) source.value = "";
    this.pendingAttempt = {
      startedAt: now.getTime(),
      context: this.location.href,
      baseline,
      snapshot
    };
  }

  detectSubmissionResult(options: { freshOnly?: boolean } = {}): SubmissionResultDetection | null {
    this.expireAttempt();
    const attempt = this.pendingAttempt;
    if (!attempt?.snapshot.problem || !attempt.snapshot.editor) return null;
    const result = resultElement(this.document);
    if (!result) return null;
    const resultText = elementText(result);
    if ((options.freshOnly ?? true) && attempt.baseline.has(result)) return null;
    return { accepted: true, resultText, element: result, attemptToken: attempt };
  }

  getSubmissionSnapshot(): SubmissionSnapshot | null {
    this.expireAttempt();
    return this.pendingAttempt?.snapshot ?? null;
  }

  collectPerformance(): PerformanceData | null { return null; }

  consumeSubmissionResult(detection: SubmissionResultDetection): void {
    if (this.pendingAttempt && detection.attemptToken === this.pendingAttempt) this.pendingAttempt = null;
  }

  private expireAttempt(now = this.clock()): void {
    if (this.pendingAttempt && (this.location.href !== this.pendingAttempt.context || now - this.pendingAttempt.startedAt > this.attemptTtlMs)) {
      this.pendingAttempt = null;
    }
  }
}
