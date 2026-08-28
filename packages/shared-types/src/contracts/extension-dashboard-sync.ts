import type { CapturedSubmission } from "../models/submission";

export const CODEARCHIVE_BRIDGE_PROTOCOL_VERSION = 1 as const;
export const CODEARCHIVE_CAPTURE_PAGE_MAX_LIMIT = 25 as const;
export const CODEARCHIVE_SYNC_MAX_PAGE_REQUESTS = 100 as const;
export const CODEARCHIVE_BRIDGE_MAX_RESPONSE_BYTES = 1024 * 1024;

export type CodeArchiveBridgeProtocolVersion =
  typeof CODEARCHIVE_BRIDGE_PROTOCOL_VERSION;

export type ClientRecordId = string;
export type ImportBatchId = string;

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

export interface CodeArchiveImportBeginRequest
  extends CodeArchiveBridgeRequestBase {
  readonly type: "CODEARCHIVE_IMPORT_BEGIN";
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
export type CodeArchiveImportBeginResponse =
  CodeArchiveBridgeResponse<CodeArchiveImportBeginData>;
export type CodeArchiveCapturePageResponse =
  CodeArchiveBridgeResponse<CodeArchiveCapturePageData>;
export type CodeArchiveCaptureAckResponse =
  CodeArchiveBridgeResponse<CodeArchiveCaptureAckReceipt>;

/**
 * Dashboard-authenticated Main API request. There is deliberately no userId:
 * the server derives user ownership from the authenticated Dashboard session.
 * importBatchId is trace/receipt metadata, never the idempotency key.
 */
export interface MainApiSolutionBulkUpsertRequest {
  readonly importBatchId: ImportBatchId;
  readonly records: readonly CaptureImportRecord[];
}

export interface MainApiBulkUpsertImportedResult {
  readonly clientRecordId: ClientRecordId;
  readonly status: "imported";
}

export interface MainApiBulkUpsertSameUserDuplicateResult {
  readonly clientRecordId: ClientRecordId;
  readonly status: "same_authenticated_user_duplicate";
}

export type MainApiBulkUpsertRejectionCode =
  | "INVALID_RECORD"
  | "UNSUPPORTED_VALUE"
  | "PAYLOAD_TOO_LARGE"
  | "TEMPORARY_FAILURE";

export interface MainApiBulkUpsertRejectedResult {
  readonly clientRecordId: ClientRecordId;
  readonly status: "rejected";
  readonly code: MainApiBulkUpsertRejectionCode;
  readonly retryable: boolean;
}

export type MainApiBulkUpsertRecordResult =
  | MainApiBulkUpsertImportedResult
  | MainApiBulkUpsertSameUserDuplicateResult
  | MainApiBulkUpsertRejectedResult;

export interface MainApiSolutionBulkUpsertResponse {
  readonly importBatchId: ImportBatchId;
  readonly results: readonly MainApiBulkUpsertRecordResult[];
}

/** Only these outcomes are permitted to become Extension ACKs. */
export type AckableMainApiBulkUpsertResult = Extract<
  MainApiBulkUpsertRecordResult,
  { readonly status: "imported" | "same_authenticated_user_duplicate" }
>;

export function isAckableMainApiBulkUpsertResult(
  result: MainApiBulkUpsertRecordResult,
): result is AckableMainApiBulkUpsertResult {
  return (
    result.status === "imported" ||
    result.status === "same_authenticated_user_duplicate"
  );
}

export function selectAckableClientRecordIds(
  results: readonly MainApiBulkUpsertRecordResult[],
): readonly ClientRecordId[] {
  return results
    .filter(isAckableMainApiBulkUpsertResult)
    .map((result) => result.clientRecordId);
}
