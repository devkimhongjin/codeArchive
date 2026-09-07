import type { SubmissionPerformance } from "../../solution";

const SWEA_ORIGIN = "https://swexpertacademy.com";
const PROBLEM_DETAIL_PATH = "/main/code/problem/problemDetail.do";
const PROBLEM_SOLVER_PATH = "/main/code/problem/problemSolver.do";
const RESULT_ROW_SELECTOR = ".box-list-inner > .problem_smt.right_answer";
const MAX_CURRENT_SUBMISSION_DELTA_MS = 90_000;
const METRIC_LABELS = {
  memoryUsage: "메모리",
  executionTime: "실행시간",
  codeLength: "코드길이",
} as const;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function exactProblemReferrer(referrer: string): boolean {
  try {
    const referrerUrl = new URL(referrer);
    return referrerUrl.origin === SWEA_ORIGIN && referrerUrl.pathname === PROBLEM_DETAIL_PATH;
  } catch {
    return false;
  }
}

function metricValue(row: Element, label: string): string | null {
  const items = Array.from(row.querySelectorAll(".info > ul > li"));
  const item = items.find((candidate) => {
    const spans = Array.from(candidate.querySelectorAll("span"));
    return spans.some((span) => normalizeText(span.textContent) === label);
  });
  if (!item) return null;
  const spans = Array.from(item.querySelectorAll("span"));
  const value = spans.find((span) => normalizeText(span.textContent) !== label);
  return value ? normalizeText(value.textContent) : null;
}

function parseMemory(value: string | null): string | null {
  const match = normalizeText(value).match(/^(0|[1-9]\d{0,2}(?:,\d{3})*)\s+kb$/);
  if (!match) return null;
  return `${Number(match[1].replace(/,/g, "")).toLocaleString("en-US")} kb`;
}

function parseExecutionTime(value: string | null): string | null {
  const match = normalizeText(value).match(/^(0|[1-9]\d*)\s+ms$/);
  return match ? `${match[1]} ms` : null;
}

function parseCodeLength(value: string | null): number | null {
  const normalized = normalizeText(value);
  if (!/^(0|[1-9]\d{0,2}(?:,\d{3})*)$/.test(normalized)) return null;
  const parsed = Number(normalized.replace(/,/g, ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function sweaDisplayedCodeLength(code: string): number | null {
  let length = 0;
  for (const character of code) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint > 0xffff) return null;
    length += codePoint <= 0x7f ? 1 : 2;
  }
  return length;
}

function visibleNickname(document: Document): string | null {
  const selectors = [
    "#Beginner",
    "header > div > span.name",
    "header span.name",
    "header .name",
    ".user_info .name",
  ];
  for (const selector of selectors) {
    const value = normalizeText(document.querySelector(selector)?.textContent);
    if (value) return value;
  }
  return null;
}

function submissionTime(row: Element): number | null {
  const text = normalizeText(row.querySelector(".submitter .smt_txt dd")?.textContent);
  const match = text.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if (!match) return null;
  const parsed = Date.parse(`${match[1]}T${match[2]}${match[2].length === 5 ? ":00" : ""}+09:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

function submitter(row: Element): string | null {
  const value = normalizeText(row.querySelector(".submitter .smt_txt dt")?.textContent);
  return value || null;
}

function rowPerformance(row: Element, code: string): SubmissionPerformance | null {
  const memoryUsage = parseMemory(metricValue(row, METRIC_LABELS.memoryUsage));
  const executionTime = parseExecutionTime(metricValue(row, METRIC_LABELS.executionTime));
  const codeLength = parseCodeLength(metricValue(row, METRIC_LABELS.codeLength));
  const sourceLength = sweaDisplayedCodeLength(code);
  if (!memoryUsage || !executionTime || codeLength === null || sourceLength === null || codeLength !== sourceLength) return null;
  return { memoryUsage, executionTime };
}

export function parseSweaPerformance(
  document: Document,
  nickname: string,
  code: string,
  observedAt: string,
): SubmissionPerformance | null {
  const observedTime = Date.parse(observedAt);
  if (!Number.isFinite(observedTime)) return null;
  const rows = Array.from(document.querySelectorAll(RESULT_ROW_SELECTOR));
  const candidates = rows.filter((row) => {
    const submitted = submissionTime(row);
    return submitter(row) === nickname
      && submitted !== null
      && Math.abs(submitted - observedTime) <= MAX_CURRENT_SUBMISSION_DELTA_MS;
  });
  if (candidates.length !== 1) return null;
  return rowPerformance(candidates[0], code);
}

export async function fetchSweaPerformance(
  document: Document,
  url: URL,
  problemContestId: string | null,
  code: string,
  observedAt: string,
  fetcher: Fetcher = fetch,
  referrer: string = document.referrer,
): Promise<SubmissionPerformance | undefined> {
  if (url.origin !== SWEA_ORIGIN || url.pathname !== "/main/solvingProblem/solvingProblem.do") return undefined;
  if (!problemContestId || !exactProblemReferrer(referrer)) return undefined;
  const nickname = visibleNickname(document);
  if (!nickname) return undefined;

  const endpoint = new URL(PROBLEM_SOLVER_PATH, SWEA_ORIGIN);
  const response = await fetcher(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ contestProbId: problemContestId, nickName: nickname }).toString(),
  });
  if (!response.ok || new URL(response.url || endpoint.href).pathname !== PROBLEM_SOLVER_PATH) return undefined;
  const resultDocument = new DOMParser().parseFromString(await response.text(), "text/html");
  const resultIds = Array.from(resultDocument.querySelectorAll("#problemForm input[name='contestProbId']"))
    .map((input) => normalizeText((input as HTMLInputElement).value))
    .filter(Boolean);
  if (resultIds.length !== 1 || resultIds[0] !== problemContestId) return undefined;
  return parseSweaPerformance(resultDocument, nickname, code, observedAt) ?? undefined;
}
