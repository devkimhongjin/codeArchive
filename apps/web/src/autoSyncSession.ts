import { createAutoSyncConsentStore } from "./accountConsent";
import { DurableAutomationController, type DashboardRelayPairingConnection } from "./durableAutomation";
import { mainApiDurableAutomationClient } from "./durableAutomationClient";
import { registerExplicitAutoSyncOffHandler } from "./durableAutomationIntent";
import { registerDurableAutomationController } from "./durableAutomationRuntime";
import {
  durableAutomationProfile,
  markDurableLocalSourceStopped,
  setDurableAutomationProfile,
} from "./durableAutomationState";
export { createAutoSyncConsentStore, type AutoSyncConsentStore } from "./accountConsent";
export const DASHBOARD_BETA_ORIGIN = "https://codearchive-dashboard-beta.onrender.com";

export interface AutoSyncSessionTransport {
  startSyncSession(syncSessionId: string): Promise<boolean>;
  endSyncSession(syncSessionId: string): Promise<void>;
  relayPairingInfo?: DashboardRelayPairingConnection["relayPairingInfo"];
  relaySignChallenge?: DashboardRelayPairingConnection["relaySignChallenge"];
  relayProvisionGrant?: DashboardRelayPairingConnection["relayProvisionGrant"];
  relayConfirmRevoke?: DashboardRelayPairingConnection["relayConfirmRevoke"];
}

export interface AutoSyncSessionController {
  setEligibility(eligible: boolean, authContextKey: string): Promise<void>;
  teardown(): Promise<void>;
  hasActiveSession(): boolean;
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
): AutoSyncSessionController {
  let desiredEligible = false;
  let desiredAuthContextKey = "";
  let activeSessionId: string | null = null;
  let activeAuthContextKey = "";
  let transition = Promise.resolve();
  let durableDetected = durableAutomationProfile()?.ownershipMode === "DURABLE_SERVER";
  const relayTransport = relayCapable(transport) ? transport : null;
  const durable = relayTransport ? new DurableAutomationController(mainApiDurableAutomationClient, relayTransport) : null;

  if (durable) {
    registerDurableAutomationController(durable);
    registerExplicitAutoSyncOffHandler(async () => {
      const current = durableAutomationProfile();
      if (!current || current.ownershipMode !== "DURABLE_SERVER") return;
      try {
        const result = await durable.disableAll();
        setDurableAutomationProfile(result.profile, false);
      } catch {
        // Local Extension state is stopped by the metadata update immediately.
        // Server OFF remains pending and will be reconciled from the next authenticated Dashboard.
      }
    });
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
      let pairing = null;
      try { pairing = await relayTransport.relayPairingInfo(); } catch { pairing = null; }
      if (pairing) {
        durableDetected = true;
        if (pairing.state === "REVOCATION_PENDING") {
          // Popup-local OFF is durable intent, not a transient disconnect. Never turn it
          // back on merely because the Dashboard reopened and remembered consent exists.
          markDurableLocalSourceStopped();
          try {
            const result = await durable.disableAll();
            setDurableAutomationProfile(result.profile, false);
          } catch {
            // Keep the local stop latched. A later authenticated reconciliation may finish
            // the server-side OFF, but this generation must not silently resume.
          }
          await endPageOwnedSession();
          return;
        }
        try {
          const result = await durable.enableSourceTransfer();
          setDurableAutomationProfile(result.profile);
        } catch {
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
    setEligibility(eligible, authContextKey) {
      desiredEligible = eligible;
      desiredAuthContextKey = eligible ? authContextKey : "";
      return schedule();
    },
    teardown() {
      // Teardown destroys only page-local capability/session state. Confirmed DURABLE_SERVER
      // intent is not cleared by pagehide, disconnect, offline, or component unmount.
      desiredEligible = false;
      desiredAuthContextKey = "";
      return schedule();
    },
    hasActiveSession() {
      return activeSessionId !== null;
    },
  };
}

export const dashboardAutoSyncConsentStore = createAutoSyncConsentStore();
