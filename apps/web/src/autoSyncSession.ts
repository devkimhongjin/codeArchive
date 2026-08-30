import { createAutoSyncConsentStore } from "./accountConsent";
export { createAutoSyncConsentStore, type AutoSyncConsentStore } from "./accountConsent";
export const DASHBOARD_BETA_ORIGIN = "https://codearchive-dashboard-beta.onrender.com";

export interface AutoSyncSessionTransport {
  startSyncSession(syncSessionId: string): Promise<boolean>;
  endSyncSession(syncSessionId: string): Promise<void>;
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

  const clearActive = (expectedSessionId: string) => {
    if (activeSessionId !== expectedSessionId) return;
    activeSessionId = null;
    activeAuthContextKey = "";
    onActiveSessionChange(null);
  };

  const reconcile = async () => {
    if (
      activeSessionId
      && (!desiredEligible || activeAuthContextKey !== desiredAuthContextKey)
    ) {
      const endingSessionId = activeSessionId;
      try {
        await transport.endSyncSession(endingSessionId);
      } catch {
        // Port disconnect/error still invalidates the in-memory Web session.
      } finally {
        clearActive(endingSessionId);
      }
    }

    if (!desiredEligible || activeSessionId) return;

    const startingContextKey = desiredAuthContextKey;
    const syncSessionId = generateSyncSessionId();
    let started = false;
    try {
      started = await transport.startSyncSession(syncSessionId);
    } catch {
      started = false;
    }
    if (!started) return;

    if (!desiredEligible || desiredAuthContextKey !== startingContextKey) {
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
