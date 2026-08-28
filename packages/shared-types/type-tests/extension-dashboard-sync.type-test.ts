import type {
  AckableMainApiBulkUpsertResult,
  CodeArchiveBridgeProtocolVersion,
  CodeArchiveCaptureChangedEvent,
  CodeArchiveCaptureSummaryData,
  MainApiBulkUpsertRecordResult,
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

type _AckableStatusesAreExact = Assert<
  Equal<
    AckableMainApiBulkUpsertResult["status"],
    "imported" | "same_authenticated_user_duplicate"
  >
>;

type _RejectedIsNeverAckable = Assert<
  Equal<
    Extract<AckableMainApiBulkUpsertResult, { readonly status: "rejected" }>,
    never
  >
>;

type _BulkResultIncludesRejected = Assert<
  Equal<
    Extract<MainApiBulkUpsertRecordResult, { readonly status: "rejected" }>["status"],
    "rejected"
  >
>;
