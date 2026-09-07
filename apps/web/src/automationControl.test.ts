import { describe, expect, it } from "vitest";
import { parseAutomationMessage, sanitizeAutomationState } from "./automationControl";

describe("Dashboard automation control plane", () => {
  it("accepts only the frozen Extension intent shapes", () => {
    expect(parseAutomationMessage({ type: "CODEARCHIVE_AUTOMATION_STATE_REQUEST", protocolVersion: 1 })).toEqual({ type: "CODEARCHIVE_AUTOMATION_STATE_REQUEST", protocolVersion: 1 });
    expect(parseAutomationMessage({ type: "CODEARCHIVE_AUTOMATION_SET_REQUEST", protocolVersion: 1, automation: "AUTO_SYNC", enabled: true })).toEqual({ type: "CODEARCHIVE_AUTOMATION_SET_REQUEST", protocolVersion: 1, automation: "AUTO_SYNC", enabled: true });
    expect(parseAutomationMessage({ type: "CODEARCHIVE_AUTOMATION_SAFETY_STOP", protocolVersion: 1, errorCode: "MULTIPLE_DASHBOARD_TABS" })).not.toBeNull();
    expect(parseAutomationMessage({ type: "CODEARCHIVE_AUTOMATION_SET_REQUEST", protocolVersion: 1, automation: "AUTO_SYNC", enabled: true, accountId: "secret" })).toBeNull();
    expect(parseAutomationMessage({ type: "CODEARCHIVE_AUTOMATION_SET_REQUEST", protocolVersion: 1, automation: "UNKNOWN", enabled: true })).toBeNull();
    expect(parseAutomationMessage({ type: "CODEARCHIVE_AUTOMATION_SAFETY_STOP", protocolVersion: 1, errorCode: "AUTH_REQUIRED" })).toBeNull();
  });

  it("publishes an exact sanitized state without caller-supplied private fields", () => {
    const state = sanitizeAutomationState({
      autoSyncEnabled: true,
      githubAutoCommitEnabled: true,
      githubTargetConfigured: true,
      authenticated: true,
      connectionAvailable: true,
      errorCode: "GITHUB_TARGET_CHANGED",
      ...( { accountId: "private", repository: "private" } as Record<string, unknown>),
    } as never);
    expect(state).toEqual({ protocolVersion: 1, autoSyncEnabled: true, githubAutoCommitEnabled: true, githubTargetConfigured: true, authenticated: true, connectionAvailable: true, errorCode: "GITHUB_TARGET_CHANGED" });
    expect(Object.keys(state)).toEqual(["protocolVersion", "autoSyncEnabled", "githubAutoCommitEnabled", "githubTargetConfigured", "authenticated", "connectionAvailable", "errorCode"]);
    expect(JSON.stringify(state)).not.toMatch(/accountId|userId|repositoryId|installationId|branch|folder|token|cookie|oauth|source|title|problemUrl/i);
  });
});
