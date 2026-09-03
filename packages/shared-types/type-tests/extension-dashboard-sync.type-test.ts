import {
  isAckableMainApiBulkUpsertResult,
  selectAckableClientRecordIds,
  toMainApiSolutionBulkUpsertRecord,
} from "../src/contracts/extension-dashboard-sync";
import type {
  AckableMainApiBulkUpsertResult,
  CaptureImportRecord,
  CodeArchiveAutomationControlErrorCode,
  CodeArchiveAutomationKind,
  CodeArchiveAutomationSafetyStopRequest,
  CodeArchiveAutomationSetRequest,
  CodeArchiveAutomationState,
  CodeArchiveAutomationStateRequest,
  CodeArchiveAutomationStateUpdateEvent,
  CodeArchiveBridgeProtocolVersion,
  CodeArchiveCaptureChangedEvent,
  CodeArchiveCaptureSummaryData,
  DashboardToExtensionAutomationMessage,
  ExtensionToDashboardAutomationMessage,
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

type ExpectedAutomationKind = "AUTO_SYNC" | "GITHUB_AUTO_COMMIT";

type ExpectedAutomationControlErrorCode =
  | "AUTH_REQUIRED"
  | "DASHBOARD_DISCONNECTED"
  | "MULTIPLE_DASHBOARD_TABS"
  | "AUTO_SYNC_CONSENT_REQUIRED"
  | "GITHUB_TARGET_REQUIRED"
  | "GITHUB_CONSENT_REQUIRED"
  | "PUBLIC_REPOSITORY_CONSENT_REQUIRED"
  | "OFFLINE"
  | "LEASE_FAILED"
  | "GITHUB_TARGET_CHANGED"
  | "GITHUB_OUTCOME_UNKNOWN"
  | "CONTROL_UNAVAILABLE";

type ExpectedAutomationState = {
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly autoSyncEnabled: boolean;
  readonly githubAutoCommitEnabled: boolean;
  readonly githubTargetConfigured: boolean;
  readonly authenticated: boolean;
  readonly connectionAvailable: boolean;
  readonly errorCode: ExpectedAutomationControlErrorCode | null;
};

type ExpectedAutomationStateRequest = {
  readonly type: "CODEARCHIVE_AUTOMATION_STATE_REQUEST";
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
};

type ExpectedAutomationSetRequest = {
  readonly type: "CODEARCHIVE_AUTOMATION_SET_REQUEST";
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly automation: ExpectedAutomationKind;
  readonly enabled: boolean;
};

type ExpectedAutomationSafetyStopRequest = {
  readonly type: "CODEARCHIVE_AUTOMATION_SAFETY_STOP";
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly errorCode: "MULTIPLE_DASHBOARD_TABS";
};

type ExpectedAutomationStateUpdateEvent = {
  readonly type: "CODEARCHIVE_AUTOMATION_STATE_UPDATE";
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly state: ExpectedAutomationState;
};

type ForbiddenAutomationWireKey =
  | "accountId"
  | "userId"
  | "githubId"
  | "githubLogin"
  | "accountName"
  | "repository"
  | "repositoryId"
  | "installationId"
  | "fullName"
  | "branch"
  | "folder"
  | "token"
  | "cookie"
  | "oauth"
  | "source"
  | "code"
  | "title"
  | "problemUrl";

type _CaptureChangedExactShape = Assert<
  Equal<CodeArchiveCaptureChangedEvent, ExpectedCaptureChangedEvent>
>;

type _CaptureSummaryExactShape = Assert<
  Equal<CodeArchiveCaptureSummaryData, ExpectedCaptureSummaryData>
>;

type _AutomationKindExact = Assert<
  Equal<CodeArchiveAutomationKind, ExpectedAutomationKind>
>;

type _AutomationErrorCodesExact = Assert<
  Equal<CodeArchiveAutomationControlErrorCode, ExpectedAutomationControlErrorCode>
>;

type _AutomationStateExactShape = Assert<
  Equal<CodeArchiveAutomationState, ExpectedAutomationState>
>;

type _AutomationStateRequestExactShape = Assert<
  Equal<CodeArchiveAutomationStateRequest, ExpectedAutomationStateRequest>
>;

type _AutomationSetRequestExactShape = Assert<
  Equal<CodeArchiveAutomationSetRequest, ExpectedAutomationSetRequest>
>;

type _AutomationSafetyStopExactShape = Assert<
  Equal<CodeArchiveAutomationSafetyStopRequest, ExpectedAutomationSafetyStopRequest>
>;

type _AutomationStateUpdateExactShape = Assert<
  Equal<CodeArchiveAutomationStateUpdateEvent, ExpectedAutomationStateUpdateEvent>
>;

type _ExtensionToDashboardAutomationUnionExact = Assert<
  Equal<
    ExtensionToDashboardAutomationMessage,
    | ExpectedAutomationStateRequest
    | ExpectedAutomationSetRequest
    | ExpectedAutomationSafetyStopRequest
  >
>;

type _DashboardToExtensionAutomationUnionExact = Assert<
  Equal<DashboardToExtensionAutomationMessage, ExpectedAutomationStateUpdateEvent>
>;

type _AutomationStateHasNoForbiddenWireKeys = Assert<
  Equal<Extract<keyof CodeArchiveAutomationState, ForbiddenAutomationWireKey>, never>
>;

type _AutomationSetHasNoForbiddenWireKeys = Assert<
  Equal<Extract<keyof CodeArchiveAutomationSetRequest, ForbiddenAutomationWireKey>, never>
>;

type _AutomationStateRequestHasNoForbiddenWireKeys = Assert<
  Equal<Extract<keyof CodeArchiveAutomationStateRequest, ForbiddenAutomationWireKey>, never>
>;

type _AutomationSafetyStopHasNoForbiddenWireKeys = Assert<
  Equal<Extract<keyof CodeArchiveAutomationSafetyStopRequest, ForbiddenAutomationWireKey>, never>
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
