import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDashboardExtensionConnection, type ExtensionConnectionState } from "./extensionConnection";
import { mainApiDurableAutomationClient, type DurableAutomationProfile } from "./durableAutomationClient";
import { durableAutomationProfile, setDurableAutomationProfile } from "./durableAutomationState";

const DEVICE = "device_identity_1234";
const GRANT = "22222222-2222-4222-8222-222222222222";

class FakePort {
  readonly sent: unknown[] = [];
  readonly messageListeners: Array<(message: unknown) => void> = [];
  readonly disconnectListeners: Array<() => void> = [];
  readonly onMessage = { addListener: (listener: (message: unknown) => void) => this.messageListeners.push(listener) };
  readonly onDisconnect = { addListener: (listener: () => void) => this.disconnectListeners.push(listener) };
  postMessage(message: unknown) { this.sent.push(message); }
  disconnect() { this.disconnectListeners.forEach((listener) => listener()); }
  receive(message: unknown) { this.messageListeners.forEach((listener) => listener(message)); }
}

function profile(overrides: Partial<DurableAutomationProfile> = {}): DurableAutomationProfile {
  return {
    userId: "550e8400-e29b-41d4-a716-446655440000",
    deviceId: DEVICE,
    generation: 4,
    sourceTransferEnabled: true,
    githubAutoCommitEnabled: true,
    ownershipMode: "DURABLE_SERVER",
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
    ...overrides,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function reachPairingRequest(port: FakePort) {
  port.receive({ ok: true, data: { protocolVersion: 1 } });
  await flush();
  port.receive({ ok: true, data: { protocolVersion: 1, pendingCount: 0, allCount: 0, revision: 1 } });
  await flush();
  expect(port.sent.at(-1)).toEqual({ type: "CODEARCHIVE_RELAY_PAIRING_INFO", phase: "REQUEST", protocolVersion: 1 });
}

describe("Dashboard durable Extension bootstrap", () => {
  beforeEach(() => setDurableAutomationProfile(null, false));
  afterEach(() => {
    vi.restoreAllMocks();
    setDurableAutomationProfile(null, false);
  });

  it("does not publish a stale false automation state before ACTIVE durable authority is restored", async () => {
    const port = new FakePort();
    const states: ExtensionConnectionState[] = [];
    let resolveProfile!: (value: DurableAutomationProfile) => void;
    vi.spyOn(mainApiDurableAutomationClient, "profile").mockReturnValue(new Promise((resolve) => { resolveProfile = resolve; }));
    const connection = createDashboardExtensionConnection({ connect: () => port }, "extension-id", true);
    connection.start((state) => states.push(state));
    await reachPairingRequest(port);
    port.receive({
      type: "CODEARCHIVE_RELAY_PAIRING_INFO", phase: "INFO", protocolVersion: 1,
      deviceId: DEVICE, publicKey: "public_key", state: "ACTIVE",
      grantId: GRANT, generation: 4, expiresAt: "2026-10-04T08:00:00Z",
    });
    await flush();

    expect(connection.publishAutomationState?.({
      protocolVersion: 1, autoSyncEnabled: false, githubAutoCommitEnabled: false,
      githubTargetConfigured: false, authenticated: false, connectionAvailable: false, errorCode: "AUTH_REQUIRED",
    })).toBe(true);
    expect(port.sent).not.toContainEqual(expect.objectContaining({ type: "CODEARCHIVE_AUTOMATION_STATE_UPDATE" }));

    resolveProfile(profile());
    await flush();
    expect(states.at(-1)?.status).toBe("connected");
    expect(durableAutomationProfile()).toMatchObject({ generation: 4, githubAutoCommitEnabled: true });
    expect(port.sent).not.toContainEqual(expect.objectContaining({ type: "CODEARCHIVE_AUTOMATION_STATE_UPDATE" }));

    connection.publishAutomationState?.({
      protocolVersion: 1, autoSyncEnabled: true, githubAutoCommitEnabled: true,
      githubTargetConfigured: true, authenticated: true, connectionAvailable: true, errorCode: null,
    });
    expect(port.sent.at(-1)).toMatchObject({ type: "CODEARCHIVE_AUTOMATION_STATE_UPDATE" });
  });

  it("keeps automation publication muted when an ACTIVE grant cannot be verified against the server", async () => {
    const port = new FakePort();
    const states: ExtensionConnectionState[] = [];
    vi.spyOn(mainApiDurableAutomationClient, "profile").mockRejectedValue(new Error("network unavailable"));
    const connection = createDashboardExtensionConnection({ connect: () => port }, "extension-id", true);
    connection.start((state) => states.push(state));
    await reachPairingRequest(port);
    port.receive({
      type: "CODEARCHIVE_RELAY_PAIRING_INFO", phase: "INFO", protocolVersion: 1,
      deviceId: DEVICE, publicKey: "public_key", state: "ACTIVE",
      grantId: GRANT, generation: 4, expiresAt: "2026-10-04T08:00:00Z",
    });
    await flush();
    expect(states.at(-1)?.status).toBe("connected");
    connection.publishAutomationState?.({
      protocolVersion: 1, autoSyncEnabled: false, githubAutoCommitEnabled: false,
      githubTargetConfigured: false, authenticated: false, connectionAvailable: true, errorCode: "AUTH_REQUIRED",
    });
    expect(port.sent).not.toContainEqual(expect.objectContaining({ type: "CODEARCHIVE_AUTOMATION_STATE_UPDATE" }));
  });

  it("treats REVOCATION_PENDING as locally stopped even when the server profile is still durable ON", async () => {
    const port = new FakePort();
    vi.spyOn(mainApiDurableAutomationClient, "profile").mockResolvedValue(profile());
    const connection = createDashboardExtensionConnection({ connect: () => port }, "extension-id", true);
    connection.start(() => undefined);
    await reachPairingRequest(port);
    port.receive({
      type: "CODEARCHIVE_RELAY_PAIRING_INFO", phase: "INFO", protocolVersion: 1,
      deviceId: DEVICE, publicKey: "public_key", state: "REVOCATION_PENDING",
      grantId: GRANT, generation: 4, expiresAt: "2026-10-04T08:00:00Z",
    });
    await flush();
    expect(durableAutomationProfile()).toMatchObject({ sourceTransferEnabled: true });
    const published = {
      protocolVersion: 1 as const, autoSyncEnabled: false, githubAutoCommitEnabled: false,
      githubTargetConfigured: true, authenticated: true, connectionAvailable: true, errorCode: null,
    };
    connection.publishAutomationState?.(published);
    expect(port.sent.at(-1)).toMatchObject({ type: "CODEARCHIVE_AUTOMATION_STATE_UPDATE", state: published });
  });
});
