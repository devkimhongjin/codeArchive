export interface SubmissionPerformance {
  executionTime: string;
  memoryUsage: string;
}

export type SweaSubmissionPerformanceResult =
  | { status: "detected"; performance: SubmissionPerformance }
  | { status: "incomplete"; reason: "identity_unavailable" | "identity_mismatch" | "no_trusted_candidate" | "ambiguous_candidate" | "metrics_missing" };

const HISTORY_FORM_SELECTOR = "form#contestProbForm";
const ROW_SELECTOR = ".box-list .box-list-inner > .problem_smt";
const CURRENT_NICKNAME_SELECTORS = [
  "#Beginner",
  "header > div > span.name",
  "header span.name",
  "header .name",
  ".user_info .name",
] as const;
const RECENT_WINDOW_MS = 300_000;

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeNickname(value: string | null | undefined): string {
  return normalizeText(value).replace(/^#/, "").trim().toLowerCase();
}

function currentNickname(document: Document): string | null {
  for (const selector of CURRENT_NICKNAME_SELECTORS) {
    const value = normalizeNickname(document.querySelector(selector)?.textContent);
    if (value) return value;
  }
  return null;
}

function submittedAtMillis(row: Element): number | null {
  const text = normalizeText(row.querySelector(".submitter .smt_txt dd")?.textContent);
  const match = text.match(/제출일\s*:\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  const millis = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+09:00`);
  return Number.isFinite(millis) ? millis : null;
}

function labelledValues(row: Element): Map<string, string> {
  const values = new Map<string, string>();
  for (const item of row.querySelectorAll(".info > ul > li")) {
    const spans = Array.from(item.querySelectorAll("span"));
    if (spans.length < 2) continue;
    const value = normalizeText(spans[0]?.textContent);
    const label = normalizeText(spans[1]?.textContent);
    if (label && value) values.set(label, value);
  }
  return values;
}

export function detectSweaSubmissionPerformance(
  document: Document,
  observedAt: string,
  expectedContestProbId?: string | null,
): SweaSubmissionPerformanceResult {
  const form = document.querySelector(HISTORY_FORM_SELECTOR);
  const nickname = currentNickname(document);
  const observedMillis = Date.parse(observedAt);
  if (!form || !nickname || !Number.isFinite(observedMillis)) return { status: "incomplete", reason: "identity_unavailable" };

  if (expectedContestProbId) {
    const actualContestProbId = (form.querySelector<HTMLInputElement>('input[name="contestProbId"], #contestProbId')?.value ?? "").trim();
    if (!actualContestProbId) return { status: "incomplete", reason: "identity_unavailable" };
    if (actualContestProbId !== expectedContestProbId) return { status: "incomplete", reason: "identity_mismatch" };
  }

  const trusted: Array<{ distance: number; performance: SubmissionPerformance | null }> = [];
  for (const row of form.querySelectorAll(ROW_SELECTOR)) {
    const submitter = normalizeNickname(row.querySelector(".submitter .smt_txt dt")?.textContent);
    if (!submitter || submitter !== nickname) continue;

    const fields = labelledValues(row);
    if (normalizeText(fields.get("결과")).toLowerCase() !== "pass") continue;

    const submittedMillis = submittedAtMillis(row);
    if (submittedMillis === null) continue;
    const distance = Math.abs(observedMillis - submittedMillis);
    if (distance > RECENT_WINDOW_MS) continue;

    const memoryUsage = normalizeText(fields.get("메모리"));
    const executionTime = normalizeText(fields.get("시간"));
    trusted.push({ distance, performance: memoryUsage && executionTime ? { memoryUsage, executionTime } : null });
  }

  if (trusted.length === 0) return { status: "incomplete", reason: "no_trusted_candidate" };
  trusted.sort((a, b) => a.distance - b.distance);
  if (trusted.length > 1 && trusted[0].distance === trusted[1].distance) return { status: "incomplete", reason: "ambiguous_candidate" };
  if (!trusted[0].performance) return { status: "incomplete", reason: "metrics_missing" };
  return { status: "detected", performance: trusted[0].performance };
}
