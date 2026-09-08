import { describe, expect, it, vi } from "vitest";
import { cancelAllDurableAutomationControllers, DurableAutomationController, type DashboardRelayPairingConnection } from "./durableAutomation";
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
const SESSION_BINDING = `sb1_${"a".repeat(43)}`;
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
    sessionBindingFingerprint: SESSION_BINDING,
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
      return {
        grantId: GRANT,
        credential: `${GRANT}.secret`,
        deviceId: DEVICE,
        generation: current.generation,
        expiresAt: "2026-10-04T08:00:00Z",
        sessionBindingFingerprint: current.sessionBindingFingerprint,
      };
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
  it("provisions only when initial, issued, and final session bindings match", async () => {
    const f = fixture();
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);

    await expect(controller.enableSourceTransfer()).resolves.toMatchObject({ relayPaired: true });
    expect(f.bridge.relayProvisionGrant).toHaveBeenCalledTimes(1);
  });

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

  it("retains cached account context when discovery returns a different account", async () => {
    const f = fixture(profile());
    const otherDevice = "device_identity_5678";
    const otherProfile = profile({ userId: "650e8400-e29b-41d4-a716-446655440000", deviceId: otherDevice, generation: 9 });
    vi.mocked(f.bridge.relayPairingInfo).mockResolvedValue({
      type: "CODEARCHIVE_RELAY_PAIRING_INFO", phase: "INFO", protocolVersion: 1,
      deviceId: otherDevice, publicKey: "public_key", state: "ACTIVE",
      grantId: GRANT, generation: otherProfile.generation, expiresAt: "2026-10-04T08:00:00Z",
    });
    vi.mocked(f.client.profile).mockResolvedValue(otherProfile);
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);

    const result = await controller.disableAll(undefined, profile());

    expect(result.profile.userId).toBe(USER);
    expect(result.profile.deviceId).toBe(DEVICE);
    expect(result.profile.generation).toBe(4);
    expect(result.profile.sourceTransferEnabled).toBe(true);
    expect(result.localRevocationConfirmed).toBe(false);
    expect(result.serverRevocationConfirmed).toBe(false);
    expect(f.bridge.relayConfirmRevoke).not.toHaveBeenCalled();
    expect(f.client.update).not.toHaveBeenCalled();
  });

  it("fails closed when the issued grant generation does not match the committed profile", async () => {
    const f = fixture(profile({ ownershipMode: "PAGE_OWNED", sourceTransferEnabled: false }));
    vi.mocked(f.client.relayGrant).mockImplementation(async () => ({
      grantId: GRANT, credential: `${GRANT}.secret`, deviceId: DEVICE,
      generation: 999, expiresAt: "2026-10-04T08:00:00Z", sessionBindingFingerprint: SESSION_BINDING,
    }));
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);
    await expect(controller.enableSourceTransfer()).rejects.toMatchObject({ code: "GRANT_GENERATION_MISMATCH" });
    expect(f.bridge.relayProvisionGrant).not.toHaveBeenCalled();
  });

  it("does not provision a grant after the server profile advances during issuance", async () => {
    const f = fixture();
    let profileReads = 0;
    vi.mocked(f.client.profile).mockImplementation(async () => {
      profileReads += 1;
      return profile({ generation: profileReads >= 2 ? 5 : 4 });
    });
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);

    await expect(controller.enableSourceTransfer()).rejects.toMatchObject({ code: "GRANT_GENERATION_MISMATCH" });
    expect(f.bridge.relayProvisionGrant).not.toHaveBeenCalled();
  });

  it("does not provision a grant after an account/session context switch", async () => {
    const f = fixture();
    const otherUser = "650e8400-e29b-41d4-a716-446655440000";
    let profileReads = 0;
    vi.mocked(f.client.profile).mockImplementation(async () => {
      profileReads += 1;
      return profile({ userId: profileReads >= 2 ? otherUser : USER, generation: 4, deviceId: DEVICE });
    });
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW, () => "session-a");

    await expect(controller.enableSourceTransfer()).rejects.toMatchObject({ code: "GRANT_GENERATION_MISMATCH" });
    expect(f.bridge.relayProvisionGrant).not.toHaveBeenCalled();
  });

  it("does not provision after a same-user AuthSession replacement changes the server binding", async () => {
    const f = fixture();
    const replacementBinding = `sb1_${"b".repeat(43)}`;
    let profileReads = 0;
    vi.mocked(f.client.profile).mockImplementation(async () => {
      profileReads += 1;
      return profile({ sessionBindingFingerprint: profileReads >= 2 ? replacementBinding : SESSION_BINDING });
    });
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);

    await expect(controller.enableSourceTransfer()).rejects.toMatchObject({ code: "SESSION_BINDING_MISMATCH" });
    expect(f.bridge.relayProvisionGrant).not.toHaveBeenCalled();
  });

  it("fails closed on a missing or malformed initial binding before any local provision", async () => {
    const f = fixture(profile({ sessionBindingFingerprint: "sb1_invalid" }));
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);

    await expect(controller.enableSourceTransfer()).rejects.toMatchObject({ code: "SESSION_BINDING_INVALID" });
    expect(f.client.relayChallenge).not.toHaveBeenCalled();
    expect(f.bridge.relayProvisionGrant).not.toHaveBeenCalled();
  });

  it("does not provision when the issued grant binding differs from the profile", async () => {
    const f = fixture();
    vi.mocked(f.client.relayGrant).mockResolvedValue({
      grantId: GRANT,
      credential: `${GRANT}.secret`,
      deviceId: DEVICE,
      generation: 4,
      expiresAt: "2026-10-04T08:00:00Z",
      sessionBindingFingerprint: `sb1_${"b".repeat(43)}`,
    });
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW);

    await expect(controller.enableSourceTransfer()).rejects.toMatchObject({ code: "SESSION_BINDING_MISMATCH" });
    expect(f.bridge.relayProvisionGrant).not.toHaveBeenCalled();
  });

  it("cancels issuance when the authenticated session key changes with a colliding profile", async () => {
    const f = fixture();
    let context = "session-a";
    let profileReads = 0;
    vi.mocked(f.client.profile).mockImplementation(async () => {
      profileReads += 1;
      if (profileReads >= 2) context = "session-b";
      return profile({ userId: USER, generation: 4, deviceId: DEVICE });
    });
    const controller = new DurableAutomationController(f.client, f.bridge, () => NOW, () => context);

    await expect(controller.enableSourceTransfer()).rejects.toMatchObject({ code: "TRANSITION_CANCELLED" });
    expect(f.bridge.relayProvisionGrant).not.toHaveBeenCalled();
  });

  it("cancels queued transitions across controllers when the authenticated context changes", async () => {
    const first = fixture();
    const second = fixture();
    let releaseChallenge!: (value: { challengeId: string; challenge: string; expiresAt: string }) => void;
    const challengeStarted = new Promise<void>((resolve) => {
      vi.mocked(first.client.relayChallenge).mockImplementation(async () => {
        resolve();
        return new Promise((release) => { releaseChallenge = release; });
      });
    });
    let context = "account-a";
    const firstController = new DurableAutomationController(first.client, first.bridge, () => NOW, () => context);
    const secondController = new DurableAutomationController(second.client, second.bridge, () => NOW, () => context);

    const firstTransition = firstController.enableSourceTransfer();
    await challengeStarted;
    const queuedTransition = secondController.enableSourceTransfer();
    context = "account-b";
    cancelAllDurableAutomationControllers();
    releaseChallenge({ challengeId: CHALLENGE, challenge: "proof", expiresAt: "2026-09-04T08:01:00Z" });

    await expect(firstTransition).rejects.toMatchObject({ code: "TRANSITION_CANCELLED" });
    await expect(queuedTransition).rejects.toMatchObject({ code: "TRANSITION_CANCELLED" });

    const stopped = await firstController.disableAll();
    expect(stopped.profile.sourceTransferEnabled).toBe(false);
    expect(second.client.relayGrant).not.toHaveBeenCalled();
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
