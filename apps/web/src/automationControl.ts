import {
  CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
  type CodeArchiveAutomationControlErrorCode,
  type CodeArchiveAutomationState,
  type ExtensionToDashboardAutomationMessage,
} from "../../../packages/shared-types/src";
import { handleExplicitDurableAutomationOff } from "./durableAutomationRuntime";
import { durableAutomationProfile, durableSourceTransferEffective } from "./durableAutomationState";

const AUTOMATION_KINDS = ["AUTO_SYNC", "GITHUB_AUTO_COMMIT"] as const;
const ERROR_CODES = [
  "AUTH_REQUIRED",
  "DASHBOARD_DISCONNECTED",
  "MULTIPLE_DASHBOARD_TABS",
  "AUTO_SYNC_CONSENT_REQUIRED",
  "GITHUB_TARGET_REQUIRED",
  "GITHUB_CONSENT_REQUIRED",
  "PUBLIC_REPOSITORY_CONSENT_REQUIRED",
  "OFFLINE",
  "LEASE_FAILED",
  "GITHUB_TARGET_CHANGED",
  "GITHUB_OUTCOME_UNKNOWN",
  "CONTROL_UNAVAILABLE",
] as const satisfies readonly CodeArchiveAutomationControlErrorCode[];

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function isErrorCode(value: unknown): value is CodeArchiveAutomationControlErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

/** Validate the external automation control plane before it can reach App state. */
export function parseAutomationMessage(value: unknown): ExtensionToDashboardAutomationMessage | null {
  if (!object(value) || value.protocolVersion !== CODEARCHIVE_BRIDGE_PROTOCOL_VERSION || typeof value.type !== "string") return null;
  if (value.type === "CODEARCHIVE_AUTOMATION_STATE_REQUEST") {
    return exactKeys(value, ["type", "protocolVersion"]) ? value as unknown as ExtensionToDashboardAutomationMessage : null;
  }
  if (value.type === "CODEARCHIVE_AUTOMATION_SET_REQUEST") {
    const valid = exactKeys(value, ["type", "protocolVersion", "automation", "enabled"])
      && (AUTOMATION_KINDS as readonly string[]).includes(value.automation as string)
      && typeof value.enabled === "boolean";
    if (!valid) return null;
    if (value.enabled === false) {
      void handleExplicitDurableAutomationOff(value.automation as "AUTO_SYNC" | "GITHUB_AUTO_COMMIT", false);
    }
    return value as unknown as ExtensionToDashboardAutomationMessage;
  }
  if (value.type === "CODEARCHIVE_AUTOMATION_SAFETY_STOP") {
    return exactKeys(value, ["type", "protocolVersion", "errorCode"])
      && value.errorCode === "MULTIPLE_DASHBOARD_TABS"
      ? value as unknown as ExtensionToDashboardAutomationMessage
      : null;
  }
  return null;
}

export function isAutomationControlType(value: unknown): boolean {
  return object(value) && typeof value.type === "string" && value.type.startsWith("CODEARCHIVE_AUTOMATION_");
}

export interface AutomationStateInput {
  autoSyncEnabled: boolean;
  githubAutoCommitEnabled: boolean;
  githubTargetConfigured: boolean;
  authenticated: boolean;
  connectionAvailable: boolean;
  errorCode?: CodeArchiveAutomationControlErrorCode | null;
}

/** Construct the only state shape that may be published to the Extension. */
export function sanitizeAutomationState(input: AutomationStateInput): CodeArchiveAutomationState {
  const durable = durableAutomationProfile();
  const durableMode = durable?.ownershipMode === "DURABLE_SERVER";
  const durableSource = durableMode && durableSourceTransferEffective();
  return {
    protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
    autoSyncEnabled: durableMode ? durableSource : input.autoSyncEnabled === true,
    githubAutoCommitEnabled: durableMode ? durableSource && durable.githubAutoCommitEnabled : input.githubAutoCommitEnabled === true,
    githubTargetConfigured: durableMode ? durable.target !== null : input.githubTargetConfigured === true,
    authenticated: durableMode ? true : input.authenticated === true,
    connectionAvailable: input.connectionAvailable === true,
    errorCode: input.errorCode && isErrorCode(input.errorCode) ? input.errorCode : null,
  };
}
