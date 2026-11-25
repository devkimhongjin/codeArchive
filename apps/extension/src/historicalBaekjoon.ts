import {
  BAEKJOON_ORIGIN, BAEKJOON_STATUS_PATH, BAEKJOON_USERNAME, baekjoonUsername, isBaekjoonOrigin, readBaekjoonSourcePage,
  readBaekjoonStatusRows, tableBodyRows, utf8Length
} from "./adapters/baekjoonSelectors";

/**
 * Baekjoon answers script requests with an empty body, so every page is read
 * from a real page load in a tab the extension opened. These readers run in
 * that tab's content script and only parse what is already on the page.
 */
export const BAEKJOON_ACCEPTED_RESULT_ID = "4";

export type BaekjoonHistoryCandidate = {
  submissionId: string; problemNumber: string; title: string; language: string; solvedAt: string;
  codeLength: number; executionTime?: number; memoryValue?: number;
};

/** The signed-in user's accepted submissions, newest first, 20 per page; `top` continues below a submission id. */
export function baekjoonListingUrl(username: string, top?: string): string {
  const url = new URL(BAEKJOON_STATUS_PATH, BAEKJOON_ORIGIN);
  url.searchParams.set("user_id", username);
  url.searchParams.set("result_id", BAEKJOON_ACCEPTED_RESULT_ID);
  if (top !== undefined) url.searchParams.set("top", top);
  return url.href;
}

/** Only an own accepted-submission listing: user_id, result_id=4 and an optional numeric top. */
export function baekjoonListingUser(value: string | URL): string | null {
  try {
    const url = value instanceof URL ? value : new URL(value);
    if (!isBaekjoonOrigin(url.origin) || url.pathname !== BAEKJOON_STATUS_PATH) return null;
    const user = url.searchParams.get("user_id") ?? "";
    const allowed = new Set(["user_id", "result_id", "top", "problem_id", "language_id"]);
    if (![...url.searchParams.keys()].every(key => allowed.has(key)) || url.searchParams.getAll("user_id").length !== 1 ||
        url.searchParams.get("result_id") !== BAEKJOON_ACCEPTED_RESULT_ID || !BAEKJOON_USERNAME.test(user)) return null;
    const top = url.searchParams.get("top");
    if (top !== null && !/^\d{1,40}$/.test(top)) return null;
    if ((url.searchParams.get("problem_id") ?? "") !== "" || !["", "-1"].includes(url.searchParams.get("language_id") ?? "")) return null;
    return user;
  } catch { return null; }
}

export type BaekjoonListingPage =
  | { status: "READY"; username: string; candidates: BaekjoonHistoryCandidate[]; nextUrl: string | null }
  | { status: "LOGIN_REQUIRED" | "NOT_OWNER" | "UNREADABLE" };

/** One page of the own accepted list. Any row that cannot be read makes the page unreadable. */
export function readBaekjoonListingPage(document: Document, location: Location): BaekjoonListingPage {
  const listed = baekjoonListingUser(location.href);
  const signedIn = baekjoonUsername(document);
  if (!listed) return { status: "UNREADABLE" };
  if (!signedIn) return { status: "LOGIN_REQUIRED" };
  if (signedIn !== listed) return { status: "NOT_OWNER" };
  const table = document.querySelector("table#status-table");
  if (!table) return { status: "UNREADABLE" };
  const bodyRows = tableBodyRows(table);
  const rows = readBaekjoonStatusRows(document);
  if (rows.length !== bodyRows.length) return { status: "UNREADABLE" };
  const candidates: BaekjoonHistoryCandidate[] = [];
  for (const row of rows) {
    if (row.username !== listed) return { status: "NOT_OWNER" };
    // A rejudged row can leave the filter's colour; it is simply not a candidate.
    if (!row.accepted) continue;
    if (!row.ownSource || !row.title || !row.submittedAt || row.codeLength === undefined) return { status: "UNREADABLE" };
    candidates.push({ submissionId: row.submissionId, problemNumber: row.problemNumber, title: row.title, language: row.language,
      solvedAt: row.submittedAt, codeLength: row.codeLength,
      ...(row.timeMs === undefined ? {} : { executionTime: row.timeMs }), ...(row.memoryKb === undefined ? {} : { memoryValue: row.memoryKb }) });
  }
  const links = document.querySelectorAll<HTMLAnchorElement>("a#next_page");
  let nextUrl: string | null = null;
  if (links.length === 1) {
    try {
      const next = new URL(links[0]!.getAttribute("href") ?? "", location.origin);
      const top = next.searchParams.get("top");
      const lowest = rows.map(row => row.submissionId).sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
      // The next page must continue this list strictly below what was read here.
      if (baekjoonListingUser(next) !== listed || !top || (lowest && (top.length > lowest.length || (top.length === lowest.length && top >= lowest))))
        return { status: "UNREADABLE" };
      nextUrl = baekjoonListingUrl(listed, top);
    } catch { return { status: "UNREADABLE" }; }
  } else if (links.length > 1) return { status: "UNREADABLE" };
  return { status: "READY", username: listed, candidates, nextUrl };
}

export type BaekjoonSourceRead =
  | { status: "DONE"; sourceCode: string; title: string }
  | { status: "LOGIN_REQUIRED" | "DETAIL_UNVERIFIED" };

/** The selected submission's own source page, checked against the listing row it came from. */
export function readBaekjoonSourceForCandidate(document: Document, location: Location, expected: { username: string; candidate: BaekjoonHistoryCandidate }): BaekjoonSourceRead {
  const signedIn = baekjoonUsername(document);
  if (!signedIn) return { status: "LOGIN_REQUIRED" };
  const page = readBaekjoonSourcePage(document, location);
  const candidate = expected.candidate;
  if (!page || signedIn !== expected.username || page.username !== signedIn || page.submissionId !== candidate.submissionId ||
      page.problemNumber !== candidate.problemNumber || !page.accepted || page.language !== candidate.language ||
      page.submittedAt !== candidate.solvedAt || page.codeLength !== candidate.codeLength ||
      ![page.sourceCode, page.sourceCode.trimEnd(), page.sourceCode.trim()].some(value => utf8Length(value) === candidate.codeLength)) return { status: "DETAIL_UNVERIFIED" };
  return { status: "DONE", sourceCode: page.sourceCode, title: page.title };
}

export function isBaekjoonHistoryCandidate(value: unknown): value is BaekjoonHistoryCandidate {
  if (!value || typeof value !== "object") return false;
  const item = value as BaekjoonHistoryCandidate;
  const metric = (number: unknown) => number === undefined || (typeof number === "number" && Number.isSafeInteger(number) && number >= 0);
  return typeof item.submissionId === "string" && /^\d{1,40}$/.test(item.submissionId) && typeof item.problemNumber === "string" && /^\d{1,40}$/.test(item.problemNumber) &&
    typeof item.title === "string" && item.title.length > 0 && item.title.length <= 500 && typeof item.language === "string" && item.language.length > 0 && item.language.length <= 100 &&
    typeof item.solvedAt === "string" && Number.isFinite(Date.parse(item.solvedAt)) && typeof item.codeLength === "number" && Number.isSafeInteger(item.codeLength) && item.codeLength > 0 &&
    metric(item.executionTime) && metric(item.memoryValue);
}
