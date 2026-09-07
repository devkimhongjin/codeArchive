import { afterEach, describe, expect, it } from "vitest";
import { sanitizeAutomationState } from "./automationControl";
import { markDurableLocalSourceStopped, setDurableAutomationProfile } from "./durableAutomationState";

const PROFILE = {
  userId: "550e8400-e29b-41d4-a716-446655440000",
  deviceId: "device_identity_1234",
  generation: 4,
  sourceTransferEnabled: true,
  githubAutoCommitEnabled: true,
  ownershipMode: "DURABLE_SERVER" as const,
  targetGeneration: 2,
  target: {
    installationId: "11", repositoryId: "22", branch: "develop",
    expectedCommitSha: "a".repeat(40), folder: "solutions",
    privateRepository: true, fullName: "owner/repo",
  },
  automaticTransferConsent: true,
  visibilityRiskConsent: true,
  publicUploadConsent: false,
  githubEnabledAt: "2026-09-04T07:00:00Z",
  version: 7,
  updatedAt: "2026-09-04T08:00:00Z",
};

afterEach(() => setDurableAutomationProfile(null, false));

describe("durable automation state sanitization", () => {
  it("keeps confirmed durable intent authoritative over page-local offline/disconnect booleans", () => {
    setDurableAutomationProfile(PROFILE);
    expect(sanitizeAutomationState({
      autoSyncEnabled: false,
      githubAutoCommitEnabled: false,
      githubTargetConfigured: false,
      authenticated: false,
      connectionAvailable: false,
      errorCode: "DASHBOARD_DISCONNECTED",
    })).toEqual({
      protocolVersion: 1,
      autoSyncEnabled: true,
      githubAutoCommitEnabled: true,
      githubTargetConfigured: true,
      authenticated: true,
      connectionAvailable: false,
      errorCode: "DASHBOARD_DISCONNECTED",
    });
  });

  it("makes explicit local source OFF dominate a still-stale server ON profile", () => {
    setDurableAutomationProfile(PROFILE);
    markDurableLocalSourceStopped();
    expect(sanitizeAutomationState({
      autoSyncEnabled: true,
      githubAutoCommitEnabled: true,
      githubTargetConfigured: true,
      authenticated: true,
      connectionAvailable: true,
      errorCode: null,
    })).toMatchObject({
      autoSyncEnabled: false,
      githubAutoCommitEnabled: false,
      githubTargetConfigured: true,
      authenticated: true,
    });
  });
});
