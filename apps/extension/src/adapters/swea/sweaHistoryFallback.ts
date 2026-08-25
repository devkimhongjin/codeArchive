import {
  SWEA_CONTEST_PROBLEM_DETAIL_PATH,
  SWEA_PROBLEM_DETAIL_PATH,
  SWEA_USER_PROBLEM_DETAIL_PATH,
} from "./sweaSelectors";

export type SweaProblemFamily = "Problem" | "ContestProblem" | "UserProblem";

export interface SweaFamilyContext {
  family: SweaProblemFamily;
  referrerUrl: string;
  contestProbId: string;
}

const SWEA_ORIGIN = "https://swexpertacademy.com";
const CACHE_PREFIX = "codearchive:swea-family:";

const DETAIL_PATH_TO_FAMILY: Record<string, SweaProblemFamily> = {
  [SWEA_PROBLEM_DETAIL_PATH]: "Problem",
  [SWEA_CONTEST_PROBLEM_DETAIL_PATH]: "ContestProblem",
  [SWEA_USER_PROBLEM_DETAIL_PATH]: "UserProblem",
};

const FAMILY_PREFIX: Record<SweaProblemFamily, string> = {
  Problem: "/main/code/problem/",
  ContestProblem: "/main/code/contestProblem/",
  UserProblem: "/main/code/userProblem/",
};

export function familyFromReferrer(referrer: string): SweaProblemFamily | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.origin !== SWEA_ORIGIN) return null;
    return DETAIL_PATH_TO_FAMILY[url.pathname] ?? null;
  } catch {
    return null;
  }
}

export function trustedFamilyContext(referrer: string, contestProbId: string | null): SweaFamilyContext | null {
  if (!contestProbId) return null;
  const family = familyFromReferrer(referrer);
  if (!family) return null;
  return { family, referrerUrl: referrer, contestProbId };
}

export function cacheSweaFamilyContext(storage: Storage, context: SweaFamilyContext): void {
  storage.setItem(`${CACHE_PREFIX}${context.contestProbId}`, JSON.stringify(context));
}

export function readCachedSweaFamilyContext(storage: Storage, contestProbId: string): SweaFamilyContext | null {
  const raw = storage.getItem(`${CACHE_PREFIX}${contestProbId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SweaFamilyContext>;
    if (parsed.contestProbId !== contestProbId || !parsed.referrerUrl || !parsed.family) return null;
    const family = familyFromReferrer(parsed.referrerUrl);
    if (family !== parsed.family) return null;
    return parsed as SweaFamilyContext;
  } catch {
    return null;
  }
}

export function discoverSweaHistoryUrl(detailDocument: Document, detailUrl: string, family: SweaProblemFamily): string | null {
  let base: URL;
  try {
    base = new URL(detailUrl);
  } catch {
    return null;
  }
  if (base.origin !== SWEA_ORIGIN || DETAIL_PATH_TO_FAMILY[base.pathname] !== family) return null;

  const candidates = Array.from(detailDocument.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .map((anchor) => {
      try {
        const url = new URL(anchor.getAttribute("href") ?? "", base);
        const text = (anchor.textContent ?? "").replace(/\s+/g, " ").trim();
        return { url, text };
      } catch {
        return null;
      }
    })
    .filter((candidate): candidate is { url: URL; text: string } => candidate !== null)
    .filter(({ url, text }) =>
      url.origin === SWEA_ORIGIN
      && url.pathname.startsWith(FAMILY_PREFIX[family])
      && (/제출/.test(text) || /submit|history/i.test(url.pathname))
    );

  const unique = new Map(candidates.map(({ url }) => [url.href, url.href]));
  return unique.size === 1 ? Array.from(unique.values())[0] : null;
}
