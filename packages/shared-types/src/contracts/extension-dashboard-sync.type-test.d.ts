import type {
  AckableMainApiBulkUpsertResult,
  CodeArchiveCaptureChangedEvent,
  CodeArchiveCaptureSummaryData,
  MainApiBulkUpsertRecordResult,
} from "./extension-dashboard-sync";

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type ForbiddenMetadataKey =
  | "source"
  | "code"
  | "title"
  | "url"
  | "problemUrl"
  | "userId"
  | "githubUserId"
  | "email"
  | "token"
  | "accessToken"
  | "refreshToken"
  | "cookie"
  | "errorMessage"
  | "rawError";

type _CaptureChangedIsMetadataOnly = Assert<
  Extract<keyof CodeArchiveCaptureChangedEvent, ForbiddenMetadataKey> extends never
    ? true
    : false
>;

type _CaptureSummaryIsMetadataOnly = Assert<
  Extract<keyof CodeArchiveCaptureSummaryData, ForbiddenMetadataKey> extends never
    ? true
    : false
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
