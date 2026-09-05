import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_CONSENT_KEY, createAccountConsentController, createAutoSyncConsentStore, deriveAccountBinding } from "./accountConsent";
import { registerExplicitAutoSyncOffHandler } from "./durableAutomationIntent";
import { durableAutomationProfile, durableLocalSourceStopped, setDurableAutomationProfile } from "./durableAutomationState";

const id = "550e8400-e29b-41d4-a716-446655440000";
const otherId = "550e8400-e29b-41d4-a716-446655440001";
const binding = `v1:sha256:${"a".repeat(64)}`;
const DURABLE_PROFILE = {
  userId: id,
  deviceId: "device_identity_1234",
  generation: 4,
  sourceTransferEnabled: true,
  githubAutoCommitEnabled: true,
  ownershipMode: "DURABLE_SERVER" as const,
  targetGeneration: 2,
  target: null,
  automaticTransferConsent: true,
  visibilityRiskConsent: true,
  publicUploadConsent: false,
  githubEnabledAt: "2026-09-04T07:00:00Z",
  version: 7,
  updatedAt: "2026-09-04T08:00:00Z",
};

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setDurableAutomationProfile(null, false);
});

describe("account-bound remembered consent", () => {
  it("hashes an immutable UUID with a versioned domain separator, never storing raw identity", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const result = await deriveAccountBinding(id);
    expect(result).toMatch(/^v1:sha256:[0-9a-f]{64}$/);
    expect(result).toBe(await deriveAccountBinding(id.toUpperCase()));
    expect(result).not.toBe(await deriveAccountBinding(otherId));
    expect(result).not.toContain(id);
    expect(await deriveAccountBinding("octocat")).toBeNull();
    const storage = memoryStorage();
    createAutoSyncConsentStore(storage).write(true, result);
    expect([...storage.values.values()]).toEqual([JSON.stringify({ binding: result, enabled: true })]);
  });

  it("does not read persistence until verified identity hashing finishes", async () => {
    let finish!: (binding: string) => void;
    const store = { read: vi.fn(() => true), write: vi.fn() };
    const changed = vi.fn();
    const controller = createAccountConsentController(store, changed, () => new Promise((resolve) => { finish = resolve; }));
    const verifying = controller.verify(id);
    expect(changed).toHaveBeenLastCalledWith(false);
    expect(store.read).not.toHaveBeenCalled();
    finish(binding);
    await verifying;
    expect(store.read).toHaveBeenCalledWith(binding);
    expect(changed).toHaveBeenLastCalledWith(true);
  });

  it("clears another account preference and ignores malformed/legacy values", () => {
    const storage = memoryStorage();
    const store = createAutoSyncConsentStore(storage);
    store.write(true, binding);
    expect(store.read(`v1:sha256:${"b".repeat(64)}`)).toBe(false);
    expect(storage.values.has(ACCOUNT_CONSENT_KEY)).toBe(false);
    for (const raw of ["true", "{}", "null", JSON.stringify({ binding, enabled: true, id })]) {
      storage.values.set(ACCOUNT_CONSENT_KEY, raw);
      expect(store.read(binding)).toBe(false);
    }
  });

  it.each(["logout", "off", "storage"])("rejects a late hash result after %s revocation", async (reason) => {
    let finish!: (binding: string) => void;
    let invalidated!: () => void;
    const store = { read: vi.fn(() => true), write: vi.fn(), subscribe: (listener: () => void) => { invalidated = listener; return () => {}; } };
    const changed = vi.fn();
    const controller = createAccountConsentController(store, changed, () => new Promise((resolve) => { finish = resolve; }));
    const stop = controller.subscribe();
    const verifying = controller.verify(id);
    if (reason === "logout") controller.reset(true);
    else if (reason === "off") await controller.choose(false);
    else invalidated();
    finish(binding);
    await verifying;
    expect(store.read).not.toHaveBeenCalled();
    expect(changed).toHaveBeenLastCalledWith(false);
    stop();
  });

  it("does not persist a delayed opt-in after opt-out", async () => {
    let finish!: (binding: string) => void;
    const store = { read: vi.fn(() => false), write: vi.fn() };
    const derive = vi.fn().mockResolvedValueOnce(binding).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const controller = createAccountConsentController(store, vi.fn(), derive);
    await controller.verify(id);
    const choosing = controller.choose(true);
    await controller.choose(false);
    finish(binding);
    await choosing;
    expect(store.write).toHaveBeenCalledExactlyOnceWith(false, undefined);
  });

  it("fails closed for missing ID and crypto/storage failure but permits explicit memory-only opt-in", async () => {
    vi.stubGlobal("crypto", {});
    expect(await deriveAccountBinding(id)).toBeNull();
    const changed = vi.fn();
    const store = createAutoSyncConsentStore({ getItem: () => { throw new Error(); }, setItem: () => { throw new Error(); }, removeItem: () => { throw new Error(); } });
    expect(store.read(binding)).toBe(false);
    const controller = createAccountConsentController(store, changed);
    await controller.verify(undefined);
    expect(changed).toHaveBeenLastCalledWith(false);
    await controller.choose(true);
    expect(changed).toHaveBeenLastCalledWith(true);
  });

  it("revokes the previous durable account before clearing its profile", async () => {
    setDurableAutomationProfile(DURABLE_PROFILE);
    const off = vi.fn(async () => {
      setDurableAutomationProfile({ ...DURABLE_PROFILE, sourceTransferEnabled: false, githubAutoCommitEnabled: false }, false);
      return true;
    });
    const unregister = registerExplicitAutoSyncOffHandler(off);
    const controller = createAccountConsentController({ read: () => false, write: vi.fn() }, vi.fn(), async () => binding);

    await controller.verify(otherId);

    expect(off).toHaveBeenCalledOnce();
    expect(durableAutomationProfile()).toBeNull();
    unregister();
  });

  it("retains a stopped durable profile when account/session revocation is unconfirmed", async () => {
    setDurableAutomationProfile(DURABLE_PROFILE);
    const unregister = registerExplicitAutoSyncOffHandler(async () => false);
    const controller = createAccountConsentController({ read: () => false, write: vi.fn() }, vi.fn(), async () => binding);

    await controller.verify(undefined);

    expect(durableAutomationProfile()?.userId).toBe(id);
    expect(durableLocalSourceStopped()).toBe(true);
    unregister();
  });

  it("invalidates on other-tab key changes and storage clear, never on unrelated keys", () => {
    const listener = vi.fn();
    const stop = createAutoSyncConsentStore(memoryStorage()).subscribe!(listener);
    globalThis.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(listener).not.toHaveBeenCalled();
    globalThis.dispatchEvent(new StorageEvent("storage", { key: ACCOUNT_CONSENT_KEY }));
    globalThis.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it.each(["setItem", "removeItem"] as const)("disables restoration for this store lifetime when %s fails", (method) => {
    const storage = memoryStorage();
    storage.values.set(ACCOUNT_CONSENT_KEY, JSON.stringify({ binding, enabled: true }));
    storage[method] = () => { throw new Error(); };
    const store = createAutoSyncConsentStore(storage);
    store.write(method === "setItem", binding);
    // Even if storage later works or still holds old consent, this instance cannot restore.
    storage.values.set(ACCOUNT_CONSENT_KEY, JSON.stringify({ binding, enabled: true }));
    expect(store.read(binding)).toBe(false);
  });
});
