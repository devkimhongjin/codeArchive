export const HISTORY_TIMING_STORAGE_KEY = "codearchive.history-timing.v1" as const;

export type HistoricalTimingSample = {
  version: 1;
  platform: "JUNGOL";
  count: number;
  durationMs: number;
  startedAt: number;
  endedAt: number;
};

type CompletedTask = { status?: unknown; total?: unknown; completed?: unknown; skipped?: unknown;
  saved?: unknown; duplicate?: unknown; startedAt?: unknown; endedAt?: unknown };

const validTimestamp = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;

export function readHistoricalTimingSample(value: unknown): HistoricalTimingSample | null {
  if (!value || typeof value !== "object") return null;
  const sample = value as Partial<HistoricalTimingSample>;
  const count = sample.count, startedAt = sample.startedAt, endedAt = sample.endedAt, durationMs = sample.durationMs;
  if (typeof count !== "number" || typeof startedAt !== "number" || typeof endedAt !== "number" || typeof durationMs !== "number") return null;
  if (sample.version !== 1 || sample.platform !== "JUNGOL" || !Number.isSafeInteger(count) || count < 1 || count > 5_000 ||
      !validTimestamp(startedAt) || !validTimestamp(endedAt) || !Number.isFinite(durationMs) || durationMs <= 0 ||
      endedAt < startedAt || Math.abs((endedAt - startedAt) - durationMs) > 1) return null;
  return { version: 1, platform: "JUNGOL", count, durationMs, startedAt, endedAt };
}

/** Completed local imports become timing evidence only when every selected store settled successfully. */
export function timingSampleFromCompletedTask(task: CompletedTask): HistoricalTimingSample | null {
  const count = task.total, startedAt = task.startedAt, endedAt = task.endedAt;
  if (typeof count !== "number" || typeof startedAt !== "number" || typeof endedAt !== "number") return null;
  if (task.status !== "DONE" || !Number.isSafeInteger(count) || count < 1 || count > 5_000 ||
      task.completed !== count || task.skipped !== 0 || typeof task.saved !== "number" ||
      typeof task.duplicate !== "number" || task.saved + task.duplicate !== count ||
      !validTimestamp(startedAt) || !validTimestamp(endedAt)) return null;
  const durationMs = endedAt - startedAt;
  return durationMs > 0 ? { version: 1, platform: "JUNGOL", count, durationMs, startedAt, endedAt } : null;
}

export async function persistHistoricalTimingSample(
  storage: { set: (items: Record<string, unknown>) => Promise<void> }, sample: HistoricalTimingSample
): Promise<void> {
  await storage.set({ [HISTORY_TIMING_STORAGE_KEY]: sample });
}

export function estimateHistoricalDuration(sample: HistoricalTimingSample | null, count: number): number | null {
  if (!sample || !Number.isSafeInteger(count) || count < 0) return null;
  return sample.durationMs / sample.count * count;
}
