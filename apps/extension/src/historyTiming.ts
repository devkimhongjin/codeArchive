export const HISTORY_TIMING_STORAGE_KEY = "codearchive.history-timing.v1" as const;
export const HISTORY_SCAN_TIMING_STORAGE_KEY = "codearchive.history-scan-timing.v1" as const;
// User-observed completed candidate scan with both windows visible (00:41).
export const INITIAL_JUNGOL_SCAN_DURATION_MS = 41_000;

export type HistoricalScanTimingSample = {
  version: 1; platform: "JUNGOL"; phase: "SCAN";
  durationMs: number; startedAt: number; endedAt: number;
};

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

export function readHistoricalScanTimingSample(value: unknown): HistoricalScanTimingSample | null {
  if (!value || typeof value !== "object") return null;
  const sample = value as Partial<HistoricalScanTimingSample>;
  const { startedAt, endedAt, durationMs } = sample;
  if (sample.version !== 1 || sample.platform !== "JUNGOL" || sample.phase !== "SCAN" ||
      typeof startedAt !== "number" || typeof endedAt !== "number" || typeof durationMs !== "number" ||
      !validTimestamp(startedAt) || !validTimestamp(endedAt) || !Number.isFinite(durationMs) || durationMs <= 0 ||
      endedAt < startedAt || Math.abs(endedAt - startedAt - durationMs) > 1) return null;
  return { version: 1, platform: "JUNGOL", phase: "SCAN", startedAt, endedAt, durationMs };
}

export function scanTimingSampleFromCompletedTask(task: {
  status?: unknown; truncated?: unknown; startedAt?: unknown; endedAt?: unknown;
}): HistoricalScanTimingSample | null {
  if (task.status !== "READY" || task.truncated !== false ||
      typeof task.startedAt !== "number" || typeof task.endedAt !== "number") return null;
  return readHistoricalScanTimingSample({ version: 1, platform: "JUNGOL", phase: "SCAN",
    startedAt: task.startedAt, endedAt: task.endedAt, durationMs: task.endedAt - task.startedAt });
}

export async function persistHistoricalScanTimingSample(
  storage: { set: (items: Record<string, unknown>) => Promise<void> }, sample: HistoricalScanTimingSample
): Promise<void> {
  await storage.set({ [HISTORY_SCAN_TIMING_STORAGE_KEY]: sample });
}

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
