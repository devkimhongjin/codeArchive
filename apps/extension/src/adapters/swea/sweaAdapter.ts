import type { PlatformAdapter, ProblemDetectionResult } from "../platformAdapter";
import { SWEA_PROBLEM_DETAIL_PATH, SWEA_SELECTORS } from "./sweaSelectors";

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
    return url.origin === "https://swexpertacademy.com" && url.pathname === SWEA_PROBLEM_DETAIL_PATH;
  },

  detect(document, url): ProblemDetectionResult {
    if (!this.matches(url)) return { status: "unsupported_page" };

    const warnings: string[] = [];
    const headingText = firstText(document, SWEA_SELECTORS.heading);
    const parsedHeading = headingText ? parseHeading(headingText) : null;
    const missing: string[] = [];

    if (!parsedHeading?.problemNumber) missing.push("problemNumber");
    if (!parsedHeading?.title) missing.push("title");

    if (missing.length > 0) {
      warnings.push("SWEA 문제 제목 영역 구조가 예상과 다릅니다.");
      return { status: "incomplete", missing, warnings };
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
