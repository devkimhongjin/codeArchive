import type { PlatformAdapter } from "../types";
import { ProgrammersAdapter } from "./programmers";
import { SweaAdapter } from "./swea";
import { JungolAdapter } from "./jungol";
import { BaekjoonAdapter } from "./baekjoon";
import { BAEKJOON_STATUS_PATH, BAEKJOON_SUBMIT_PATH, isBaekjoonOrigin } from "./baekjoonSelectors";

export function createAdapter(
  document: Document,
  location: Location,
  sweaProblemUrl: string | null = null,
  allowSweaQuerylessFallback = true
): PlatformAdapter | null {
  if (location.origin === "https://swexpertacademy.com" && location.pathname === "/main/solvingProblem/solvingProblem.do") {
    return new SweaAdapter(document, location, undefined, undefined, sweaProblemUrl, allowSweaQuerylessFallback);
  }
  // Keep the listener on the origin when the site navigates to a lesson
  // without loading a new document. The adapter still verifies the exact
  // lesson path before accepting a submission.
  if (location.origin === "https://school.programmers.co.kr") {
    return new ProgrammersAdapter(document, location);
  }
  // Jungol navigates from lists to problems without reloading the document.
  // Keep the adapter alive across that route change; its problem detection
  // remains restricted to an exact /problem/<number> path.
  if (location.origin === "https://jungol.co.kr") {
    return new JungolAdapter(document, location);
  }
  // Baekjoon submits on /submit/{n} and judges on /status, two separate page
  // loads; the adapter carries the attempt from one to the other.
  if (isBaekjoonOrigin(location.origin) && (BAEKJOON_SUBMIT_PATH.test(location.pathname) || location.pathname === BAEKJOON_STATUS_PATH)) {
    return new BaekjoonAdapter(document, location);
  }
  return null;
}

export { ProgrammersAdapter } from "./programmers";
export { SweaAdapter } from "./swea";
export { JungolAdapter } from "./jungol";
export { BaekjoonAdapter } from "./baekjoon";
