import assert from "node:assert/strict";
import test from "node:test";
import { fetchGithubCommitStatuses, recordRelayAttempt, relayCapture, revokeRelay } from "../src/relay";
import { MemoryCaptureStore } from "../src/storage";
import type { Capture, CaptureSettings } from "../src/types";

const settings: CaptureSettings = { autoSyncEnabled: false, autoDownloadEnabled: false, githubAutoCommitEnabled: false, githubTargetConfigured: false, relay: { endpoint: "/api/relay/captures", secret: "opaque", accountId: "7", generation: 1, status: "REVOCATION_PENDING" } };

const capture: Capture = {
  captureId: "11111111-1111-4111-8111-111111111111",
  platform: "PROGRAMMERS",
  problemNumber: "1234",
  title: "Timeout",
  problemUrl: "https://school.programmers.co.kr/learn/courses/30/lessons/1234",
  language: "JavaScript",
  sourceCode: "return 42;",
  result: "ACCEPTED",
  observedAt: "2026-09-18T00:00:00.000Z",
  solvedAt: "2026-09-18T00:00:00.000Z",
  syncState: "PENDING"
};

const neverSettlingFetcher: typeof fetch = async () => new Promise<Response>(() => undefined);

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

test("commit status lookup is bearer-scoped and accepts only known states", async () => {
  const enabled: CaptureSettings = {
    ...settings,
    autoSyncEnabled: true,
    githubAutoCommitEnabled: true,
    githubTargetConfigured: true,
    relay: { ...settings.relay!, status: "CONFIRMED" }
  };
  let requestedHref = "";
  const statuses = await fetchGithubCommitStatuses(
    ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
    enabled,
    async (input, init) => {
      requestedHref = String(input);
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer opaque");
      return new Response(JSON.stringify({ statuses: {
        "11111111-1111-4111-8111-111111111111": "SUCCEEDED",
        "22222222-2222-4222-8222-222222222222": "INJECTED"
      } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  );
  const requested = new URL(requestedHref);
  assert.equal(requested.pathname, "/api/relay/github-commit-status");
  assert.equal(requested.searchParams.getAll("captureId").length, 2);
  assert.deepEqual(statuses, { "11111111-1111-4111-8111-111111111111": "SUCCEEDED" });
});

test("relay, status lookup and self-revocation stop waiting when the network never settles", async () => {
  const enabled: CaptureSettings = {
    ...settings,
    autoSyncEnabled: true,
    relay: { ...settings.relay!, status: "CONFIRMED" }
  };

  assert.equal(await relayCapture(capture, enabled, neverSettlingFetcher, 5), "OFFLINE");
  assert.deepEqual(await fetchGithubCommitStatuses([capture.captureId], enabled, neverSettlingFetcher, 5), {});
  assert.equal(await revokeRelay(settings, neverSettlingFetcher, 5), "OFFLINE");
});
