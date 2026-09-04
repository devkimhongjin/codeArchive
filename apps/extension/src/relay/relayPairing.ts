import {
  CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
  CODEARCHIVE_RELAY_CHALLENGE_ID_MAX_LENGTH,
  CODEARCHIVE_RELAY_CHALLENGE_MAX_LENGTH,
  CODEARCHIVE_RELAY_CREDENTIAL_MAX_LENGTH,
  CODEARCHIVE_RELAY_DEVICE_ID_MAX_LENGTH,
  CODEARCHIVE_RELAY_DEVICE_ID_MIN_LENGTH,
  CODEARCHIVE_RELAY_GRANT_ID_MAX_LENGTH,
  CODEARCHIVE_RELAY_PUBLIC_KEY_MAX_LENGTH,
  CODEARCHIVE_RELAY_SIGNATURE_MAX_LENGTH,
  type ExtensionToDashboardRelayPairingMessage,
} from "../../../../packages/shared-types/src";
import { indexedDbRelayStateRepository, signRelayChallenge, type RelayStateRecord, type RelayStateRepository } from "./relayState";

export interface RelayPort {
  postMessage(message: unknown): void;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validDeviceId(value: unknown): value is string {
  return boundedString(value, CODEARCHIVE_RELAY_DEVICE_ID_MAX_LENGTH)
    && value.length >= CODEARCHIVE_RELAY_DEVICE_ID_MIN_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function validDate(value: unknown, now: number): value is string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > now;
}

function validAbsoluteDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validUuidLike(value: unknown, max: number): value is string {
  return boundedString(value, max) && /^[0-9a-f-]+$/i.test(value);
}

function pairingInfo(state: RelayStateRecord): ExtensionToDashboardRelayPairingMessage {
  const base = {
    type: "CODEARCHIVE_RELAY_PAIRING_INFO" as const,
    phase: "INFO" as const,
    protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
    deviceId: state.deviceId,
    publicKey: state.publicKey,
  };
  if (state.state === "UNPAIRED" || !state.grantId || !validGeneration(state.generation) || !validAbsoluteDate(state.expiresAt)) {
    return { ...base, state: "UNPAIRED" };
  }
  return {
    ...base,
    state: state.state,
    grantId: state.grantId,
    generation: state.generation,
    expiresAt: state.expiresAt,
  };
}

export class RelayPairingController {
  constructor(private readonly repository: RelayStateRepository = indexedDbRelayStateRepository) {}

  /** Returns null for non-relay traffic so the legacy bridge can process it. */
  handle(raw: unknown, eligiblePort: boolean): Promise<unknown> | null {
    if (!object(raw) || raw.protocolVersion !== CODEARCHIVE_BRIDGE_PROTOCOL_VERSION
      || typeof raw.type !== "string" || !String(raw.type).startsWith("CODEARCHIVE_RELAY_")) return null;
    if (!eligiblePort) return Promise.resolve(undefined);
    switch (raw.type) {
      case "CODEARCHIVE_RELAY_PAIRING_INFO": return this.info(raw);
      case "CODEARCHIVE_RELAY_SIGN_CHALLENGE": return this.sign(raw);
      case "CODEARCHIVE_RELAY_GRANT_PROVISION": return this.provision(raw);
      case "CODEARCHIVE_RELAY_REVOKE_CONFIRMED": return this.revoke(raw);
      default: return Promise.resolve(undefined);
    }
  }

  private async info(raw: Record<string, unknown>): Promise<unknown> {
    if (raw.phase !== "REQUEST" || !hasExactlyKeys(raw, ["protocolVersion", "type", "phase"])) return undefined;
    const state = await this.repository.get();
    return pairingInfo(state);
  }

  private async sign(raw: Record<string, unknown>): Promise<unknown> {
    if (!hasExactlyKeys(raw, ["protocolVersion", "type", "phase", "deviceId", "challengeId", "challenge", "expiresAt"])
      || raw.phase !== "REQUEST" || !validDeviceId(raw.deviceId)
      || !validUuidLike(raw.challengeId, CODEARCHIVE_RELAY_CHALLENGE_ID_MAX_LENGTH)
      || !boundedString(raw.challenge, CODEARCHIVE_RELAY_CHALLENGE_MAX_LENGTH)
      || !validDate(raw.expiresAt, Date.now())) return undefined;
    const state = await this.repository.get();
    if (state.deviceId !== raw.deviceId) return undefined;
    if (state.state === "EXPIRED" || state.state === "INVALIDATED") return undefined;
    const signature = await signRelayChallenge(state, raw.challenge);
    const signed = await this.repository.update((current) => ({
      ...current,
      signedChallengeId: raw.challengeId as string,
      signedChallengeExpiresAt: raw.expiresAt as string,
    }));
    if (signed.deviceId !== raw.deviceId) return undefined;
    return {
      type: "CODEARCHIVE_RELAY_SIGN_CHALLENGE",
      phase: "SIGNED",
      protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
      deviceId: signed.deviceId,
      challengeId: raw.challengeId,
      signature,
    };
  }

  private async provision(raw: Record<string, unknown>): Promise<unknown> {
    if (!hasExactlyKeys(raw, ["protocolVersion", "type", "phase", "deviceId", "grantId", "generation", "expiresAt", "challengeId", "credential"])
      || raw.phase !== "REQUEST" || !validDeviceId(raw.deviceId)
      || !validUuidLike(raw.challengeId, CODEARCHIVE_RELAY_CHALLENGE_ID_MAX_LENGTH)
      || !validUuidLike(raw.grantId, CODEARCHIVE_RELAY_GRANT_ID_MAX_LENGTH)
      || !validGeneration(raw.generation)
      || !validDate(raw.expiresAt, Date.now())
      || !boundedString(raw.credential, CODEARCHIVE_RELAY_CREDENTIAL_MAX_LENGTH)) return undefined;
    const state = await this.repository.get();
    if (state.deviceId !== raw.deviceId || state.signedChallengeId !== raw.challengeId
      || !validDate(state.signedChallengeExpiresAt, Date.now())) return undefined;
    const next = await this.repository.update((current) => ({
      ...current,
      state: "ACTIVE",
      grantId: raw.grantId as string,
      generation: raw.generation as number,
      expiresAt: raw.expiresAt as string,
      credential: raw.credential as string,
      signedChallengeId: undefined,
      signedChallengeExpiresAt: undefined,
      failureCount: 0,
      nextRetryAt: undefined,
    }));
    return {
      type: "CODEARCHIVE_RELAY_GRANT_PROVISION",
      phase: "STORED",
      protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
      deviceId: next.deviceId,
      grantId: next.grantId,
      generation: next.generation,
      expiresAt: next.expiresAt,
    };
  }

  private async revoke(raw: Record<string, unknown>): Promise<unknown> {
    if (!hasExactlyKeys(raw, ["protocolVersion", "type", "phase", "deviceId", "grantId", "generation", "revokedAt"])
      || raw.phase !== "REQUEST" || !validDeviceId(raw.deviceId)
      || !validUuidLike(raw.grantId, CODEARCHIVE_RELAY_GRANT_ID_MAX_LENGTH)
      || !validGeneration(raw.generation) || !validAbsoluteDate(raw.revokedAt)) return undefined;
    const state = await this.repository.get();
    if (state.deviceId !== raw.deviceId || state.grantId !== raw.grantId || state.generation !== raw.generation) return undefined;
    const next = await this.repository.update((current) => ({
      ...current,
      state: "INVALIDATED",
      credential: undefined,
      autoSyncEnabled: false,
      nextRetryAt: undefined,
    }));
    return {
      type: "CODEARCHIVE_RELAY_REVOKE_CONFIRMED",
      phase: "APPLIED",
      protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
      deviceId: next.deviceId,
      grantId: raw.grantId,
      generation: raw.generation,
      revokedAt: raw.revokedAt,
    };
  }
}

export const backgroundRelayPairingController = new RelayPairingController();
