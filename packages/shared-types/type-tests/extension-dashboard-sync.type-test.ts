import {
  isAckableMainApiBulkUpsertResult,
  selectAckableClientRecordIds,
  toMainApiSolutionBulkUpsertRecord,
} from "../src/contracts/extension-dashboard-sync";
import type {
  AckableMainApiBulkUpsertResult,
  CaptureImportRecord,
  CodeArchiveBridgeProtocolVersion,
  CodeArchiveCaptureChangedEvent,
  CodeArchiveCaptureSummaryData,
  MainApiBulkUpsertRecordResult,
  MainApiSolutionBulkUpsertRecord,
  MainApiSolutionBulkUpsertRequest,
  MainApiSolutionBulkUpsertSuccessData,
} from "../src/contracts/extension-dashboard-sync";

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends
        (<T>() => T extends A ? 1 : 2)
      ? true
      : false
    : false;

type ExpectedCaptureChangedEvent = {
  readonly type: "CODEARCHIVE_CAPTURE_CHANGED";
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly pendingCount: number;
  readonly revision: number;
};

type ExpectedCaptureSummaryData = {
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly pendingCount: number;
  readonly allCount: number;
  readonly revision: number;
};

type _CaptureChangedExactShape = Assert<
  Equal<CodeArchiveCaptureChangedEvent, ExpectedCaptureChangedEvent>
>;

type _CaptureSummaryExactShape = Assert<
  Equal<CodeArchiveCaptureSummaryData, ExpectedCaptureSummaryData>
>;

type _AckableOutcomesAreExact = Assert<
  Equal<AckableMainApiBulkUpsertResult["outcome"], "IMPORTED" | "EXISTING">
>;

type _FailedIsNeverAckable = Assert<
  Equal<
    Extract<AckableMainApiBulkUpsertResult, { readonly outcome: "FAILED" }>,
    never
  >
>;

type _BulkResultIncludesFailed = Assert<
  Equal<
    Extract<MainApiBulkUpsertRecordResult, { readonly outcome: "FAILED" }>["ackEligible"],
    false
  >
>;

type _FailedAckEligibleTrueIsImpossible = Assert<
  Equal<
    Extract<
      MainApiBulkUpsertRecordResult,
      { readonly outcome: "FAILED"; readonly ackEligible: true }
    >,
    never
  >
>;

type _SuccessDataHasOnlyResults = Assert<
  Equal<keyof MainApiSolutionBulkUpsertSuccessData, "results">
>;

type _RequestHasNoUserId = Assert<
  Equal<"userId" extends keyof MainApiSolutionBulkUpsertRequest ? true : false, false>
>;

type _RequestRecordHasNoUserId = Assert<
  Equal<"userId" extends keyof MainApiSolutionBulkUpsertRecord ? true : false, false>
>;

type _RequestRecordIsFlat = Assert<
  Equal<"problem" extends keyof MainApiSolutionBulkUpsertRecord ? true : false, false>
>;

type ExpectedMainApiRecordKeys =
  | "clientRecordId"
  | "platform"
  | "problemNumber"
  | "title"
  | "language"
  | "code"
  | "result"
  | "solvedAt"
  | "observedAt"
  | "executionTime"
  | "memoryUsage"
  | "aiUsage";

type _RequestRecordMatchesSpringCaptureItem = Assert<
  Equal<keyof MainApiSolutionBulkUpsertRecord, ExpectedMainApiRecordKeys>
>;

const bridgeRecord = {
  clientRecordId: "capture-id",
  problem: {
    platform: "SWEA",
    platformProblemId: "1206",
    title: "View",
    url: "https://swexpertacademy.com/example",
    tags: [],
  },
  language: "JAVA",
  code: "class Solution {}",
  result: "ACCEPTED",
  executionTime: 81,
  memoryUsage: 32,
  submittedAt: "2026-08-29T00:00:00.000Z",
} satisfies CaptureImportRecord;

const apiRecord = toMainApiSolutionBulkUpsertRecord(bridgeRecord);

type _MapperReturnsFlatSpringCaptureItem = Assert<
  Equal<typeof apiRecord, MainApiSolutionBulkUpsertRecord>
>;

const mappedRequest = {
  importBatchId: "batch-id",
  records: [apiRecord],
} satisfies MainApiSolutionBulkUpsertRequest;

void mappedRequest;

const imported = {
  clientRecordId: "imported-id",
  outcome: "IMPORTED",
  ackEligible: true,
  errorCode: null,
} satisfies MainApiBulkUpsertRecordResult;

const existing = {
  clientRecordId: "existing-id",
  outcome: "EXISTING",
  ackEligible: true,
  errorCode: null,
} satisfies MainApiBulkUpsertRecordResult;

const failed = {
  clientRecordId: "failed-id",
  outcome: "FAILED",
  ackEligible: false,
  errorCode: "INVALID_RECORD",
} satisfies MainApiBulkUpsertRecordResult;

isAckableMainApiBulkUpsertResult(imported);
isAckableMainApiBulkUpsertResult(existing);
isAckableMainApiBulkUpsertResult(failed);
isAckableMainApiBulkUpsertResult({
  clientRecordId: "inconsistent-id",
  outcome: "FAILED",
  ackEligible: true,
  errorCode: null,
});

selectAckableClientRecordIds([
  imported,
  existing,
  failed,
  {
    clientRecordId: "inconsistent-id",
    outcome: "FAILED",
    ackEligible: true,
    errorCode: null,
  },
]);
