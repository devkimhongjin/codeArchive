import type {
  EditorData,
  PerformanceData,
  PlatformAdapter,
  ProblemMetadata,
  SubmissionSnapshot,
  SubmissionResultDetection
} from "../types";
import { elementText, firstElement, isVisible, mainWorldSyncFailed, normalizeText } from "./dom";
import {
  createSweaCanonicalProblemUrl,
  normalizeSweaDetailUrl,
  readSweaContestProbId
} from "../sweaProblemContext";
import {
  SWEA_EDITOR_SELECTORS,
  SWEA_ORIGIN,
  SWEA_RESULT_SELECTOR,
  SWEA_SOLVING_HEADING_SELECTOR,
  SWEA_SOLVING_PATH,
  SWEA_SUBMIT_SELECTORS
} from "./sweaSelectors";
import { fetchSweaPerformance } from "./sweaPerformance";

export const SWEA_ATTEMPT_TTL_MS = 60_000;

function exactSolvingPage(location: Location): boolean {
  return location.origin === SWEA_ORIGIN && location.pathname === SWEA_SOLVING_PATH;
}

function resultElement(document: Document): Element | null {
  const candidates = Array.from(document.querySelectorAll(SWEA_RESULT_SELECTOR)).filter(isVisible);
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

/** Exact legacy and observed live success dialogs; never match a history row. */
export function isSweaAccepted(text: string): boolean {
  return /^(?:pass입니다\.|축하합니다\.\s*pass입니다\.\s*제출이 완료되었습니다\.)$/i.test(normalizeText(text));
}

function detectProblem(document: Document, location: Location, resolvedProblemUrl: string | null, allowQuerylessFallback: boolean): ProblemMetadata | null {
  if (!exactSolvingPage(location)) return null;
  const heading = normalizeText(document.querySelector(SWEA_SOLVING_HEADING_SELECTOR)?.textContent);
  const match = heading.match(/^(\d+)\.\s*(.+)$/);
  if (!match?.[1] || !match[2]) return null;

  const hiddenId = readSweaContestProbId(document);
  if (!hiddenId) return null;
  const currentUrl = new URL(location.href);
  const urlIds = currentUrl.searchParams.getAll("contestProbId");
  if (urlIds.length > 1) return null;
  const urlId = urlIds[0]?.trim() || null;
  if (urlId && hiddenId !== urlId) return null;
  const canonicalProblemUrl = createSweaCanonicalProblemUrl(hiddenId);
  if (!canonicalProblemUrl) return null;

  let problemUrl = resolvedProblemUrl;
  if (problemUrl) {
    const normalizedProblemUrl = normalizeSweaDetailUrl(problemUrl);
    if (!normalizedProblemUrl) return null;
    const resolved = new URL(normalizedProblemUrl);
    const resolvedIds = resolved.searchParams.getAll("contestProbId");
    if (resolvedIds.length !== 1 || resolvedIds[0]?.trim() !== hiddenId) return null;
    problemUrl = normalizedProblemUrl;
  } else if (urlId) {
    problemUrl = canonicalProblemUrl;
  }
  // #237's source-link validation is enrichment, not capture identity. A
  // query-less solving page is still a single, validated contest problem
  // when its heading and one hidden contestProbId agree. Derive the public
  // detail route instead of saving the transient solving page.
  if (!problemUrl && !allowQuerylessFallback) return null;
  if (!problemUrl) problemUrl = canonicalProblemUrl;

  return {
    problemNumber: match[1],
    title: normalizeText(match[2]),
    problemUrl
  };
}

function normalizeSweaLanguage(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized.includes("javascript") || normalized === "js") return "JavaScript";
  if (normalized.includes("kotlin")) return "Kotlin";
  if (normalized.includes("python")) return "Python";
  if (normalized.includes("java")) return "Java";
  if (normalized.includes("c++") || normalized.includes("cpp")) return "C++";
  if (normalized === "c" || /^c\s*\d/.test(normalized)) return "C";
  return raw;
}

function detectEditor(document: Document, location: Location): EditorData | null {
  if (mainWorldSyncFailed(document)) return null;
  const select = firstElement<HTMLSelectElement>(document, SWEA_EDITOR_SELECTORS.language);
  const language = normalizeSweaLanguage(select?.selectedOptions?.[0]?.textContent || select?.value || select?.textContent || null)
    ?? normalizeSweaLanguage(new URL(location.href).searchParams.get("selectCodeLang"));
  const codeElement = firstElement<HTMLTextAreaElement>(document, SWEA_EDITOR_SELECTORS.code);
  if (!language || !codeElement || typeof codeElement.value !== "string") return null;
  return { language, sourceCode: codeElement.value };
}

function matchesSubmitControl(element: Element): boolean {
  return SWEA_SUBMIT_SELECTORS.some((selector) => {
    try { return element.matches(selector); } catch { return false; }
  });
}

interface PendingAttempt {
  startedAt: number;
  context: string;
  baseline: WeakMap<Element, string>;
  consumed: WeakSet<Element>;
  observedNoResult: boolean;
  snapshot: SubmissionSnapshot;
}

export class SweaAdapter implements PlatformAdapter {
  readonly platform = "SWEA" as const;
  private pendingAttempt: PendingAttempt | null = null;

  constructor(
    private readonly document: Document,
    private readonly location: Location,
    private readonly attemptTtlMs = SWEA_ATTEMPT_TTL_MS,
    private readonly clock: () => number = () => Date.now(),
    private readonly resolvedProblemUrl: string | null = null,
    private readonly allowQuerylessFallback = true
  ) {}

  detectProblem(): ProblemMetadata | null {
    return detectProblem(this.document, this.location, this.resolvedProblemUrl, this.allowQuerylessFallback);
  }

  detectSubmissionResult(options: { freshOnly?: boolean } = {}): SubmissionResultDetection | null {
    this.expireAttempt();
    const attempt = this.pendingAttempt;
    if (!attempt) return null;
    const result = resultElement(this.document);
    if (!result) {
      attempt.observedNoResult = true;
      return null;
    }
    const resultText = elementText(result);
    if (!isSweaAccepted(resultText)) {
      attempt.observedNoResult = true;
      return null;
    }

    const baseline = attempt.baseline.get(result);
    const fresh = baseline === undefined || baseline !== resultText || attempt.observedNoResult;
    if ((options.freshOnly ?? true) && (!fresh || attempt.consumed.has(result))) return null;
    return { accepted: true, resultText, element: result, attemptToken: attempt };
  }

  detectEditor(): EditorData | null {
    return detectEditor(this.document, this.location);
  }

  collectPerformance(): PerformanceData | null {
    // SWEA publishes the authoritative performance row on a separate Problem
    // page request. The local capture path never guesses from popup prose.
    return null;
  }

  collectPerformanceAsync(capture: import("../types").Capture): Promise<PerformanceData | null> {
    const contestProbId = readSweaContestProbId(this.document);
    if (!contestProbId) return Promise.resolve(null);
    return fetchSweaPerformance(
      this.document,
      this.location,
      contestProbId,
      capture.sourceCode,
      capture.observedAt
    );
  }

  isSubmitControl(element: Element): boolean {
    return matchesSubmitControl(element);
  }

  beginSubmissionAttempt(now: Date = new Date()): void {
    const baseline = new WeakMap<Element, string>();
    const result = resultElement(this.document);
    if (result) baseline.set(result, elementText(result));
    this.pendingAttempt = {
      startedAt: now.getTime(),
      context: this.location.href,
      baseline,
      consumed: new WeakSet<Element>(),
      observedNoResult: false,
      // This is intentionally read at the click boundary, after the packaged
      // MAIN-world synchronizer has called the platform editor's save method.
      snapshot: { problem: this.detectProblem(), editor: this.detectEditor() }
    };
  }

  hasPendingSubmissionAttempt(): boolean {
    this.expireAttempt();
    return this.pendingAttempt !== null;
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

  private expireAttempt(now = this.clock()): void {
    if (!this.pendingAttempt) return;
    if (this.location.href !== this.pendingAttempt.context || now - this.pendingAttempt.startedAt > this.attemptTtlMs) {
      this.pendingAttempt = null;
    }
  }
}

export { SWEA_RESULT_SELECTOR };
