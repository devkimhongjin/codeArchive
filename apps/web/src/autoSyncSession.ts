export const DASHBOARD_BETA_ORIGIN = "https://codearchive-dashboard-beta.onrender.com";
const AUTO_SYNC_CONSENT_KEY = "codearchive.autoSyncConsent";

export interface AutoSyncConsentStore {
  read(): boolean;
  write(enabled: boolean): void;
}

export interface AutoSyncSessionTransport {
  startSyncSession(syncSessionId: string): Promise<boolean>;
  endSyncSession(syncSessionId: string): Promise<void>;
}

export interface AutoSyncSessionController {
  setEligibility(eligible: boolean, authContextKey: string): Promise<void>;
  teardown(): Promise<void>;
  hasActiveSession(): boolean;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function createAutoSyncConsentStore(
  storage: StorageLike | null = typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage,
): AutoSyncConsentStore {
  return {
    read() {
      if (!storage) return false;
      try {
        return storage.getItem(AUTO_SYNC_CONSENT_KEY) === "true";
      } catch {
        return false;
      }
    },
    write(enabled) {
      if (!storage) return;
      try {
        storage.setItem(AUTO_SYNC_CONSENT_KEY, enabled ? "true" : "false");
      } catch {
        // Consent persistence is optional; keep the in-memory choice usable.
      }
    },
  };
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
): AutoSyncSessionController {
  let desiredEligible = false;
  let desiredAuthContextKey = "";
  let activeSessionId: string | null = null;
  let activeAuthContextKey = "";
  let transition = Promise.resolve();

  const reconcile = async () => {
    if (
      activeSessionId
      && (!desiredEligible || activeAuthContextKey !== desiredAuthContextKey)
    ) {
      const endingSessionId = activeSessionId;
      activeSessionId = null;
      activeAuthContextKey = "";
      try {
        await transport.endSyncSession(endingSessionId);
      } catch {
        // Port disconnect/error still invalidates the in-memory Web session.
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
