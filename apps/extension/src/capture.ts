import {
  CAPTURE_RESULT,
  type Capture,
  type CaptureDraft,
  type Platform,
  type PlatformAdapter,
  type SubmissionResultDetection
} from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function createUuid(): string {
  const candidate = globalThis.crypto?.randomUUID?.();
  if (candidate) return candidate;

  // Chrome MV3 provides Web Crypto. Do not fall back to Math.random for IDs
  // that are later used for idempotency or acknowledgement.
  const bytes = new Uint8Array(16);
  const webCrypto = globalThis.crypto;
  if (!webCrypto?.getRandomValues) throw new Error("Web Crypto is unavailable");
  webCrypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function normalizeDate(value: string | Date | undefined, fallback: Date): string | null {
  const date = value === undefined ? fallback : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function nonEmpty(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validPlatform(value: unknown): value is Platform {
  return value === "SWEA" || value === "PROGRAMMERS";
}

function validProblemUrl(value: unknown): value is string {
  if (!nonEmpty(value, 2_048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export interface CaptureFactoryOptions {
  now?: () => Date;
  uuid?: () => string;
}

/**
 * Converts adapter data into the only record shape accepted by local storage.
 * Any uncertainty is represented by null so callers can fail closed.
 */
export function createCapture(
  draft: CaptureDraft,
  options: CaptureFactoryOptions = {}
): Capture | null {
  const now = options.now?.() ?? new Date();
  const captureId = draft.captureId ?? (options.uuid?.() ?? createUuid());
  if (!isUuid(captureId)) return null;
  if (!validPlatform(draft.platform)) return null;
  if (!nonEmpty(draft.problemNumber, 100)) return null;
  if (!nonEmpty(draft.title, 500)) return null;
  if (!validProblemUrl(draft.problemUrl)) return null;
  if (!nonEmpty(draft.language, 100)) return null;
  if (!nonEmpty(draft.sourceCode, 1_000_000)) return null;
  if (draft.result !== CAPTURE_RESULT) return null;

  const observedAt = normalizeDate(draft.observedAt, now);
  const solvedAt = normalizeDate(draft.solvedAt, now);
  if (!observedAt || !solvedAt) return null;

  const executionTime = draft.executionTime;
  const memoryUsage = draft.memoryUsage;
  if (executionTime !== undefined && (!Number.isFinite(executionTime) || executionTime < 0)) {
    return null;
  }
  if (memoryUsage !== undefined && (!Number.isFinite(memoryUsage) || memoryUsage < 0)) {
    return null;
  }

  return {
    captureId,
    platform: draft.platform,
    problemNumber: draft.problemNumber.trim(),
    title: draft.title.trim(),
    problemUrl: draft.problemUrl,
    language: draft.language.trim(),
    sourceCode: draft.sourceCode,
    result: CAPTURE_RESULT,
    observedAt,
    solvedAt,
    ...(executionTime === undefined ? {} : { executionTime }),
    ...(memoryUsage === undefined ? {} : { memoryUsage }),
    syncState: "PENDING"
  };
}

/** Runtime validation for messages crossing the content-script boundary. */
export function isCaptureRecord(value: unknown): value is Capture {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Capture>;
  const parsedObservedAt = typeof candidate.observedAt === "string" ? new Date(candidate.observedAt) : null;
  const parsedSolvedAt = typeof candidate.solvedAt === "string" ? new Date(candidate.solvedAt) : null;
  return (
    isUuid(candidate.captureId) &&
    validPlatform(candidate.platform) &&
    nonEmpty(candidate.problemNumber, 100) &&
    nonEmpty(candidate.title, 500) &&
    validProblemUrl(candidate.problemUrl) &&
    nonEmpty(candidate.language, 100) &&
    nonEmpty(candidate.sourceCode, 1_000_000) &&
    candidate.result === CAPTURE_RESULT &&
    candidate.syncState === "PENDING" &&
    parsedObservedAt !== null &&
    !Number.isNaN(parsedObservedAt.getTime()) &&
    parsedObservedAt.toISOString() === candidate.observedAt &&
    parsedSolvedAt !== null &&
    !Number.isNaN(parsedSolvedAt.getTime()) &&
    parsedSolvedAt.toISOString() === candidate.solvedAt &&
    (candidate.executionTime === undefined ||
      (Number.isFinite(candidate.executionTime) && candidate.executionTime >= 0)) &&
    (candidate.memoryUsage === undefined ||
      (Number.isFinite(candidate.memoryUsage) && candidate.memoryUsage >= 0))
  );
}

export interface CollectedCapture {
  capture: Capture;
  detection: SubmissionResultDetection;
}

// Keep the idempotency key when storage succeeds but its response is lost.
// Weak keys release the payload when the adapter drops its submission attempt.
const attemptCaptures = new WeakMap<object, Capture>();

/** Collects only when an adapter has positively observed an accepted result. */
export function collectAcceptedCaptureAttempt(
  adapter: PlatformAdapter,
  now: Date = new Date()
): CollectedCapture | null {
  const detection = adapter.detectSubmissionResult({ freshOnly: true });
  if (!detection?.accepted) return null;
  const previous = detection.attemptToken && attemptCaptures.get(detection.attemptToken);
  if (previous) return { capture: previous, detection };

  const snapshot = adapter.getSubmissionSnapshot?.();
  if (!snapshot?.problem || !snapshot.editor) return null;
  const problem = snapshot.problem;
  const editor = snapshot.editor;

  let performance = {};
  try {
    performance = adapter.collectPerformance() ?? {};
  } catch {
    // Performance is optional and must never prevent accepted source capture.
    performance = {};
  }
  const capture = createCapture({
    ...problem,
    ...editor,
    ...performance,
    platform: adapter.platform,
    result: CAPTURE_RESULT,
    observedAt: now,
    solvedAt: now
  });
  if (capture && detection.attemptToken) attemptCaptures.set(detection.attemptToken, capture);
  return capture ? { capture, detection } : null;
}

export function collectAcceptedCapture(
  adapter: PlatformAdapter,
  now: Date = new Date()
): Capture | null {
  return collectAcceptedCaptureAttempt(adapter, now)?.capture ?? null;
}
