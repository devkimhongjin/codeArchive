import type { PlatformAdapter } from "../types";
import { ProgrammersAdapter } from "./programmers";
import { SweaAdapter } from "./swea";

export function createAdapter(
  document: Document,
  location: Location,
  sweaProblemUrl: string | null = null,
  allowSweaQuerylessFallback = true
): PlatformAdapter | null {
  if (location.origin === "https://swexpertacademy.com" && location.pathname === "/main/solvingProblem/solvingProblem.do") {
    return new SweaAdapter(document, location, undefined, undefined, sweaProblemUrl, allowSweaQuerylessFallback);
  }
  if (location.origin === "https://school.programmers.co.kr" && /^\/learn\/courses\/30\/lessons\/\d+\/?$/.test(location.pathname)) {
    return new ProgrammersAdapter(document, location);
  }
  return null;
}

export { ProgrammersAdapter } from "./programmers";
export { SweaAdapter } from "./swea";
