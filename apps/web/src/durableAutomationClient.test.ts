import { describe, expect, it, vi } from "vitest";
import { ArchiveSessionExpiredError } from "./archiveDataSource";
import { createDurableAutomationClient, DurableAutomationRequestError } from "./durableAutomationClient";

const PROFILE = {
  userId: "550e8400-e29b-41d4-a716-446655440000",
  deviceId: "device_identity_1234",
  generation: 4,
  sourceTransferEnabled: true,
  githubAutoCommitEnabled: false,
  ownershipMode: "DURABLE_SERVER",
  targetGeneration: 2,
  target: {
    installationId: "11",
    repositoryId: "22",
    branch: "develop",
    expectedCommitSha: "a".repeat(40),
    folder: "solutions",
    privateRepository: true,
    fullName: "owner/repo",
  },
  automaticTransferConsent: true,
  visibilityRiskConsent: true,
  publicUploadConsent: false,
  githubEnabledAt: null,
  version: 7,
  updatedAt: "2026-09-04T08:00:00Z",
};

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(status < 400
    ? { success: true, data, error: null, requestId: "req-1" }
    : { success: false, data: null, error: { code: "AUTOMATION_GENERATION_STALE" }, requestId: "req-1" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("durable automation API client", () => {
  it("loads a strictly validated profile with Dashboard session credentials", async () => {
    const fetcher = vi.fn(async () => response(PROFILE));
    const client = createDurableAutomationClient(fetcher);
    await expect(client.profile()).resolves.toEqual(PROFILE);
    expect(fetcher).toHaveBeenCalledWith(
      "https://codearchive-api.onrender.com/api/v1/automation",
      expect.objectContaining({ method: "GET", credentials: "include", cache: "no-store" }),
    );
  });

  it("rejects malformed profile authority instead of accepting partial state", async () => {
    const fetcher = vi.fn(async () => response({ ...PROFILE, generation: -1 }));
    const client = createDurableAutomationClient(fetcher);
    await expect(client.profile()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("maps 401 to the common session-expired error", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 401 }));
    const client = createDurableAutomationClient(fetcher);
    await expect(client.profile()).rejects.toBeInstanceOf(ArchiveSessionExpiredError);
  });

  it("preserves server error codes for version/generation conflicts", async () => {
    const fetcher = vi.fn(async () => response(null, 409));
    const client = createDurableAutomationClient(fetcher);
    await expect(client.update({
      deviceId: "device_identity_1234",
      sourceTransferEnabled: true,
      githubAutoCommitEnabled: false,
      ownershipMode: "DURABLE_SERVER",
      target: PROFILE.target,
      automaticTransferConsent: true,
      visibilityRiskConsent: true,
      publicUploadConsent: false,
      expectedVersion: 7,
    })).rejects.toEqual(expect.objectContaining<Partial<DurableAutomationRequestError>>({ code: "AUTOMATION_GENERATION_STALE" }));
  });

  it("validates challenge and one-time grant responses", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({
        challengeId: "11111111-1111-4111-8111-111111111111",
        challenge: "proof",
        expiresAt: "2026-09-04T08:01:00Z",
      }))
      .mockResolvedValueOnce(response({
        grantId: "22222222-2222-4222-8222-222222222222",
        credential: "22222222-2222-4222-8222-222222222222.secret",
        deviceId: "device_identity_1234",
        generation: 4,
        expiresAt: "2026-10-04T08:00:00Z",
      }));
    const client = createDurableAutomationClient(fetcher);
    const challenge = await client.relayChallenge("device_identity_1234", "public-key");
    expect(challenge.challenge).toBe("proof");
    const grant = await client.relayGrant({
      deviceId: "device_identity_1234",
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      publicKey: "public-key",
      signature: "signature",
    });
    expect(grant.generation).toBe(4);
    expect(fetcher.mock.calls[0]?.[0]).toContain("/api/v1/relay/grants/challenge");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://codearchive-api.onrender.com/api/v1/relay/grants");
  });

  it("rejects invalid client-side device/version inputs before network", async () => {
    const fetcher = vi.fn();
    const client = createDurableAutomationClient(fetcher);
    await expect(client.update({
      deviceId: "short",
      sourceTransferEnabled: false,
      githubAutoCommitEnabled: false,
      ownershipMode: "DURABLE_SERVER",
      target: null,
      automaticTransferConsent: false,
      visibilityRiskConsent: false,
      publicUploadConsent: false,
      expectedVersion: 0,
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
