import type { PlatformAdapter, ProblemDetectionResult } from "../platformAdapter";
import { detectSweaEditor } from "./sweaEditor";
import { detectSweaSolvingProblemMeta } from "./sweaSolvingProblemMeta";
import {
  SWEA_PROBLEM_DETAIL_PATH,
  SWEA_SELECTORS,
  SWEA_SOLVING_PATH,
  SWEA_USER_PROBLEM_DETAIL_PATH,
} from "./sweaSelectors";

export type SweaPageKind = "problem_detail" | "user_problem_detail" | "solving";

export function getSweaPageKind(url: URL): SweaPageKind | null {
  if (url.origin !== "https://swexpertacademy.com") return null;
  if (url.pathname === SWEA_PROBLEM_DETAIL_PATH) return "problem_detail";
  if (url.pathname === SWEA_USER_PROBLEM_DETAIL_PATH) return "user_problem_detail";
  if (url.pathname === SWEA_SOLVING_PATH) return "solving";
  return null;
}

function firstText(document: Document, selectors: readonly string[]): string | null {
  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

function parseHeading(text: string): { problemNumber: string; title: string } | null {
  const match = text.match(/^\s*(\d+)\s*[.\-:]?\s*(.+?)\s*$/);
  if (!match) return null;
  return { problemNumber: match[1], title: match[2] };
}

function parseDifficulty(text: string | null): string | null {
  if (!text) return null;
  return text.match(/\bD[1-8]\b/i)?.[0].toUpperCase() ?? null;
}

export const sweaAdapter: PlatformAdapter = {
  platform: "SWEA",

  matches(url) {
    return getSweaPageKind(url) !== null;
  },

  detect(document, url): ProblemDetectionResult {
    const pageKind = getSweaPageKind(url);
    if (!pageKind) return { status: "unsupported_page" };

    if (pageKind === "solving") {
      return {
        status: "connected_page",
        platform: "SWEA",
        pageKind,
        url: url.href,
        metadata: detectSweaSolvingProblemMeta(document, url),
        editor: detectSweaEditor(document, url),
        submissionResult: { status: "none" },
      };
    }

    const warnings: string[] = [];
    const headingText = firstText(document, SWEA_SELECTORS.heading);
    const parsedHeading = headingText ? parseHeading(headingText) : null;

    if (!parsedHeading) {
      warnings.push("SWEA 문제 제목 영역 구조가 예상과 다릅니다.");
      return {
        status: "incomplete",
        missing: ["problemNumber", "title"],
        warnings,
      };
    }

    const difficultyText = firstText(document, SWEA_SELECTORS.difficulty);
    const difficulty = parseDifficulty(difficultyText);
    if (difficultyText && !difficulty) warnings.push("난이도 값을 해석하지 못했습니다.");

    return {
      status: "detected",
      problem: {
        platform: "SWEA",
        problemNumber: parsedHeading.problemNumber,
        title: parsedHeading.title,
        difficulty,
        url: url.href,
      },
      warnings,
    };
  },
};
