import { canonicalLanguageDisplayName, canonicalLanguageKey } from "../../../shared/language";
import { createCapture } from "./capture";
import { CAPTURE_RESULT, type Capture } from "./types";
import type { HistoricalImportFailureReason } from "./historicalTaskController";

const JUNGOL_ORIGIN = "https://jungol.co.kr";
const MAX_IMPORT_BATCH = 10;
const ACCOUNT_HISTORY_PATH = /^\/account\/(\d{1,40})\/submission$/;
type ObservedScan = { url: string; table: Element | null; clicks: number; minRows: number; knownSubmissionIds: Set<string>;
  groupsExpanded: number; lastProgressAt: number; lastProgressSignature?: string;
  pendingPageIds?: Set<string>; pendingGroups: Map<string, { beforeChildren: Set<string>; additional: number }> };
const observedPagination = new WeakMap<Document, ObservedScan>();

export function isJungolHistoryPath(pathname: string): boolean {
  return pathname === "/submission" || ACCOUNT_HISTORY_PATH.test(pathname);
}

export function isJungolHistorySenderUrl(url: URL): boolean {
  if (url.origin !== JUNGOL_ORIGIN || !isJungolHistoryPath(url.pathname)) return false;
  if (url.pathname === "/submission") return /^[\w.-]{1,80}$/.test(url.searchParams.get("account") ?? "");
  return !url.searchParams.has("account");
}

function listIdentity(document: Document, location: Location): { account: string; accountId: string | null } | null {
  const url = new URL(location.href);
  const profileId = url.pathname.match(ACCOUNT_HISTORY_PATH)?.[1];
  if (profileId) {
    // The edit tab is only rendered on the signed-in user's own profile.
    if (!document.querySelector(`a[href="/account/${profileId}/edit"]`) ||
        !document.querySelector(`a[href="/account/${profileId}/submission"].active`)) return null;
    const account = document.querySelector<HTMLAnchorElement>(`a.crumb[href="/account/${profileId}"]`)
      ?.textContent?.trim().replace(/^@/, "") ?? "";
    return /^[\w.-]{1,80}$/.test(account) ? { account, accountId: profileId } : null;
  }
  if (url.pathname !== "/submission") return null;
  const account = url.searchParams.get("account");
  if (!account || !/^[\w.-]{1,80}$/.test(account)) return null;
  const own = [...document.querySelectorAll<HTMLElement>('[role="switch"]')]
    .some(element => element.textContent?.trim() === "내 제출" && element.getAttribute("aria-checked") === "true");
  const filtered = [...document.querySelectorAll<HTMLButtonElement>("button[aria-label]")]
    .some(button => button.getAttribute("aria-label") === `@${account} 필터 해제`);
  return own && filtered ? { account, accountId: null } : null;
}

export interface JungolHistoryCandidate {
  submissionId: string;
  problemNumber: string;
  title: string;
  language: string;
  detailUrl: string;
  codeByteLength: number;
  executionTime?: number;
  memoryValue?: number;
}

export interface JungolHistoryVerified extends JungolHistoryCandidate {
  sourceCode: string;
  solvedAt: string;
}

function rowSubmissionIdentity(row: HTMLTableRowElement, location: Location):
  { submissionId: string; detailUrl: URL } | null {
  const languageLink = row.querySelector<HTMLAnchorElement>('td[data-col="언어"] a[href]');
  if (!languageLink) return null;
  let detailUrl: URL;
  try { detailUrl = new URL(languageLink.getAttribute("href") ?? "", location.href); }
  catch { return null; }
  if (detailUrl.origin !== JUNGOL_ORIGIN || detailUrl.pathname !== location.pathname) return null;
  const submissionId = detailUrl.searchParams.get("sid") ?? "";
  if (!/^\d{1,40}$/.test(submissionId)) return null;
  const explicitId = row.querySelector('td[data-col="번호"] .sl-id')?.textContent?.trim() ?? "";
  if (explicitId && (!/^\d{1,40}$/.test(explicitId) || explicitId !== submissionId)) return null;
  // Expanded group children show a short ordinal in the number cell, not a
  // submission ID. The result link must corroborate their language link.
  const resultHref = row.querySelector<HTMLAnchorElement>('td[data-col="결과"] a.sl-card-link[href]')?.getAttribute("href");
  if (resultHref) {
    let resultUrl: URL;
    try { resultUrl = new URL(resultHref, location.href); } catch { return null; }
    if (resultUrl.origin !== detailUrl.origin || resultUrl.pathname !== detailUrl.pathname ||
        resultUrl.searchParams.get("sid") !== submissionId) return null;
  } else if (!explicitId) {
    const numberText = row.querySelector('td[data-col="번호"]')?.textContent?.trim() ?? "";
    if (numberText !== submissionId) return null;
  }
  return { submissionId, detailUrl };
}

function rowProblemIdentity(row: HTMLTableRowElement): { problemNumber: string; title: string } | null {
  const cell = row.querySelector('td[data-col="문제"]');
  const link = cell?.querySelector<HTMLAnchorElement>('a[href^="/problem/"]');
  const text = (link ?? cell)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const match = text.match(/^(.*?)\s*#(\d{1,40})$/);
  if (!match?.[1]?.trim()) return null;
  if (link && link.getAttribute("href") !== `/problem/${match[2]}`) return null;
  return { problemNumber: match[2]!, title: match[1].trim() };
}

function rowGroupId(row: HTMLTableRowElement, location: Location): string {
  const displayed = row.querySelector('td[data-col="번호"] .sl-id')?.textContent?.trim() ?? "";
  return /^\d{1,40}$/.test(displayed) ? displayed : rowSubmissionIdentity(row, location)?.submissionId ?? "";
}

function pageSubmissionIds(document: Document, location: Location): Set<string> {
  return new Set([...document.querySelectorAll<HTMLTableRowElement>('table tr:not(.gr)')]
    .map(row => rowSubmissionIdentity(row, location)?.submissionId).filter((id): id is string => !!id));
}

function allSubmissionIds(document: Document, location: Location): Set<string> {
  return new Set([...document.querySelectorAll<HTMLTableRowElement>('table tr')]
    .map(row => rowSubmissionIdentity(row, location)?.submissionId).filter((id): id is string => !!id));
}

function groupChildIds(document: Document, location: Location, groupId: string): Set<string> {
  const parent = [...document.querySelectorAll<HTMLTableRowElement>('table tr')]
    .find(row => rowGroupId(row, location) === groupId && !!row.querySelector('button.sl-group-toggle'));
  const ids = new Set<string>();
  for (let row = parent?.nextElementSibling; row?.matches('tr.gr') && !row.querySelector('button.sl-group-toggle'); row = row.nextElementSibling) {
    const id = rowSubmissionIdentity(row as HTMLTableRowElement, location)?.submissionId;
    if (id) ids.add(id);
  }
  return ids;
}

export type JungolHistoryPreview =
  | { status: "LOGIN_REQUIRED" | "ACCESS_DENIED" | "OWNERSHIP_UNVERIFIED"; candidates: []; skipped: 0 }
  | { status: "READY"; candidates: JungolHistoryCandidate[]; skipped: number; truncated: boolean;
      scanProtocol?: number; paginationClicks?: number; remainingGroups?: number };

export type JungolHistoryScanProgress = {
  phase: "pages" | "groups";
  /** The operation currently being observed; it does not imply a row increment. */
  stage: "reading-pages" | "waiting-pages" | "expanding-groups" | "waiting-groups";
  rows: number;
  pagesLoaded: number;
  groupsExpanded: number;
  groupsTotal: number;
  /** False while late group controls can still be discovered. */
  groupsTotalKnown: boolean;
  /** Timestamp of the last actual DOM progress, distinct from a wait report. */
  lastProgressAt: number;
  /** The source document's observed visibility, without inferring browser scheduling. */
  sourceVisibility: "visible" | "hidden" | "prerender" | "unknown";
};

/** A listing is only a candidate source. It never supplies source code or an exact submission time. */
export function previewJungolHistory(document: Document, location: Location): JungolHistoryPreview {
  const empty = (status: "LOGIN_REQUIRED" | "ACCESS_DENIED" | "OWNERSHIP_UNVERIFIED"): JungolHistoryPreview =>
    ({ status, candidates: [], skipped: 0 });
  if (location.origin !== JUNGOL_ORIGIN || !isJungolHistoryPath(location.pathname)) return empty("OWNERSHIP_UNVERIFIED");
  if (/APIError\(403\)|권한이 없어요/.test(document.body?.textContent ?? "")) return empty("ACCESS_DENIED");
  if (location.pathname === "/submission" &&
      ![...document.querySelectorAll<HTMLElement>('[role="switch"]')]
        .some(element => element.textContent?.trim() === "내 제출" && element.getAttribute("aria-checked") === "true")) {
    return empty("LOGIN_REQUIRED");
  }
  const identity = listIdentity(document, location);
  if (!identity) return empty("OWNERSHIP_UNVERIFIED");

  const rows = [...document.querySelectorAll<HTMLTableRowElement>("table tr")]
    .filter(row => !!row.querySelector('td[data-col="번호"]'));
  const candidates: JungolHistoryCandidate[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const row of rows) {
    const submission = rowSubmissionIdentity(row, location);
    const id = submission?.submissionId ?? "";
    const rowOwner = row.querySelector<HTMLAnchorElement>('td[data-col="제출자"] a[href^="/account/"]');
    const result = row.querySelector('td[data-col="결과"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const problem = rowProblemIdentity(row);
    const languageLink = row.querySelector<HTMLAnchorElement>('td[data-col="언어"] a[href]');
    const number = problem?.problemNumber;
    const title = problem?.title;
    const language = languageLink?.textContent?.trim() ?? "";
    const codeLengthText = row.querySelector('td[data-col="코드 길이"]')?.textContent?.replace(/\s+/g, "") ?? "";
    const executionText = row.querySelector('td[data-col="시간"]')?.textContent?.replace(/[\s·]/g, "") ?? "";
    const memoryText = row.querySelector('td[data-col="메모리"]')?.textContent?.replace(/[\s·]/g, "") ?? "";
    const codeByteLength = /^\d{1,7}B$/.test(codeLengthText) ? Number(codeLengthText.slice(0, -1)) : NaN;
    const executionTime = /^\d+(?:\.\d+)?ms$/.test(executionText) ? Number(executionText.slice(0, -2)) : NaN;
    const memoryValue = /^\d+(?:\.\d+)?MB$/.test(memoryText) ? Number(memoryText.slice(0, -2)) : NaN;
    const detailUrl = submission?.detailUrl;
    if (!/^\d{1,40}$/.test(id) || result !== "정답 100점" || !number || !title || !language ||
      !canonicalLanguageKey(language) || !detailUrl ||
      (identity.accountId ? rowOwner?.getAttribute("href") !== `/account/${identity.accountId}` :
        detailUrl.searchParams.get("account") !== identity.account) ||
      seen.has(id) ||
      !Number.isSafeInteger(codeByteLength) || codeByteLength < 1 || codeByteLength > 1_000_000) {
      skipped += 1;
      continue;
    }
    seen.add(id);
    candidates.push({ submissionId: id, problemNumber: number, title, language, detailUrl: detailUrl.href,
      codeByteLength, ...(Number.isFinite(executionTime) ? { executionTime } : {}),
      ...(Number.isFinite(memoryValue) ? { memoryValue } : {}) });
  }
  return { status: "READY", candidates, skipped,
    truncated: !!document.querySelector('button.sl-group-toggle[aria-expanded="false"]') };
}

/** Expand the site's grouped submissions before previewing; each accepted submission keeps its own ID. */
export async function loadJungolHistoryPreview(document: Document, location: Location,
  onProgress: (progress: JungolHistoryScanProgress) => void = () => undefined,
  maxIdlePageChecks = 12, stepWaitMs = 8_000,
  isCurrent: () => boolean = () => true): Promise<JungolHistoryPreview> {
  const initial = previewJungolHistory(document, location);
  if (initial.status !== "READY") return initial;
  const cancelled = (): JungolHistoryPreview => ({ status: "OWNERSHIP_UNVERIFIED", candidates: [], skipped: 0 });
  if (!isCurrent()) return cancelled();
  const startingUrl = location.href;
  const moreButton = () => [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent?.trim() === "더 불러오기");
  const attempted = new Set<string>();
  let incomplete = false;
  let unresolvedPage = false;
  let sawMoreButton = false;
  let finishedPageWithoutMore = false;
  let lastRowCount = document.querySelectorAll('table tr').length;
  let idlePageChecks = 0;
  let groupsTotal = 0;
  const table = document.querySelector("table");
  const priorPagination = observedPagination.get(document);
  const currentIds = allSubmissionIds(document, location);
  const sameListing = priorPagination?.url === startingUrl && priorPagination.table === table &&
    lastRowCount >= priorPagination.minRows && [...priorPagination.knownSubmissionIds].every(id => currentIds.has(id));
  const observed: ObservedScan = sameListing
    ? priorPagination : { url: startingUrl, table, clicks: 0, minRows: lastRowCount,
      knownSubmissionIds: currentIds, groupsExpanded: 0, lastProgressAt: Date.now(), pendingGroups: new Map() };
  observedPagination.set(document, observed);
  let paginationClicks = observed.clicks;
  let groupsExpanded = observed.groupsExpanded;
  let lastProgressAt = observed.lastProgressAt;
  const sourceVisibility = (): JungolHistoryScanProgress["sourceVisibility"] => {
    const visibility = document.visibilityState;
    return visibility === "visible" || visibility === "hidden" || visibility === "prerender" ? visibility : "unknown";
  };
  const report = (phase: JungolHistoryScanProgress["phase"], stage: JungolHistoryScanProgress["stage"], _changed = false) => {
    // Stage changes and continuation passes are not progress. Only observed
    // rows, loaded pages, or expanded groups advance the real-progress clock.
    const rows = document.querySelectorAll('table tr').length;
    const signature = `${rows}:${paginationClicks}:${groupsExpanded}`;
    if (signature !== observed.lastProgressSignature) {
      lastProgressAt = Date.now();
      observed.lastProgressAt = lastProgressAt;
      observed.lastProgressSignature = signature;
    }
    onProgress({ phase, stage, rows, pagesLoaded: paginationClicks,
      groupsExpanded, groupsTotal, groupsTotalKnown: false, lastProgressAt, sourceVisibility: sourceVisibility() });
  };
  report("pages", "reading-pages", true);
  const pageLoaded = () => {
    const previous = observed.pendingPageIds;
    if (!previous?.size || moreButton()?.disabled) return null;
    const current = allSubmissionIds(document, location);
    if (![...previous].every(id => current.has(id))) return null;
    return [...pageSubmissionIds(document, location)].some(id => !previous.has(id)) ? true : null;
  };
  if (observed.pendingPageIds) {
    let loaded: true | null = null;
    for (let wait = 0; wait < 4 && !loaded; wait++) {
      report("pages", "waiting-pages");
      loaded = await waitFor(document, pageLoaded, stepWaitMs);
    }
    if (!isCurrent()) return cancelled();
    if (loaded && location.href === startingUrl) {
      observed.pendingPageIds = undefined;
      observed.clicks += 1;
      paginationClicks = observed.clicks;
      observed.minRows = document.querySelectorAll("table tr").length;
      observed.knownSubmissionIds = allSubmissionIds(document, location);
      lastRowCount = observed.minRows;
      sawMoreButton = true;
      finishedPageWithoutMore = !moreButton();
      report("pages", "reading-pages", true);
    } else { incomplete = true; unresolvedPage = true; }
  }
  for (let count = 0; count < 1_000 && !incomplete; count++) {
    if (!isCurrent()) return cancelled();
    const more = moreButton();
    if (!more) {
      // The first page and its pagination control are rendered asynchronously.
      // A momentarily missing button does not mean the final page was reached.
      report("pages", "waiting-pages");
      const changed = await waitFor(document, () => {
        const rowCount = document.querySelectorAll('table tr').length;
        return moreButton() || rowCount !== lastRowCount ? true : null;
      }, stepWaitMs);
      if (!isCurrent()) return cancelled();
      if (location.href !== startingUrl) { incomplete = true; break; }
      if (changed) {
        idlePageChecks = 0;
        lastRowCount = document.querySelectorAll('table tr').length;
        report("pages", "reading-pages", true);
        continue;
      }
      // Neither a footer/version nor fewer than 30 represented submissions
      // proves that the first cursor request has finished. The site can show
      // just 13 rows while its pagination control is still loading. The
      // control's disappearance is terminal only after this scan has clicked
      // it and observed the following page grow.
      if ((!sawMoreButton && paginationClicks === 0) ||
          (sawMoreButton && !finishedPageWithoutMore) || lastRowCount <= 1) {
        if (++idlePageChecks < maxIdlePageChecks) continue;
        incomplete = true;
      } else if (++idlePageChecks < Math.min(maxIdlePageChecks, 4)) {
        // After a loaded page the next cursor can mount later than the rows.
        // Require several quiet windows before treating its absence as final.
        continue;
      }
      break;
    }
    sawMoreButton = true;
    if (more.disabled) {
      report("pages", "waiting-pages");
      const ready = await waitFor(document, () => moreButton() && !moreButton()?.disabled ? true : null,
        stepWaitMs);
      if (!isCurrent()) return cancelled();
      if (!ready) { if (++idlePageChecks < maxIdlePageChecks) continue; incomplete = true; break; }
      idlePageChecks = 0;
      continue;
    }
    observed.pendingPageIds = pageSubmissionIds(document, location);
    if (!isCurrent()) return cancelled();
    more.click();
    let loaded: true | null = null;
    for (let wait = 0; wait < 4 && !loaded; wait++) {
      report("pages", "waiting-pages");
      loaded = await waitFor(document, pageLoaded, stepWaitMs);
    }
    if (!isCurrent()) return cancelled();
    if (!loaded || location.href !== startingUrl) { incomplete = true; unresolvedPage = true; break; }
    observed.pendingPageIds = undefined;
    idlePageChecks = 0;
    paginationClicks += 1;
    lastRowCount = document.querySelectorAll('table tr').length;
    observed.clicks = paginationClicks;
    observed.minRows = lastRowCount;
    observed.knownSubmissionIds = allSubmissionIds(document, location);
    finishedPageWithoutMore = !moreButton();
    report("pages", "reading-pages", true);
  }
  if (moreButton()) incomplete = true;
  groupsTotal = document.querySelectorAll('button.sl-group-toggle[aria-expanded="false"]').length;
  report("groups", "expanding-groups", true);
  let unresolvedGroup = false;
  for (const [id, pending] of observed.pendingGroups) {
    if (!isCurrent()) return cancelled();
    const expandedNow = () => {
      const row = [...document.querySelectorAll<HTMLTableRowElement>("table tr")]
        .find(item => rowGroupId(item, location) === id);
      return row?.querySelector<HTMLButtonElement>("button.sl-group-toggle")?.getAttribute("aria-expanded") === "true" &&
        [...groupChildIds(document, location, id)].filter(childId => !pending.beforeChildren.has(childId)).length >= pending.additional ? true : null;
    };
    let expanded: true | null = null;
    for (let wait = 0; wait < 4 && !expanded; wait++) {
      report("groups", "waiting-groups");
      expanded = await waitFor(document, expandedNow, stepWaitMs);
    }
    if (!isCurrent()) return cancelled();
    if (!expanded || location.href !== startingUrl) { incomplete = true; unresolvedGroup = true; break; }
    observed.pendingGroups.delete(id);
    attempted.add(id);
    groupsExpanded += 1;
    observed.groupsExpanded = groupsExpanded;
    report("groups", "expanding-groups", true);
  }
  let waitedForLateRows = false;
  for (let count = 0; count < 3_000 && !unresolvedGroup && !unresolvedPage; count++) {
    if (!isCurrent()) return cancelled();
    const toggle = [...document.querySelectorAll<HTMLButtonElement>('button.sl-group-toggle[aria-expanded="false"]')]
      .find(button => !attempted.has(rowGroupId(button.closest("tr") as HTMLTableRowElement, location)));
    if (!toggle) {
      if (waitedForLateRows) break;
      waitedForLateRows = true;
      const rowCount = document.querySelectorAll('table tr').length;
      report("groups", "waiting-groups");
      const late = await waitFor(document, () =>
        document.querySelector('button.sl-group-toggle[aria-expanded="false"]') ||
        moreButton() || document.querySelectorAll('table tr').length !== rowCount ? true : null,
        Math.min(stepWaitMs, 5_000));
      if (!isCurrent()) return cancelled();
      if (location.href !== startingUrl) { incomplete = true; break; }
      if (late) {
        if (moreButton()) incomplete = true;
        if (document.querySelectorAll('table tr').length !== rowCount) waitedForLateRows = false;
        continue;
      }
      break;
    }
    const id = rowGroupId(toggle.closest("tr") as HTMLTableRowElement, location);
    const additional = Number(toggle.querySelector(".sl-group-count")?.textContent?.trim().replace(/^\+/, ""));
    if (!/^\d{1,40}$/.test(id) || !Number.isSafeInteger(additional) || additional < 1) {
      incomplete = true;
      break;
    }
    observed.pendingGroups.set(id, { beforeChildren: groupChildIds(document, location, id), additional });
    if (!isCurrent()) return cancelled();
    toggle.click();
    const expandedNow = () => {
      const row = [...document.querySelectorAll<HTMLTableRowElement>("table tr")]
        .find(item => rowGroupId(item, location) === id);
      return row?.querySelector<HTMLButtonElement>("button.sl-group-toggle")?.getAttribute("aria-expanded") === "true" &&
        groupChildIds(document, location, id).size >= additional ? true : null;
    };
    let expanded: true | null = null;
    for (let wait = 0; wait < 4 && !expanded; wait++) {
      report("groups", "waiting-groups");
      expanded = await waitFor(document, expandedNow, stepWaitMs);
    }
    if (!isCurrent()) return cancelled();
    if (location.href !== startingUrl) { incomplete = true; break; }
    if (!expanded) { incomplete = true; break; }
    observed.pendingGroups.delete(id);
    attempted.add(id);
    groupsExpanded += 1;
    observed.groupsExpanded = groupsExpanded;
    report("groups", "expanding-groups", true);
    waitedForLateRows = false;
  }
  if (!isCurrent()) return cancelled();
  if (location.href !== startingUrl) return { status: "OWNERSHIP_UNVERIFIED", candidates: [], skipped: 0 };
  const finalIds = allSubmissionIds(document, location);
  if (document.querySelectorAll('table tr').length < observed.minRows ||
      [...observed.knownSubmissionIds].some(id => !finalIds.has(id))) incomplete = true;
  const result = previewJungolHistory(document, location);
  return result.status === "READY"
    ? { ...result, truncated: result.truncated || incomplete || paginationClicks === 0,
        scanProtocol: 3, paginationClicks,
        remainingGroups: document.querySelectorAll('button.sl-group-toggle[aria-expanded="false"]').length }
    : result;
}

/** Only a matching, signed-in submission dialog can turn a listing candidate into source evidence. */
export function verifyJungolHistoryDetail(document: Document, location: Location,
  candidate: JungolHistoryCandidate): JungolHistoryVerified | null {
  const url = new URL(location.href);
  const detailUrl = new URL(candidate.detailUrl);
  const profileId = url.pathname.match(ACCOUNT_HISTORY_PATH)?.[1];
  if (url.origin !== JUNGOL_ORIGIN || url.pathname !== detailUrl.pathname ||
      detailUrl.searchParams.get("sid") !== candidate.submissionId ||
      (profileId ? !document.querySelector(`a[href="/account/${profileId}/edit"]`) :
        url.searchParams.get("sid") !== candidate.submissionId ||
        url.searchParams.get("account") !== detailUrl.searchParams.get("account"))) return null;
  const identity = listIdentity(document, location);
  if (!identity || (!profileId && identity.account !== detailUrl.searchParams.get("account"))) return null;
  const account = profileId ? document.querySelector<HTMLAnchorElement>(`a.crumb[href="/account/${profileId}"]`)
    ?.textContent?.trim().replace(/^@/, "") : url.searchParams.get("account");
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="제출 상세"]');
  const owner = dialog?.querySelector<HTMLAnchorElement>('a[href^="/account/"]')?.textContent?.trim();
  const problem = dialog?.querySelector<HTMLAnchorElement>(`a[href="/problem/${candidate.problemNumber}"]`);
  const detailId = dialog?.querySelector(".sd-id")?.textContent?.trim();
  const score = dialog?.querySelector(".sd-heading-score")?.textContent?.trim();
  const status = dialog?.querySelector(".sd-heading-status")?.textContent?.trim();
  const timeText = dialog?.querySelector('.sd-meta-item .time')?.parentElement?.parentElement
    ?.querySelector('.paper .content')?.textContent?.trim() ?? "";
  const code = dialog?.querySelector<HTMLElement>('code.hljs')?.textContent ?? "";
  const ownerLink = dialog?.querySelector<HTMLAnchorElement>('a[href^="/account/"]');
  // The current account-profile table reports JavaScript string length despite
  // its B suffix; the legacy filtered listing reports UTF-8 bytes. Keep the
  // route-specific metric exact rather than accepting either representation.
  const reportedCodeLength = profileId ? code.length : new TextEncoder().encode(code).length;
  const problemText = problem?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const problemMatch = problemText.match(/^(.*?)\s*#(\d{1,40})$/);
  if (!account || owner !== account || (profileId && ownerLink?.getAttribute("href") !== `/account/${profileId}`) || !problem ||
      problemMatch?.[1]?.trim() !== candidate.title || problemMatch?.[2] !== candidate.problemNumber ||
      detailId !== `#${candidate.submissionId}` || score !== "100점" || status !== "정답" ||
      !code.trim() || reportedCodeLength !== candidate.codeByteLength) return null;
  const date = timeText.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!date) return null;
  const [, year, month, day, period, hour, minute, second] = date;
  const displayHour = Number(hour);
  if (displayHour < 1 || displayHour > 12) return null;
  const hour24 = displayHour % 12 + (period === "오후" ? 12 : 0);
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), hour24, Number(minute), Number(second)) - 9 * 60 * 60 * 1000;
  const roundTrip = new Date(utc + 9 * 60 * 60 * 1000);
  if (roundTrip.getUTCFullYear() !== Number(year) || roundTrip.getUTCMonth() + 1 !== Number(month) ||
      roundTrip.getUTCDate() !== Number(day) || roundTrip.getUTCHours() !== hour24 ||
      roundTrip.getUTCMinutes() !== Number(minute) || roundTrip.getUTCSeconds() !== Number(second)) return null;
  return { ...candidate, sourceCode: code, solvedAt: new Date(utc).toISOString() };
}

export function historicalJungolCapture(verified: JungolHistoryVerified): Capture | null {
  return createCapture({
    platform: "JUNGOL",
    problemNumber: verified.problemNumber,
    title: verified.title,
    problemUrl: `${JUNGOL_ORIGIN}/problem/${verified.problemNumber}`,
    language: canonicalLanguageDisplayName(verified.language),
    sourceCode: verified.sourceCode,
    result: CAPTURE_RESULT,
    solvedAt: verified.solvedAt,
    executionTime: verified.executionTime,
    memoryValue: verified.memoryValue,
    ...(verified.memoryValue === undefined ? {} : { memoryUnit: "MB" as const }),
    historicalImport: true,
    historicalSubmissionId: verified.submissionId
  });
}

type StoreHistorical = (capture: Capture) => Promise<{ ok?: boolean; created?: boolean; error?: string }>;

function waitFor<T>(document: Document, read: () => T | null, timeoutMs = 8_000): Promise<T | null> {
  const found = read();
  if (found !== null) return Promise.resolve(found);
  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      const value = read();
      if (value !== null) { observer.disconnect(); clearTimeout(timeout); resolve(value); }
    });
    const timeout = setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
    observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
  });
}

/** User-initiated, bounded local import. No relay, auto-download, or GitHub job is started here. */
export async function importVisibleJungolHistory(document: Document, location: Location,
  candidates: JungolHistoryCandidate[], store: StoreHistorical,
  onProgress: (completed: number, total: number) => void = () => undefined,
  onFailure: (reason: HistoricalImportFailureReason) => void = () => undefined): Promise<{ saved: number; duplicate: number; skipped: number }> {
  const selected = candidates.slice(0, MAX_IMPORT_BATCH);
  let saved = 0, duplicate = 0, skipped = 0;
  const originalUrl = new URL(location.href);
  for (const [index, candidate] of selected.entries()) {
    const current = previewJungolHistory(document, location);
    if (current.status !== "READY" || new URL(location.href).pathname !== originalUrl.pathname ||
        new URL(location.href).searchParams.get("account") !== originalUrl.searchParams.get("account") ||
        !current.candidates.some(item => item.submissionId === candidate.submissionId &&
          item.detailUrl === candidate.detailUrl && item.problemNumber === candidate.problemNumber &&
          item.title === candidate.title && item.language === candidate.language &&
          item.codeByteLength === candidate.codeByteLength &&
          item.executionTime === candidate.executionTime && item.memoryValue === candidate.memoryValue)) {
      skipped += selected.length - index;
      onFailure("LIST_CHANGED");
      break;
    }
    const row = [...document.querySelectorAll<HTMLTableRowElement>('table tr')]
      .find(item => rowSubmissionIdentity(item, location)?.submissionId === candidate.submissionId);
    const link = row?.querySelector<HTMLAnchorElement>('td[data-col="언어"] a[href]');
    if (!link || new URL(link.getAttribute("href") ?? "", location.href).href !== candidate.detailUrl) { skipped++; onFailure("LIST_CHANGED"); onProgress(index + 1, selected.length); continue; }
    link.click();
    const dialog = await waitFor(document, () =>
      (new URL(location.href).pathname.match(ACCOUNT_HISTORY_PATH) ||
        new URL(location.href).searchParams.get("sid") === candidate.submissionId) &&
      document.querySelector<HTMLElement>('[role="dialog"][aria-label="제출 상세"] .sd-id')?.textContent?.trim() === `#${candidate.submissionId}`
        ? document.querySelector<HTMLElement>('[role="dialog"][aria-label="제출 상세"] code.hljs')?.closest<HTMLElement>('[role="dialog"]') ?? null
        : null);
    if (dialog) {
      // The site renders the ID/code shell before hydrating its metadata.
      // Wait for this exact dialog's time control; an early optional click
      // permanently misses the timestamp popover when the control arrives later.
      const timeTrigger = await waitFor(document, () => {
        const currentUrl = new URL(location.href);
        if (currentUrl.origin !== originalUrl.origin || currentUrl.pathname !== originalUrl.pathname ||
            currentUrl.searchParams.get("account") !== originalUrl.searchParams.get("account") ||
            !dialog.isConnected || document.querySelector('[role="dialog"][aria-label="제출 상세"]') !== dialog ||
            dialog.querySelector('.sd-id')?.textContent?.trim() !== `#${candidate.submissionId}` ||
            !dialog.querySelector('code.hljs')?.textContent?.trim()) return null;
        return dialog.querySelector<HTMLElement>('.sd-meta-item .time')?.closest<HTMLElement>('[role="button"]') ?? null;
      });
      if (timeTrigger?.getAttribute("aria-expanded") !== "true") timeTrigger?.click();
      const verified = timeTrigger ? await waitFor(document, () => verifyJungolHistoryDetail(document, location, candidate)) : null;
      const capture = verified && historicalJungolCapture(verified);
      const stillOwnSubmission = previewJungolHistory(document, location);
      if (capture && stillOwnSubmission.status === "READY" &&
          stillOwnSubmission.candidates.some(item => item.submissionId === candidate.submissionId &&
            item.detailUrl === candidate.detailUrl && item.language === candidate.language &&
            item.problemNumber === candidate.problemNumber && item.codeByteLength === candidate.codeByteLength)) {
        try {
          const response = await store(capture);
          if (response.ok && response.created) saved++;
          else if (response.ok) duplicate++;
          else { skipped++; onFailure(response.error === "STORAGE_ERROR" ? "STORE_FAILED" : "STORE_REJECTED"); }
        } catch { skipped++; onFailure("STORE_FAILED"); }
      } else { skipped++; onFailure("DETAIL_UNVERIFIED"); }
      // Jungol's open time popover consumes the first outside click. Dismiss
      // it explicitly, then retry Close once if the dialog remains open.
      if (timeTrigger?.getAttribute("aria-expanded") === "true") timeTrigger.click();
      const close = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "닫기");
      const isClosed = () => document.querySelector('[role="dialog"][aria-label="제출 상세"]') ||
        (!new URL(location.href).pathname.match(ACCOUNT_HISTORY_PATH) && new URL(location.href).searchParams.has("sid"))
          ? null : true;
      let closed = isClosed();
      for (let attempt = 0; !closed && close?.isConnected && attempt < 5; attempt++) {
        close.click();
        closed = await waitFor(document, isClosed, 2_000);
      }
      if (!closed) { skipped += selected.length - index - 1; break; }
    } else { skipped++; onFailure("DETAIL_NOT_FOUND"); }
    onProgress(index + 1, selected.length);
  }
  return { saved, duplicate, skipped };
}
