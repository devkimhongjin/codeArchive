import { normalizeText } from "./dom";

/**
 * Baekjoon Online Judge (acmicpc.net). The site now serves the bare host and
 * redirects www to it; both are accepted so a switch back does not break capture.
 * Pages are read in their Korean layout only: an unknown layout reads as nothing.
 */
export const BAEKJOON_ORIGIN = "https://acmicpc.net";
export const BAEKJOON_ORIGINS: readonly string[] = ["https://acmicpc.net", "https://www.acmicpc.net"];
/** /submit/1000, or /submit/1000/105249231 when resubmitting a previous code. */
export const BAEKJOON_SUBMIT_PATH = /^\/submit\/(\d{1,40})(?:\/\d{1,40})?\/?$/;
export const BAEKJOON_STATUS_PATH = "/status";
export const BAEKJOON_SOURCE_PATH = /^\/source\/(\d{1,40})\/?$/;
/** Baekjoon ids are letters, digits and underscores. */
export const BAEKJOON_USERNAME = /^[A-Za-z0-9_]{1,40}$/;
export const BAEKJOON_SOURCE_SELECTOR = "#submit_form textarea#source[name=\"source\"]";
export const BAEKJOON_SUBMIT_BUTTON_ID = "submit_button";

export function isBaekjoonOrigin(origin: string): boolean { return BAEKJOON_ORIGINS.includes(origin); }

export function baekjoonProblemUrl(problemNumber: string): string { return `${BAEKJOON_ORIGIN}/problem/${problemNumber}`; }
export function baekjoonSourceUrl(submissionId: string): string { return `${BAEKJOON_ORIGIN}/source/${submissionId}`; }

/** The signed-in id from the top bar's own profile link, or null when it is absent or unclear. */
export function baekjoonUsername(document: Document): string | null {
  const links = [...document.querySelectorAll<HTMLAnchorElement>(".loginbar a.username")];
  if (links.length !== 1) return null;
  const href = links[0]!.getAttribute("href") ?? "", name = normalizeText(links[0]!.textContent);
  return BAEKJOON_USERNAME.test(name) && href === `/user/${name}` ? name : null;
}

/** A visitor's top bar links the login page and has no own profile link. */
export function baekjoonSignedOut(document: Document): boolean {
  const bar = document.querySelector(".loginbar");
  return !!bar && !bar.querySelector("a.username") && !!bar.querySelector('a[href^="/login"]');
}

export function baekjoonSubmitControl(element: Element): boolean {
  return element.tagName === "BUTTON" && element.id === BAEKJOON_SUBMIT_BUTTON_ID && !!element.closest("#submit_form");
}

/** The language picker's selected entry on the submit form, e.g. "C++17". */
export function baekjoonSelectedLanguage(document: Document): string | null {
  const select = document.querySelector<HTMLSelectElement>("#submit_form select#language");
  const options = select ? [...select.querySelectorAll<HTMLOptionElement>("option")].filter(option => option.selected) : [];
  if (options.length !== 1) return null;
  const label = normalizeText(options[0]!.textContent);
  return label && label.length <= 100 ? label : null;
}

/** Bytes as Baekjoon counts a source in its 코드 길이 column. */
export function utf8Length(value: string): number { return new TextEncoder().encode(value).length; }

const ACCEPTED_TEXT = /^(?:맞았습니다!!|Accepted|100\s*점|100 points)$/;

/** Only a full accept: "맞았습니다!!", or 100 points on a scored problem. Partial scores never count. */
export function baekjoonAcceptedText(value: string | null | undefined): boolean {
  const text = normalizeText(value);
  const counted = text.match(/^(.*?)\s*\((\d+)\/(\d+)\)$/);
  if (counted) return counted[2] === counted[3] && ACCEPTED_TEXT.test(counted[1]!);
  return ACCEPTED_TEXT.test(text);
}

function integer(value: string | null | undefined): number | undefined {
  const text = normalizeText(value).replace(/,/g, "");
  if (!/^\d{1,12}$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** data-timestamp is the server's submission time in Unix seconds. */
function submittedAt(row: Element): string | undefined {
  const stamps = row.querySelectorAll("[data-timestamp]");
  if (stamps.length !== 1) return undefined;
  const seconds = integer(stamps[0]!.getAttribute("data-timestamp"));
  return seconds && seconds > 1_000_000_000 ? new Date(seconds * 1000).toISOString() : undefined;
}

function headerIndexes(table: Element | null): Map<string, number> {
  const headers = [...(table?.querySelector("thead > tr")?.children ?? [])].map(cell => normalizeText(cell.textContent));
  return new Map(headers.map((label, index) => [label, index]));
}

/** Plain element APIs, so the same reader works on pages and in test DOMs without table helpers. */
export function tableBodyRows(table: Element): HTMLTableRowElement[] {
  return [...table.querySelectorAll<HTMLTableRowElement>("tbody > tr")];
}
const cellsOf = (row: Element) => [...row.children].filter(cell => cell.tagName === "TD" || cell.tagName === "TH");

export type BaekjoonStatusRow = {
  row: HTMLTableRowElement;
  submissionId: string;
  username: string;
  problemNumber: string;
  title: string;
  /** The site's colour key: wait/compile/judging while running, ac for accepted. */
  resultColor: string;
  accepted: boolean;
  /** A final result other than a full accept; an unknown colour keeps waiting. */
  rejected: boolean;
  language: string;
  codeLength?: number;
  timeMs?: number;
  memoryKb?: number;
  submittedAt?: string;
  /** The row links the source page, which the site shows only for the owner. */
  ownSource: boolean;
};

const REJECTED_COLORS = new Set(["pe", "wa", "tle", "mle", "ole", "rte", "ce", "pac", "del"]);

/** One row of a 채점 현황 table, or null when any identity cell is unclear. */
export function readBaekjoonStatusRow(row: HTMLTableRowElement, indexes: Map<string, number> = headerIndexes(row.closest("table"))): BaekjoonStatusRow | null {
  const submissionId = row.id.match(/^solution-(\d{1,40})$/)?.[1];
  const cells = cellsOf(row);
  if (!submissionId || normalizeText(cells[0]?.textContent) !== submissionId) return null;
  const users = row.querySelectorAll<HTMLAnchorElement>('a[href^="/user/"]');
  const username = users.length === 1 ? normalizeText(users[0]!.textContent) : "";
  if (!BAEKJOON_USERNAME.test(username) || users[0]!.getAttribute("href") !== `/user/${username}`) return null;
  const problems = row.querySelectorAll<HTMLAnchorElement>('a.problem_title[href^="/problem/"]');
  const problemNumber = problems.length === 1 ? problems[0]!.getAttribute("href")!.match(/^\/problem\/(\d{1,40})$/)?.[1] : undefined;
  if (!problemNumber || normalizeText(problems[0]!.textContent) !== problemNumber) return null;
  // Bootstrap moves the tooltip text from title to data-original-title once it starts.
  const title = normalizeText(problems[0]!.getAttribute("data-original-title") || problems[0]!.getAttribute("title"));
  const results = row.querySelectorAll<HTMLElement>("td.result span.result-text");
  if (results.length !== 1) return null;
  const result = results[0]!, resultColor = result.getAttribute("data-color") ?? "";
  const accepted = resultColor === "ac" && result.classList.contains("result-ac") && baekjoonAcceptedText(result.textContent);
  const languageIndex = indexes.get("언어"), lengthIndex = indexes.get("코드 길이");
  const languageCell = languageIndex === undefined ? undefined : cells[languageIndex];
  const sourceLinks = languageCell?.querySelectorAll<HTMLAnchorElement>(`a[href="/source/${submissionId}"]`) ?? [];
  const language = normalizeText(sourceLinks.length === 1 ? sourceLinks[0]!.textContent : languageCell?.textContent);
  if (!language || language.length > 100) return null;
  const memory = row.querySelectorAll("td.memory"), time = row.querySelectorAll("td.time");
  return {
    row, submissionId, username, problemNumber, title, resultColor, accepted,
    rejected: REJECTED_COLORS.has(resultColor) || (resultColor === "ac" && !accepted), language,
    codeLength: lengthIndex === undefined ? undefined : integer(cells[lengthIndex]?.textContent),
    timeMs: time.length === 1 ? integer(time[0]!.textContent) : undefined,
    memoryKb: memory.length === 1 ? integer(memory[0]!.textContent) : undefined,
    submittedAt: submittedAt(row),
    ownSource: sourceLinks.length === 1
  };
}

export function readBaekjoonStatusRows(document: Document): BaekjoonStatusRow[] {
  const table = document.querySelector("table#status-table");
  if (!table) return [];
  const indexes = headerIndexes(table);
  return tableBodyRows(table).flatMap(row => readBaekjoonStatusRow(row, indexes) ?? []);
}

export type BaekjoonSourcePage = {
  submissionId: string;
  username: string;
  problemNumber: string;
  title: string;
  accepted: boolean;
  language: string;
  sourceCode: string;
  codeLength?: number;
  timeMs?: number;
  memoryKb?: number;
  submittedAt?: string;
};

/** The owner's own /source/{id} page: its read-only source and the one-row submission table. */
export function readBaekjoonSourcePage(document: Document, location: Location): BaekjoonSourcePage | null {
  if (!isBaekjoonOrigin(location.origin)) return null;
  const submissionId = location.pathname.match(BAEKJOON_SOURCE_PATH)?.[1];
  if (!submissionId) return null;
  const sources = document.querySelectorAll<HTMLTextAreaElement>('textarea.codemirror-textarea[name="source"]');
  if (sources.length !== 1) return null;
  const sourceCode = sources[0]!.value;
  if (!sourceCode.trim() || sourceCode.length > 1_000_000) return null;
  const tables = [...document.querySelectorAll("table")].filter(table => headerIndexes(table).has("문제 제목"));
  if (tables.length !== 1) return null;
  const indexes = headerIndexes(tables[0]!);
  const rows = tableBodyRows(tables[0]!);
  if (rows.length !== 1) return null;
  const row = rows[0]!, cells = cellsOf(row);
  const cell = (label: string) => { const index = indexes.get(label); return index === undefined ? undefined : cells[index]; };
  if (normalizeText(cell("제출 번호")?.textContent) !== submissionId) return null;
  const users = cell("아이디")?.querySelectorAll<HTMLAnchorElement>('a[href^="/user/"]') ?? [];
  const username = users.length === 1 ? normalizeText(users[0]!.textContent) : "";
  if (!BAEKJOON_USERNAME.test(username) || users[0]!.getAttribute("href") !== `/user/${username}`) return null;
  const problems = cell("문제")?.querySelectorAll<HTMLAnchorElement>('a[href^="/problem/"]') ?? [];
  const problemNumber = problems.length === 1 ? problems[0]!.getAttribute("href")!.match(/^\/problem\/(\d{1,40})$/)?.[1] : undefined;
  if (!problemNumber || normalizeText(problems[0]!.textContent) !== problemNumber) return null;
  const title = normalizeText(cell("문제 제목")?.textContent);
  const language = normalizeText(cell("언어")?.textContent);
  if (!title || title.length > 500 || !language || language.length > 100) return null;
  const results = cell("결과")?.querySelectorAll<HTMLElement>('span[class*="result-"]') ?? [];
  const accepted = results.length === 1 && results[0]!.classList.contains("result-ac") && baekjoonAcceptedText(results[0]!.textContent);
  return {
    submissionId, username, problemNumber, title, accepted, language, sourceCode,
    codeLength: integer(cell("코드 길이")?.textContent),
    timeMs: integer(cell("시간")?.textContent),
    memoryKb: integer(cell("메모리")?.textContent),
    submittedAt: submittedAt(row)
  };
}

/** Site metrics: time in ms, memory in KB as labelled. */
export function baekjoonPerformance(row: { timeMs?: number; memoryKb?: number }) {
  return {
    ...(row.timeMs === undefined ? {} : { executionTime: row.timeMs }),
    ...(row.memoryKb === undefined ? {} : { memoryValue: row.memoryKb, memoryUnit: "KB" as const, memoryUsage: row.memoryKb / 1024 })
  };
}
