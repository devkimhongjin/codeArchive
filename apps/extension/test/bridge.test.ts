import assert from "node:assert/strict";
import test from "node:test";
import { DashboardBridge, DASHBOARD_ORIGIN, DASHBOARD_ORIGINS } from "../src/bridge";
import { createCapture } from "../src/capture";
import { MemoryCaptureStore } from "../src/storage";

function sender(documentId = "doc-1", tabId = 7, url = `${DASHBOARD_ORIGIN}/app`) {
  return {
    url,
    documentId,
    frameId: 0,
    tab: { id: tabId, url: `${DASHBOARD_ORIGIN}/app` }
  };
}

test('capability-bound local archive reads are read-only and do not issue ACK state', async () => {
  const store = new MemoryCaptureStore();
  const capture = createCapture({ captureId: '11111111-1111-4111-8111-111111111111', platform: 'SWEA', problemNumber: '1', title: 'local', problemUrl: 'https://example.test/1', language: 'Java', sourceCode: 'class A {}', result: 'ACCEPTED' });
  assert.ok(capture);
  await store.putCapture(capture);
  const bridge = new DashboardBridge(store);
  const connected = await bridge.handleMessage({ type: 'CONNECT' }, sender());
  assert.ok('capability' in connected);
  const local = await bridge.handleMessage({ type: 'GET_LOCAL_ARCHIVE', capability: connected.capability }, sender());
  assert.equal('localOnly' in local && local.localOnly, true);
  assert.equal('captures' in local && local.captures.length, 1);
  assert.equal(await store.countPending(), 1);
});

test('heartbeat is capability-bound, exposes no captures and keeps absolute expiry', async () => {
  let now = 0;
  const store = new MemoryCaptureStore();
  const bridge = new DashboardBridge(store, { now: () => now, idleTtlMs: 10, absoluteTtlMs: 20 });
  const connected = await bridge.handleMessage({ type: 'CONNECT' }, sender());
  assert.ok('capability' in connected);
  now = 9;
  assert.deepEqual(await bridge.handleMessage({ type: 'PING', capability: connected.capability }, sender()), { ok: true });
  assert.deepEqual(await bridge.handleMessage({ type: 'PING', capability: connected.capability }, sender('other')), { error: 'UNAUTHORIZED' });
  now = 18;
  assert.deepEqual(await bridge.handleMessage({ type: 'PING', capability: connected.capability }, sender()), { ok: true });
  now = 21;
  assert.deepEqual(await bridge.handleMessage({ type: 'PING', capability: connected.capability }, sender()), { error: 'UNAUTHORIZED' });
});

async function capture(number: string) {
  const result = createCapture({
    platform: "PROGRAMMERS",
    problemNumber: number,
    title: `Problem ${number}`,
    problemUrl: `https://programmers.co.kr/learn/lessons/${number}`,
    language: "JavaScript",
    sourceCode: `console.log(${number});`,
    result: "ACCEPTED"
  });
  assert.ok(result);
  return result;
}

test("bridge pages pending records, binds capability to document/tab, and ACKs only issued IDs", async () => {
  const store = new MemoryCaptureStore();
  const first = await capture("1");
  const second = await capture("2");
  const third = await capture("3");
  await store.putCapture(first);
  await store.putCapture(second);
  await store.putCapture(third);
  let now = 1_000;
  let capabilityCounter = 0;
  const bridge = new DashboardBridge(store, {
    now: () => now,
    capabilityFactory: () => `capability-${++capabilityCounter}`
  });
  const dashboard = sender();
  const connected = await bridge.handleMessage({ type: "CONNECT" }, dashboard);
  assert.ok("capability" in connected);

  const pageOne = await bridge.handleMessage(
    { type: "GET_PENDING", capability: connected.capability, limit: 2 },
    dashboard
  );
  assert.ok("captures" in pageOne);
  assert.equal(pageOne.captures.length, 2);
  const pageTwo = await bridge.handleMessage(
    { type: "GET_PENDING", capability: connected.capability, limit: 2 },
    dashboard
  );
  assert.ok("captures" in pageTwo);
  assert.equal(pageTwo.captures.length, 1);

  const invalidAck = await bridge.handleMessage(
    { type: "ACK", capability: connected.capability, captureIds: ["not-issued"] },
    dashboard
  );
  assert.deepEqual(invalidAck, { error: "BAD_REQUEST" });
  assert.equal(await store.countPending(), 3);

  const acknowledged = await bridge.handleMessage(
    { type: "ACK", capability: connected.capability, captureIds: pageOne.captures.map((item) => item.captureId) },
    dashboard
  );
  assert.deepEqual(acknowledged, { ok: true });
  assert.equal(await store.countPending(), 1);

  const wrongDocument = await bridge.handleMessage(
    { type: "GET_PENDING", capability: connected.capability },
    sender("new-document")
  );
  assert.deepEqual(wrongDocument, { error: "UNAUTHORIZED" });

  const wrongOrigin = await bridge.handleMessage(
    { type: "GET_PENDING", capability: connected.capability },
    sender("doc-1", 7, "http://localhost:51730/app")
  );
  assert.deepEqual(wrongOrigin, { error: "UNAUTHORIZED" });

  now += 5 * 60 * 1_000 + 1;
  const expired = await bridge.handleMessage(
    { type: "GET_PENDING", capability: connected.capability },
    dashboard
  );
  assert.deepEqual(expired, { error: "UNAUTHORIZED" });
});

test("bridge rejects a dashboard tab whose tab URL is not the registered origin", async () => {
  const store = new MemoryCaptureStore();
  const bridge = new DashboardBridge(store, { capabilityFactory: () => "capability-tab-url" });
  const result = await bridge.handleMessage(
    { type: "CONNECT" },
    {
      url: `${DASHBOARD_ORIGIN}/app`,
      documentId: "doc-1",
      frameId: 0,
      tab: { id: 7, url: "https://evil.example/app" }
    }
  );
  assert.deepEqual(result, { error: "UNAUTHORIZED" });
});

test("bridge fails closed when Chrome omits the external sender tab URL", async () => {
  const bridge = new DashboardBridge(new MemoryCaptureStore());
  const result = await bridge.handleMessage({ type: "CONNECT" }, {
    url: `${DASHBOARD_ORIGIN}/app`,
    documentId: "doc-without-tab-url",
    frameId: 0,
    tab: { id: 7 }
  });
  assert.deepEqual(result, { error: "UNAUTHORIZED" });
});

test("bridge accepts both exact dashboard origins and rejects lookalikes or mixed origins", async () => {
  let capabilityCounter = 0;
  const bridge = new DashboardBridge(new MemoryCaptureStore(), {
    capabilityFactory: () => `capability-origin-${++capabilityCounter}`
  });
  for (const origin of DASHBOARD_ORIGINS) {
    const result = await bridge.handleMessage({ type: "CONNECT" }, {
      url: `${origin}/app`, documentId: `doc-${origin}`, frameId: 0, tab: { id: 7, url: `${origin}/app` }
    });
    assert.ok("capability" in result, origin);
  }
  assert.deepEqual(await bridge.handleMessage({ type: "CONNECT" }, {
    url: "https://codearchive-dashboard-beta.netlify.app.evil.example/app",
    documentId: "lookalike", frameId: 0,
    tab: { id: 7, url: "https://codearchive-dashboard-beta.netlify.app.evil.example/app" }
  }), { error: "UNAUTHORIZED" });
  assert.deepEqual(await bridge.handleMessage({ type: "CONNECT" }, {
    url: "https://codearchive-dashboard-beta.netlify.app/app",
    documentId: "mixed", frameId: 0, tab: { id: 7, url: "http://localhost:5173/app" }
  }), { error: "UNAUTHORIZED" });
});

test("relay configuration persists only opaque acknowledged profile/export/theme settings and OFF clears it", async () => {
  const store = new MemoryCaptureStore(); const bridge = new DashboardBridge(store, { capabilityFactory: () => "capability-relay" });
  const connected = await bridge.handleMessage({ type: "CONNECT" }, sender()); assert.ok("capability" in connected);
  assert.deepEqual(await bridge.handleMessage({ type: "CONFIGURE_RELAY", capability: connected.capability, relay: { endpoint: "/api/relay/captures", secret: "opaque-only", accountId: "17", generation: 3 }, settingsVersion: 3, autoSyncEnabled: true, githubAutoCommitEnabled: true, githubTargetConfigured: true, copyHeader: true, downloadHeader: true, downloadFilenameTemplate: "{number}", gitPathTemplate: "java/{number}", name: "name", nickname: "nick", lightTheme: "one-light", darkTheme: "dracula" }, sender()), { ok: true });
  const configured = await store.getSettings();
  assert.deepEqual(configured.relay, { endpoint: "/api/relay/captures", secret: "opaque-only", accountId: "17", generation: 3, status: "CONFIRMED" });
  assert.equal(configured.downloadFilenameTemplate, "{number}"); assert.equal(configured.lightTheme, "one-light"); assert.equal(configured.darkTheme, "dracula");
  assert.deepEqual(await bridge.handleMessage({ type: "CONFIGURE_RELAY", capability: connected.capability, relay: null, accountId: "17", settingsVersion: 4, copyHeader: false, downloadHeader: true, downloadFilenameTemplate: "{nickname}-{number}", gitPathTemplate: "offline/{id}", name: null, nickname: "새 별명", lightTheme: "solarized-light", darkTheme: "one-dark-pro", githubTargetConfigured: true }, sender()), { ok: true });
  const off = await store.getSettings();
  assert.equal(off.relay, undefined);
  assert.equal(off.autoSyncEnabled, false);
  assert.equal(off.githubAutoCommitEnabled, false);
  assert.equal(off.accountId, "17");
  assert.equal(off.copyHeader, false); assert.equal(off.downloadHeader, true);
  assert.equal(off.downloadFilenameTemplate, "{nickname}-{number}"); assert.equal(off.gitPathTemplate, "offline/{id}");
  assert.equal(off.name, undefined); assert.equal(off.nickname, "새 별명");
  assert.equal(off.lightTheme, "solarized-light"); assert.equal(off.darkTheme, "one-dark-pro");
});

test("older same-account bridge configuration cannot overwrite a newer relay settings version", async () => {
  const store = new MemoryCaptureStore(); const bridge = new DashboardBridge(store, { capabilityFactory: () => "capability-version" });
  const connected = await bridge.handleMessage({ type: "CONNECT" }, sender()); assert.ok("capability" in connected);
  const newest = { type: "CONFIGURE_RELAY" as const, capability: connected.capability, relay: { endpoint: "/api/relay/captures", secret: "new-secret", accountId: "17", generation: 8 }, accountId: "17", settingsVersion: 8, autoSyncEnabled: true, githubTargetConfigured: true };
  assert.deepEqual(await bridge.handleMessage(newest, sender()), { ok: true });
  assert.deepEqual(await bridge.handleMessage({ ...newest, relay: { ...newest.relay, secret: "old-secret", generation: 7 }, settingsVersion: 7, autoSyncEnabled: false }, sender()), { error: "STALE_CONFIGURATION" });
  const settings = await store.getSettings();
  assert.equal(settings.accountSettingsVersion, 8); assert.equal(settings.autoSyncEnabled, true); assert.equal(settings.relay?.secret, "new-secret");
});
