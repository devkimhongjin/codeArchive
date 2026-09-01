import type { PlatformAdapter, ProblemDetectionResult } from "../platformAdapter";
import { PROGRAMMERS_LESSON_PATH, PROGRAMMERS_ORIGIN, PROGRAMMERS_SELECTORS } from "./programmersSelectors";

export function getProgrammersProblemNumber(url: URL): string | null {
  if (url.origin !== PROGRAMMERS_ORIGIN) return null;
  return url.pathname.match(PROGRAMMERS_LESSON_PATH)?.[1] ?? null;
}

export function canonicalProgrammersProblemUrl(url: URL): string | null {
  const problemNumber = getProgrammersProblemNumber(url);
  return problemNumber ? `${PROGRAMMERS_ORIGIN}/learn/courses/30/lessons/${problemNumber}` : null;
}

export const programmersAdapter: PlatformAdapter = {
  platform: "PROGRAMMERS",

  matches(url) {
    return getProgrammersProblemNumber(url) !== null;
  },

  detect(document, url): ProblemDetectionResult {
    const problemNumber = getProgrammersProblemNumber(url);
    if (!problemNumber) return { status: "unsupported_page" };

    const title = document.querySelector(PROGRAMMERS_SELECTORS.title[0])?.textContent?.trim() ?? "";
    if (!title) {
      return {
        status: "incomplete",
        missing: ["title"],
        warnings: ["���α׷��ӽ� ���� ���� ���� ������ ����� �ٸ��ϴ�."],
      };
    }

    return {
      status: "detected",
      problem: {
        platform: "PROGRAMMERS",
        problemNumber,
        title,
        difficulty: null,
        url: canonicalProgrammersProblemUrl(url)!,
      },
      warnings: [],
    };
  },
};
