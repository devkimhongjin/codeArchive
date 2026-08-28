export interface SweaSolvingProblemMeta {
  problemNumber: string;
  title: string;
  contestProbId: string | null;
}

export type SweaSolvingProblemMetaResult =
  | { status: "detected"; problem: SweaSolvingProblemMeta; warnings: string[] }
  | { status: "incomplete"; missing: Array<"problemNumber" | "title">; warnings: string[] }
  | { status: "conflict"; warnings: string[] };

const SOLVING_HEADING_SELECTOR = "div.problem_box > h3";
const CONTEST_PROB_ID_SELECTOR = "#contestProbId, input[name='contestProbId']";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function lastNonEmptyContestProbId(document: Document): string | null {
  const values = Array.from(document.querySelectorAll<HTMLElement>(CONTEST_PROB_ID_SELECTOR))
    .map((element) => element instanceof HTMLInputElement ? element.value.trim() : "")
    .filter(Boolean);
  return values.at(-1) ?? null;
}

function parseHeading(heading: string | null): Pick<SweaSolvingProblemMeta, "problemNumber" | "title"> | null {
  if (!heading) return null;
  const match = normalizeText(heading).match(/^(\d+)\.\s*(.+)$/);
  if (!match) return null;

  const title = normalizeText(match[2]);
  if (!title) return null;
  return { problemNumber: match[1], title };
}

export function detectSweaSolvingProblemMeta(document: Document, url: URL): SweaSolvingProblemMetaResult {
  const contestProbId = lastNonEmptyContestProbId(document);
  const urlContestProbId = url.searchParams.get("contestProbId")?.trim() || null;

  if (contestProbId && urlContestProbId && contestProbId !== urlContestProbId) {
    return { status: "conflict", warnings: ["SWEA 문제 식별 정보가 URL과 일치하지 않습니다."] };
  }

  const parsedHeading = parseHeading(document.querySelector(SOLVING_HEADING_SELECTOR)?.textContent ?? null);
  if (!parsedHeading) {
    return {
      status: "incomplete",
      missing: ["problemNumber", "title"],
      warnings: ["SWEA 풀이 페이지 문제 제목 영역 구조가 예상과 다릅니다."],
    };
  }

  return {
    status: "detected",
    problem: { ...parsedHeading, contestProbId: contestProbId ?? urlContestProbId },
    warnings: [],
  };
}
