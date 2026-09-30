const PROGRAMMERS_ORIGIN = "https://school.programmers.co.kr";
const HISTORY_PATH = "/learn/challenges";

export interface ProgrammersHistoryCandidate {
  problemNumber: string;
  title: string;
  solvedAt: string;
  problemUrl: string;
}

export type ProgrammersHistoryPreview =
  | { status: "LOGIN_REQUIRED" | "OWNERSHIP_UNVERIFIED"; candidates: []; skipped: 0 }
  | { status: "READY"; candidates: ProgrammersHistoryCandidate[]; skipped: number; truncated: boolean };

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
