import { describe, expect, it } from "vitest";
import { CODEARCHIVE_BRIDGE_PROTOCOL_VERSION } from "../../../../packages/shared-types/src";
import { RelayPairingController } from "./relayPairing";
import type { RelayStateRecord, RelayStateRepository } from "./relayState";

const FUTURE = "2099-01-01T00:00:00.000Z";

class MemoryState implements RelayStateRepository {
  constructor(public value: RelayStateRecord) {}
  async get(): Promise<RelayStateRecord> { return this.value; }
  async update(mutate: (current: RelayStateRecord) => RelayStateRecord): Promise<RelayStateRecord> {
    this.value = mutate(this.value);
    return this.value;
  }
}

function state(overrides: Partial<RelayStateRecord> = {}): RelayStateRecord {
  return {
    deviceId: "device-1234567890",
    publicKey: "public-key",
    privateKey: {} as CryptoKey,
    state: "UNPAIRED",
    autoSyncEnabled: false,
    failureCount: 0,
    ...overrides,
  };
}

describe("RelayPairingController", () => {
  it("answers only an explicit pairing-info request and never exposes a credential", async () => {
    const repository = new MemoryState(state({ state: "ACTIVE", grantId: "a0000000-0000-4000-8000-000000000001", generation: 2, expiresAt: FUTURE, credential: "secret" }));
    const controller = new RelayPairingController(repository);

    const response = await controller.handle({ type: "CODEARCHIVE_RELAY_PAIRING_INFO", phase: "REQUEST", protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION }, true);

    expect(response).toMatchObject({ type: "CODEARCHIVE_RELAY_PAIRING_INFO", state: "ACTIVE", grantId: "a0000000-0000-4000-8000-000000000001", generation: 2 });
    expect(response).not.toHaveProperty("credential");
  });

  it("stores a provisioned grant only after matching the signed challenge", async () => {
    const repository = new MemoryState(state({ signedChallengeId: "a0000000-0000-4000-8000-000000000002", signedChallengeExpiresAt: FUTURE }));
    const controller = new RelayPairingController(repository);

    const response = await controller.handle({
      type: "CODEARCHIVE_RELAY_GRANT_PROVISION",
      phase: "REQUEST",
      protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
      deviceId: "device-1234567890",
      grantId: "a0000000-0000-4000-8000-000000000003",
      generation: 4,
      expiresAt: FUTURE,
      challengeId: "a0000000-0000-4000-8000-000000000002",
      credential: "secret",
    }, true);

    expect(response).toMatchObject({ phase: "STORED", grantId: "a0000000-0000-4000-8000-000000000003", generation: 4 });
    expect(repository.value).toMatchObject({ state: "ACTIVE", credential: "secret", generation: 4 });
    expect(repository.value.signedChallengeId).toBeUndefined();
  });

  it("rejects wrong-device and duplicate-key pairing messages fail closed", async () => {
    const repository = new MemoryState(state());
    const controller = new RelayPairingController(repository);

    const wrongDevice = await controller.handle({ type: "CODEARCHIVE_RELAY_PAIRING_INFO", phase: "REQUEST", protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION, extra: true }, true);
    const wrongPort = await controller.handle({ type: "CODEARCHIVE_RELAY_PAIRING_INFO", phase: "REQUEST", protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION }, false);

    expect(wrongDevice).toBeUndefined();
    expect(wrongPort).toBeUndefined();
    expect(repository.value.state).toBe("UNPAIRED");
  });

  it("applies server-confirmed revoke and erases the credential", async () => {
    const repository = new MemoryState(state({ state: "ACTIVE", grantId: "a0000000-0000-4000-8000-000000000004", generation: 2, expiresAt: FUTURE, credential: "secret", autoSyncEnabled: true }));
    const controller = new RelayPairingController(repository);

    const response = await controller.handle({
      type: "CODEARCHIVE_RELAY_REVOKE_CONFIRMED",
      phase: "REQUEST",
      protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
      deviceId: "device-1234567890",
      grantId: "a0000000-0000-4000-8000-000000000004",
      generation: 2,
      revokedAt: FUTURE,
    }, true);

    expect(response).toMatchObject({ phase: "APPLIED", grantId: "a0000000-0000-4000-8000-000000000004", generation: 2 });
    expect(repository.value).toMatchObject({ state: "INVALIDATED", autoSyncEnabled: false });
    expect(repository.value.credential).toBeUndefined();
  });
});
