import { describe, expect, it, vi } from "vitest";
import {
  createAutoSyncConsentStore,
  createAutoSyncSessionController,
  isExactDashboardOrigin,
  secureSyncSessionId,
  type AutoSyncSessionTransport,
} from "./autoSyncSession";

function transport() {
  const startSyncSession = vi.fn(async () => true);
  const endSyncSession = vi.fn(async () => undefined);
  return { value: { startSyncSession, endSyncSession } satisfies AutoSyncSessionTransport, startSyncSession, endSyncSession };
}

describe("Dashboard auto-sync session controller", () => {
  it("stores only a versioned account binding and preference, ignoring legacy boolean", () => {
    const values = new Map<string, string>();
    values.set("codearchive.autoSyncConsent", "true");
    const binding = `v1:sha256:${"a".repeat(64)}`;
    const store = createAutoSyncConsentStore({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    });
    expect(store.read(binding)).toBe(false);
    store.write(true, binding);
    expect(store.read(binding)).toBe(true);
    expect(JSON.parse(values.get("codearchive.autoSyncConsent.v1")!)).toEqual({ binding, enabled: true });
    store.write(false);
    expect(store.read(binding)).toBe(false);
  });

  it("requires the exact beta Dashboard origin", () => {
    expect(isExactDashboardOrigin("https://codearchive-dashboard-beta.onrender.com")).toBe(true);
    expect(isExactDashboardOrigin("http://codearchive-dashboard-beta.onrender.com")).toBe(false);
    expect(isExactDashboardOrigin("https://example.com")).toBe(false);
  });

  it("starts once while eligible and rerenders do not duplicate START", async () => {
    const bridge = transport();
    const ids = ["session-a", "session-b"];
    const controller = createAutoSyncSessionController(bridge.value, () => ids.shift()!);

    await controller.setEligibility(true, "octocat");
    await controller.setEligibility(true, "octocat");
    await controller.setEligibility(true, "octocat");

    expect(bridge.startSyncSession).toHaveBeenCalledTimes(1);
    expect(bridge.startSyncSession).toHaveBeenCalledWith("session-a");
    expect(controller.hasActiveSession()).toBe(true);
  });

  it("ends before clearing when consent/session eligibility becomes false", async () => {
    const bridge = transport();
    const controller = createAutoSyncSessionController(bridge.value, () => "session-a");
    await controller.setEligibility(true, "octocat");
    await controller.setEligibility(false, "");

    expect(bridge.endSyncSession).toHaveBeenCalledTimes(1);
    expect(bridge.endSyncSession).toHaveBeenCalledWith("session-a");
    expect(controller.hasActiveSession()).toBe(false);
  });

  it("changes auth context by ending the old session before starting a fresh one", async () => {
    const calls: string[] = [];
    const ids = ["session-a", "session-b"];
    const controller = createAutoSyncSessionController({
      async startSyncSession(id) { calls.push(`start:${id}`); return true; },
      async endSyncSession(id) { calls.push(`end:${id}`); },
    }, () => ids.shift()!);

    await controller.setEligibility(true, "account-a");
    await controller.setEligibility(true, "account-b");

    expect(calls).toEqual(["start:session-a", "end:session-a", "start:session-b"]);
  });

  it("disconnect/ineligible then reconnect/eligible uses a fresh session", async () => {
    const bridge = transport();
    const ids = ["session-a", "session-b"];
    const controller = createAutoSyncSessionController(bridge.value, () => ids.shift()!);

    await controller.setEligibility(true, "octocat");
    await controller.setEligibility(false, "");
    await controller.setEligibility(true, "octocat");

    expect(bridge.startSyncSession.mock.calls).toEqual([["session-a"], ["session-b"]]);
  });

  it("uses Web Crypto randomUUID through the production generator boundary", () => {
    expect(secureSyncSessionId()).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
