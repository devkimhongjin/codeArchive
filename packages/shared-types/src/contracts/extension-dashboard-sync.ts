import type { CapturedSubmission } from "../models/submission";

export const CODEARCHIVE_BRIDGE_PROTOCOL_VERSION = 1 as const;
export const CODEARCHIVE_CAPTURE_PAGE_MAX_LIMIT = 25 as const;
export const CODEARCHIVE_SYNC_MAX_PAGE_REQUESTS = 100 as const;
export const CODEARCHIVE_BRIDGE_MAX_RESPONSE_BYTES = 1024 * 1024;

export type CodeArchiveBridgeProtocolVersion =
  typeof CODEARCHIVE_BRIDGE_PROTOCOL_VERSION;

export type ClientRecordId = string;
export type ImportBatchId = string;
export type SyncSessionId = string;

/**
 * `pending` is the only automatic-sync scope.
 * `all` is reserved for an explicit, target-account-confirmed recovery/re-import action.
 */
export type CaptureSyncScope = "pending" | "all";

/**
 * Source-bearing record transferred only after the runtime bridge has issued a
 * valid Port/tab/origin-bound ephemeral capability.
 *
 * The authenticated server user is intentionally absent. Dashboard/Main API
 * session context determines ownership; Extension never does.
 */
export interface CaptureImportRecord extends CapturedSubmission {
  readonly clientRecordId: ClientRecordId;
}

interface CodeArchiveBridgeRequestBase {
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
}

export interface CodeArchivePingRequest extends CodeArchiveBridgeRequestBase {
  readonly type: "CODEARCHIVE_PING";
}

export interface CodeArchiveCaptureSummaryRequest
  extends CodeArchiveBridgeRequestBase {
  readonly type: "CODEARCHIVE_CAPTURE_SUMMARY";
}

/**
 * Dashboard assertion made only after its own authenticated session and explicit
 * automatic-sync consent have both been verified. `syncSessionId` is an opaque,
 * random, per-auth-context nonce; it is never a user/account identifier or token.
 */
export interface CodeArchiveSyncSessionStartRequest
  extends CodeArchiveBridgeRequestBase {
  readonly type: "CODEARCHIVE_SYNC_SESSION_START";
  readonly syncSessionId: SyncSessionId;
  readonly authenticated: true;
  readonly autoSyncConsent: true;
}

export interface CodeArchiveSyncSessionEndRequest
  extends CodeArchiveBridgeRequestBase {
  readonly type: "CODEARCHIVE_SYNC_SESSION_END";
  readonly syncSessionId: SyncSessionId;
}

export interface CodeArchiveImportBeginRequest
  extends CodeArchiveBridgeRequestBase {
  readonly type: "CODEARCHIVE_IMPORT_BEGIN";
  readonly syncSessionId: SyncSessionId;
}

export interface CodeArchiveCapturePageRequest
  extends CodeArchiveBridgeRequestBase {
  readonly type: "CODEARCHIVE_CAPTURE_PAGE";
  readonly capability: string;
  readonly cursor?: string;
  readonly limit: number;
  readonly scope: CaptureSyncScope;
}

export interface CodeArchiveCaptureAckRequest
  extends CodeArchiveBridgeRequestBase {
  readonly type: "CODEARCHIVE_CAPTURE_ACK";
  readonly capability: string;
  readonly importBatchId: ImportBatchId;
  readonly clientRecordIds: readonly ClientRecordId[];
}

export type DashboardBridgeRequest =
  | CodeArchivePingRequest
  | CodeArchiveCaptureSummaryRequest
  | CodeArchiveSyncSessionStartRequest
  | CodeArchiveSyncSessionEndRequest
  | CodeArchiveImportBeginRequest
  | CodeArchiveCapturePageRequest
  | CodeArchiveCaptureAckRequest;

/** Metadata-only event. Source/title/problem/account/auth fields are forbidden. */
export interface CodeArchiveCaptureChangedEvent {
  readonly type: "CODEARCHIVE_CAPTURE_CHANGED";
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly pendingCount: number;
  readonly revision: number;
}

export type ExtensionBridgeEvent = CodeArchiveCaptureChangedEvent;

export interface CodeArchivePingData {
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
}

/** Metadata-only summary. Source/title/problem/account/auth fields are forbidden. */
export interface CodeArchiveCaptureSummaryData {
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly pendingCount: number;
  readonly allCount: number;
  readonly revision: number;
}

export interface CodeArchiveImportBeginData {
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly capability: string;
}

export interface CodeArchiveSyncSessionData {
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly syncSessionId: SyncSessionId;
}

export interface CodeArchiveCapturePageData {
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly scope: CaptureSyncScope;
  readonly records: readonly CaptureImportRecord[];
  readonly nextCursor?: string;
  readonly revision: number;
}

/**
 * Receipt only. ACK does not delete local capture data.
 * `acknowledgedAt` is the local receipt time that may back the Extension's importedAt metadata.
 * The runtime must also reject IDs that were not offered by this capability.
 */
export interface CodeArchiveCaptureAckReceipt {
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly importBatchId: ImportBatchId;
  readonly acknowledgedAt: string;
  readonly acknowledgedClientRecordIds: readonly ClientRecordId[];
}

export type CodeArchiveBridgeErrorCode =
  | "UNSUPPORTED_PROTOCOL"
  | "ORIGIN_NOT_ALLOWED"
  | "SYNC_NOT_ELIGIBLE"
  | "CAPABILITY_REQUIRED"
  | "CAPABILITY_INVALID"
  | "CAPABILITY_EXPIRED"
  | "INVALID_REQUEST"
  | "INVALID_CURSOR"
  | "ACK_NOT_OFFERED"
  | "REQUEST_LIMIT_EXCEEDED"
  | "PAYLOAD_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

export interface CodeArchiveBridgeSuccess<T> {
  readonly ok: true;
  readonly data: T;
}

/** Safe fixed failure envelope. Never attach raw exceptions/provider/API bodies. */
export interface CodeArchiveBridgeFailure {
  readonly ok: false;
  readonly error: {
    readonly code: CodeArchiveBridgeErrorCode;
    readonly retryable: boolean;
  };
}

export type CodeArchiveBridgeResponse<T> =
  | CodeArchiveBridgeSuccess<T>
  | CodeArchiveBridgeFailure;

export type CodeArchivePingResponse =
  CodeArchiveBridgeResponse<CodeArchivePingData>;
export type CodeArchiveCaptureSummaryResponse =
  CodeArchiveBridgeResponse<CodeArchiveCaptureSummaryData>;
export type CodeArchiveSyncSessionStartResponse =
  CodeArchiveBridgeResponse<CodeArchiveSyncSessionData>;
export type CodeArchiveSyncSessionEndResponse =
  CodeArchiveBridgeResponse<CodeArchiveSyncSessionData>;
export type CodeArchiveImportBeginResponse =
  CodeArchiveBridgeResponse<CodeArchiveImportBeginData>;
export type CodeArchiveCapturePageResponse =
  CodeArchiveBridgeResponse<CodeArchiveCapturePageData>;
export type CodeArchiveCaptureAckResponse =
  CodeArchiveBridgeResponse<CodeArchiveCaptureAckReceipt>;

/**
 * Dashboard-authenticated Main API request. There is deliberately no userId:
 * the server derives user ownership from the authenticated Dashboard session.
 * importBatchId is trace/receipt metadata, never the idempotency key. Dashboard
 * retains it for the later Extension ACK; the API does not echo it.
 */
export type MainApiAiUsage = "used" | "not_used" | "unknown";

/** Flat wire shape consumed by CaptureBulkUpsertRequest.CaptureItem. */
export interface MainApiSolutionBulkUpsertRecord {
  readonly clientRecordId: ClientRecordId;
  readonly platform: CaptureImportRecord["problem"]["platform"];
  readonly problemNumber: string;
  readonly title: string;
  readonly language: CaptureImportRecord["language"];
  readonly code: string;
  readonly result: CaptureImportRecord["result"];
  readonly solvedAt: string | null;
  readonly observedAt: string | null;
  readonly executionTime: string | null;
  readonly memoryUsage: string | null;
  readonly aiUsage: MainApiAiUsage;
}

export interface MainApiSolutionBulkUpsertRequest {
  readonly importBatchId: ImportBatchId;
  readonly records: readonly MainApiSolutionBulkUpsertRecord[];
}

function apiPerformanceValue(value: number | undefined): string | null {
  return value === undefined ? null : String(value);
}

/**
 * Deterministic bridge-to-API mapping for accepted capture records.
 * `submittedAt` is the capture's accepted-submission event instant, so it is
 * used for both server timestamps. Unitless bridge performance numbers remain
 * unitless decimal strings. The bridge has no AI-use assertion, so the request
 * explicitly sends `unknown`.
 */
export function toMainApiSolutionBulkUpsertRecord(
  record: CaptureImportRecord,
): MainApiSolutionBulkUpsertRecord {
  return {
    clientRecordId: record.clientRecordId,
    platform: record.problem.platform,
    problemNumber: record.problem.problemNumber ?? record.problem.platformProblemId,
    title: record.problem.title,
    language: record.language,
    code: record.code,
    result: record.result,
    solvedAt: record.submittedAt,
    observedAt: record.submittedAt,
    executionTime: apiPerformanceValue(record.executionTime),
    memoryUsage: apiPerformanceValue(record.memoryUsage),
    aiUsage: "unknown",
  };
}

export type MainApiBulkUpsertOutcome =
  | "IMPORTED"
  | "EXISTING"
  | "FAILED";

export type MainApiBulkUpsertFailureCode =
  | "INVALID_RECORD"
  | "PERSISTENCE_FAILED";

export interface MainApiBulkUpsertImportedResult {
  readonly clientRecordId: ClientRecordId;
  readonly outcome: "IMPORTED";
  readonly ackEligible: true;
  readonly errorCode: null;
}

export interface MainApiBulkUpsertExistingResult {
  readonly clientRecordId: ClientRecordId;
  readonly outcome: "EXISTING";
  readonly ackEligible: true;
  readonly errorCode: null;
}

export interface MainApiBulkUpsertFailedResult {
  readonly clientRecordId: ClientRecordId;
  readonly outcome: "FAILED";
  readonly ackEligible: false;
  readonly errorCode: MainApiBulkUpsertFailureCode;
}

export type MainApiBulkUpsertRecordResult =
  | MainApiBulkUpsertImportedResult
  | MainApiBulkUpsertExistingResult
  | MainApiBulkUpsertFailedResult;

export interface MainApiSolutionBulkUpsertSuccessData {
  readonly results: readonly MainApiBulkUpsertRecordResult[];
}

export interface MainApiError {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface MainApiSuccessEnvelope<T> {
  readonly success: true;
  readonly data: T;
  readonly error: null;
  readonly requestId: string;
}

export interface MainApiFailureEnvelope {
  readonly success: false;
  readonly data: null;
  readonly error: MainApiError;
  readonly requestId: string;
}

export type MainApiSolutionBulkUpsertResponse =
  | MainApiSuccessEnvelope<MainApiSolutionBulkUpsertSuccessData>
  | MainApiFailureEnvelope;

/** Only runtime-confirmed imported/existing results may become Extension ACKs. */
export type AckableMainApiBulkUpsertResult =
  | MainApiBulkUpsertImportedResult
  | MainApiBulkUpsertExistingResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isAckableMainApiBulkUpsertResult(
  result: unknown,
): result is AckableMainApiBulkUpsertResult {
  if (!isRecord(result)) return false;
  if (typeof result.clientRecordId !== "string" || result.clientRecordId.length === 0) {
    return false;
  }
  if (result.ackEligible !== true || result.errorCode !== null) return false;
  return result.outcome === "IMPORTED" || result.outcome === "EXISTING";
}

export function selectAckableClientRecordIds(
  results: readonly unknown[],
): readonly ClientRecordId[] {
  return results
    .filter(isAckableMainApiBulkUpsertResult)
    .map((result) => result.clientRecordId);
}
