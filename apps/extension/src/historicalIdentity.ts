import { canonicalLanguageKey } from "../../../shared/language";
import type { Platform } from "./types";

/** Historical ids are site identities rather than capture ids. */
export function isHistoricalSubmissionId(platform: Platform, value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (platform === "JUNGOL") return /^\d{1,40}$/.test(value);
  if (platform === "SWEA") return /^[A-Za-z0-9_-]{8,160}$/.test(value);
  // Programmers has no exposed native submission id. This form is generated
  // only after the selected account's row is proven unique.
  return /^pg:[A-Za-z0-9_-]{1,100}:\d{1,40}:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}:[a-z0-9+.#-]{1,100}$/.test(value);
}

/** Requires the exact server timestamp; no missing seconds are invented. */
export function programmersHistoricalSubmissionId(account: string, problemNumber: string, createdAt: string, language: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(account) || !/^\d{1,40}$/.test(problemNumber) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/.test(createdAt)) return null;
  const normalizedLanguage = canonicalLanguageKey(language);
  if (!normalizedLanguage || !/^[a-z0-9+.#-]{1,100}$/.test(normalizedLanguage)) return null;
  const key = `pg:${account}:${problemNumber}:${createdAt}:${normalizedLanguage}`;
  return isHistoricalSubmissionId("PROGRAMMERS", key) ? key : null;
}
