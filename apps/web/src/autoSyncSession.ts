import { createAutoSyncConsentStore } from "./accountConsent";
import { cancelAllDurableAutomationControllers, DurableAutomationController, type DashboardRelayPairingConnection } from "./durableAutomation";
import { mainApiDurableAutomationClient } from "./durableAutomationClient";
import { COMMUNITY_DEFAULT_PUBLIC_POLICY_VERSION } from "./durableAutomationClient";
import { registerExplicitAutoSyncOffHandler } from "./durableAutomationIntent";
import { registerDurableAutomationController } from "./durableAutomationRuntime";
import {
  durableAutomationProfile,
  markDurableLocalSourceStopped,
  setDurableAutomationProfile,
} from "./durableAutomationState";
import type { RelayPairingProbe } from "./extensionConnection";
export { createAutoSyncConsentStore, type AutoSyncConsentStore } from "./accountConsent";
export const DASHBOARD_BETA_ORIGIN = "https://codearchive-dashboard-beta.onrender.com";

export interface AutoSyncSessionTransport {
  startSyncSession(syncSessionId: string): Promise<boolean>;
  endSyncSession(syncSessionId: string): Promise<void>;
  relayPairingInfo?: DashboardRelayPairingConnection["relayPairingInfo"];
  relayPairingStatus?: () => Promise<RelayPairingProbe>;
  relaySignChallenge?: DashboardRelayPairingConnection["relaySignChallenge"];
  relayProvisionGrant?: DashboardRelayPairingConnection["relayProvisionGrant"];
  relayConfirmRevoke?: DashboardRelayPairingConnection["relayConfirmRevoke"];
}

export interface AutoSyncSessionController {
  setEligibility(eligible: boolean, authContextKey: string): Promise<void>;
  teardown(): Promise<void>;
  revokeDurableAutomation(): Promise<boolean>;
  rearmDurableReconnect(): void;
  hasActiveSession(): boolean;
  confirmCommunityDefaultPublic(): Promise<boolean>;
}

export function secureSyncSessionId(): string {
  return globalThis.crypto.randomUUID();
}

export function isExactDashboardOrigin(origin: string): boolean {
  return origin === DASHBOARD_BETA_ORIGIN;
}

function relayCapable(transport: AutoSyncSessionTransport): transport is AutoSyncSessionTransport & DashboardRelayPairingConnection {
  return typeof transport.relayPairingInfo === "function"
    && typeof transport.relaySignChallenge === "function"
    && typeof transport.relayProvisionGrant === "function"
    && typeof transport.relayConfirmRevoke === "function";
}

export function createAutoSyncSessionController(
  transport: AutoSyncSessionTransport,
  generateSyncSessionId: () => string = secureSyncSessionId,
  onActiveSessionChange: (syncSessionId: string | null) => void = () => undefined,
  onCommunityDefaultPublicConsentActiveChange: (active: boolean) => void = () => undefined,
): AutoSyncSessionController {
  let desiredEligible = false;
  let desiredAuthContextKey = "";
  let activeSessionId: string | null = null;
  let activeAuthContextKey = "";
  let transition = Promise.resolve();
  let durableDetected = durableAutomationProfile()?.ownershipMode === "DURABLE_SERVER";
  let durableReconnectBlocked = false;
  const relayTransport = relayCapable(transport) ? transport : null;
  const durable = relayTransport ? new DurableAutomationController(
    mainApiDurableAutomationClient,
    relayTransport,
    undefined,
    () => desiredAuthContextKey,
  ) : null;

  const revokeDurableAutomation = async (): Promise<boolean> => {
    const current = durableAutomationProfile();
    if (!durable || !current || current.ownershipMode !== "DURABLE_SERVER") return false;
    durableReconnectBlocked = true;
    cancelAllDurableAutomationControllers();
    durable.cancelPendingTransitions();
    markDurableLocalSourceStopped();
    try {
      const result = await durable.disableAll(undefined, current);
      setDurableAutomationProfile(result.profile, false);
      return result.serverRevocationConfirmed === true && result.localRevocationConfirmed === true;
    } catch {
      // Local Extension state is stopped by the metadata update immediately.
      // Server OFF remains pending and will be reconciled from the next authenticated Dashboard.
      return false;
    }
  };

  if (durable) {
    registerDurableAutomationController(durable);
    registerExplicitAutoSyncOffHandler(revokeDurableAutomation);
  }

  const clearActive = (expectedSessionId: string) => {
    if (activeSessionId !== expectedSessionId) return;
    activeSessionId = null;
    activeAuthContextKey = "";
    onActiveSessionChange(null);
  };

  const endPageOwnedSession = async () => {
    if (!activeSessionId) return;
    const endingSessionId = activeSessionId;
    try {
      await transport.endSyncSession(endingSessionId);
    } catch {
      // Port disconnect/error still invalidates the in-memory Web session.
    } finally {
      clearActive(endingSessionId);
    }
  };

  const reconcile = async () => {
    if (
      activeSessionId
      && (!desiredEligible || activeAuthContextKey !== desiredAuthContextKey || durableDetected)
    ) await endPageOwnedSession();

    if (!desiredEligible) return;

    if (durable && relayTransport) {
      const remembered = durableAutomationProfile();
      if (remembered?.ownershipMode === "DURABLE_SERVER") durableDetected = true;
      let pairingProbe: RelayPairingProbe = { kind: "unknown" };
      try {
        pairingProbe = relayTransport.relayPairingStatus
          ? await relayTransport.relayPairingStatus()
          : { kind: "unknown" };
      } catch {
        pairingProbe = { kind: "unknown" };
      }
      // A timeout, bridge error, or malformed response is not proof that the
      // relay is unpaired. Keep the single-writer decision fail-closed until
      // an authoritative pairing response is available.
      if (pairingProbe.kind === "unknown") {
        await endPageOwnedSession();
        return;
      }
      const pairing = pairingProbe.pairing;
      if (pairing) {
        durableDetected = true;
        if (pairing.state === "REVOCATION_PENDING") {
          // Popup-local OFF is durable intent, not a transient disconnect. Never turn it
          // back on merely because the Dashboard reopened and remembered consent exists.
          markDurableLocalSourceStopped();
          try {
            const result = await durable.disableAll(undefined, remembered);
            setDurableAutomationProfile(result.profile, false);
          } catch {
            // Keep the local stop latched. A later authenticated reconciliation may finish
            // the server-side OFF, but this generation must not silently resume.
          }
          await endPageOwnedSession();
          return;
        }
        if (durableReconnectBlocked) {
          // A disconnect-triggered revoke is a durable stop even when its server/local
          // confirmation is unavailable. Reconnect requires a fresh explicit AUTO_SYNC ON.
          await endPageOwnedSession();
          return;
        }
        try {
          const result = await durable.enableSourceTransfer();
          setDurableAutomationProfile(result.profile);
          onCommunityDefaultPublicConsentActiveChange(result.profile.communityDefaultPublicConsentActive === true);
        } catch {
          onCommunityDefaultPublicConsentActiveChange(false);
          // Once relay capability has been detected, never fall back to a page-owned writer
          // after a possibly-partial durable profile transition.
        }
        await endPageOwnedSession();
        return;
      }
      if (durableDetected) {
        await endPageOwnedSession();
        return;
      }
    }

    if (activeSessionId) return;

    const startingContextKey = desiredAuthContextKey;
    const syncSessionId = generateSyncSessionId();
    let started = false;
    try {
      started = await transport.startSyncSession(syncSessionId);
    } catch {
      started = false;
    }
    if (!started) return;

    if (!desiredEligible || desiredAuthContextKey !== startingContextKey || durableDetected) {
      try {
        await transport.endSyncSession(syncSessionId);
      } catch {
        // The returned session is discarded even if the Port already disappeared.
      }
      return;
    }

    activeSessionId = syncSessionId;
    activeAuthContextKey = startingContextKey;
    onActiveSessionChange(syncSessionId);
  };

  const schedule = () => {
    transition = transition.then(reconcile, reconcile);
    return transition;
  };

  return {
    async confirmCommunityDefaultPublic() {
      if (!durable || !desiredEligible) return false;
      try {
        const result = await durable.enableSourceTransfer(undefined, COMMUNITY_DEFAULT_PUBLIC_POLICY_VERSION);
        setDurableAutomationProfile(result.profile);
        const active = result.profile.communityDefaultPublicConsentActive === true;
        onCommunityDefaultPublicConsentActiveChange(active);
        return active;
      } catch { onCommunityDefaultPublicConsentActiveChange(false); return false; }
    },
    setEligibility(eligible, authContextKey) {
      if (!eligible || desiredAuthContextKey !== (eligible ? authContextKey : "")) onCommunityDefaultPublicConsentActiveChange(false);
      if (!eligible || desiredAuthContextKey !== (eligible ? authContextKey : "")) {
        cancelAllDurableAutomationControllers();
        durable?.cancelPendingTransitions();
      }
      desiredEligible = eligible;
      desiredAuthContextKey = eligible ? authContextKey : "";
      return schedule();
    },
    teardown() {
      // Teardown destroys only page-local capability/session state. Confirmed DURABLE_SERVER
      // intent is not cleared by pagehide, disconnect, offline, or component unmount.
      desiredEligible = false;
      desiredAuthContextKey = "";
      cancelAllDurableAutomationControllers();
      durable?.cancelPendingTransitions();
      return schedule();
    },
    revokeDurableAutomation,
    rearmDurableReconnect() {
      durableReconnectBlocked = false;
    },
    hasActiveSession() {
      return activeSessionId !== null;
    },
  };
}

export const dashboardAutoSyncConsentStore = createAutoSyncConsentStore();
