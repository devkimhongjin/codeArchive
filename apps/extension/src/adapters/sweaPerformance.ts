import type { PerformanceData } from "../types";
import { SWEA_ORIGIN, SWEA_SOLVING_PATH } from "./sweaSelectors";

const PROBLEM_SOLVER_PATH = "/main/code/problem/problemSolver.do";
const RESULT_ROW_SELECTOR = ".box-list-inner > .problem_smt.right_answer";
const MAX_CURRENT_SUBMISSION_DELTA_MS = 90_000;
const RETRY_DELAYS_MS = [0, 350, 1_000, 2_000] as const;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Sleep = (delayMs: number) => Promise<void>;

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function metricValue(row: Element, label: string): string | null {
  for (const item of row.querySelectorAll(".info > ul > li")) {
    const spans = Array.from(item.querySelectorAll("span"));
    if (!spans.some((span) => normalizeText(span.textContent) === label)) continue;
    return normalizeText(spans.find((span) => normalizeText(span.textContent) !== label)?.textContent) || null;
  }
  return null;
}

function parseIntegerMetric(value: string | null, unit: string): number | null {
  const match = normalizeText(value).match(new RegExp(`^(0|[1-9]\\d{0,2}(?:,\\d{3})*)\\s*${unit}$`, "i"));
  if (!match?.[1]) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
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
  for (const selector of ["#Beginner", "header > div > span.name", "header span.name", "header .name", ".user_info .name"]) {
    const value = normalizeText(document.querySelector(selector)?.textContent);
    if (value) return value;
  }
  return null;
}

function submissionTime(row: Element): number | null {
  const text = normalizeText(row.querySelector(".submitter .smt_txt dd")?.textContent);
  const match = text.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if (!match?.[1] || !match[2]) return null;
  const parsed = Date.parse(`${match[1]}T${match[2]}${match[2].length === 5 ? ":00" : ""}+09:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowPerformance(row: Element, codeLength: number): PerformanceData | null {
  if (parseCodeLength(metricValue(row, "코드길이")) !== codeLength) return null;
  const memoryValue = parseIntegerMetric(metricValue(row, "메모리"), "kb");
  const executionTime = parseIntegerMetric(metricValue(row, "실행시간"), "ms");
  if (memoryValue === null || executionTime === null) return null;
  return { executionTime, memoryValue, memoryUnit: "KB" };
}

export function parseSweaPerformance(
  document: Document,
  nickname: string,
  code: string,
  observedAt: string
): PerformanceData | null {
  const observedTime = Date.parse(observedAt);
  const codeLength = sweaDisplayedCodeLength(code);
  if (!Number.isFinite(observedTime) || codeLength === null) return null;

  const candidates = Array.from(document.querySelectorAll(RESULT_ROW_SELECTOR)).flatMap((row) => {
    const submitted = submissionTime(row);
    const submitter = normalizeText(row.querySelector(".submitter .smt_txt dt")?.textContent);
    if (submitter !== nickname || submitted === null || Math.abs(submitted - observedTime) > MAX_CURRENT_SUBMISSION_DELTA_MS) return [];
    const performance = rowPerformance(row, codeLength);
    return performance ? [performance] : [];
  });
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

async function fetchOnce(
  document: Document,
  contestProbId: string,
  code: string,
  observedAt: string,
  nickname: string,
  fetcher: Fetcher
): Promise<PerformanceData | null> {
  const endpoint = new URL(PROBLEM_SOLVER_PATH, SWEA_ORIGIN);
  const response = await fetcher(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ contestProbId, nickName: nickname }).toString()
  });
  if (!response.ok) return null;
  if (response.url) {
    const responseUrl = new URL(response.url);
    if (responseUrl.origin !== SWEA_ORIGIN || responseUrl.pathname !== PROBLEM_SOLVER_PATH) return null;
  }

  const Parser = document.defaultView?.DOMParser ?? globalThis.DOMParser;
  if (!Parser) return null;
  const resultDocument = new Parser().parseFromString(await response.text(), "text/html");
  const resultIds = Array.from(resultDocument.querySelectorAll("#problemForm input[name='contestProbId']"))
    .map((input) => normalizeText((input as HTMLInputElement).value))
    .filter(Boolean);
  if (resultIds.length !== 1 || resultIds[0] !== contestProbId) return null;
  return parseSweaPerformance(resultDocument, nickname, code, observedAt);
}

export async function fetchSweaPerformance(
  document: Document,
  location: Location,
  contestProbId: string,
  code: string,
  observedAt: string,
  fetcher: Fetcher = fetch,
  sleep: Sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))
): Promise<PerformanceData | null> {
  if (location.origin !== SWEA_ORIGIN || location.pathname !== SWEA_SOLVING_PATH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(contestProbId)) return null;
  const nickname = visibleNickname(document);
  if (!nickname) return null;

  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    try {
      const performance = await fetchOnce(document, contestProbId, code, observedAt, nickname, fetcher);
      if (performance) return performance;
    } catch {
      // The accepted source capture remains valid when optional enrichment fails.
    }
  }
  return null;
}
