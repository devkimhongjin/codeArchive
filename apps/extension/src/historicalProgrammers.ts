import { canonicalLanguageKey } from "../../../shared/language";
import { programmersHistoricalSubmissionId } from "./historicalIdentity";

const PROGRAMMERS_ORIGIN = "https://school.programmers.co.kr";
const HISTORY_PATH = "/learn/challenges";
const LESSON_PATH = /^\/learn\/courses\/30\/lessons\/(\d{1,40})$/;

export interface ProgrammersHistoryCandidate {
  problemNumber: string;
  title: string;
  solvedAt: string;
  problemUrl: string;
}

export type ProgrammersHistoryPreview =
  | { status: "LOGIN_REQUIRED" | "OWNERSHIP_UNVERIFIED"; candidates: []; skipped: 0 }
  | { status: "READY"; candidates: ProgrammersHistoryCandidate[]; skipped: number; truncated: boolean };

export interface ProgrammersListingLesson {
  problemNumber: string;
  title: string;
  lessonUrl: string;
  page: number;
  order: number;
}

export type ProgrammersListingPage =
  | { status: "PENDING" | "LOGIN_REQUIRED" | "OWNERSHIP_UNVERIFIED" | "INCOMPLETE" }
  | { status: "READY"; total: number; page: number; lessons: ProgrammersListingLesson[]; nextDisabled: boolean; signature: string };

export interface ProgrammersHistorySubmission {
  problemNumber: string;
  language: string;
  createdAt: string;
  score: 100;
  row: HTMLElement;
}

export interface ProgrammersLessonSubmission extends ProgrammersHistorySubmission {
  submissionId: string;
  page: number;
}

export interface ProgrammersLessonHistoryRow {
  problemNumber: string;
  language: string;
  createdAt: string;
  score: number;
  isPerfectScore: boolean;
  row: HTMLElement;
  submissionId: string;
  page: number;
}

export type ProgrammersLessonHistoryState =
  | { status: "PENDING" }
  | { status: "EMPTY"; accountId: string; lessonId: string; title: string }
  | { status: "INCOMPLETE" | "AMBIGUOUS" | "OWNERSHIP_UNVERIFIED" }
  | { status: "READY"; accountId: string; lessonId: string; title: string; totalEntries: number; page: number;
      rows: ProgrammersLessonHistoryRow[]; candidates: ProgrammersLessonSubmission[] };

export function canonicalProgrammersLessonUrl(value: string | Location): string | null {
  try {
    const url = typeof value === "string" ? new URL(value) : new URL(value.href);
    return url.origin === PROGRAMMERS_ORIGIN && !url.search && !url.hash && LESSON_PATH.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

function normalizedText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function programmersLessonTitle(document: Document): string | null {
  const titles = [...document.querySelectorAll<HTMLElement>(".challenge-title")]
    .map(element => normalizedText(element.textContent)).filter(Boolean);
  return titles.length === 1 && titles[0]!.length <= 500 ? titles[0]! : null;
}

function historyPanelTotal(wrapper: HTMLElement, lessonId: string): number | null {
  const counts = [...wrapper.querySelectorAll<HTMLElement>('[class*="Headerstyle__TotalSubmissionCount"]')]
    .map(element => normalizedText(element.textContent).match(/^(\d{1,7})개의 제출$/)?.[1]).filter((value): value is string => !!value);
  if (counts.length !== 1) return null;
  const total = Number(counts[0]);
  if (!Number.isSafeInteger(total) || total < 0 || total > 100_000) return null;
  const refreshes = [...wrapper.querySelectorAll<HTMLElement>("[data-hackle-value]")].map(element => {
    const raw = element.getAttribute("data-hackle-value");
    if (!raw || raw.length > 2_000) return null;
    try { return JSON.parse(raw) as { key?: unknown; properties?: { total_entries?: unknown; lesson_id?: unknown } }; } catch { return null; }
  }).filter((value): value is { key?: unknown; properties?: { total_entries?: unknown; lesson_id?: unknown } } => !!value)
    .filter(value => value.key === "open_challenge_lesson_submission_history_refresh_clicked");
  if (refreshes.length !== 1 || refreshes[0]!.properties?.total_entries !== total || String(refreshes[0]!.properties?.lesson_id) !== lessonId) return null;
  return total;
}

function historyActivePage(wrapper: HTMLElement): number | null {
  const active = [...wrapper.querySelectorAll<HTMLElement>("[data-testid='page-active']")].map(element => normalizedText(element.textContent));
  return active.length === 1 && /^\d{1,6}$/.test(active[0]!) && Number(active[0]) > 0 ? Number(active[0]) : null;
}

type SubmissionRowValue = { lesson_id?: unknown; created_at?: unknown; language?: unknown; score?: unknown; is_perfect_score?: unknown };

/** The two source-owned components independently bind the signed-in numeric user. */
export function authenticatedProgrammersUserId(document: Document, location: Location): string | null {
  if (location.origin !== PROGRAMMERS_ORIGIN || !LESSON_PATH.test(location.pathname)) return null;
  const challenge = document.querySelector<HTMLElement>('.challenge-content.lesson-algorithm-main-section[data-user-id][data-challengeable-id]');
  const history = document.querySelector<HTMLElement>('[data-challengeable-submission-history-component][data-user-id][data-lesson-id]');
  const account = challenge?.dataset.userId ?? "";
  const lesson = location.pathname.match(LESSON_PATH)?.[1] ?? "";
  // challengeable-id is the internal algorithm id (e.g. 26803), not the
  // lesson id in the URL (e.g. 389481). The history component binds the lesson;
  // both independent components must still agree on the signed-in account.
  if (!/^\d{1,40}$/.test(account) || !/^\d{1,40}$/.test(challenge?.dataset.challengeableId ?? "") || history?.dataset.userId !== account || history.dataset.lessonId !== lesson) return null;
  return account;
}

function submissionRowValue(row: HTMLElement): SubmissionRowValue | null {
  const raw = row.getAttribute("data-hackle-value");
  if (!raw || raw.length > 2_000) return null;
  try {
    const value = JSON.parse(raw) as { key?: unknown; properties?: unknown } | null;
    return value?.key === "open_challenge_lesson_submission_history_list_item_toggle_clicked" && value.properties &&
      typeof value.properties === "object" && !Array.isArray(value.properties) ? value.properties as SubmissionRowValue : null;
  } catch { return null; }
}

function exactCreatedAt(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/.test(value) &&
    !Number.isNaN(new Date(value).getTime());
}

/**
 * Submission history rows intentionally have no observed native id.  Callers
 * must reject duplicate (lesson, timestamp, language) tuples before deriving
 * their local key.
 */
export function programmersLessonHistory(document: Document, location: Location): ProgrammersHistorySubmission[] | null {
  if (location.origin !== PROGRAMMERS_ORIGIN) return null;
  const match = location.pathname.match(LESSON_PATH);
  if (!match) return null;
  const result: ProgrammersHistorySubmission[] = [];
  for (const row of document.querySelectorAll<HTMLElement>('.submission-history-wrapper [class*="SubmissionListstyle__ListRow"]')) {
    const value = submissionRowValue(row);
    if (!value || String(value.lesson_id) !== match[1] || !exactCreatedAt(value.created_at) || typeof value.language !== "string" ||
        !value.language.trim() || value.language.length > 100 || value.score !== 100 || value.is_perfect_score !== true) continue;
    result.push({ problemNumber: match[1]!, language: value.language.trim(), createdAt: value.created_at, score: 100, row });
  }
  return result;
}

/**
 * The lesson history has neither a native submission id nor a reliable
 * fallback editor.  Parse every exposed history row strictly before making a
 * local surrogate; a malformed or duplicate tuple makes the whole lesson
 * unusable instead of silently dropping an attempt.
 */
export function readProgrammersLessonHistory(document: Document, location: Location): ProgrammersLessonHistoryState {
  const canonical = canonicalProgrammersLessonUrl(location);
  const accountId = authenticatedProgrammersUserId(document, location);
  const title = programmersLessonTitle(document);
  const lessonId = location.pathname.match(LESSON_PATH)?.[1] ?? "";
  if (!canonical || !accountId || !title || !lessonId) return { status: "OWNERSHIP_UNVERIFIED" };
  const wrappers = document.querySelectorAll<HTMLElement>(".submission-history-wrapper");
  const components = document.querySelectorAll<HTMLElement>("[data-challengeable-submission-history-component][data-user-id][data-lesson-id]");
  if (wrappers.length !== 1 || components.length !== 1) return { status: "PENDING" };
  const totalEntries = historyPanelTotal(wrappers[0]!, lessonId);
  const page = historyActivePage(wrappers[0]!);
  if (totalEntries === null) return { status: "PENDING" };
  const rows = [...wrappers[0]!.querySelectorAll<HTMLElement>('[class*="SubmissionListstyle__ListRow"][data-hackle-value]')];
  if (rows.length === 0) {
    const text = normalizedText(wrappers[0]!.textContent);
    return totalEntries === 0 && /제출\s*이력.*없|no\s+submissions?|empty/i.test(text)
      ? { status: "EMPTY", accountId, lessonId, title }
      : { status: "PENDING" };
  }
  if (page === null) return { status: "PENDING" };
  const parsedRows: ProgrammersLessonHistoryRow[] = [];
  const candidates: ProgrammersLessonSubmission[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = submissionRowValue(row);
    const score = value?.score;
    if (!value || String(value.lesson_id) !== lessonId || !exactCreatedAt(value.created_at) || typeof value.language !== "string" ||
        !value.language.trim() || value.language.length > 100 || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100 ||
        typeof value.is_perfect_score !== "boolean") return { status: "INCOMPLETE" };
    const language = value.language.trim();
    const languageKey = canonicalLanguageKey(language);
    if (!languageKey || languageKey.startsWith("unknown:")) return { status: "INCOMPLETE" };
    const submissionId = programmersHistoricalSubmissionId(accountId, lessonId, value.created_at, language);
    if (!submissionId) return { status: "INCOMPLETE" };
    if (seen.has(submissionId)) return { status: "AMBIGUOUS" };
    seen.add(submissionId);
    const parsed = { problemNumber: lessonId, language, createdAt: value.created_at, score, isPerfectScore: value.is_perfect_score,
      row, submissionId, page } satisfies ProgrammersLessonHistoryRow;
    parsedRows.push(parsed);
    if (score === 100 && value.is_perfect_score) candidates.push({ problemNumber: lessonId, language, createdAt: value.created_at, score: 100, row, submissionId, page });
  }
  return { status: "READY", accountId, lessonId, title, totalEntries, page, rows: parsedRows, candidates };
}

/** A row can be imported only when its native-id surrogate is unambiguous. */
export function hasUniqueProgrammersHistoryIdentity(rows: readonly ProgrammersHistorySubmission[], target: ProgrammersHistorySubmission): boolean {
  return rows.filter(row => row.problemNumber === target.problemNumber && row.createdAt === target.createdAt &&
    row.language.toLowerCase() === target.language.toLowerCase()).length === 1;
}

/** The editor URI identifies the selected submission; never fall back to #code. */
export function selectedProgrammersHistoryEditorUri(row: HTMLElement): string | null {
  const editors = row.querySelectorAll<HTMLElement>('[class*="ListItemCodeWrapper"] .monaco-editor[role="code"][data-uri]');
  if (editors.length !== 1) return null;
  const uri = editors[0]!.dataset.uri ?? "";
  return /^inmemory:\/\/model\/\d{1,20}$/.test(uri) ? uri : null;
}

/** The solved filter is account-specific, but its rows do not expose source code. Preview only. */
export function previewProgrammersHistory(document: Document, location: Location): ProgrammersHistoryPreview {
  const empty = (status: "LOGIN_REQUIRED" | "OWNERSHIP_UNVERIFIED"): ProgrammersHistoryPreview =>
    ({ status, candidates: [], skipped: 0 });
  const url = new URL(location.href);
  if (url.origin !== PROGRAMMERS_ORIGIN || url.pathname !== HISTORY_PATH) return empty("OWNERSHIP_UNVERIFIED");
  const statuses = url.searchParams.get("statuses")?.split(",").sort().join(",");
  if (statuses !== "solved,solved_with_unlock") return empty("OWNERSHIP_UNVERIFIED");
  if (![...document.querySelectorAll("button")].some(button => button.textContent?.trim() === "로그아웃") ||
      !document.querySelector('a[href="https://programmers.co.kr/users/profile"]')) return empty("LOGIN_REQUIRED");
  const rows = [...document.querySelectorAll<HTMLTableRowElement>("table tbody tr")];
  const candidates: ProgrammersHistoryCandidate[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const row of rows) {
    const status = row.querySelector<HTMLElement>("td.status");
    const link = row.querySelector<HTMLAnchorElement>('td.title a[href^="/learn/courses/30/lessons/"]');
    const match = link?.getAttribute("href")?.match(/^\/learn\/courses\/30\/lessons\/(\d{1,40})$/);
    const number = match?.[1];
    const title = link?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const solvedAt = status?.querySelector("[data-tip]")?.getAttribute("data-tip") ?? "";
    if (!status?.classList.contains("solved") || !number || !title || seen.has(number) ||
        !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(solvedAt)) {
      skipped += 1;
      continue;
    }
    seen.add(number);
    candidates.push({ problemNumber: number, title, solvedAt,
      problemUrl: `${PROGRAMMERS_ORIGIN}/learn/courses/30/lessons/${number}` });
  }
  return { status: "READY", candidates, skipped,
    truncated: !!document.querySelector('button[aria-label="다음 페이지"]:not([disabled])') };
}

/** Strictly parse one displayed solved-list page before the coordinator clicks pagination. */
export function readProgrammersSolvedListingPage(document: Document, location: Location): ProgrammersListingPage {
  const url = new URL(location.href);
  if (url.origin !== PROGRAMMERS_ORIGIN || url.pathname !== HISTORY_PATH || url.searchParams.get("order") !== "recent" ||
      url.searchParams.get("statuses") !== "solved,solved_with_unlock") return { status: "OWNERSHIP_UNVERIFIED" };
  const logout = [...document.querySelectorAll("button")].filter(button => normalizedText(button.textContent) === "로그아웃");
  const profiles = [...document.querySelectorAll<HTMLAnchorElement>('a[href="https://programmers.co.kr/users/profile"]')];
  if (logout.length !== 1 || profiles.length !== 1) return { status: "LOGIN_REQUIRED" };
  const totals = [...document.querySelectorAll<HTMLElement>(".total > .text")].map(element => normalizedText(element.textContent).match(/^(\d{1,7}) 문제$/)?.[1])
    .filter((value): value is string => !!value);
  const pages = [...document.querySelectorAll<HTMLElement>("[data-testid='page-active']")].map(element => normalizedText(element.textContent));
  if (totals.length !== 1 || pages.length !== 1 || !/^\d{1,6}$/.test(pages[0]!)) return { status: "PENDING" };
  const total = Number(totals[0]), page = Number(pages[0]);
  if (!Number.isSafeInteger(total) || total < 1 || total > 100_000 || page < 1) return { status: "INCOMPLETE" };
  const rows = [...document.querySelectorAll<HTMLTableRowElement>("table tbody tr")];
  const expected = Math.min(20, total - (page - 1) * 20);
  if (expected < 1 || rows.length !== expected) return { status: "PENDING" };
  const lessons: ProgrammersListingLesson[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const status = row.querySelector<HTMLElement>("td.status");
    const link = row.querySelector<HTMLAnchorElement>('td.title a[href^="/learn/courses/30/lessons/"]');
    const path = link?.getAttribute("href") ?? "";
    const match = path.match(/^\/learn\/courses\/30\/lessons\/(\d{1,40})$/);
    const title = normalizedText(link?.textContent);
    if (!status?.classList.contains("solved") || !match || !title || title.length > 500 || seen.has(match[1]!)) return { status: "INCOMPLETE" };
    seen.add(match[1]!);
    lessons.push({ problemNumber: match[1]!, title, lessonUrl: `${PROGRAMMERS_ORIGIN}${path}`, page, order: (page - 1) * 20 + index });
  }
  const next = document.querySelectorAll<HTMLButtonElement>("button[aria-label='다음 페이지']");
  const first = document.querySelectorAll<HTMLButtonElement>("button[aria-label='처음 페이지']");
  if (next.length !== 1 || first.length !== 1) return { status: "PENDING" };
  return { status: "READY", total, page, lessons, nextDisabled: next[0]!.disabled,
    signature: lessons.map(lesson => lesson.problemNumber).join(",") };
}
