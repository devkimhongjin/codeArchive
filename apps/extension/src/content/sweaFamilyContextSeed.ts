import { getSweaPageKind } from "../adapters/swea/sweaAdapter";
import {
  cacheSweaFamilyContext,
  familyFromReferrer,
  trustedFamilyContext,
  type SweaFamilyContext,
} from "../adapters/swea/sweaHistoryFallback";
import { detectSweaSolvingProblemMeta } from "../adapters/swea/sweaSolvingProblemMeta";

const CONTEST_PROB_ID_SELECTOR = "#contestProbId, input[name='contestProbId']";

function contestProbIdFromDocument(document: Document): string | null {
  const values = Array.from(document.querySelectorAll<HTMLInputElement>(CONTEST_PROB_ID_SELECTOR))
    .map((element) => element.value.trim())
    .filter(Boolean);
  return values.at(-1) ?? null;
}

function trustedDetailContestProbId(document: Document, url: URL): string | null {
  const documentContestProbId = contestProbIdFromDocument(document);
  const urlContestProbId = url.searchParams.get("contestProbId")?.trim() || null;
  if (documentContestProbId && urlContestProbId && documentContestProbId !== urlContestProbId) return null;
  return documentContestProbId ?? urlContestProbId;
}

export function seedSweaFamilyContext(
  document: Document,
  url: URL,
  referrer: string,
  storage: Storage,
): SweaFamilyContext | null {
  const pageKind = getSweaPageKind(url);
  let context: SweaFamilyContext | null = null;

  if (pageKind === "solving") {
    const metadata = detectSweaSolvingProblemMeta(document, url);
    if (metadata.status !== "detected" || !metadata.problem.contestProbId) return null;
    context = trustedFamilyContext(referrer, metadata.problem.contestProbId);
  } else if (
    pageKind === "problem_detail"
    || pageKind === "contest_problem_detail"
    || pageKind === "user_problem_detail"
  ) {
    const contestProbId = trustedDetailContestProbId(document, url);
    const family = familyFromReferrer(url.href);
    if (!contestProbId || !family) return null;
    context = { family, referrerUrl: url.href, contestProbId };
  }

  if (!context) return null;
  cacheSweaFamilyContext(storage, context);
  return context;
}
