import { notifyExplicitAutoSyncOff } from "./durableAutomationIntent";
import { durableAutomationProfile, setDurableAutomationProfile } from "./durableAutomationState";

export const ACCOUNT_CONSENT_KEY = "codearchive.autoSyncConsent.v1";
const BINDING_PREFIX = "v1:sha256:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BINDING = /^v1:sha256:[0-9a-f]{64}$/;

export function validatedAccountId(value: unknown): string | undefined {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : undefined;
}

export async function deriveAccountBinding(id: unknown): Promise<string | null> {
  const accountId = validatedAccountId(id);
  if (!accountId) return null;
  try {
    const bytes = new TextEncoder().encode(`codearchive:auto-sync-consent:v1:${accountId}`);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return BINDING_PREFIX + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

export interface AutoSyncConsentStore {
  read(binding: string): boolean;
  write(enabled: boolean, binding?: string | null): void;
  subscribe?(onInvalidated: () => void): () => void;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function createAutoSyncConsentStore(storage: StorageLike | null = browserStorage()): AutoSyncConsentStore {
  let restorationDisabled = false;
  const clear = () => {
    try { storage?.removeItem(ACCOUNT_CONSENT_KEY); } catch { restorationDisabled = true; }
  };
  return {
    read(binding) {
      if (!storage || restorationDisabled || !BINDING.test(binding)) return false;
      try {
        const raw = storage.getItem(ACCOUNT_CONSENT_KEY);
        if (raw === null) return false;
        const value: unknown = JSON.parse(raw);
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const preference = value as Record<string, unknown>;
          if (Object.keys(preference).length === 2 && preference.binding === binding && preference.enabled === true) return true;
        }
        clear();
      } catch { restorationDisabled = true; clear(); }
      return false;
    },
    write(enabled, binding) {
      if (!enabled || !binding || !BINDING.test(binding)) { clear(); return; }
      try { storage?.setItem(ACCOUNT_CONSENT_KEY, JSON.stringify({ binding, enabled: true })); }
      catch { restorationDisabled = true; clear(); /* Explicit in-memory consent does not depend on storage. */ }
    },
    subscribe(onInvalidated) {
      const listener = (event: StorageEvent) => {
        if ((event.key === null || event.key === ACCOUNT_CONSENT_KEY)
          && (!event.storageArea || event.storageArea === storage)) onInvalidated();
      };
      globalThis.addEventListener("storage", listener);
      return () => globalThis.removeEventListener("storage", listener);
    },
  };
}

// A preference is not auth. Call verify only after a fresh successful /me response.
export function createAccountConsentController(
  store: AutoSyncConsentStore,
  onChange: (enabled: boolean) => void,
  derive: (id: unknown) => Promise<string | null> = deriveAccountBinding,
  onInvalidated: () => void = () => {},
) {
  let revision = 0;
  let verifiedId: string | undefined;
  const write = (enabled: boolean, binding?: string | null) => {
    try { store.write(enabled, binding); } catch { /* Optional persistence. */ }
  };
  const bindingFor = async (id: unknown) => {
    try { return await derive(id); } catch { return null; }
  };
  const reset = (clearStored: boolean) => {
    revision += 1;
    verifiedId = undefined;
    onChange(false);
    if (clearStored) {
      write(false);
      void notifyExplicitAutoSyncOff();
    }
  };
  return {
    async verify(id: unknown) {
      const current = ++revision;
      const nextId = validatedAccountId(id);
      onChange(false);
      const durable = durableAutomationProfile();
      if (durable && durable.userId !== nextId) {
        const revoked = await notifyExplicitAutoSyncOff();
        if (revoked && durableAutomationProfile()?.userId === durable.userId) {
          setDurableAutomationProfile(null, false);
        }
      }
      if (current !== revision) return;
      verifiedId = nextId;
      const binding = await bindingFor(verifiedId);
      if (current !== revision) return;
      if (!binding) { write(false); return; }
      try { onChange(store.read(binding)); } catch { onChange(false); }
    },
    async choose(enabled: boolean) {
      const current = ++revision;
      onChange(enabled);
      if (!enabled) {
        write(false);
        await notifyExplicitAutoSyncOff();
        return;
      }
      const binding = await bindingFor(verifiedId);
      if (current === revision) write(true, binding);
    },
    reset,
    subscribe() {
      const unsubscribe = store.subscribe?.(() => {
        revision += 1;
        verifiedId = undefined;
        onChange(false);
        onInvalidated();
      });
      return () => {
        revision += 1;
        verifiedId = undefined;
        unsubscribe?.();
      };
    },
  };
}
