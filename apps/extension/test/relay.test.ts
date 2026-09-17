import assert from "node:assert/strict";
import test from "node:test";
import { recordRelayAttempt, revokeRelay } from "../src/relay";
import { MemoryCaptureStore } from "../src/storage";
import type { CaptureSettings } from "../src/types";

const settings: CaptureSettings = { autoSyncEnabled: false, githubAutoCommitEnabled: false, githubTargetConfigured: false, relay: { endpoint: "/api/relay/captures", secret: "opaque", accountId: "7", generation: 1, status: "REVOCATION_PENDING" } };

test("self-revocation uses only the opaque bearer and accepts server confirmation", async () => {
  let input: RequestInfo | URL | undefined; let init: RequestInit | undefined;
  assert.equal(await revokeRelay(settings, async (url, options) => { input=url; init=options; return new Response(null,{status:204}); }), "ACK");
  assert.equal(new URL(String(input)).pathname, "/api/relay/grants/self");
  assert.equal(init?.method, "DELETE"); assert.equal((init?.headers as Record<string,string>).Authorization, "Bearer opaque");
});

test("offline self-revocation remains pending rather than discarding the bearer", async () => {
  assert.equal(await revokeRelay(settings, async () => { throw new Error("offline"); }), "OFFLINE");
});

test("a successful retry restores the durable relay status", async () => {
  const store = new MemoryCaptureStore();
  await store.updateSettings({
    autoSyncEnabled: true,
    githubTargetConfigured: true,
    relay: { endpoint: "/api/relay/captures", secret: "opaque", accountId: "7", generation: 1, status: "RELAY_ERROR" }
  });
  const current = await store.getSettings();
  await recordRelayAttempt(store, current, "ACK");
  assert.equal((await store.getSettings()).relay?.status, "CONFIRMED");
});

test("delayed relay failure or revoke acknowledgement cannot mutate a newer relay or REVOCATION_PENDING", async () => {
  const store = new MemoryCaptureStore();
  const oldRelay = { endpoint: "/api/relay/captures", secret: "old-secret", accountId: "7", generation: 1, status: "CONFIRMED" as const };
  await store.updateSettings({ autoSyncEnabled: true, githubTargetConfigured: true, relay: oldRelay });
  // Simulate immediate local OFF while a previous capture request is waiting.
  const pending = { ...oldRelay, status: "REVOCATION_PENDING" as const };
  await store.updateSettings({ autoSyncEnabled: false, githubAutoCommitEnabled: false, relay: pending });
  assert.equal((await store.mutateRelayIfCurrent(oldRelay, current => ({ ...current, relay: { ...oldRelay, status: "OFFLINE" } }))).applied, false);
  assert.equal((await store.getSettings()).relay?.status, "REVOCATION_PENDING");
  // Simulate a newer dashboard CONFIGURE_RELAY before the old self-revoke ACK.
  const newer = { ...oldRelay, secret: "new-secret", generation: 2, status: "CONFIRMED" as const };
  await store.updateSettings({ autoSyncEnabled: true, relay: newer });
  assert.equal((await store.mutateRelayIfCurrent(pending, current => ({ ...current, relay: undefined }))).applied, false);
  const final = await store.getSettings();
  assert.equal(final.relay?.secret, "new-secret"); assert.equal(final.autoSyncEnabled, true);
});
