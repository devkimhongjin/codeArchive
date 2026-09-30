const SWEA_ORIGIN = "https://swexpertacademy.com";
const HISTORY_PATH = "/main/userpage/code/userSubmitProblem.do";
const MAX_VISIBLE_CARDS = 30;

export interface SweaHistoryCandidate {
  problemNumber: string;
  title: string;
  contestProbId: string;
}

export type SweaHistoryPreview =
  | { status: "LOGIN_REQUIRED" | "OWNERSHIP_UNVERIFIED"; candidates: []; skipped: 0 }
  | { status: "READY"; candidates: SweaHistoryCandidate[]; skipped: number; truncated: boolean };

function codeMenuUserId(document: Document): string | null {
  const link = [...document.querySelectorAll<HTMLAnchorElement>('a[href], a[onclick]')]
    .find(anchor => anchor.textContent?.trim() === "Code" &&
      /fnMoveToMenu/.test(anchor.getAttribute("href") ?? anchor.getAttribute("onclick") ?? ""));
  const action = link?.getAttribute("onclick") ?? link?.getAttribute("href") ?? "";
  return action.match(/^(?:javascript:)?fnMoveToMenu\('CODE','([A-Za-z0-9_-]{1,100})'\);?$/)?.[1] ?? null;
}

/** This endpoint is the signed-in user's own profile, unlike a userId-parametrized My Page. */
export function authenticatedSweaUserId(profile: Document): string | null {
  return codeMenuUserId(profile);
}

export async function loadSweaHistoryPreview(document: Document, location: Location): Promise<SweaHistoryPreview> {
  try {
    const profileUrl = `${SWEA_ORIGIN}/main/userpage/userInformation.do`;
    const response = await fetch(profileUrl, { credentials: "include", redirect: "error" });
    if (!response.ok || response.url !== profileUrl) return { status: "LOGIN_REQUIRED", candidates: [], skipped: 0 };
    const profile = new DOMParser().parseFromString(await response.text(), "text/html");
    return previewSweaHistory(document, location, authenticatedSweaUserId(profile));
  } catch {
    return { status: "LOGIN_REQUIRED", candidates: [], skipped: 0 };
  }
}

/** My Page groups by problem, not by submission; these are only problems to inspect. */
export function previewSweaHistory(document: Document, location: Location, authenticatedUserId: string | null = null): SweaHistoryPreview {
  const empty = (status: "LOGIN_REQUIRED" | "OWNERSHIP_UNVERIFIED"): SweaHistoryPreview =>
    ({ status, candidates: [], skipped: 0 });
  if (location.origin !== SWEA_ORIGIN || location.pathname !== HISTORY_PATH) return empty("OWNERSHIP_UNVERIFIED");
  const signedInName = document.querySelector(".my-login .name")?.textContent?.trim();
  if (!signedInName) return empty("LOGIN_REQUIRED");
  const queryUserId = new URL(location.href).searchParams.get("userId");
  const userId = codeMenuUserId(document);
  if (!userId || !authenticatedUserId || authenticatedUserId !== userId ||
      (queryUserId && queryUserId !== userId)) return empty("OWNERSHIP_UNVERIFIED");
  const pageName = document.querySelector(".mypage_wrap .my_label .nick")?.textContent?.trim();
  if (!pageName || pageName !== signedInName) {
    return empty("OWNERSHIP_UNVERIFIED");
  }

  const cards = [...document.querySelectorAll<HTMLElement>("#submitProb .widget-box-sub")];
  const candidates: SweaHistoryCandidate[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const card of cards.slice(0, MAX_VISIBLE_CARDS)) {
    const number = card.querySelector(".week_num")?.textContent?.trim().match(/^(\d{1,40})\.$/)?.[1];
    const link = card.querySelector<HTMLAnchorElement>(".week_text a[onclick]");
    const title = link?.textContent?.trim() ?? "";
    const match = link?.getAttribute("onclick")?.match(/^javascript:fn_move_prob\('([A-Za-z0-9_-]{1,100})','N','CODE','','\1',''\);?$/);
    const unfinished = card.textContent?.includes("풀이중") ?? false;
    if (!number || !title || !match || unfinished || seen.has(number)) {
      skipped += 1;
      continue;
    }
    seen.add(number);
    candidates.push({ problemNumber: number, title, contestProbId: match[1]! });
  }
  return { status: "READY", candidates, skipped, truncated: cards.length > MAX_VISIBLE_CARDS };
}
