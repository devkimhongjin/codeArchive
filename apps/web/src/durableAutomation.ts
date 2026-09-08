import {
  CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
  type CodeArchiveRelayGrantProvisionResponse,
  type CodeArchiveRelayPairingInfoResponse,
  type CodeArchiveRelayRevokeConfirmedResponse,
  type CodeArchiveRelaySignChallengeResponse,
} from "../../../packages/shared-types/src";
import type { GitHubAutoTarget } from "./githubClient";
import type {
  DurableAutomationClient,
  DurableAutomationProfile,
  DurableAutomationUpdate,
} from "./durableAutomationClient";

export interface DashboardRelayPairingConnection {
  relayPairingInfo(): Promise<CodeArchiveRelayPairingInfoResponse | null>;
  relaySignChallenge(request: {
    type: "CODEARCHIVE_RELAY_SIGN_CHALLENGE";
    phase: "REQUEST";
    protocolVersion: typeof CODEARCHIVE_BRIDGE_PROTOCOL_VERSION;
    deviceId: string;
    challengeId: string;
    challenge: string;
    expiresAt: string;
  }): Promise<CodeArchiveRelaySignChallengeResponse | null>;
  relayProvisionGrant(request: {
    type: "CODEARCHIVE_RELAY_GRANT_PROVISION";
    phase: "REQUEST";
    protocolVersion: typeof CODEARCHIVE_BRIDGE_PROTOCOL_VERSION;
    deviceId: string;
    challengeId: string;
    grantId: string;
    credential: string;
    generation: number;
    expiresAt: string;
  }): Promise<CodeArchiveRelayGrantProvisionResponse | null>;
  relayConfirmRevoke(request: {
    type: "CODEARCHIVE_RELAY_REVOKE_CONFIRMED";
    phase: "REQUEST";
    protocolVersion: typeof CODEARCHIVE_BRIDGE_PROTOCOL_VERSION;
    deviceId: string;
    grantId: string;
    generation: number;
    revokedAt: string;
  }): Promise<CodeArchiveRelayRevokeConfirmedResponse | null>;
}

export class DurableAutomationTransitionError extends Error {
  constructor(readonly code: string) {
    super("Durable automation transition failed");
  }
}

export interface DurableTransitionResult {
  readonly profile: DurableAutomationProfile;
  readonly relayPaired: boolean;
  readonly localRevocationConfirmed?: boolean;
  readonly serverRevocationConfirmed?: boolean;
}

// Auto-reconnect and the GitHub durable toggle can originate from different
// component instances in the same Dashboard document. Serialize their
// profile/challenge/grant transitions so an older grant response cannot race a
// newer profile generation and become the last local provision request.
let durableTransitionQueue: Promise<void> = Promise.resolve();
const durableControllers = new Set<DurableAutomationController>();

/**
 * Explicit account/session stops must invalidate every controller in this
 * document, including the GitHub panel's controller and the auto-sync one.
 */
export function cancelAllDurableAutomationControllers(): void {
  for (const controller of durableControllers) controller.cancelPendingTransitions();
}

function serializeDurableTransition<T>(operation: () => Promise<T>): Promise<T> {
  const next = durableTransitionQueue.then(operation, operation);
  durableTransitionQueue = next.then(() => undefined, () => undefined);
  return next;
}

interface TransitionFence {
  readonly epoch: number;
  readonly contextKey: string;
  readonly signal?: AbortSignal;
}

function sameTarget(a: GitHubAutoTarget | null, b: GitHubAutoTarget | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameDesired(profile: DurableAutomationProfile, desired: Omit<DurableAutomationUpdate, "expectedVersion">): boolean {
  return profile.deviceId === desired.deviceId
    && profile.sourceTransferEnabled === desired.sourceTransferEnabled
    && profile.githubAutoCommitEnabled === desired.githubAutoCommitEnabled
    && profile.ownershipMode === desired.ownershipMode
    && sameTarget(profile.target, desired.target)
    && profile.automaticTransferConsent === desired.automaticTransferConsent
    && profile.visibilityRiskConsent === desired.visibilityRiskConsent
    && profile.publicUploadConsent === desired.publicUploadConsent;
}

function pairedForProfile(info: CodeArchiveRelayPairingInfoResponse, profile: DurableAutomationProfile, now: number): boolean {
  return info.state === "ACTIVE"
    && profile.deviceId === info.deviceId
    && info.generation === profile.generation
    && Date.parse(info.expiresAt) > now;
}

function sameRevocationContext(a: DurableAutomationProfile, b: DurableAutomationProfile): boolean {
  return a.ownershipMode === "DURABLE_SERVER"
    && b.ownershipMode === "DURABLE_SERVER"
    && a.userId === b.userId
    && a.deviceId === b.deviceId
    && a.generation === b.generation;
}

export class DurableAutomationController {
  private transitionEpoch = 0;
  private readonly client: DurableAutomationClient;
  private readonly bridge: Partial<DashboardRelayPairingConnection>;
  private readonly now: () => number;
  private readonly contextKey: () => string;

  constructor(
    client: DurableAutomationClient,
    bridge: Partial<DashboardRelayPairingConnection>,
    now: () => number = () => Date.now(),
    contextKey: () => string = () => "",
  ) {
    this.client = client;
    this.bridge = bridge;
    this.now = now;
    this.contextKey = contextKey;
    durableControllers.add(this);
  }

  /** Cancel queued and in-flight transitions for a closed/auth-changed context. */
  cancelPendingTransitions(): void {
    this.transitionEpoch += 1;
  }

  private fence(signal?: AbortSignal): TransitionFence {
    return { epoch: this.transitionEpoch, contextKey: this.contextKey(), signal };
  }

  private assertFence(fence: TransitionFence): void {
    if (fence.signal?.aborted || fence.epoch !== this.transitionEpoch || fence.contextKey !== this.contextKey()) {
      throw new DurableAutomationTransitionError("TRANSITION_CANCELLED");
    }
  }

  async discover(signal?: AbortSignal): Promise<{ profile: DurableAutomationProfile; pairing: CodeArchiveRelayPairingInfoResponse | null }> {
    const [profile, pairing] = await Promise.all([
      this.client.profile(signal),
      this.bridge.relayPairingInfo?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    return { profile, pairing };
  }

  async enableSourceTransfer(signal?: AbortSignal): Promise<DurableTransitionResult> {
    const fence = this.fence(signal);
    return serializeDurableTransition(async () => {
      this.assertFence(fence);
      return this.enableSourceTransferInternal(signal, fence);
    });
  }

  private async enableSourceTransferInternal(signal: AbortSignal | undefined, fence: TransitionFence): Promise<DurableTransitionResult> {
    this.assertFence(fence);
    const pairing = await this.requirePairingInfo();
    const current = await this.client.profile(signal);
    this.assertFence(fence);
    const migratingFromPageOwned = current.ownershipMode === "PAGE_OWNED";
    const desired = {
      deviceId: pairing.deviceId,
      sourceTransferEnabled: true,
      githubAutoCommitEnabled: migratingFromPageOwned ? false : current.githubAutoCommitEnabled,
      ownershipMode: "DURABLE_SERVER" as const,
      target: migratingFromPageOwned ? null : current.target,
      automaticTransferConsent: true,
      visibilityRiskConsent: migratingFromPageOwned ? false : current.visibilityRiskConsent,
      publicUploadConsent: migratingFromPageOwned ? false : current.publicUploadConsent,
    };
    const profile = await this.updateIfNeeded(current, desired, signal);
    this.assertFence(fence);
    await this.ensureRelayGrant(profile, signal, fence);
    this.assertFence(fence);
    return { profile, relayPaired: true };
  }

  async enableGitHubAutoCommit(target: GitHubAutoTarget, consent: {
    automaticTransferConsent: boolean;
    visibilityRiskConsent: boolean;
    publicUploadConsent: boolean;
  }, signal?: AbortSignal): Promise<DurableTransitionResult> {
    const fence = this.fence(signal);
    return serializeDurableTransition(async () => {
      this.assertFence(fence);
      return this.enableGitHubAutoCommitInternal(target, consent, signal, fence);
    });
  }

  private async enableGitHubAutoCommitInternal(target: GitHubAutoTarget, consent: {
    automaticTransferConsent: boolean;
    visibilityRiskConsent: boolean;
    publicUploadConsent: boolean;
  }, signal: AbortSignal | undefined, fence: TransitionFence): Promise<DurableTransitionResult> {
    this.assertFence(fence);
    if (!consent.automaticTransferConsent || !consent.visibilityRiskConsent || (!target.privateRepository && !consent.publicUploadConsent)) {
      throw new DurableAutomationTransitionError("CONSENT_REQUIRED");
    }
    const pairing = await this.requirePairingInfo();
    const current = await this.client.profile(signal);
    this.assertFence(fence);
    const desired = {
      deviceId: pairing.deviceId,
      sourceTransferEnabled: true,
      githubAutoCommitEnabled: true,
      ownershipMode: "DURABLE_SERVER" as const,
      target,
      automaticTransferConsent: true,
      visibilityRiskConsent: true,
      publicUploadConsent: target.privateRepository ? consent.publicUploadConsent : true,
    };
    const profile = await this.updateIfNeeded(current, desired, signal);
    this.assertFence(fence);
    await this.ensureRelayGrant(profile, signal, fence);
    this.assertFence(fence);
    return { profile, relayPaired: true };
  }

  async disableGitHubAutoCommit(signal?: AbortSignal): Promise<DurableTransitionResult> {
    const fence = this.fence(signal);
    return serializeDurableTransition(async () => {
      this.assertFence(fence);
      return this.disableGitHubAutoCommitInternal(signal, fence);
    });
  }

  private async disableGitHubAutoCommitInternal(signal: AbortSignal | undefined, fence: TransitionFence): Promise<DurableTransitionResult> {
    this.assertFence(fence);
    const current = await this.client.profile(signal);
    this.assertFence(fence);
    if (current.ownershipMode !== "DURABLE_SERVER") return { profile: current, relayPaired: false };
    const pairing = await (this.bridge.relayPairingInfo?.().catch(() => null) ?? Promise.resolve(null));
    const deviceId = pairing?.deviceId ?? current.deviceId;
    if (!deviceId) throw new DurableAutomationTransitionError("RELAY_PAIRING_UNAVAILABLE");
    const desired = {
      deviceId,
      sourceTransferEnabled: current.sourceTransferEnabled,
      githubAutoCommitEnabled: false,
      ownershipMode: "DURABLE_SERVER" as const,
      target: current.target,
      automaticTransferConsent: current.automaticTransferConsent,
      visibilityRiskConsent: current.visibilityRiskConsent,
      publicUploadConsent: current.publicUploadConsent,
    };
    const profile = await this.updateIfNeeded(current, desired, signal);
    this.assertFence(fence);
    if (profile.sourceTransferEnabled) {
      await this.ensureRelayGrant(profile, signal, fence);
      this.assertFence(fence);
      return { profile, relayPaired: true };
    }
    return { profile, relayPaired: false };
  }

  async disableAll(
    signal?: AbortSignal,
    cachedProfile: DurableAutomationProfile | null = null,
  ): Promise<DurableTransitionResult> {
    const fence = this.fence(signal);
    return serializeDurableTransition(async () => {
      this.assertFence(fence);
      return this.disableAllInternal(fence, signal, cachedProfile);
    });
  }

  private async disableAllInternal(
    fence: TransitionFence,
    signal?: AbortSignal,
    cachedProfile: DurableAutomationProfile | null = null,
  ): Promise<DurableTransitionResult> {
    this.assertFence(fence);
    const pairing = await (this.bridge.relayPairingInfo?.().catch(() => null) ?? Promise.resolve(null));
    this.assertFence(fence);
    const localRevocationConfirmed = await this.confirmLocalRevoke(pairing, cachedProfile);
    this.assertFence(fence);
    let current = cachedProfile;
    try {
      const discovered = await this.client.profile(signal);
      this.assertFence(fence);
      if (cachedProfile && !sameRevocationContext(cachedProfile, discovered)) {
        // A new account/session must never authorize OFF for the cached old context.
        // Keep the old profile stopped and pending until its own server transition is confirmed.
        return {
          profile: cachedProfile,
          relayPaired: false,
          localRevocationConfirmed,
          serverRevocationConfirmed: false,
        };
      }
      current = discovered;
    } catch {
      if (!current) throw new DurableAutomationTransitionError("PROFILE_UNAVAILABLE");
    }
    if (!current || current.ownershipMode !== "DURABLE_SERVER") {
      return {
        profile: current ?? cachedProfile!,
        relayPaired: false,
        localRevocationConfirmed,
        serverRevocationConfirmed: true,
      };
    }
    const deviceId = pairing?.deviceId ?? current.deviceId;
    if (!deviceId) {
      return { profile: current, relayPaired: false, localRevocationConfirmed, serverRevocationConfirmed: false };
    }
    const desired = {
      deviceId,
      sourceTransferEnabled: false,
      githubAutoCommitEnabled: false,
      ownershipMode: "DURABLE_SERVER" as const,
      target: current.target,
      automaticTransferConsent: false,
      visibilityRiskConsent: false,
      publicUploadConsent: false,
    };
    try {
      this.assertFence(fence);
      const profile = await this.updateIfNeeded(current, desired, signal);
      this.assertFence(fence);
      return { profile, relayPaired: false, localRevocationConfirmed, serverRevocationConfirmed: true };
    } catch {
      this.assertFence(fence);
      // Local source transfer is already stopped and the cached profile is kept
      // as REVOCATION_PENDING until an authenticated reconciliation succeeds.
      return { profile: current, relayPaired: false, localRevocationConfirmed, serverRevocationConfirmed: false };
    }
  }

  private async confirmLocalRevoke(
    pairing: CodeArchiveRelayPairingInfoResponse | null,
    cachedProfile: DurableAutomationProfile | null = null,
  ): Promise<boolean> {
    if (cachedProfile && (
      cachedProfile.ownershipMode !== "DURABLE_SERVER"
      || !pairing
      || pairing.state === "UNPAIRED"
      || pairing.deviceId !== cachedProfile.deviceId
      || pairing.generation !== cachedProfile.generation
    )) return false;
    if (!pairing || pairing.state === "UNPAIRED") return Boolean(pairing);
    const applied = await (this.bridge.relayConfirmRevoke?.({
      type: "CODEARCHIVE_RELAY_REVOKE_CONFIRMED",
      phase: "REQUEST",
      protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
      deviceId: pairing.deviceId,
      grantId: pairing.grantId,
      generation: pairing.generation,
      revokedAt: new Date(this.now()).toISOString(),
    }).catch(() => null) ?? Promise.resolve(null));
    return Boolean(applied
      && applied.deviceId === pairing.deviceId
      && applied.grantId === pairing.grantId
      && applied.generation === pairing.generation);
  }

  private async requirePairingInfo(): Promise<CodeArchiveRelayPairingInfoResponse> {
    const pairingInfo = this.bridge.relayPairingInfo;
    if (!pairingInfo) throw new DurableAutomationTransitionError("RELAY_PAIRING_UNAVAILABLE");
    const pairing = await pairingInfo().catch(() => null);
    if (!pairing) throw new DurableAutomationTransitionError("RELAY_PAIRING_UNAVAILABLE");
    return pairing;
  }

  private async updateIfNeeded(
    current: DurableAutomationProfile,
    desired: Omit<DurableAutomationUpdate, "expectedVersion">,
    signal?: AbortSignal,
  ): Promise<DurableAutomationProfile> {
    if (sameDesired(current, desired)) return current;
    return this.client.update({ ...desired, expectedVersion: current.version }, signal);
  }

  private async ensureRelayGrant(profile: DurableAutomationProfile, signal: AbortSignal | undefined, fence: TransitionFence): Promise<void> {
    this.assertFence(fence);
    if (!profile.sourceTransferEnabled || profile.ownershipMode !== "DURABLE_SERVER" || !profile.deviceId) {
      throw new DurableAutomationTransitionError("PROFILE_NOT_RELAY_ELIGIBLE");
    }
    const info = await this.requirePairingInfo();
    this.assertFence(fence);
    if (info.deviceId !== profile.deviceId) throw new DurableAutomationTransitionError("DEVICE_CHANGED");
    if (pairedForProfile(info, profile, this.now())) return;

    const challenge = await this.client.relayChallenge(info.deviceId, info.publicKey, signal);
    this.assertFence(fence);
    if (Date.parse(challenge.expiresAt) <= this.now()) throw new DurableAutomationTransitionError("CHALLENGE_EXPIRED");
    const signed = await this.bridge.relaySignChallenge?.({
      type: "CODEARCHIVE_RELAY_SIGN_CHALLENGE",
      phase: "REQUEST",
      protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
      deviceId: info.deviceId,
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      expiresAt: challenge.expiresAt,
    }) ?? null;
    this.assertFence(fence);
    if (!signed || signed.deviceId !== info.deviceId || signed.challengeId !== challenge.challengeId) {
      throw new DurableAutomationTransitionError("CHALLENGE_SIGNATURE_REJECTED");
    }
    const grant = await this.client.relayGrant({
      deviceId: info.deviceId,
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      publicKey: info.publicKey,
      signature: signed.signature,
    }, signal);
    this.assertFence(fence);
    if (grant.deviceId !== profile.deviceId || grant.generation !== profile.generation || Date.parse(grant.expiresAt) <= this.now()) {
      throw new DurableAutomationTransitionError("GRANT_GENERATION_MISMATCH");
    }
    // The profile may have advanced while the challenge/grant round trip was
    // in flight (for example, another tab or a second control path changed
    // consent). Do not provision a grant that is no longer current.
    const latest = await this.client.profile(signal);
    this.assertFence(fence);
    if (latest.userId !== profile.userId || latest.ownershipMode !== "DURABLE_SERVER" || !latest.sourceTransferEnabled
      || latest.deviceId !== profile.deviceId || latest.generation !== profile.generation) {
      throw new DurableAutomationTransitionError("GRANT_GENERATION_MISMATCH");
    }
    this.assertFence(fence);
    const stored = await this.bridge.relayProvisionGrant?.({
      type: "CODEARCHIVE_RELAY_GRANT_PROVISION",
      phase: "REQUEST",
      protocolVersion: CODEARCHIVE_BRIDGE_PROTOCOL_VERSION,
      deviceId: grant.deviceId,
      challengeId: challenge.challengeId,
      grantId: grant.grantId,
      credential: grant.credential,
      generation: grant.generation,
      expiresAt: grant.expiresAt,
    }) ?? null;
    this.assertFence(fence);
    if (!stored || stored.deviceId !== grant.deviceId || stored.grantId !== grant.grantId
      || stored.generation !== grant.generation || stored.expiresAt !== grant.expiresAt) {
      throw new DurableAutomationTransitionError("GRANT_STORAGE_UNCONFIRMED");
    }
  }
}
