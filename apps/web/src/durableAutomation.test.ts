import { describe, expect, it, vi } from "vitest";
import { DurableAutomationController, type DashboardRelayPairingConnection } from "./durableAutomation";
import type { DurableAutomationClient, DurableAutomationProfile } from "./durableAutomationClient";
import type { GitHubAutoTarget } from "./githubClient";
import type {
  CodeArchiveRelayGrantProvisionResponse,
  CodeArchiveRelayPairingInfoResponse,
  CodeArchiveRelayRevokeConfirmedResponse,
  CodeArchiveRelaySignChallengeResponse,
} from "../../../packages/shared-types/src";

const USER = "550e8400-e29b-41d4-a716-446655440000";
const DEVICE = "device_identity_1234";
const CHALLENGE = "11111111-1111-4111-8111-111111111111";
const GRANT = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-09-04T08:00:00Z");
const TARGET: GitHubAutoTarget = {
  installationId: "11",
  repositoryId: "22",
  branch: "develop",
  expectedCommitSha: "a".repeat(40),
  folder: "solutions",
  privateRepository: true,
  fullName: "owner/repo",
};

function profile(overrides: Partial<DurableAutomationProfile> = {}): DurableAutomationProfile {
  return {
    userId: USER,
    deviceId: DEVICE,
    generation: 4,
    sourceTransferEnabled: true,
    githubAutoCommitEnabled: false,
    ownershipMode: "DURABLE_SERVER",
    targetGeneration: 2,
    target: TARGET,
    automaticTransferConsent: true,
    visibilityRiskConsent: true,
    publicUploadConsent: false,
    githubEnabledAt: null,
    version: 7,
    updatedAt: "2026-09-04T07:59:00Z",
    ...overrides,
  };
}

function fixture(initial = profile()) {
  let current = initial;
  const calls: string[] = [];
  const client: DurableAutomationClient = {
    profile: vi.fn(async () => { calls.push("profile"); return current; }),
    update: vi.fn(async (request) => {
      calls.push("update");
      current = profile({
        ...current,
        deviceId: request.deviceId,
        sourceTransferEnabled: request.sourceTransferEnabled,
        githubAutoCommitEnabled: request.githubAutoCommitEnabled,
        ownershipMode: request.ownershipMode,
        target: request.target,
        automaticTransferConsent: request.automaticTransferConsent,
        visibilityRiskConsent: request.visibilityRiskConsent,
        publicUploadConsent: request.publicUploadConsent,
        generation: current.generation + 1,
        version: current.version + 1,
        githubEnabledAt: request.githubAutoCommitEnabled ? "2026-09-04T08:00:00Z" : null,
        updatedAt: "2026-09-04T08:00:00Z",
      });
      return current;
    }),
    relayChallenge: vi.fn(async () => {
      calls.push("challenge");
      return { challengeId: CHALLENGE, challenge: "proof", expiresAt: "2026-09-04T08:01:00Z" };
    }),
    relayGrant: vi.fn(async () => {
      calls.push("grant");
      return { grantId: GRANT, credential: `${GRANT}.secret`, deviceId: DEVICE, generation: current.generation, expiresAt: "2026-10-04T08:00:00Z" };
    }),
    revokeRelayGrant: vi.fn(async () => undefined),
  };
  const bridge: DashboardRelayPairingConnection = {
    relayPairingInfo: vi.fn(async (): Promise<CodeArchiveRelayPairingInfoResponse> => ({
      type: "CODEARCHIVE_RELAY_PAIRING_INFO", phase: "INFO", protocolVersion: 1,
      deviceId: DEVICE, publicKey: "public_key", state: "UNPAIRED",
    })),
    relaySignChallenge: vi.fn(async (request): Promise<CodeArchiveRelaySignChallengeResponse> => ({
      type: "CODEARCHIVE_RELAY_SIGN_CHALLENGE", phase: "SIGNED", protocolVersion: 1,
      deviceId: DEVICE, challengeId: request.challengeId, signature: "signature",
    })),
    relayProvisionGrant: vi.fn(async (request): Promise<CodeArchiveRelayGrantProvisionResponse> => ({
      type: "CODEARCHIVE_RELAY_GRANT_PROVISION", phase: "STORED", protocolVersion: 1,
      deviceId: DEVICE, grantId: request.grantId, generation: request.generation, expiresAt: request.expiresAt,
    })),
    relayConfirmRevoke: vi.fn(async (request): Promise<CodeArchiveRelayRevokeConfirmedResponse> => ({
      type: "CODEARCHIVE_RELAY_REVOKE_CONFIRMED", phase: "APPLIED", protocolVersion: 1,
      deviceId: request.deviceId, grantId: request.grantId, generation: request.generation, revokedAt: request.revokedAt,
    })),
  };
  return { client, bridge, calls };
}

describe("DurableAutomationController", () => {
  it("preserves an existing durable GitHub ON while restoring source transfer", async () => {
    const f = fixture(profile({ githubAutoCommitEnabled: true, githubEnabledAt: "2026-09-04T07:00:00Z" }));
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);
    const result = await controller.enableSourceTransfer();
    expect(f.client.update).not.toHaveBeenCalled();
    expect(result.profile.githubAutoCommitEnabled).toBe(true);
    expect(f.client.relayChallenge).toHaveBeenCalled();
  });

  it("commits the profile generation before challenge and grant provisioning", async () => {
    const f = fixture(profile({ ownershipMode: "PAGE_OWNED", sourceTransferEnabled: false, deviceId: null, generation: 3 }));
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);
    const result = await controller.enableSourceTransfer();
    expect(f.calls.indexOf("update")).toBeLessThan(f.calls.indexOf("challenge"));
    expect(f.calls.indexOf("challenge")).toBeLessThan(f.calls.indexOf("grant"));
    expect(result.profile.ownershipMode).toBe("DURABLE_SERVER");
    expect(result.profile.sourceTransferEnabled).toBe(true);
  });

  it("forces GitHub automation off when migrating PAGE_OWNED source transfer", async () => {
    const f = fixture(profile({
      ownershipMode: "PAGE_OWNED",
      githubAutoCommitEnabled: true,
      target: TARGET,
      visibilityRiskConsent: true,
      publicUploadConsent: true,
    }));
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);
    const result = await controller.enableSourceTransfer();
    expect(f.client.update).toHaveBeenCalledWith(expect.objectContaining({
      githubAutoCommitEnabled: false,
      target: null,
      visibilityRiskConsent: false,
      publicUploadConsent: false,
    }), undefined);
    expect(result.profile.githubAutoCommitEnabled).toBe(false);
    expect(result.profile.target).toBeNull();
  });

  it("enables GitHub with fresh target consent then provisions the new generation", async () => {
    const f = fixture();
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);
    const fresh = { ...TARGET, expectedCommitSha: "b".repeat(40) };
    const result = await controller.enableGitHubAutoCommit(fresh, {
      automaticTransferConsent: true,
      visibilityRiskConsent: true,
      publicUploadConsent: false,
    });
    expect(f.client.update).toHaveBeenCalledWith(expect.objectContaining({
      githubAutoCommitEnabled: true,
      sourceTransferEnabled: true,
      target: fresh,
      expectedVersion: 7,
    }), undefined);
    expect(result.profile.githubAutoCommitEnabled).toBe(true);
    expect(f.client.relayGrant).toHaveBeenCalled();
  });

  it("turns GitHub off without turning source transfer off and re-pairs the changed generation", async () => {
    const f = fixture(profile({ githubAutoCommitEnabled: true, githubEnabledAt: "2026-09-04T07:00:00Z" }));
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);
    const result = await controller.disableGitHubAutoCommit();
    expect(result.profile.sourceTransferEnabled).toBe(true);
    expect(result.profile.githubAutoCommitEnabled).toBe(false);
    expect(f.client.relayGrant).toHaveBeenCalled();
  });

  it("turns all durable intent off and confirms local revoke metadata", async () => {
    const f = fixture(profile({ githubAutoCommitEnabled: true, githubEnabledAt: "2026-09-04T07:00:00Z" }));
    vi.mocked(f.bridge.relayPairingInfo).mockResolvedValue({
      type: "CODEARCHIVE_RELAY_PAIRING_INFO", phase: "INFO", protocolVersion: 1,
      deviceId: DEVICE, publicKey: "public_key", state: "ACTIVE",
      grantId: GRANT, generation: 4, expiresAt: "2026-10-04T08:00:00Z",
    });
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);
    const result = await controller.disableAll();
    expect(f.client.update).toHaveBeenCalledWith(expect.objectContaining({
      sourceTransferEnabled: false,
      githubAutoCommitEnabled: false,
    }), undefined);
    expect(f.bridge.relayConfirmRevoke).toHaveBeenCalledTimes(1);
    expect(result.profile.sourceTransferEnabled).toBe(false);
    expect(result.profile.githubAutoCommitEnabled).toBe(false);
    expect(result.localRevocationConfirmed).toBe(true);
    expect(result.serverRevocationConfirmed).toBe(true);
  });

  it("revokes the cached old grant even when profile discovery expires, retaining a stopped pending profile", async () => {
    const f = fixture(profile({ githubAutoCommitEnabled: true, githubEnabledAt: "2026-09-04T07:00:00Z" }));
    vi.mocked(f.bridge.relayPairingInfo).mockResolvedValue({
      type: "CODEARCHIVE_RELAY_PAIRING_INFO", phase: "INFO", protocolVersion: 1,
      deviceId: DEVICE, publicKey: "public_key", state: "ACTIVE",
      grantId: GRANT, generation: 4, expiresAt: "2026-10-04T08:00:00Z",
    });
    vi.mocked(f.client.profile).mockRejectedValue(new Error("session expired"));
    vi.mocked(f.client.update).mockRejectedValue(new Error("session expired"));
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);

    const result = await controller.disableAll(undefined, profile({ githubAutoCommitEnabled: true }));

    expect(f.bridge.relayConfirmRevoke).toHaveBeenCalledTimes(1);
    expect(result.localRevocationConfirmed).toBe(true);
    expect(result.serverRevocationConfirmed).toBe(false);
    expect(result.profile.sourceTransferEnabled).toBe(true);
    expect(f.client.update).toHaveBeenCalledWith(expect.objectContaining({
      sourceTransferEnabled: false,
      githubAutoCommitEnabled: false,
    }), undefined);
  });

  it("fails closed when the issued grant generation does not match the committed profile", async () => {
    const f = fixture(profile({ ownershipMode: "PAGE_OWNED", sourceTransferEnabled: false }));
    vi.mocked(f.client.relayGrant).mockImplementation(async () => ({
      grantId: GRANT, credential: `${GRANT}.secret`, deviceId: DEVICE,
      generation: 999, expiresAt: "2026-10-04T08:00:00Z",
    }));
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);
    await expect(controller.enableSourceTransfer()).rejects.toMatchObject({ code: "GRANT_GENERATION_MISMATCH" });
    expect(f.bridge.relayProvisionGrant).not.toHaveBeenCalled();
  });

  it("requires explicit visibility/public consent before a durable GitHub ON", async () => {
    const f = fixture();
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);
    await expect(controller.enableGitHubAutoCommit({ ...TARGET, privateRepository: false }, {
      automaticTransferConsent: true,
      visibilityRiskConsent: true,
      publicUploadConsent: false,
    })).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(f.client.update).not.toHaveBeenCalled();
  });
});
