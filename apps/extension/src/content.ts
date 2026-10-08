import type { ProblemDifficulty } from '../../../shared/difficulty';
import { createAdapter } from "./adapters";
import { collectAcceptedCaptureAttempt, createCapture, isCaptureRecord } from "./capture";
import { CAPTURE_RESULT, type Capture, type PlatformAdapter } from "./types";
import { canonicalLanguageKey } from "../../../shared/language";
import { BUILD_METADATA } from "../../../shared/buildMetadata";
import { importVisibleJungolHistory, isJungolHistoryPath, loadJungolHistoryPreview, previewJungolHistory,
  type JungolHistoryCandidate, type JungolHistoryPreview, type JungolHistoryScanProgress } from "./historicalJungol";
import { authenticatedSweaHistoryIdentity, hydrateSweaCandidateResult, loadSweaHistoryPreview, type SweaHistoryCandidate } from "./historicalSwea";
import { mayStoreLocalHistoryCapture, sameHistorySource } from "./historyRouting";
import { HistoricalTaskController, HistoricalImportFailure, type HistoricalImportFailureReason } from "./historicalTaskController";
import { persistHistoricalTimingSample, timingSampleFromCompletedTask, type HistoricalTimingSample } from "./historyTiming";
import { authenticatedProgrammersUserId, canonicalProgrammersLessonUrl, previewProgrammersHistory, readProgrammersLessonHistory,
  readProgrammersSolvedListingPage, selectedProgrammersHistoryEditorUri, unsupportedProgrammersSqlHistory,
  type ProgrammersLessonHistoryRow, type ProgrammersLessonSubmission } from "./historicalProgrammers";
import { isHistoricalSubmissionId, programmersHistoricalSubmissionAccount } from "./historicalIdentity";
import {
  createSweaProblemContext,
  normalizeSweaDetailUrl,
  resolveSweaProblem,
  SWEA_CONTEXT_LOOKUP_ERROR,
  type SweaProblemContext
} from "./sweaProblemContext";
import {
  SWEA_ORIGIN,
  SWEA_PROBLEM_DETAIL_PATHS,
  SWEA_SOLVING_PATH,
  SWEA_USER_SUBMISSIONS_PATH
} from "./adapters/sweaSelectors";

type ProgrammersAuxiliaryCandidate = Pick<ProgrammersLessonSubmission, "submissionId" | "problemNumber" | "language" | "createdAt" | "score">;
export type ProgrammersAuxiliaryResponse =
  | { status: "READY"; accountId: string; lessonId: string; title: string; candidates: ProgrammersAuxiliaryCandidate[] }
  | { status: "DONE"; accountId: string; capture: Capture }
  | { status: "EMPTY"; accountId: string; lessonId: string; title: string; candidates: [] }
  | { status: "UNSUPPORTED_HISTORY"; accountId: string; lessonId: string; title: string; candidates: [] }
  | { status: "BAD_REQUEST" | "TAB_NOT_FOUND" | "OWNERSHIP_UNVERIFIED" | "HISTORY_INCOMPLETE" | "AMBIGUOUS_HISTORY" | "STALE_SUBMISSION" | "SOURCE_UNAVAILABLE" };

export interface ProgrammersAuxiliaryServices {
  sleep?: (delayMs: number) => Promise<void>;
  now?: () => number;
  /** Test-only hook; production relies on the already-installed MAIN-world observer. */
  onBridgeRequested?: (uri: string, requestStamp: string) => void;
  attempts?: number;
}

let programmersAuxiliaryRequestSequence = 0;
const PROGRAMMERS_AUXILIARY_WAIT_MS = 100;

function programmersCandidateView(candidate: ProgrammersLessonSubmission): ProgrammersAuxiliaryCandidate {
  return { submissionId: candidate.submissionId, problemNumber: candidate.problemNumber, language: candidate.language,
    createdAt: candidate.createdAt, score: candidate.score };
}

function sameProgrammersSubmission(left: ProgrammersLessonSubmission, right: ProgrammersLessonSubmission): boolean {
  return left.submissionId === right.submissionId && left.problemNumber === right.problemNumber &&
    left.createdAt === right.createdAt && left.language === right.language && left.score === right.score;
}

function programmersAuxiliaryRouteCurrent(location: Location, lessonUrl: string): boolean {
  return canonicalProgrammersLessonUrl(location) === lessonUrl;
}

function currentProgrammersLesson(document: Document, location: Location, accountId: string, lessonId: string, title: string,
  submissionId?: string): ProgrammersLessonSubmission | null {
  const current = readProgrammersLessonHistory(document, location);
  if (current.status !== "READY" || current.accountId !== accountId || current.lessonId !== lessonId || current.title !== title) return null;
  if (submissionId === undefined) return current.candidates[0] ?? null;
  const matches = current.candidates.filter(candidate => candidate.submissionId === submissionId);
  return matches.length === 1 ? matches[0]! : null;
}

async function waitForProgrammersLessonHistory(document: Document, location: Location, services: ProgrammersAuxiliaryServices) {
  const sleep = services.sleep ?? (delayMs => new Promise<void>(resolve => setTimeout(resolve, delayMs)));
  const attempts = services.attempts ?? 100;
  let openedHistory = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const tabs = [...document.querySelectorAll<HTMLElement>(".submission-history-title")];
    if (tabs.length === 1 && !openedHistory) { tabs[0]!.click(); openedHistory = true; }
    if (tabs.length > 1) return { status: "INCOMPLETE" } as const;
    const state = readProgrammersLessonHistory(document, location);
    if (state.status !== "PENDING" && state.status !== "OWNERSHIP_UNVERIFIED") return state;
    await sleep(PROGRAMMERS_AUXILIARY_WAIT_MS);
  }
  return readProgrammersLessonHistory(document, location);
}

function programmersHistoryWrapper(document: Document): HTMLElement | null {
  const wrappers = document.querySelectorAll<HTMLElement>(".submission-history-wrapper");
  return wrappers.length === 1 ? wrappers[0]! : null;
}

async function waitForProgrammersHistoryPage(document: Document, location: Location, expectedPage: number,
  priorSignature: string, accountId: string, lessonId: string, title: string, services: ProgrammersAuxiliaryServices) {
  const sleep = services.sleep ?? (delayMs => new Promise<void>(resolve => setTimeout(resolve, delayMs)));
  for (let attempt = 0; attempt < (services.attempts ?? 100); attempt += 1) {
    const state = readProgrammersLessonHistory(document, location);
    if (state.status === "READY") {
      if (state.accountId !== accountId || state.lessonId !== lessonId || state.title !== title) return { status: "OWNERSHIP_UNVERIFIED" } as const;
      if (state.page === expectedPage && state.rows.map(row => row.submissionId).join(",") !== priorSignature) return state;
    }
    if (state.status === "INCOMPLETE" || state.status === "AMBIGUOUS" || state.status === "OWNERSHIP_UNVERIFIED") return state;
    await sleep(PROGRAMMERS_AUXILIARY_WAIT_MS);
  }
  // A page button can change before its list rows.  Returning that ready
  // snapshot would let callers traverse an old page indefinitely.
  return { status: "INCOMPLETE" } as const;
}

/** Traverse the site panel itself; no internal endpoint is inferred. */
async function collectProgrammersLessonHistory(document: Document, location: Location, services: ProgrammersAuxiliaryServices) {
  let current = await waitForProgrammersLessonHistory(document, location, services);
  if (current.status !== "READY") return current;
  if (current.page !== 1) {
    current = await openProgrammersHistoryPage(document, location, 1, current.accountId, current.lessonId, current.title, services);
    if (current.status !== "READY") return current;
  }
  const first = current;
  const allRows: ProgrammersLessonHistoryRow[] = [];
  const allCandidates: ProgrammersLessonSubmission[] = [];
  const seen = new Set<string>();
  for (let guard = 0; guard < 10_000; guard += 1) {
    if (current.status !== "READY") return current;
    if (current.accountId !== first.accountId || current.lessonId !== first.lessonId || current.title !== first.title)
      return { status: "OWNERSHIP_UNVERIFIED" } as const;
    if (current.totalEntries !== first.totalEntries || current.page !== guard + 1) return { status: "INCOMPLETE" } as const;
    for (const row of current.rows) {
      if (seen.has(row.submissionId)) return { status: "AMBIGUOUS" } as const;
      seen.add(row.submissionId); allRows.push(row);
    }
    allCandidates.push(...current.candidates);
    if (allRows.length > first.totalEntries) return { status: "INCOMPLETE" } as const;
    const wrapper = programmersHistoryWrapper(document);
    const next = wrapper?.querySelectorAll<HTMLButtonElement>("button[aria-label='다음 페이지']") ?? [];
    if (next.length !== 1) return { status: "INCOMPLETE" } as const;
    if (next[0]!.disabled) {
      return allRows.length === first.totalEntries
        ? { ...first, rows: allRows, candidates: allCandidates }
        : { status: "INCOMPLETE" } as const;
    }
    next[0]!.click();
    current = await waitForProgrammersHistoryPage(document, location, guard + 2, current.rows.map(row => row.submissionId).join(","), first.accountId, first.lessonId, first.title, services);
  }
  return { status: "INCOMPLETE" } as const;
}

async function openProgrammersHistoryPage(document: Document, location: Location, targetPage: number,
  accountId: string, lessonId: string, title: string, services: ProgrammersAuxiliaryServices) {
  let current = readProgrammersLessonHistory(document, location);
  if (current.status !== "READY") return current;
  if (current.accountId !== accountId || current.lessonId !== lessonId || current.title !== title) return { status: "OWNERSHIP_UNVERIFIED" } as const;
  if (current.page > targetPage) {
    const first = programmersHistoryWrapper(document)?.querySelectorAll<HTMLButtonElement>("button[aria-label='처음 페이지']") ?? [];
    if (first.length !== 1 || first[0]!.disabled) return { status: "INCOMPLETE" } as const;
    first[0]!.click();
    current = await waitForProgrammersHistoryPage(document, location, 1, current.rows.map(row => row.submissionId).join(","), accountId, lessonId, title, services);
  }
  while (current.status === "READY" && current.page < targetPage) {
    const next = programmersHistoryWrapper(document)?.querySelectorAll<HTMLButtonElement>("button[aria-label='다음 페이지']") ?? [];
    if (next.length !== 1 || next[0]!.disabled) return { status: "INCOMPLETE" } as const;
    next[0]!.click();
    current = await waitForProgrammersHistoryPage(document, location, current.page + 1, current.rows.map(row => row.submissionId).join(","), accountId, lessonId, title, services);
  }
  return current.status === "READY" && current.page === targetPage ? current : { status: "INCOMPLETE" } as const;
}

function requestProgrammersHistorySource(document: Document, uri: string, services: ProgrammersAuxiliaryServices): string | null {
  const root = document.documentElement;
  if (!root) return null;
  const requestStamp = `${uri}:${++programmersAuxiliaryRequestSequence}`;
  const source = document.querySelector<HTMLTextAreaElement>("textarea[data-codearchive-programmers-history-source]");
  root.removeAttribute("data-codearchive-programmers-history-response");
  delete root.dataset.codearchiveProgrammersHistoryUri;
  delete root.dataset.codearchiveProgrammersHistoryRequest;
  if (source) {
    source.value = "";
    delete source.dataset.codearchiveProgrammersHistoryUri;
    delete source.dataset.codearchiveProgrammersHistoryRequest;
  }
  // Setting the URI last triggers the MAIN-world mutation observer only after
  // stale source and response data can no longer satisfy this read.
  root.dataset.codearchiveProgrammersHistoryRequest = requestStamp;
  root.dataset.codearchiveProgrammersHistoryUri = uri;
  services.onBridgeRequested?.(uri, requestStamp);
  return requestStamp;
}

async function waitForProgrammersHistorySource(document: Document, location: Location, lessonUrl: string, accountId: string, lessonId: string,
  title: string, target: ProgrammersLessonSubmission, uri: string, requestStamp: string, services: ProgrammersAuxiliaryServices): Promise<
    { status: "DONE"; sourceCode: string } | { status: "TAB_NOT_FOUND" | "OWNERSHIP_UNVERIFIED" | "SOURCE_UNAVAILABLE" }> {
  const sleep = services.sleep ?? (delayMs => new Promise<void>(resolve => setTimeout(resolve, delayMs)));
  const attempts = services.attempts ?? 100;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!programmersAuxiliaryRouteCurrent(location, lessonUrl)) return { status: "TAB_NOT_FOUND" };
    const state = readProgrammersLessonHistory(document, location);
    if (state.status === "OWNERSHIP_UNVERIFIED") return { status: "OWNERSHIP_UNVERIFIED" };
    if (state.status !== "READY") return { status: "SOURCE_UNAVAILABLE" };
    if (state.accountId !== accountId || state.lessonId !== lessonId || state.title !== title) return { status: "OWNERSHIP_UNVERIFIED" };
    const matches = state.candidates.filter(candidate => candidate.submissionId === target.submissionId);
    if (matches.length !== 1 || !sameProgrammersSubmission(target, matches[0]!)) return { status: "SOURCE_UNAVAILABLE" };
    const current = matches[0]!;
    if (selectedProgrammersHistoryEditorUri(current.row) !== uri) return { status: "SOURCE_UNAVAILABLE" };
    const root = document.documentElement;
    const source = document.querySelector<HTMLTextAreaElement>("textarea[data-codearchive-programmers-history-source]");
    if (root?.dataset.codearchiveProgrammersHistoryRequest !== requestStamp) return { status: "SOURCE_UNAVAILABLE" };
    const response = root?.getAttribute("data-codearchive-programmers-history-response") ?? "";
    if (response.startsWith(`${requestStamp}:`) && source?.dataset.codearchiveProgrammersHistoryUri === uri &&
        source.dataset.codearchiveProgrammersHistoryRequest === requestStamp && typeof source.value === "string" &&
        source.value.trim() && source.value.length <= 1_000_000) return { status: "DONE", sourceCode: source.value };
    await sleep(PROGRAMMERS_AUXILIARY_WAIT_MS);
  }
  return { status: "SOURCE_UNAVAILABLE" };
}

/** Read-only auxiliary lesson operation. It never sends a runtime store command. */
export async function readProgrammersAuxiliaryLesson(document: Document, location: Location, message: {
  lessonUrl: unknown; mode: unknown; submissionId?: unknown;
}, services: ProgrammersAuxiliaryServices = {}): Promise<ProgrammersAuxiliaryResponse> {
  const lessonUrl = typeof message.lessonUrl === "string" ? canonicalProgrammersLessonUrl(message.lessonUrl) : null;
  const currentUrl = canonicalProgrammersLessonUrl(location);
  if (!lessonUrl || !currentUrl || lessonUrl !== currentUrl) return { status: "TAB_NOT_FOUND" };
  if (message.mode !== "preview" && message.mode !== "import") return { status: "BAD_REQUEST" };
  if (message.mode === "import" && typeof message.submissionId !== "string") return { status: "BAD_REQUEST" };
  const selectedAccount = message.mode === "import" ? programmersHistoricalSubmissionAccount(message.submissionId) : null;

  const unsupported = unsupportedProgrammersSqlHistory(document, location);
  if (unsupported) {
    if (message.mode === "import" && unsupported.accountId !== selectedAccount) return { status: "OWNERSHIP_UNVERIFIED" };
    return { status: "UNSUPPORTED_HISTORY", ...unsupported, candidates: [] };
  }

  const history = await collectProgrammersLessonHistory(document, location, services);
  if (!programmersAuxiliaryRouteCurrent(location, lessonUrl)) return { status: "TAB_NOT_FOUND" };
  const observedAccount = authenticatedProgrammersUserId(document, location);
  if (message.mode === "import" && observedAccount !== null && selectedAccount !== observedAccount) return { status: "OWNERSHIP_UNVERIFIED" };
  if (history.status === "EMPTY") {
    if (message.mode === "import" && selectedAccount !== history.accountId) return { status: "OWNERSHIP_UNVERIFIED" };
    return { status: "EMPTY", accountId: history.accountId, lessonId: history.lessonId, title: history.title, candidates: [] };
  }
  if (history.status === "OWNERSHIP_UNVERIFIED" || history.status === "PENDING") return { status: "OWNERSHIP_UNVERIFIED" };
  if (history.status === "INCOMPLETE") return { status: "HISTORY_INCOMPLETE" };
  if (history.status === "AMBIGUOUS") return { status: "AMBIGUOUS_HISTORY" };
  if (history.status !== "READY") return { status: "HISTORY_INCOMPLETE" };
  const readyHistory = history;
  if (message.mode === "preview") return { status: "READY", accountId: readyHistory.accountId, lessonId: readyHistory.lessonId, title: readyHistory.title,
    candidates: readyHistory.candidates.map(programmersCandidateView) };

  if (!selectedAccount || selectedAccount !== readyHistory.accountId) return { status: "OWNERSHIP_UNVERIFIED" };
  const matches = readyHistory.candidates.filter(candidate => candidate.submissionId === message.submissionId);
  if (matches.length !== 1) return { status: "STALE_SUBMISSION" };
  const target = matches[0]!;
  const livePage = await openProgrammersHistoryPage(document, location, target.page, readyHistory.accountId, readyHistory.lessonId, readyHistory.title, services);
  if (!programmersAuxiliaryRouteCurrent(location, lessonUrl)) return { status: "TAB_NOT_FOUND" };
  if (livePage.status !== "READY") return livePage.status === "OWNERSHIP_UNVERIFIED" ? { status: "OWNERSHIP_UNVERIFIED" } : livePage.status === "AMBIGUOUS" ? { status: "AMBIGUOUS_HISTORY" } : { status: "SOURCE_UNAVAILABLE" };
  const liveMatches = livePage.candidates.filter(candidate => candidate.submissionId === target.submissionId);
  if (liveMatches.length !== 1 || !sameProgrammersSubmission(target, liveMatches[0]!)) return { status: "STALE_SUBMISSION" };
  const liveTarget = liveMatches[0]!;
  // The native toggle lives in the row's column wrapper. Clicking the outer
  // metadata container does not dispatch an event to its child controls.
  if (!selectedProgrammersHistoryEditorUri(liveTarget.row)) {
    const toggles = [...liveTarget.row.querySelectorAll<HTMLElement>('[class*="ListItemColumnWrapper"]')].filter(child => child.parentElement === liveTarget.row);
    if (toggles.length !== 1) return { status: "SOURCE_UNAVAILABLE" };
    toggles[0]!.click();
  }
  let selected: ProgrammersLessonSubmission | null = null;
  let uri: string | null = null;
  const sleep = services.sleep ?? (delayMs => new Promise<void>(resolve => setTimeout(resolve, delayMs)));
  for (let attempt = 0; attempt < (services.attempts ?? 100); attempt += 1) {
    if (!programmersAuxiliaryRouteCurrent(location, lessonUrl)) return { status: "TAB_NOT_FOUND" };
    const state = readProgrammersLessonHistory(document, location);
    if (state.status === "OWNERSHIP_UNVERIFIED") return { status: "OWNERSHIP_UNVERIFIED" };
    if (state.status !== "READY") return { status: "SOURCE_UNAVAILABLE" };
    if (state.accountId !== readyHistory.accountId || state.lessonId !== readyHistory.lessonId || state.title !== readyHistory.title)
      return { status: "OWNERSHIP_UNVERIFIED" };
    const selectedMatches = state.candidates.filter(candidate => candidate.submissionId === target.submissionId);
    if (selectedMatches.length !== 1 || !sameProgrammersSubmission(liveTarget, selectedMatches[0]!)) return { status: "STALE_SUBMISSION" };
    selected = selectedMatches[0]!;
    uri = selectedProgrammersHistoryEditorUri(selected.row);
    if (uri) break;
    await sleep(PROGRAMMERS_AUXILIARY_WAIT_MS);
  }
  if (!selected || !uri) return { status: "SOURCE_UNAVAILABLE" };
  const requestStamp = requestProgrammersHistorySource(document, uri, services);
  if (!requestStamp) return { status: "SOURCE_UNAVAILABLE" };
  const source = await waitForProgrammersHistorySource(document, location, lessonUrl, readyHistory.accountId, readyHistory.lessonId, readyHistory.title,
    liveTarget, uri, requestStamp, services);
  if (source.status !== "DONE") return source;
  if (!programmersAuxiliaryRouteCurrent(location, lessonUrl)) return { status: "TAB_NOT_FOUND" };
  const finalState = readProgrammersLessonHistory(document, location);
  if (finalState.status === "OWNERSHIP_UNVERIFIED") return { status: "OWNERSHIP_UNVERIFIED" };
  if (finalState.status !== "READY") return { status: "SOURCE_UNAVAILABLE" };
  if (finalState.accountId !== readyHistory.accountId || finalState.lessonId !== readyHistory.lessonId || finalState.title !== readyHistory.title)
    return { status: "OWNERSHIP_UNVERIFIED" };
  const finalMatches = finalState.candidates.filter(candidate => candidate.submissionId === liveTarget.submissionId);
  if (finalMatches.length !== 1 || !sameProgrammersSubmission(liveTarget, finalMatches[0]!) || selectedProgrammersHistoryEditorUri(finalMatches[0]!.row) !== uri) return { status: "SOURCE_UNAVAILABLE" };
  const capture = createCapture({ platform: "PROGRAMMERS", problemNumber: liveTarget.problemNumber, title: readyHistory.title, problemUrl: lessonUrl,
    language: liveTarget.language, sourceCode: source.sourceCode, result: CAPTURE_RESULT, solvedAt: liveTarget.createdAt, observedAt: new Date(services.now?.() ?? Date.now()),
    historicalImport: true, historicalSubmissionId: liveTarget.submissionId });
  return capture ? { status: "DONE", accountId: readyHistory.accountId, capture } : { status: "SOURCE_UNAVAILABLE" };
}

const STORE_CAPTURE_RETRY_DELAYS_MS = [50, 150, 500] as const;

type SendRuntimeMessage = (message: unknown) => Promise<unknown>;
type Sleep = (delayMs: number) => Promise<void>;

function extensionContextInvalidated(error: unknown): boolean {
  return error instanceof Error && /extension context invalidated/i.test(error.message);
}

export async function storeSweaProblemContext(
  document: Document,
  location: Location,
  send: SendRuntimeMessage = (message) => chrome.runtime.sendMessage(message),
  observedAt = Date.now()
): Promise<boolean> {
  const context = createSweaProblemContext(document, location, observedAt);
  if (!context) return false;
  try {
    const response = await send({ type: "STORE_SWEA_PROBLEM_CONTEXT", context });
    return (response as { ok?: unknown } | null)?.ok === true;
  } catch {
    return false;
  }
}

export async function loadSweaProblemContext(
  sourceUrl: string,
  send: SendRuntimeMessage = (message) => chrome.runtime.sendMessage(message)
): Promise<SweaProblemContext | null | typeof SWEA_CONTEXT_LOOKUP_ERROR> {
  try {
    const response = await send({ type: "GET_SWEA_PROBLEM_CONTEXT", sourceUrl });
    const result = response as { context?: unknown; missing?: unknown; error?: unknown } | null;
    if (!result || result.error !== undefined) return SWEA_CONTEXT_LOOKUP_ERROR;
    const context = result.context;
    if (context === null && result.missing === true) return null;
    return context && typeof context === "object" ? context as SweaProblemContext : SWEA_CONTEXT_LOOKUP_ERROR;
  } catch {
    return SWEA_CONTEXT_LOOKUP_ERROR;
  }
}

/**
 * SWEA can POST from My Page into a query-less detail page and then into a
 * query-less solving page. Those exact same-origin routes are navigation
 * context, not failed canonical-detail lookups. Keep malformed, cross-origin,
 * or contestProbId-bearing conflicts fail-closed while allowing the solving
 * page's own unambiguous DOM identity to be used.
 */
export async function loadSweaProblemContextForReferrer(
  referrer: string,
  send: SendRuntimeMessage = (message) => chrome.runtime.sendMessage(message)
): Promise<SweaProblemContext | null | typeof SWEA_CONTEXT_LOOKUP_ERROR> {
  if (!referrer) return null;
  const detailUrl = normalizeSweaDetailUrl(referrer);
  if (detailUrl) return loadSweaProblemContext(detailUrl, send);
  try {
    const url = new URL(referrer);
    const isQuerylessNavigationRoute = url.searchParams.getAll("contestProbId").length === 0 && (
      url.pathname === SWEA_USER_SUBMISSIONS_PATH ||
      url.pathname === SWEA_SOLVING_PATH ||
      SWEA_PROBLEM_DETAIL_PATHS.some((path) => path === url.pathname)
    );
    if (url.origin === SWEA_ORIGIN && isQuerylessNavigationRoute) return null;
  } catch {
    // An invalid non-empty referrer is conflict evidence, not missing context.
  }
  return SWEA_CONTEXT_LOOKUP_ERROR;
}

/**
 * The service worker can be starting up when the result popup first appears.
 * Keep the same attempt payload and retry a small, bounded number of times;
 * callers consume the attempt only after an explicit positive response.
 */
export async function storeCaptureWithRetry(
  capture: Capture,
  send: SendRuntimeMessage = (message) => chrome.runtime.sendMessage(message),
  sleep: Sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))
): Promise<unknown> {
  // Keep the site's exact language through submission verification, then store
  // Java versions under one name across all platforms.
  const storedCapture = canonicalLanguageKey(capture.language) === "java"
    ? { ...capture, language: "Java", languageKey: "java" }
    : capture;
  let response: unknown;
  for (let attempt = 0; attempt <= STORE_CAPTURE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      response = await send({ type: "STORE_CAPTURE", capture: storedCapture });
      if ((response as { ok?: unknown } | null)?.ok === true) return response;
    } catch (error) {
      // Reloading an unpacked extension permanently invalidates the old tab's
      // content-script context. Retrying that context cannot reach the worker.
      if (extensionContextInvalidated(error)) return undefined;
      response = undefined;
    }

    const delay = STORE_CAPTURE_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await sleep(delay);
  }
  return response;
}

export function startCapture(adapter: PlatformAdapter, document: Document, send: SendRuntimeMessage): void {
  document.documentElement?.setAttribute("data-codearchive-content-build", BUILD_METADATA.buildId);
  let processing = false;
  let invalidated = false;
  let checkScheduled = false;
  let checkAfterProcessing = false;
  let resultPoll: ReturnType<typeof setInterval> | null = null;
  let observer: MutationObserver | null = null;
  let activeAttemptId: string | null = null;

  function markCaptureStage(stage: string, attemptId: string | null = activeAttemptId): void {
    if ((adapter.platform !== "PROGRAMMERS" && adapter.platform !== "JUNGOL") || (attemptId && attemptId !== activeAttemptId)) return;
    // A non-sensitive, page-local diagnostic for the next real submission.
    // Never include source, identity, capture IDs, or runtime error messages.
    document.documentElement?.setAttribute("data-codearchive-capture-stage", stage);
  }

  function stopInvalidatedContext(): void {
    if (invalidated) return;
    invalidated = true;
    markCaptureStage("context-invalidated");
    if (resultPoll !== null) clearInterval(resultPoll);
    resultPoll = null;
    observer?.disconnect();
    const root = document.body ?? document.documentElement;
    if (!root || document.getElementById("codearchive-reload-required")) return;
    const notice = document.createElement("div");
    notice.id = "codearchive-reload-required";
    notice.setAttribute("role", "alert");
    notice.style.cssText = "position:fixed;z-index:2147483647;bottom:16px;left:16px;right:16px;padding:14px 18px;background:#fff4e5;color:#442b08;border:2px solid #c77700;border-radius:8px;font:14px/1.5 sans-serif;box-shadow:0 4px 16px #0003";
    notice.textContent = "CodeArchive 확장 프로그램이 갱신되어 이 탭의 자동 수집이 중단되었습니다. 코드와 저장 여부를 확인한 뒤 이 문제 탭을 새로고침하고 다시 제출해 주세요.";
    root.prepend(notice);
  }

  async function sendTracked(message: unknown): Promise<unknown> {
    try {
      return await send(message);
    } catch (error) {
      if (extensionContextInvalidated(error)) stopInvalidatedContext();
      throw error;
    }
  }

  function reportProgress(attemptId: string | null, phase: "CAPTURING" | "SAVING" | "CLEAR"): void {
    if (!attemptId || invalidated) return;
    const problem = adapter.detectProblem();
    if (phase === "CAPTURING" && !problem) return;
    void sendTracked({
      type: "SET_SUBMISSION_PROGRESS", attemptId, platform: adapter.platform, phase,
      ...(problem ? { problemNumber: problem.problemNumber, title: problem.title } : {})
    }).catch(() => undefined);
  }

  function ensureResultPoll(): void {
    if (invalidated || !adapter.hasPendingSubmissionAttempt || resultPoll !== null) return;
    resultPoll = setInterval(() => {
      if (!adapter.hasPendingSubmissionAttempt?.()) {
        clearInterval(resultPoll!);
        resultPoll = null;
        reportProgress(activeAttemptId, "CLEAR");
        if (document.documentElement?.getAttribute("data-codearchive-capture-stage") !== "store-acknowledged") {
          markCaptureStage("result-timeout");
        }
        activeAttemptId = null;
        return;
      }
      scheduleCaptureCheck();
    }, 300);
  }

  const runCaptureCheck = async (): Promise<void> => {
    if (invalidated) return;
    if (processing) {
      checkAfterProcessing = true;
      return;
    }
    const collected = collectAcceptedCaptureAttempt(adapter);
    if (!collected) return;
    const progressAttemptId = activeAttemptId;

    markCaptureStage("accepted", progressAttemptId);

    processing = true;
    try {
      if (adapter.confirmCaptureAsync) {
        const confirmed = await adapter.confirmCaptureAsync(collected.capture, collected.detection);
        if (!confirmed) {
          markCaptureStage("result-unverified", progressAttemptId);
          return;
        }
        Object.assign(collected.capture, confirmed);
      }
      reportProgress(progressAttemptId, "SAVING");
      markCaptureStage("saving", progressAttemptId);
      if (
        adapter.collectPerformanceAsync &&
        collected.capture.executionTime === undefined &&
        collected.capture.memoryValue === undefined
      ) {
        try {
          const performance = await adapter.collectPerformanceAsync(collected.capture);
          if (performance) Object.assign(collected.capture, performance);
        } catch {
          // Optional metrics must never prevent the accepted source capture.
        }
      }
      const response = await storeCaptureWithRetry(collected.capture, sendTracked);
      // A capture is consumed only after the service worker confirms local
      // persistence. Storage or channel failures remain retryable.
      if ((response as { ok?: unknown } | null)?.ok === true) {
        adapter.consumeSubmissionResult(collected.detection);
        markCaptureStage("store-acknowledged", progressAttemptId);
      } else {
        markCaptureStage("store-unavailable", progressAttemptId);
      }
      reportProgress(progressAttemptId, "CLEAR");
      if (activeAttemptId === progressAttemptId) activeAttemptId = null;
    } finally {
      processing = false;
      if (checkAfterProcessing) {
        checkAfterProcessing = false;
        scheduleCaptureCheck();
      }
    }
  };

  function scheduleCaptureCheck(): void {
    if (invalidated) return;
    if (processing) {
      checkAfterProcessing = true;
      return;
    }
    if (checkScheduled) return;
    checkScheduled = true;
    // Several platform mutations arrive in one render turn. One microtask
    // keeps detection bounded without delaying the accepted-result capture.
    queueMicrotask(() => {
      checkScheduled = false;
      void runCaptureCheck();
    });
  }

  document.addEventListener(
    "click",
    (event) => {
      if (invalidated) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      let current: Element | null = target;
      while (current) {
        if (adapter.isSubmitControl(current)) {
          if ((adapter.platform === "JUNGOL" || adapter.platform === "PROGRAMMERS") && !adapter.detectProblem()) break;
          // The MAIN-world document_start listener runs before this isolated
          // document_idle listener and synchronously updates the platform's
          // source textarea at this click boundary.
          adapter.beginSubmissionAttempt(new Date());
          activeAttemptId = crypto.randomUUID();
          if (adapter.platform === "PROGRAMMERS" || adapter.platform === "JUNGOL") {
            const snapshot = adapter.getSubmissionSnapshot?.();
            markCaptureStage(!snapshot?.problem || !snapshot.editor ? "snapshot-missing" : "waiting-result");
          }
          reportProgress(activeAttemptId, "CAPTURING");
          ensureResultPoll();
          scheduleCaptureCheck();
          break;
        }
        current = current.parentElement;
      }
    },
    true
  );

  document.defaultView?.addEventListener("pagehide", () => {
    reportProgress(activeAttemptId, "CLEAR");
    activeAttemptId = null;
  });

  const root = document.body ?? document.documentElement;
  if (root) {
    observer = new MutationObserver(() => {
      if (adapter.platform === "SWEA" || adapter.hasPendingSubmissionAttempt?.()) scheduleCaptureCheck();
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-modal"]
    });
  }
}

export async function bootstrapContent(
  document: Document,
  location: Location,
  referrer: string,
  send: SendRuntimeMessage = (message) => chrome.runtime.sendMessage(message)
): Promise<void> {
  if (location.origin === SWEA_ORIGIN && location.pathname === SWEA_USER_SUBMISSIONS_PATH) {
    return;
  }
  const detailContext = createSweaProblemContext(document, location);
  if (detailContext) {
    await storeSweaProblemContext(document, location, send, detailContext.observedAt);
    return;
  }

  let sweaProblemUrl: string | null = null;
  let allowSweaQuerylessFallback = true;
  if (location.origin === SWEA_ORIGIN && location.pathname === SWEA_SOLVING_PATH) {
    const storedContext = await loadSweaProblemContextForReferrer(referrer, send);
    const resolution = resolveSweaProblem(document, location, referrer, storedContext);
    sweaProblemUrl = resolution.problemUrl;
    allowSweaQuerylessFallback = resolution.kind === "missing";
  }

  const adapter = createAdapter(document, location, sweaProblemUrl, allowSweaQuerylessFallback);
  if (adapter) startCapture(adapter, document, send);
}

type JungolScanState =
  | { status: "SCANNING"; progress: JungolHistoryScanProgress }
  | JungolHistoryPreview
  | { status: "SCAN_INCOMPLETE" | "SCAN_FAILED" };
type JungolImportState = {
  status: "IMPORTING" | "CANCELLING" | "DONE" | "FAILED" | "INTERRUPTED";
  completed: number; total: number; saved: number; duplicate: number; skipped: number;
  startedAt?: number; endedAt?: number; lastProgressAt?: number; timingSample?: HistoricalTimingSample;
  /** Unique JUNGOL/problemNumber identities whose local store settled. */
  problemCount?: number; submissionCount?: number;
  failureReason?: HistoricalImportFailureReason;
};
type JungolLocalTaskState = (JungolScanState | JungolImportState) & {
  startedAt?: number; endedAt?: number; lastProgressAt?: number;
};
type JungolLocalTask = { url: string; state: JungolLocalTaskState; cancelling: boolean;
  startedAt: number; endedAt?: number; completedProblemKeys?: Set<string> };
let jungolScan: { url: string; table: Element | null; state: JungolScanState;
  onState?: (state: JungolScanState) => void } | null = null;
let jungolLocalTask: JungolLocalTask | null = null;
let jungolImportController: HistoricalTaskController<JungolHistoryCandidate> | null = null;
// Controller state is only meaningful for the task that created it. A later
// explicit scan must not inherit a completed import's terminal status.
let jungolImportOwner: object | null = null;
type ExternalHistoryScanProgress = Omit<JungolHistoryScanProgress, "phase" | "stage"> & {
  phase: "pages" | "histories";
  stage: "reading-pages" | "reading-histories";
  historiesRead?: number;
  historiesTotal?: number;
  currentProblemNumber?: string;
};
let sweaState: { status: string; verificationFailures?: Record<string, number>; failureReason?: string; failurePage?: number; failedProblemNumber?: string; candidates?: SweaHistoryCandidate[]; completed?: number; total?: number; saved?: number; duplicate?: number; skipped?: number; startedAt?: number; endedAt?: number; lastProgressAt?: number; progress?: ExternalHistoryScanProgress; problemCount?: number; submissionCount?: number; timingSample?: HistoricalTimingSample } = { status: "SCAN_IDLE" };
let sweaController: HistoricalTaskController<SweaHistoryCandidate> | null = null;
let sweaGeneration = 0;
let sweaScanIdentity: ReturnType<typeof authenticatedSweaHistoryIdentity> = null;
let sweaSourceUrl = "";

function sweaStatus(): typeof sweaState { return sweaController?.state ? { ...sweaController.state, verificationFailures: sweaState.verificationFailures, ...(sweaState.problemCount === undefined ? {} : { problemCount: sweaState.problemCount, submissionCount: sweaState.submissionCount, timingSample: sweaState.timingSample }) } : sweaState; }
function startSweaScan(document: Document, location: Location): typeof sweaState {
  if (sweaController?.isActive || sweaState.status === "SCANNING") return sweaStatus();
  const generation = ++sweaGeneration, sourceUrl = location.href, identity = authenticatedSweaHistoryIdentity(document, location);
  if (!identity) return { status: "OWNERSHIP_UNVERIFIED" };
  sweaController = null; sweaScanIdentity = identity; sweaSourceUrl = sourceUrl;
  sweaState = { status: "SCANNING", startedAt: Date.now(), progress: { phase: "pages", stage: "reading-pages", rows: 0, pagesLoaded: 0, groupsExpanded: 0, groupsTotal: 0, groupsTotalKnown: false, lastProgressAt: Date.now(), sourceVisibility: "unknown" } };
  void loadSweaHistoryPreview(document, location, fetch, value => {
    if (generation === sweaGeneration && sweaState.status === "SCANNING") sweaState = { ...sweaState, progress: { phase: value.historiesTotal === undefined ? "pages" : "histories", stage: value.historiesTotal === undefined ? "reading-pages" : "reading-histories", rows: value.problems, pagesLoaded: value.pages, groupsExpanded: 0, groupsTotal: 0, groupsTotalKnown: false, historiesRead: value.historiesRead, historiesTotal: value.historiesTotal, lastProgressAt: Date.now(), sourceVisibility: document.visibilityState === "hidden" ? "hidden" : "visible" } };
  }, () => generation === sweaGeneration && sweaState.status === "SCANNING" && location.href === sourceUrl && (() => { const current = authenticatedSweaHistoryIdentity(document, location); return !!current && current.userId === identity.userId && current.nickname === identity.nickname; })()).then(result => {
    if (generation !== sweaGeneration) return;
    if (result.status === "READY") sweaState = { status: "READY", candidates: result.candidates, skipped: result.skipped, startedAt: sweaState.startedAt, endedAt: Date.now() };
    else { sweaScanIdentity = null; sweaSourceUrl = ""; sweaState = { ...sweaState, status: result.status, failureReason: result.failureReason, failurePage: result.failurePage, failedProblemNumber: result.failedProblemNumber, endedAt: Date.now() }; }
  }).catch(() => { if (generation === sweaGeneration) { sweaScanIdentity = null; sweaSourceUrl = ""; sweaState = { status: "FAILED", startedAt: sweaState.startedAt, endedAt: Date.now() }; } });
  return sweaState;
}
function startSweaImport(document: Document, location: Location, ids: unknown): typeof sweaState {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5_000 || ids.some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{8,160}$/.test(id)) || sweaController?.isActive) return { status: "FAILED" };
  const candidates = ids.map(id => sweaState.candidates?.find(candidate => candidate.submissionId === id));
  const identity = authenticatedSweaHistoryIdentity(document, location);
  if (!identity || !sweaScanIdentity || location.href !== sweaSourceUrl || identity.userId !== sweaScanIdentity.userId || identity.nickname !== sweaScanIdentity.nickname || candidates.some(candidate => !candidate)) return { status: "INTERRUPTED" };
  const controller = new HistoricalTaskController<SweaHistoryCandidate>(); sweaController = controller;
  const generation = ++sweaGeneration;
  const completedProblems = new Set<string>();
  const verificationFailures: Record<string, number> = {};
  sweaState.verificationFailures = verificationFailures;
  controller.start(candidates as SweaHistoryCandidate[], async (candidate, mayStore) => {
    const currentIdentity = authenticatedSweaHistoryIdentity(document, location);
    if (!mayStore() || !currentIdentity || currentIdentity.userId !== identity.userId || currentIdentity.nickname !== identity.nickname) { controller.cancel(); return { saved: 0, duplicate: 0, skipped: 0 }; }
    const hydrated = await hydrateSweaCandidateResult(candidate, identity);
    const beforeStore = authenticatedSweaHistoryIdentity(document, location);
    if (!mayStore() || !beforeStore || beforeStore.userId !== identity.userId || beforeStore.nickname !== identity.nickname) { controller.cancel(); return { saved: 0, duplicate: 0, skipped: 0 }; }
    if (hydrated.status === "OWNERSHIP_UNVERIFIED" || hydrated.status === "TAB_NOT_FOUND") { controller.cancel(); return { saved: 0, duplicate: 0, skipped: 0 }; }
    if (hydrated.status !== "DONE" || !hydrated.capture) {
      const reason = hydrated.status === "SOURCE_UNAVAILABLE" ? hydrated.verificationFailure ?? "source" : "source";
      verificationFailures[reason] = (verificationFailures[reason] ?? 0) + 1;
      return { saved: 0, duplicate: 0, skipped: 1, failedSubmissionId: candidate.submissionId };
    }
    const capture = hydrated.capture;
    try { const response = await chrome.runtime.sendMessage({ type: "STORE_HISTORICAL_CAPTURE", capture }); if (!(response as { ok?: boolean })?.ok) throw new HistoricalImportFailure("STORE_REJECTED"); if ((response as { reconciliation?: string }).reconciliation === "ambiguous") return { saved: 0, duplicate: 0, skipped: 1, failedSubmissionId: candidate.submissionId }; return { saved: (response as { created?: boolean }).created ? 1 : 0, duplicate: (response as { created?: boolean }).created ? 0 : 1, skipped: 0 }; }
    catch (error) { if (error instanceof HistoricalImportFailure) throw error; throw new HistoricalImportFailure("STORE_FAILED"); }
  }, (candidate, result) => { if (result.saved + result.duplicate > 0) completedProblems.add(`SWEA:${candidate.problemNumber}`); }, candidate => candidate.submissionId);
  void controller.settled().then(() => {
    if (generation !== sweaGeneration || sweaController !== controller || !controller.state) return;
    const timingSample = timingSampleFromCompletedTask(controller.state, "SWEA");
    sweaState = { ...controller.state, verificationFailures, problemCount: completedProblems.size, submissionCount: controller.state.saved + controller.state.duplicate,
      ...(timingSample ? { timingSample } : {}) };
    if (timingSample && chrome.storage?.local) void persistHistoricalTimingSample(chrome.storage.local, timingSample).catch(() => undefined);
  });
  return sweaStatus();
}

type ProgrammersLocalCandidate = { difficulty?: ProblemDifficulty; submissionId: string; problemNumber: string; title: string; language: string; createdAt: string; lessonUrl: string; order: number };
type ProgrammersLocalState = { status: string; candidates?: ProgrammersLocalCandidate[]; truncated?: false; skipped?: number;
  unsupportedProblemNumbers?: string[];
  progress?: ExternalHistoryScanProgress; completed?: number; total?: number; saved?: number; duplicate?: number; problemCount?: number;
  submissionCount?: number; startedAt?: number; endedAt?: number; timingSample?: HistoricalTimingSample; failedSubmissionIds?: string[]; failureReason?: string };
let programmersLocalState: ProgrammersLocalState = { status: "SCAN_IDLE" };
let programmersLocalController: HistoricalTaskController<ProgrammersLocalCandidate> | null = null;
let programmersLocalGeneration = 0;
let programmersLocalSourceUrl = "";
let programmersLocalAccountId: string | null = null;

function normalizedProgrammersTitle(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function programmersSourceCurrent(location: Location): boolean {
  return !!programmersLocalSourceUrl && sameHistorySource(programmersLocalSourceUrl, location.href, "PROGRAMMERS");
}
function programmersLocalStatus(): ProgrammersLocalState {
  if (!programmersLocalController?.state) return programmersLocalState;
  const state = programmersLocalController.state;
  return { ...programmersLocalState, ...state,
    ...(programmersLocalState.problemCount === undefined ? {} : { problemCount: programmersLocalState.problemCount, submissionCount: programmersLocalState.submissionCount, timingSample: programmersLocalState.timingSample }) };
}
function programmersProgress(pagesLoaded: number, historiesRead: number, historiesTotal: number, rows = historiesTotal, currentProblemNumber?: string): ExternalHistoryScanProgress {
  return { phase: historiesTotal > 0 ? "histories" : "pages", stage: historiesTotal > 0 ? "reading-histories" : "reading-pages", rows, pagesLoaded, currentProblemNumber,
    groupsExpanded: 0, groupsTotal: 0, groupsTotalKnown: false, historiesRead: historiesTotal > 0 ? historiesRead : undefined,
    historiesTotal: historiesTotal > 0 ? historiesTotal : undefined, lastProgressAt: Date.now(), sourceVisibility: "unknown" };
}
async function waitForProgrammersListingPage(document: Document, location: Location, expectedPage: number, priorSignature: string,
  generation: number): Promise<ReturnType<typeof readProgrammersSolvedListingPage>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (generation !== programmersLocalGeneration || !programmersSourceCurrent(location)) return { status: "OWNERSHIP_UNVERIFIED" };
    const current = readProgrammersSolvedListingPage(document, location);
    if (current.status === "READY" && current.page === expectedPage && current.signature !== priorSignature) return current;
    if (current.status === "LOGIN_REQUIRED" || current.status === "OWNERSHIP_UNVERIFIED" || current.status === "INCOMPLETE") return current;
    await new Promise<void>(resolve => setTimeout(resolve, 100));
  }
  return { status: "PENDING" };
}
function validProgrammersAuxiliaryPreview(value: unknown, lesson: { problemNumber: string; title: string; lessonUrl: string }, accountId: string | null):
  { accountId: string; candidates: Array<{ submissionId: string; problemNumber: string; language: string; createdAt: string; score: number }> } | null {
  if (!value || typeof value !== "object" || (value as { ok?: unknown }).ok !== true) return null;
  const response = (value as { result?: unknown }).result as { status?: unknown; accountId?: unknown; lessonId?: unknown; title?: unknown; candidates?: unknown } | null;
  if (!response) return null;
  if (response.status === "EMPTY" || response.status === "UNSUPPORTED_HISTORY") return typeof response.accountId === "string" && /^\d{1,40}$/.test(response.accountId) && (accountId === null || response.accountId === accountId) &&
    response.lessonId === lesson.problemNumber && typeof response.title === "string" && normalizedProgrammersTitle(response.title) === lesson.title
    ? { accountId: response.accountId, candidates: [] } : null;
  if (response.status !== "READY" || typeof response.accountId !== "string" || !/^\d{1,40}$/.test(response.accountId) ||
      response.lessonId !== lesson.problemNumber || typeof response.title !== "string" || normalizedProgrammersTitle(response.title) !== lesson.title ||
      !Array.isArray(response.candidates) || (accountId !== null && response.accountId !== accountId)) return null;
  const seen = new Set<string>();
  const candidates: Array<{ submissionId: string; problemNumber: string; language: string; createdAt: string; score: number }> = [];
  for (const item of response.candidates) {
    if (!item || typeof item !== "object") return null;
    const candidate = item as { submissionId?: unknown; problemNumber?: unknown; language?: unknown; createdAt?: unknown; score?: unknown };
    if (!isHistoricalSubmissionId("PROGRAMMERS", candidate.submissionId) || programmersHistoricalSubmissionAccount(candidate.submissionId) !== response.accountId || candidate.problemNumber !== lesson.problemNumber ||
        typeof candidate.language !== "string" || !candidate.language.trim() || typeof candidate.createdAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/.test(candidate.createdAt) || candidate.score !== 100 || seen.has(candidate.submissionId)) return null;
    seen.add(candidate.submissionId); candidates.push({ submissionId: candidate.submissionId, problemNumber: candidate.problemNumber, language: candidate.language,
      createdAt: candidate.createdAt, score: candidate.score });
  }
  return { accountId: response.accountId, candidates };
}

function startProgrammersScan(document: Document, location: Location): ProgrammersLocalState {
  if (programmersLocalState.status === "SCANNING" || programmersLocalController?.isActive) return programmersLocalStatus();
  const initial = readProgrammersSolvedListingPage(document, location);
  if (initial.status !== "READY") return { status: initial.status };
  const generation = ++programmersLocalGeneration;
  programmersLocalController = null; programmersLocalSourceUrl = location.href; programmersLocalAccountId = null;
  programmersLocalState = { status: "SCANNING", startedAt: Date.now(), progress: programmersProgress(0, 0, 0) };
  void (async () => {
    const lessons: Array<{ difficulty?: ProblemDifficulty; problemNumber: string; title: string; lessonUrl: string; order: number }> = [];
    const seenLessons = new Set<string>();
    let current: ReturnType<typeof readProgrammersSolvedListingPage> = initial;
    if (current.page !== 1) {
      const first = document.querySelectorAll<HTMLButtonElement>("button[aria-label='처음 페이지']");
      if (first.length !== 1 || first[0]!.disabled) throw new HistoricalImportFailure("LIST_CHANGED");
      const priorSignature = current.signature;
      first[0]!.click();
      current = await waitForProgrammersListingPage(document, location, 1, priorSignature, generation);
    }
    for (let guard = 0; guard < 10_000; guard += 1) {
      if (generation !== programmersLocalGeneration || !programmersSourceCurrent(location)) throw new HistoricalImportFailure("LIST_CHANGED");
      if (current.status !== "READY" || current.page !== guard + 1 || (guard && current.total !== initial.total)) throw new HistoricalImportFailure("LIST_CHANGED");
      for (const lesson of current.lessons) {
        if (seenLessons.has(lesson.problemNumber)) throw new HistoricalImportFailure("LIST_CHANGED");
        seenLessons.add(lesson.problemNumber); lessons.push(lesson);
      }
      programmersLocalState = { ...programmersLocalState, progress: programmersProgress(current.page, 0, 0, lessons.length) };
      if (current.nextDisabled) {
        if (lessons.length !== initial.total) throw new HistoricalImportFailure("LIST_CHANGED");
        break;
      }
      const next = document.querySelectorAll<HTMLButtonElement>("button[aria-label='다음 페이지']");
      if (next.length !== 1) throw new HistoricalImportFailure("LIST_CHANGED");
      const priorPage = current.page;
      const priorSignature = current.signature;
      next[0]!.click();
      current = await waitForProgrammersListingPage(document, location, priorPage + 1, priorSignature, generation);
    }
    const candidates: ProgrammersLocalCandidate[] = [];
    const unsupportedProblemNumbers: string[] = [];
    let accountId: string | null = null;
    for (const lesson of lessons) {
      if (generation !== programmersLocalGeneration || !programmersSourceCurrent(location)) throw new HistoricalImportFailure("LIST_CHANGED");
      programmersLocalState = { ...programmersLocalState, progress: programmersProgress(Math.ceil(initial.total / 20), lesson.order, lessons.length, lessons.length, lesson.problemNumber) };
      const response = await chrome.runtime.sendMessage({ type: "PROGRAMMERS_AUX_READ", lessonUrl: lesson.lessonUrl, mode: "preview" });
      if (generation !== programmersLocalGeneration || !programmersSourceCurrent(location)) throw new HistoricalImportFailure("LIST_CHANGED");
      if ((response as { ok?: unknown; error?: unknown } | null)?.ok !== true && /INTERRUPTED|UNAUTHORIZED|REDIRECTED/.test(String((response as { error?: unknown } | null)?.error ?? "")))
        throw new HistoricalImportFailure("LIST_CHANGED");
      const parsed = validProgrammersAuxiliaryPreview(response, lesson, accountId);
      if (!parsed) throw new HistoricalImportFailure("DETAIL_UNVERIFIED");
      accountId ??= parsed.accountId;
      if (parsed.accountId !== accountId) throw new HistoricalImportFailure("DETAIL_UNVERIFIED");
      if ((response as { result?: { status?: string } }).result?.status === "UNSUPPORTED_HISTORY") unsupportedProblemNumbers.push(lesson.problemNumber);
      for (const candidate of parsed.candidates) candidates.push({ ...candidate, difficulty: lesson.difficulty, title: lesson.title, lessonUrl: lesson.lessonUrl, order: lesson.order });
      programmersLocalState = { ...programmersLocalState, progress: programmersProgress(Math.ceil(initial.total / 20), lesson.order + 1, lessons.length) };
    }
    if (generation !== programmersLocalGeneration) return;
    programmersLocalAccountId = accountId;
    programmersLocalState = { status: "READY", candidates, unsupportedProblemNumbers, truncated: false, skipped: 0, startedAt: programmersLocalState.startedAt, endedAt: Date.now() };
  })().catch(error => {
    if (generation !== programmersLocalGeneration) return;
    programmersLocalState = { status: error instanceof HistoricalImportFailure && error.reason === "LIST_CHANGED" ? "INTERRUPTED" : "SCAN_INCOMPLETE",
      startedAt: programmersLocalState.startedAt, endedAt: Date.now() };
  });
  return programmersLocalState;
}

function startProgrammersImport(document: Document, location: Location, ids: unknown): ProgrammersLocalState {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5_000 || ids.some(id => !isHistoricalSubmissionId("PROGRAMMERS", id)) || new Set(ids).size !== ids.length) return { status: "FAILED" };
  if (programmersLocalController?.isActive || !programmersSourceCurrent(location) || programmersLocalState.status !== "READY") return { status: "INTERRUPTED" };
  const selected = ids.map(id => programmersLocalState.candidates?.find(candidate => candidate.submissionId === id));
  if (selected.some(candidate => !candidate)) return { status: "FAILED" };
  const generation = ++programmersLocalGeneration;
  const controller = new HistoricalTaskController<ProgrammersLocalCandidate>(); programmersLocalController = controller;
  const unsupportedProblemNumbers = programmersLocalState.unsupportedProblemNumbers;
  const completedProblems = new Set<string>();
  controller.start(selected as ProgrammersLocalCandidate[], async (candidate, mayStore) => {
    if (!mayStore() || generation !== programmersLocalGeneration || !programmersSourceCurrent(location)) { controller.cancel(); return { saved: 0, duplicate: 0, skipped: 0 }; }
    let response: unknown;
    try { response = await chrome.runtime.sendMessage({ type: "PROGRAMMERS_AUX_READ", lessonUrl: candidate.lessonUrl, mode: "import", submissionId: candidate.submissionId }); }
    catch { return { saved: 0, duplicate: 0, skipped: 1, failedSubmissionId: candidate.submissionId }; }
    if (!mayStore() || generation !== programmersLocalGeneration || !programmersSourceCurrent(location)) { controller.cancel(); return { saved: 0, duplicate: 0, skipped: 0 }; }
    const envelope = response as { ok?: unknown; error?: unknown; result?: unknown } | null;
    if (envelope?.ok !== true) {
      if (envelope && typeof envelope.error === "string" && /INTERRUPTED|UNAUTHORIZED|REDIRECTED/.test(envelope.error)) { controller.cancel(); return { saved: 0, duplicate: 0, skipped: 0 }; }
      return { saved: 0, duplicate: 0, skipped: 1, failedSubmissionId: candidate.submissionId };
    }
    const result = envelope.result as { status?: unknown; accountId?: unknown; capture?: unknown } | null;
    if (result?.status === "OWNERSHIP_UNVERIFIED" || result?.status === "TAB_NOT_FOUND") {
      controller.cancel();
      return { saved: 0, duplicate: 0, skipped: 0 };
    }
    if (result?.status !== "DONE") return { saved: 0, duplicate: 0, skipped: 1, failedSubmissionId: candidate.submissionId };
    if (result.accountId !== programmersLocalAccountId || !isCaptureRecord(result.capture)) { controller.cancel(); return { saved: 0, duplicate: 0, skipped: 0 }; }
    const capture = { ...result.capture, ...(candidate.difficulty ? { difficulty: candidate.difficulty } : {}) };
    if (capture.platform !== "PROGRAMMERS" || capture.historicalImport !== true || capture.historicalSubmissionId !== candidate.submissionId ||
        capture.problemNumber !== candidate.problemNumber || normalizedProgrammersTitle(capture.title) !== candidate.title || capture.language !== candidate.language ||
        capture.solvedAt !== new Date(candidate.createdAt).toISOString()) { controller.cancel(); return { saved: 0, duplicate: 0, skipped: 0 }; }
    try {
      const stored = await chrome.runtime.sendMessage({ type: "STORE_HISTORICAL_CAPTURE", capture }) as { ok?: unknown; created?: unknown; reconciliation?: string };
      if (stored?.ok !== true) throw new HistoricalImportFailure("STORE_REJECTED");
      if (stored.reconciliation === "ambiguous") return { saved: 0, duplicate: 0, skipped: 1, failedSubmissionId: candidate.submissionId };
      return { saved: stored.created === true ? 1 : 0, duplicate: stored.created === true ? 0 : 1, skipped: 0 };
    } catch (error) { if (error instanceof HistoricalImportFailure) throw error; throw new HistoricalImportFailure("STORE_FAILED"); }
  }, (candidate, result) => { if (result.saved + result.duplicate) completedProblems.add(`PROGRAMMERS:${candidate.problemNumber}`); }, candidate => candidate.submissionId);
  programmersLocalState = { status: "IMPORTING", startedAt: Date.now(), unsupportedProblemNumbers };
  void controller.settled().then(() => {
    if (generation !== programmersLocalGeneration || programmersLocalController !== controller || !controller.state) return;
    const timingSample = timingSampleFromCompletedTask(controller.state, "PROGRAMMERS");
    programmersLocalState = { ...controller.state, unsupportedProblemNumbers, problemCount: completedProblems.size, submissionCount: controller.state.saved + controller.state.duplicate,
      ...(timingSample ? { timingSample } : {}) };
    if (timingSample && chrome.storage?.local) void persistHistoricalTimingSample(chrome.storage.local, timingSample).catch(() => undefined);
  });
  return programmersLocalStatus();
}

function cancelProgrammersLocal(): ProgrammersLocalState {
  if (programmersLocalState.status === "SCANNING") programmersLocalGeneration += 1;
  else programmersLocalController?.cancel();
  void chrome.runtime.sendMessage({ type: "PROGRAMMERS_AUX_CANCEL" }).catch(() => undefined);
  if (programmersLocalState.status === "SCANNING") programmersLocalState = { ...programmersLocalState, status: "INTERRUPTED", endedAt: Date.now() };
  return programmersLocalStatus();
}

function emptyLocalState(status: "INTERRUPTED" | "CANCELLING" = "INTERRUPTED"): JungolImportState {
  return { status, completed: 0, total: 0, saved: 0, duplicate: 0, skipped: 0 };
}

function withScanTiming(task: JungolLocalTask, state: JungolScanState): JungolLocalTaskState {
  const visibility = document.visibilityState === "visible" ? "visible" : document.visibilityState === "hidden" ? "hidden" :
    document.visibilityState === "prerender" ? "prerender" : "unknown";
  const current = state.status === "SCANNING"
    ? { ...state, progress: { ...state.progress, sourceVisibility: visibility } } as JungolScanState
    : state;
  const lastProgressAt = current.status === "SCANNING" ? current.progress.lastProgressAt : undefined;
  return { ...current, startedAt: task.startedAt, ...(task.endedAt === undefined ? {} : { endedAt: task.endedAt }),
    ...(lastProgressAt === undefined ? {} : { lastProgressAt }) } as JungolLocalTaskState;
}

function startJungolScan(document: Document, location: Location,
  onState?: (state: JungolScanState) => void): JungolScanState {
  const table = document.querySelector("table");
  // A legacy status read may restart after the site replaces its table. Keep
  // the local task's state receiver so that replacement cannot orphan it.
  const activeLocalReplacement = !!jungolLocalTask && !jungolLocalTask.cancelling &&
    jungolLocalTask.state.status === "SCANNING" && sameHistorySource(jungolLocalTask.url, location.href) &&
    jungolScan?.url === location.href;
  const inheritedOnState = onState ?? (activeLocalReplacement ? jungolScan?.onState : undefined);
  if (jungolScan?.url === location.href && jungolScan.table === table &&
      jungolScan.state.status === "SCANNING") {
    if (onState) jungolScan.onState = onState;
    return jungolScan.state;
  }
  const initial = previewJungolHistory(document, location);
  if (initial.status !== "READY") return initial;
  const url = location.href;
  const progress: JungolHistoryScanProgress = { phase: "pages", stage: "reading-pages",
    rows: document.querySelectorAll("table tr").length, pagesLoaded: 0, groupsExpanded: 0, groupsTotal: 0, groupsTotalKnown: false,
    lastProgressAt: Date.now(), sourceVisibility: document.visibilityState === "visible" ? "visible" :
      document.visibilityState === "hidden" ? "hidden" : document.visibilityState === "prerender" ? "prerender" : "unknown" };
  const run = { url, table, state: { status: "SCANNING", progress } as JungolScanState, onState: inheritedOnState };
  const setState = (state: JungolScanState) => { run.state = state; run.onState?.(state); };
  jungolScan = run;
  void (async () => {
    try {
      let stalledPasses = 0;
      let priorSignature = "";
      for (;;) {
        const result = await loadJungolHistoryPreview(document, location, next => {
          if (jungolScan === run) setState({ status: "SCANNING", progress: next });
        }, 12, 8_000, () => jungolScan === run && document.querySelector("table") === table && location.href === url &&
          (!jungolLocalTask || jungolLocalTask.url !== url || !jungolLocalTask.cancelling));
        if (jungolScan !== run) return;
        if (location.href !== url) {
          setState({ status: "SCAN_INCOMPLETE" });
          return;
        }
        if (result.status !== "READY" || !result.truncated) {
          setState(result);
          return;
        }
        const signature = `${result.candidates.length}:${result.paginationClicks ?? 0}:${result.remainingGroups ?? 0}`;
        stalledPasses = signature === priorSignature ? stalledPasses + 1 : 0;
        priorSignature = signature;
        // Continue delayed pagination/group discovery while it changes. Two
        // complete passes with no movement is a diagnosed site stall.
        if (stalledPasses >= 2) { setState({ status: "SCAN_INCOMPLETE" }); return; }
      }
    } catch {
      if (jungolScan === run) setState({ status: "SCAN_FAILED" });
    }
  })();
  return run.state;
}

function localTaskStatus(location: Location): JungolLocalTaskState {
  if (!jungolLocalTask || !sameHistorySource(jungolLocalTask.url, location.href)) return emptyLocalState();
  const task = jungolLocalTask;
  if (jungolImportOwner === task && jungolImportController?.state) {
    // The controller is authoritative for live counters. Preserve a completed
    // observed timing sample attached after settlement for immediate UI estimates.
    task.state = { ...jungolImportController.state,
      ...(task.state.status === "DONE" && "timingSample" in task.state && task.state.timingSample
        ? { timingSample: task.state.timingSample } : {}),
      ...( (jungolImportController.state.status === "DONE" || jungolImportController.state.status === "FAILED" || jungolImportController.state.status === "INTERRUPTED") && task.completedProblemKeys
        ? { problemCount: task.completedProblemKeys.size, submissionCount: jungolImportController.state.saved + jungolImportController.state.duplicate }
        : (task.state.status === "DONE" || task.state.status === "FAILED" || task.state.status === "INTERRUPTED") && "problemCount" in task.state && typeof task.state.problemCount === "number"
          ? { problemCount: task.state.problemCount, submissionCount: task.state.submissionCount } : {}) };
    return task.state;
  }
  if (task.cancelling && jungolScan?.url === task.url && jungolScan.state.status === "SCANNING") {
    return { ...emptyLocalState("CANCELLING"), startedAt: task.startedAt };
  }
  if (task.cancelling && task.state.status === "CANCELLING") {
    task.endedAt ??= Date.now();
    task.state = emptyLocalState();
  }
  return withScanTiming(task, task.state as JungolScanState);
}

function startLocalJungolScan(document: Document, location: Location): JungolLocalTaskState {
  if (jungolImportController?.isActive || jungolLocalTask && (jungolLocalTask.state.status === "SCANNING" || jungolLocalTask.state.status === "IMPORTING" || jungolLocalTask.state.status === "CANCELLING")) return localTaskStatus(location);
  // Replace a terminal task before scanner construction. The scanner's
  // isCurrent callback reads jungolLocalTask, so a cancelled predecessor on
  // the same URL must never poison the first explicit retry.
  const task: JungolLocalTask = {
    url: location.href,
    state: { status: "SCANNING", progress: { phase: "pages", stage: "reading-pages", rows: 0, pagesLoaded: 0,
      groupsExpanded: 0, groupsTotal: 0, groupsTotalKnown: false, lastProgressAt: Date.now(), sourceVisibility: "unknown" } },
    cancelling: false, startedAt: Date.now()
  };
  jungolLocalTask = task;
  jungolImportController = null;
  jungolImportOwner = null;
  const receiveScanState = (state: JungolScanState) => {
    if (jungolLocalTask !== task) return;
    if (task.cancelling) {
      if (state.status !== "SCANNING") {
        task.state = emptyLocalState();
        task.endedAt = Date.now();
      }
      return;
    }
    task.state = state;
    if (state.status !== "SCANNING") task.endedAt = Date.now();
  };
  const scan = startJungolScan(document, location, receiveScanState);
  receiveScanState(scan);
  return localTaskStatus(location);
}

function validHistoricalIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 5_000 &&
    value.every(id => typeof id === "string" && /^\d{1,40}$/.test(id)) && new Set(value).size === value.length;
}

function startLocalJungolImport(document: Document, location: Location, ids: unknown): JungolLocalTaskState {
  if (!validHistoricalIds(ids)) return { status: "FAILED", completed: 0, total: 0, saved: 0, duplicate: 0, skipped: 0 };
  if (jungolImportController?.isActive || jungolLocalTask && (jungolLocalTask.state.status === "SCANNING" || jungolLocalTask.state.status === "IMPORTING" || jungolLocalTask.state.status === "CANCELLING")) return localTaskStatus(location);
  const scan = jungolScan?.url === location.href ? jungolScan.state : null;
  if (!scan || scan.status !== "READY" || scan.truncated) return { status: "INTERRUPTED", completed: 0, total: ids.length, saved: 0, duplicate: 0, skipped: 0 };
  const candidates = ids.map(id => scan.candidates.find(candidate => candidate.submissionId === id));
  if (candidates.some(candidate => !candidate)) return { status: "FAILED", completed: 0, total: ids.length, saved: 0, duplicate: 0, skipped: 0 };
  const task: JungolLocalTask = { url: location.href, cancelling: false, startedAt: Date.now(),
    state: { status: "IMPORTING", completed: 0, total: ids.length, saved: 0, duplicate: 0, skipped: 0 } };
  jungolLocalTask = task;
  const controller = new HistoricalTaskController<JungolHistoryCandidate>();
  jungolImportController = controller;
  jungolImportOwner = task;
  // Only Jungol candidates reach this runner, so this is the platform/problem identity.
  const completedProblemKeys = new Set<string>();
  task.completedProblemKeys = completedProblemKeys;
  controller.start(candidates as JungolHistoryCandidate[], async (candidate, mayStore) => {
    let result: { saved: number; duplicate: number; skipped: number } | null = null;
    let failureReason: HistoricalImportFailureReason = "IMPORT_FAILED";
    const isDetailFailure = (reason: HistoricalImportFailureReason) => reason === "DETAIL_NOT_FOUND" || reason === "DETAIL_UNVERIFIED";
    for (let attempt = 0; attempt < 3 && mayStore(); attempt++) {
      try {
        result = await importVisibleJungolHistory(document, location, [candidate], capture => {
          if (!mayStore() || !mayStoreLocalHistoryCapture(jungolLocalTask === task, task.cancelling, task.url, location.href)) return Promise.resolve({ ok: false, created: false });
          return chrome.runtime.sendMessage({ type: "STORE_HISTORICAL_CAPTURE", capture });
        }, () => undefined, reason => { failureReason = reason; });
      } catch { result = null; failureReason = "IMPORT_FAILED"; }
      if (result && result.skipped !== 1) break;
      if (!isDetailFailure(failureReason)) break;
    }
    // A rejected detail is isolated to this submission only after cleanup and
    // source ownership are confirmed. Never continue under a stale dialog/route.
    if (result?.skipped === 1 && mayStore() &&
        isDetailFailure(failureReason) &&
        mayStoreLocalHistoryCapture(jungolLocalTask === task, task.cancelling, task.url, location.href) &&
        previewJungolHistory(document, location).status === "READY" &&
        !document.querySelector('[role="dialog"][aria-label="제출 상세"]')) {
      return { ...result, failedSubmissionId: candidate.submissionId };
    }
    if (!result || (!mayStore() && result.saved === 0 && result.duplicate === 0) || result.skipped === 1) throw new HistoricalImportFailure(failureReason);
    return result;
  }, (candidate, result) => {
    if (result.saved + result.duplicate > 0) completedProblemKeys.add(`JUNGOL:${candidate.problemNumber}`);
  }, candidate => candidate.submissionId);
  void controller.settled().then(() => {
    if (jungolLocalTask !== task || jungolImportOwner !== task || !controller.state) return;
    const timingSample = timingSampleFromCompletedTask(controller.state);
    const submissionCount = controller.state.saved + controller.state.duplicate;
    task.state = { ...controller.state, ...(timingSample ? { timingSample } : {}),
      ...(controller.state.status === "DONE" || controller.state.status === "FAILED" || controller.state.status === "INTERRUPTED"
        ? { problemCount: completedProblemKeys.size, submissionCount } : {}) };
    // The sample carries only completed local-import timing metadata. Persistence is
    // source-owned so closing the extension page cannot lose an observed duration.
    if (timingSample && chrome.storage?.local) {
      void persistHistoricalTimingSample(chrome.storage.local, timingSample).catch(() => undefined);
    }
  });
  return controller.state!;
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const object = message !== null && typeof message === "object" ? message as Record<string, unknown> : null;
    if (object?.type === "PROGRAMMERS_AUXILIARY_READ") {
      void readProgrammersAuxiliaryLesson(document, window.location, {
        lessonUrl: object.lessonUrl, mode: object.mode, submissionId: object.submissionId
      }).then(sendResponse).catch(() => sendResponse({ status: "SOURCE_UNAVAILABLE" }));
      return true;
    }
    if (object?.type === "HISTORY_SCAN_START" || object?.type === "HISTORY_SCAN_STATUS") {
      if (window.location.origin !== "https://jungol.co.kr" || !isJungolHistoryPath(window.location.pathname)) {
        sendResponse({ status: "TAB_NOT_FOUND" });
      } else if (object.type === "HISTORY_SCAN_START") sendResponse(startJungolScan(document, window.location));
      else if (jungolScan?.url === window.location.href && jungolScan.table !== document.querySelector("table"))
        sendResponse(startJungolScan(document, window.location));
      else sendResponse(jungolScan?.url === window.location.href ? jungolScan.state : { status: "SCAN_IDLE" });
      return false;
    }
    if (object?.type === "HISTORY_PREVIEW") {
      if (window.location.origin === "https://jungol.co.kr" && isJungolHistoryPath(window.location.pathname)) {
        sendResponse(startJungolScan(document, window.location));
        return false;
      } else if (window.location.origin === SWEA_ORIGIN && window.location.pathname === SWEA_USER_SUBMISSIONS_PATH) {
        void loadSweaHistoryPreview(document, window.location).then(sendResponse);
        return true;
      } else if (window.location.origin === "https://school.programmers.co.kr" && window.location.pathname === "/learn/challenges") {
        sendResponse(previewProgrammersHistory(document, window.location));
      } else sendResponse({ status: "TAB_NOT_FOUND" });
      return false;
    }
    if (object?.type === "HISTORY_IMPORT") {
      const ids = object.submissionIds;
      if (window.location.origin !== "https://jungol.co.kr" || !isJungolHistoryPath(window.location.pathname) ||
          !Array.isArray(ids) || ids.length < 1 || ids.length > 10 ||
          ids.some(id => typeof id !== "string" || !/^\d{1,40}$/.test(id)) || new Set(ids).size !== ids.length) {
        sendResponse({ status: "BAD_REQUEST" });
        return false;
      }
      const preview = previewJungolHistory(document, window.location);
      const selected = preview.status === "READY" ? ids.map(id => preview.candidates.find(candidate => candidate.submissionId === id)) : [];
      if (selected.length !== ids.length || selected.some(candidate => !candidate)) {
        sendResponse({ status: "STALE_PREVIEW" });
        return false;
      }
      void importVisibleJungolHistory(document, window.location, selected as NonNullable<typeof selected[number]>[],
        capture => chrome.runtime.sendMessage({ type: "STORE_HISTORICAL_CAPTURE", capture }))
        .then(result => sendResponse({ status: "DONE", ...result }))
        .catch(() => sendResponse({ status: "FAILED" }));
      return true;
    }
    if (object?.type === "LOCAL_HISTORY_SCAN_START" || object?.type === "LOCAL_HISTORY_STATUS" || object?.type === "LOCAL_HISTORY_IMPORT_START" || object?.type === "LOCAL_HISTORY_CANCEL") {
      if (object.platform === "PROGRAMMERS") {
        if (window.location.origin !== "https://school.programmers.co.kr" || window.location.pathname !== "/learn/challenges") sendResponse({ status: "TAB_NOT_FOUND" });
        else if (object.type === "LOCAL_HISTORY_SCAN_START") sendResponse(startProgrammersScan(document, window.location));
        else if (object.type === "LOCAL_HISTORY_IMPORT_START") sendResponse(startProgrammersImport(document, window.location, object.submissionIds));
        else if (object.type === "LOCAL_HISTORY_CANCEL") sendResponse(cancelProgrammersLocal());
        else sendResponse(programmersLocalStatus());
        return false;
      }
      if (object.platform === "SWEA") {
        if (window.location.origin !== SWEA_ORIGIN || window.location.pathname !== SWEA_USER_SUBMISSIONS_PATH) sendResponse({ status: "TAB_NOT_FOUND" });
        else if (object.type === "LOCAL_HISTORY_SCAN_START") sendResponse(startSweaScan(document, window.location));
        else if (object.type === "LOCAL_HISTORY_IMPORT_START") sendResponse(startSweaImport(document, window.location, object.submissionIds));
        else if (object.type === "LOCAL_HISTORY_CANCEL") {
          // A scan has no dispatched stores and can be invalidated outright.
          // An import retains its owner generation so an in-flight store can
          // settle and terminal counters remain truthful after cancellation.
          if (sweaState.status === "SCANNING") { sweaGeneration++; sweaState = { ...sweaState, status: "INTERRUPTED", endedAt: Date.now() }; }
          else sweaController?.cancel();
          sendResponse(sweaStatus());
        }
        else sendResponse(sweaStatus());
        return false;
      }
      if (window.location.origin !== "https://jungol.co.kr" || !isJungolHistoryPath(window.location.pathname)) {
        sendResponse({ status: "TAB_NOT_FOUND" });
      } else if (object.type === "LOCAL_HISTORY_SCAN_START") sendResponse(startLocalJungolScan(document, window.location));
      else if (object.type === "LOCAL_HISTORY_IMPORT_START") sendResponse(startLocalJungolImport(document, window.location, object.submissionIds));
      else if (object.type === "LOCAL_HISTORY_CANCEL") {
        if (jungolLocalTask && sameHistorySource(jungolLocalTask.url, window.location.href)) {
          const importing = jungolImportOwner === jungolLocalTask && jungolImportController?.isActive;
          const scanning = jungolLocalTask.state.status === "SCANNING" && jungolScan?.state.status === "SCANNING";
          // A delayed history-page cancel must not turn a settled result into
          // CANCELLING and block the next explicit scan.
          if ((importing || scanning) && !jungolLocalTask.cancelling) {
            jungolLocalTask.cancelling = true;
            if (importing) jungolImportController!.cancel();
            else jungolLocalTask.state = { status: "CANCELLING", completed: 0, total: 0, saved: 0, duplicate: 0, skipped: 0 };
          }
        }
        sendResponse(localTaskStatus(window.location));
      } else sendResponse(localTaskStatus(window.location));
      return false;
    }
    return false;
  });
  void bootstrapContent(document, window.location, document.referrer);
}
