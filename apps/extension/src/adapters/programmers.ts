import type {
  EditorData,
  PerformanceData,
  PlatformAdapter,
  ProblemMetadata,
  SubmissionSnapshot,
  SubmissionResultDetection
} from "../types";
import { elementText, firstElement, mainWorldSyncFailed, normalizeText, parseFiniteNonNegative } from "./dom";
import {
  PROGRAMMERS_ACCEPTED_DIALOG_SELECTOR,
  PROGRAMMERS_ACCEPTED_TITLE_SELECTOR,
  PROGRAMMERS_CODE_SELECTOR,
  PROGRAMMERS_LANGUAGE_SELECTOR,
  PROGRAMMERS_LESSON_PATH,
  PROGRAMMERS_ORIGIN,
  PROGRAMMERS_RESULT_CELL_SELECTOR,
  PROGRAMMERS_RESULT_GROUP_SELECTOR,
  PROGRAMMERS_SUBMIT_SELECTOR,
  PROGRAMMERS_TITLE_SELECTOR
} from "./programmersSelectors";

export const PROGRAMMERS_ATTEMPT_TTL_MS = 60_000;
const RESULT_PATTERN = /^통과\s*\(\s*(\d+(?:\.\d+)?)\s*ms\s*,\s*(\d+(?:\.\d+)?)\s*MB\s*\)$/;

function exactLessonPage(location: Location): boolean {
  return location.origin === PROGRAMMERS_ORIGIN && PROGRAMMERS_LESSON_PATH.test(location.pathname);
}

function acceptedDialog(document: Document): Element | null {
  const dialog = document.querySelector(PROGRAMMERS_ACCEPTED_DIALOG_SELECTOR);
  // Bootstrap's .show/aria-modal mutation precedes the CSS opacity transition.
  // Opacity can still be zero at the only observer callback for this dialog.
  if (!dialog || dialog.hasAttribute("hidden") || dialog.getAttribute("aria-hidden") === "true") return null;
  const style = (dialog as HTMLElement).style;
  if (style?.display === "none" || style?.visibility === "hidden") return null;
  const computed = dialog.ownerDocument.defaultView?.getComputedStyle?.(dialog);
  if (computed?.display === "none" || computed?.visibility === "hidden") return null;
  const title = normalizeText(dialog.querySelector(PROGRAMMERS_ACCEPTED_TITLE_SELECTOR)?.textContent);
  return title === "정답입니다!" ? dialog : null;
}

export function isProgrammersAccepted(text: string): boolean {
  return normalizeText(text) === "정답입니다!";
}

function detectProblem(document: Document, location: Location): ProblemMetadata | null {
  if (!exactLessonPage(location)) return null;
  const problemNumber = location.pathname.match(PROGRAMMERS_LESSON_PATH)?.[1];
  const title = normalizeText(document.querySelector(PROGRAMMERS_TITLE_SELECTOR)?.textContent);
  if (!problemNumber || !title) return null;
  return {
    problemNumber,
    title,
    problemUrl: `${PROGRAMMERS_ORIGIN}/learn/courses/30/lessons/${problemNumber}`
  };
}

function normalizeProgrammersLanguage(value: string | null | undefined): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized === "python3" || normalized === "python") return "Python";
  if (normalized === "javascript") return "JavaScript";
  if (normalized === "kotlin") return "Kotlin";
  if (normalized === "java") return "Java";
  if (normalized === "c++") return "C++";
  if (normalized === "c#") return "C#";
  if (normalized === "go") return "Go";
  if (normalized === "ruby") return "Ruby";
  if (normalized === "scala") return "Scala";
  if (normalized === "swift") return "Swift";
  return raw;
}

function detectEditor(document: Document): EditorData | null {
  if (mainWorldSyncFailed(document)) return null;
  // The platform keeps the authoritative CodeMirror source in this textarea;
  // it may be hidden, so visibility is deliberately not a trust signal here.
  const language = normalizeProgrammersLanguage(document.querySelector(PROGRAMMERS_LANGUAGE_SELECTOR)?.textContent);
  const codeElement = firstElement<HTMLTextAreaElement>(document, [PROGRAMMERS_CODE_SELECTOR]);
  if (!language || !codeElement || typeof codeElement.value !== "string" || !codeElement.value.trim()) return null;
  return { language, sourceCode: codeElement.value };
}

function resultGroups(document: Document): Element[] | null {
  const groups = Array.from(document.querySelectorAll(PROGRAMMERS_RESULT_GROUP_SELECTOR));
  if (groups.length === 1) {
    // Effectiveness is a companion to correctness, not a complete standalone
    // result. Keep unlabelled legacy single-table results supported.
    return groups[0]?.getAttribute('data-category') === 'effectiveness' ? null : groups;
  }
  if (groups.length !== 2) return null;
  const labels: Record<string, string> = { correctness: '정확성 테스트', effectiveness: '효율성 테스트' };
  const categories = groups.map(group => group.getAttribute('data-category') ?? '');
  if (new Set(categories).size !== 2 || categories.some(category => !Object.hasOwn(labels, category))) return null;
  const container = groups[0]?.parentElement;
  if (!container?.matches('.console-content')) return null;
  return groups.every((group, index) => group.tagName === 'TABLE' && group.parentElement === container
    && group.previousElementSibling?.matches('.console-message')
    && normalizeText(group.previousElementSibling.textContent) === labels[categories[index]!]) ? groups : null;
}

function duplicateCodeNotice(document: Document): Element | null {
  const notices = [...document.querySelectorAll(".console-content .console-failed")]
    .filter((element) => normalizeText(element.textContent) === "같은 코드로 채점한 결과가 있습니다.");
  return notices.length === 1 ? notices[0] ?? null : null;
}

function parseResultGroups(groups: Element[]): PerformanceData | null {
  const sections = groups.map(group => Array.from(group.querySelectorAll(PROGRAMMERS_RESULT_CELL_SELECTOR)));
  if (sections.some(cells => cells.length === 0)) return null;
  const cells = sections.flat();
  const metrics = cells.map((cell) => {
    if (!cell.classList.contains("passed")) return null;
    const match = normalizeText(cell.textContent).match(RESULT_PATTERN);
    if (!match?.[1] || !match[2]) return null;
    const executionTime = parseFiniteNonNegative(match[1]);
    const memoryUsage = parseFiniteNonNegative(match[2]);
    return executionTime === null || memoryUsage === null ? null : { executionTime, memoryUsage, memoryValue: memoryUsage, memoryUnit: "MB" as const };
  });
  if (metrics.some((metric) => metric === null)) return null;
  const valid = metrics as Array<{ executionTime: number; memoryUsage: number; memoryValue: number; memoryUnit: "MB" }>;
  const executionTime = valid.reduce((sum, metric) => sum + metric.executionTime, 0);
  // Weight by test count, not by category: the sections can contain 10 and 30
  // rows. This preserves the existing sum-time / mean-memory contract.
  const memoryUsage = valid.reduce((sum, metric) => sum + metric.memoryUsage, 0) / valid.length;
  if (!Number.isFinite(executionTime) || !Number.isFinite(memoryUsage)) return null;
  return {
    executionTime,
    memoryUsage,
    memoryValue: memoryUsage,
    memoryUnit: "MB"
  };
}

function matchesSubmitControl(element: Element): boolean {
  try { return element.matches(PROGRAMMERS_SUBMIT_SELECTOR); } catch { return false; }
}

interface PendingAttempt {
  startedAt: number;
  context: string;
  baselineDialog: WeakMap<Element, string>;
  baselineResults: WeakMap<Element, string>;
  sawSplitResults: boolean;
  baselineDuplicateNotice: Element | null;
  consumed: WeakSet<Element>;
  observedNoDialog: boolean;
  snapshot: SubmissionSnapshot;
}

export class ProgrammersAdapter implements PlatformAdapter {
  readonly platform = "PROGRAMMERS" as const;

  constructor(
    private readonly document: Document,
    private readonly location: Location,
    private readonly attemptTtlMs = PROGRAMMERS_ATTEMPT_TTL_MS,
    private readonly clock: () => number = () => Date.now()
  ) {}

  detectProblem(): ProblemMetadata | null {
    return detectProblem(this.document, this.location);
  }

  detectSubmissionResult(options: { freshOnly?: boolean } = {}): SubmissionResultDetection | null {
    this.expireAttempt();
    const attempt = this.pendingAttempt;
    if (!attempt) return null;
    const dialog = acceptedDialog(this.document);
    if (!dialog) {
      attempt.observedNoDialog = true;
      return null;
    }
    const resultText = elementText(dialog.querySelector(PROGRAMMERS_ACCEPTED_TITLE_SELECTOR) ?? dialog);
    if (!isProgrammersAccepted(resultText)) {
      attempt.observedNoDialog = true;
      return null;
    }
    const baseline = attempt.baselineDialog.get(dialog);
    const fresh = baseline === undefined || baseline !== resultText || attempt.observedNoDialog;
    if ((options.freshOnly ?? true) && (!fresh || attempt.consumed.has(dialog))) return null;
    return { accepted: true, resultText, element: dialog, attemptToken: attempt };
  }

  detectEditor(): EditorData | null {
    return detectEditor(this.document);
  }

  collectPerformance(): PerformanceData | null {
    this.expireAttempt();
    const attempt = this.pendingAttempt;
    if (!attempt) return null;
    const groups = resultGroups(this.document);
    if (!groups || attempt.sawSplitResults && groups.length !== 2) return null;
    if (groups.length === 2) attempt.sawSplitResults = true;
    const notice = duplicateCodeNotice(this.document);
    const freshDuplicateNotice = notice !== null && notice !== attempt.baselineDuplicateNotice;
    // The site may reuse identical test results for a duplicate-code submit.
    // A new exact duplicate notice is evidence that the result belongs to this click.
    if (!freshDuplicateNotice && groups.some(group => attempt.baselineResults.get(group) === elementText(group))) return null;
    return parseResultGroups(groups);
  }

  hasPendingSubmissionAttempt(): boolean {
    this.expireAttempt();
    return this.pendingAttempt !== null;
  }

  isSubmitControl(element: Element): boolean {
    return matchesSubmitControl(element);
  }

  beginSubmissionAttempt(now: Date = new Date()): void {
    const baselineDialog = new WeakMap<Element, string>();
    const dialog = acceptedDialog(this.document);
    if (dialog) baselineDialog.set(dialog, elementText(dialog.querySelector(PROGRAMMERS_ACCEPTED_TITLE_SELECTOR) ?? dialog));
    const baselineResults = new WeakMap<Element, string>();
    for (const group of this.document.querySelectorAll(PROGRAMMERS_RESULT_GROUP_SELECTOR)) baselineResults.set(group, elementText(group));
    this.pendingAttempt = {
      startedAt: now.getTime(),
      context: this.location.href,
      baselineDialog,
      baselineResults,
      sawSplitResults: resultGroups(this.document)?.length === 2,
      baselineDuplicateNotice: duplicateCodeNotice(this.document),
      consumed: new WeakSet<Element>(),
      observedNoDialog: false,
      // Read metadata and the hidden source textarea at the click boundary.
      snapshot: { problem: this.detectProblem(), editor: this.detectEditor() }
    };
  }

  getSubmissionSnapshot(): SubmissionSnapshot | null {
    this.expireAttempt();
    return this.pendingAttempt?.snapshot ?? null;
  }

  consumeSubmissionResult(detection: SubmissionResultDetection): void {
    if (detection.element && this.pendingAttempt && detection.attemptToken === this.pendingAttempt) {
      this.pendingAttempt.consumed.add(detection.element);
      // Local persistence is the idempotency boundary for this submission
      // attempt. A newer click attempt must survive an older response.
      this.pendingAttempt = null;
    }
  }

  private pendingAttempt: PendingAttempt | null = null;

  private expireAttempt(now = this.clock()): void {
    if (!this.pendingAttempt) return;
    if (this.location.href !== this.pendingAttempt.context || now - this.pendingAttempt.startedAt > this.attemptTtlMs) {
      this.pendingAttempt = null;
    }
  }
}

export {
  PROGRAMMERS_ACCEPTED_DIALOG_SELECTOR,
  PROGRAMMERS_RESULT_GROUP_SELECTOR
};
