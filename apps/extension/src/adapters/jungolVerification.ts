import type { Capture, PerformanceData } from "../types";

const ORIGIN = "https://jungol.co.kr";
const MAX_CLOCK_SKEW_MS = 2_000;

export function jungolSignedInHandle(document: Document): string | null {
  const handles = [...document.querySelectorAll("script")]
    .map((script) => script.textContent?.match(/"\$\/account\/my":\{data:\{id:\d+,handle:"([A-Za-z0-9_-]{1,64})"/)?.[1])
    .filter((handle): handle is string => Boolean(handle));
  return handles.length === 1 ? handles[0] ?? null : null;
}

export function jungolAcceptedIds(html: string, account: string, problemNumber: string, earliest?: number): number[] {
  const page = new DOMParser().parseFromString(html, "text/html");
  const ids: number[] = [];
  for (const row of page.querySelectorAll("table tbody tr")) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 8) continue;
    const href = cells[0]?.querySelector("a[href]")?.getAttribute("href");
    const link = href ? new URL(href, ORIGIN) : null;
    const sid = link?.searchParams.get("sid");
    const problemHref = cells[1]?.querySelector("a[href^='/problem/']")?.getAttribute("href");
    if (!sid || !/^\d+$/.test(sid) || link?.origin !== ORIGIN || link.searchParams.get("account") !== account || problemHref !== `/problem/${problemNumber}`) continue;
    if (cells[2]?.textContent?.replace(/\s+/g, " ").trim() !== "정답 100점") continue;
    const relativeTime = cells[7]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const minutes = relativeTime.match(/^(\d+)분 전$/);
    if ((minutes && Number(minutes[1]) >= 4) || /(?:시간|일|개월|년) 전$/.test(relativeTime)) continue;
    const id = Number(sid);
    if (!Number.isSafeInteger(id) || id <= 0 || ids.includes(id)) continue;
    if (earliest !== undefined) {
      // Svelte's server-rendered list carries the exact submission timestamp.
      // Ignore old rows before requesting any detail page, even when the
      // visible relative-time chip has become stale or locale-dependent.
      const record = html.match(new RegExp(`\\bp:${problemNumber},id:${id},r:"AC",s:100,[^}]{0,250}?\\bt:(\\d+)`));
      const submittedAt = record ? Number(record[1]) : NaN;
      if (!Number.isSafeInteger(submittedAt) || submittedAt < earliest - MAX_CLOCK_SKEW_MS) continue;
    }
    ids.push(id);
  }
  return ids.slice(0, 10);
}

function equivalentSource(left: string, right: string): boolean {
  return left.replace(/\r\n/g, "\n").replace(/\n+$/, "") === right.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

function equivalentLanguage(left: string, right: string): boolean {
  return left.replace(/[^a-z0-9]/gi, "").toUpperCase() === right.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function parseVerifiedJungolDetail(
  html: string,
  id: number,
  account: string,
  capture: Capture,
  attemptStartedAt: number,
  now: number
): { submittedAt: number; performance: PerformanceData } | null {
  const marker = `"$/submission/${id}":{data:{`;
  const start = html.indexOf(marker);
  if (start < 0 || html.indexOf(marker, start + marker.length) >= 0) return null;
  const end = html.indexOf(",problemInfo:", start);
  if (end < 0) return null;
  const detail = html.slice(start, end);
  if (!/\bm_reason:"AC",score:100\b/.test(detail)) return null;
  const accountMatch = detail.match(/\badditional:\{account:"([A-Za-z0-9_-]+)",time:(\d+)/);
  const accountInfoMatch = detail.match(/\baccountInfo:\{[^}]{0,160}?\bhandle:"([A-Za-z0-9_-]+)"/);
  const sourceMatch = detail.match(/\bsource:\[\{name:("(?:\\.|[^"\\])*"),source:("(?:\\.|[^"\\])*")\}\],size:/);
  const languageMatch = detail.match(/\baltLanguage:"([A-Za-z0-9_+.-]+)"/);
  const problemMatch = detail.match(/\bproblemId:(\d+)/);
  const submissionMatch = detail.match(/\bsubmissionId:(\d+)/);
  const timeMatch = detail.match(/\bm_time:(\d+)/);
  const memoryMatch = detail.match(/\bm_memory:(\d+)/);
  if (!accountMatch || !accountInfoMatch || !sourceMatch || !languageMatch || !problemMatch || !submissionMatch || !timeMatch || !memoryMatch) return null;
  if (accountMatch[1] !== account || accountInfoMatch[1] !== account || Number(problemMatch[1]) !== Number(capture.problemNumber) || Number(submissionMatch[1]) !== id) return null;
  if (!equivalentLanguage(languageMatch[1]!, capture.language)) return null;
  let source: string;
  try { source = JSON.parse(sourceMatch[2]!); } catch { return null; }
  if (!equivalentSource(source, capture.sourceCode)) return null;
  const submittedAt = Number(accountMatch[2]);
  if (!Number.isSafeInteger(submittedAt) || submittedAt < attemptStartedAt - MAX_CLOCK_SKEW_MS || submittedAt > now + MAX_CLOCK_SKEW_MS) return null;
  const executionTime = Number(timeMatch[1]);
  const memoryValue = Number(memoryMatch[1]);
  if (!Number.isFinite(executionTime) || !Number.isFinite(memoryValue) || executionTime < 0 || memoryValue < 0) return null;
  return { submittedAt, performance: { executionTime, memoryValue, memoryUnit: "KB", memoryUsage: memoryValue / 1024 } };
}

export async function verifyJungolCapture(
  capture: Capture,
  account: string,
  attemptStartedAt: number,
  request: typeof fetch = fetch
): Promise<Capture | null> {
  const options: RequestInit = { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(6_000) };
  const list = await request(`${ORIGIN}/submission?account=${encodeURIComponent(account)}`, options);
  if (!list.ok) return null;
  const ids = jungolAcceptedIds(await list.text(), account, capture.problemNumber, attemptStartedAt);
  if (ids.length === 0) return null;
  const matches: Array<{ submittedAt: number; performance: PerformanceData }> = [];
  for (const id of ids) {
    const detail = await request(`${ORIGIN}/submission?account=${encodeURIComponent(account)}&sid=${id}`, options);
    if (!detail.ok) continue;
    const verified = parseVerifiedJungolDetail(await detail.text(), id, account, capture, attemptStartedAt, Date.now());
    if (verified) matches.push(verified);
    if (matches.length > 1) return null; // Ambiguous same-code submissions must never be guessed.
  }
  if (matches.length !== 1) return null;
  return { ...capture, ...matches[0]!.performance, solvedAt: new Date(matches[0]!.submittedAt).toISOString() };
}
