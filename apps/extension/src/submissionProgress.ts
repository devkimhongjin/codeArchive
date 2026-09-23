import type { Platform } from "./types";

export const SUBMISSION_PROGRESS_KEY = "codearchive-submission-progress";
export const SUBMISSION_PROGRESS_TTL_MS = 180_000;

export interface SubmissionProgress {
  tabId: number;
  attemptId: string;
  platform: Platform;
  problemNumber: string;
  title: string;
  phase: "CAPTURING" | "SAVING";
  startedAt: number;
}

export function isSubmissionProgress(value: unknown): value is SubmissionProgress {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SubmissionProgress>;
  return Number.isSafeInteger(item.tabId) && (item.tabId ?? -1) >= 0 &&
    typeof item.attemptId === "string" && /^[0-9a-f-]{36}$/i.test(item.attemptId) &&
    (item.platform === "SWEA" || item.platform === "PROGRAMMERS" || item.platform === "JUNGOL") &&
    typeof item.problemNumber === "string" && item.problemNumber.length > 0 && item.problemNumber.length <= 40 &&
    typeof item.title === "string" && item.title.length > 0 && item.title.length <= 200 &&
    (item.phase === "CAPTURING" || item.phase === "SAVING") &&
    typeof item.startedAt === "number" && Number.isSafeInteger(item.startedAt) && item.startedAt > 0;
}

export function activeSubmissionProgress(value: unknown, now = Date.now()): SubmissionProgress[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SubmissionProgress =>
    isSubmissionProgress(item) && item.startedAt <= now && now - item.startedAt < SUBMISSION_PROGRESS_TTL_MS
  ).slice(-8).sort((a, b) => b.startedAt - a.startedAt);
}

export function updateSubmissionProgress(
  current: unknown,
  update: { tabId: number; attemptId: string; platform?: Platform; problemNumber?: string; title?: string; phase: "CAPTURING" | "SAVING" | "CLEAR" },
  now = Date.now()
): SubmissionProgress[] {
  const entries = activeSubmissionProgress(current, now);
  const previous = entries.find(item => item.tabId === update.tabId);
  // A late result from an older attempt must not alter the newer attempt.
  if (update.phase !== "CAPTURING" && previous?.attemptId !== update.attemptId) return entries;
  const active = entries.filter(item => item.tabId !== update.tabId);
  if (update.phase === "CLEAR") return active;
  if (update.phase === "CAPTURING") {
    if (!update.platform || !update.problemNumber || !update.title) return activeSubmissionProgress(current, now);
    active.push({ tabId: update.tabId, attemptId: update.attemptId, platform: update.platform, problemNumber: update.problemNumber, title: update.title, phase: "CAPTURING", startedAt: now });
  } else if (previous) {
    active.push({ ...previous, phase: "SAVING" });
  }
  return active.sort((a, b) => b.startedAt - a.startedAt).slice(0, 8);
}
