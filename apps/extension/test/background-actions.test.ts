import assert from "node:assert/strict";
import test from "node:test";
import { loadPopupLocalState, prepareCaptureDownload, retryRelayConnection, storeCaptureLocalFirst } from "../src/backgroundActions";
import { createCapture } from "../src/capture";
import { MemoryCaptureStore } from "../src/storage";

function capture(id = "11111111-1111-4111-8111-111111111111") {
  const value = createCapture({
    captureId: id,
    platform: "PROGRAMMERS",
    problemNumber: "1234",
    title: "Local first",
    problemUrl: "https://school.programmers.co.kr/learn/courses/30/lessons/1234",
    language: "JavaScript",
    sourceCode: "const answer = 42;",
    result: "ACCEPTED",
    observedAt: "2026-09-18T00:00:00.000Z",
    solvedAt: "2026-09-18T00:00:00.000Z"
  });
  assert.ok(value);
  return value;
}

test("local capture acknowledgement does not await a permanently stalled relay", async () => {
  const store = new MemoryCaptureStore();
  let relayRequested = false;
  const result = await Promise.race([
    storeCaptureLocalFirst(store, capture(), () => {
      relayRequested = true;
      void new Promise<never>(() => undefined);
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("local write was blocked")), 100))
  ]);

  assert.deepEqual(result, { created: true });
  assert.equal(relayRequested, true);
  assert.equal(await store.countPending(), 1);
});

test("a relay scheduler failure cannot turn a durable local write into a storage failure", async () => {
  const store = new MemoryCaptureStore();
  const result = await storeCaptureLocalFirst(store, capture(), () => {
    throw new Error("worker scheduler unavailable");
  });

  assert.deepEqual(result, { created: true });
  assert.equal(await store.countPending(), 1);
});

test("popup state is built only from local storage and never exposes source code", async () => {
  const store = new MemoryCaptureStore();
  await store.putCapture(capture());

  const state = await loadPopupLocalState(store);

  assert.equal(state.pendingCount, 1);
  assert.equal(state.recentCaptures.length, 1);
  assert.equal("sourceCode" in state.recentCaptures[0]!, false);
});

test("automatic download preparation reuses profile, header and language extension rules", () => {
  const prepared = prepareCaptureDownload(
    { ...capture(), language: "Python3", sourceCode: "print(42)" },
    {
      autoSyncEnabled: false,
      autoDownloadEnabled: true,
      githubAutoCommitEnabled: false,
      githubTargetConfigured: false,
      downloadHeader: true,
      downloadFilenameTemplate: "Solution_{number}_{name}.java",
      name: "홍길동"
    }
  );

  assert.ok(prepared);
  assert.equal(prepared.filename, "Solution_1234_홍길동.py");
  assert.match(prepared.url, /^data:application\/octet-stream;base64,/);
});

test("manual relay retry drains pending captures without clearing automation preferences", async () => {
  const store = new MemoryCaptureStore();
  await store.putCapture(capture());
  await store.putCapture(capture("22222222-2222-4222-8222-222222222222"));
  await store.updateSettings({
    autoSyncEnabled: true,
    githubAutoCommitEnabled: true,
    githubTargetConfigured: true,
    relay: { endpoint: "/api/relay/captures", secret: "opaque", accountId: "7", generation: 1, status: "RELAY_ERROR" }
  });
  let drains = 0;

  const result = await retryRelayConnection(store, async () => {
    drains += 1;
    const pending = await store.listPending([], 50);
    await store.markSynced(pending.map(item => item.captureId));
    const current = await store.getSettings();
    await store.mutateRelayIfCurrent(current.relay!, settings => ({ ...settings, relay: { ...current.relay!, status: "CONFIRMED" } }));
  });

  assert.deepEqual(result, { ok: true, status: "CONFIRMED", pendingCount: 0 });
  assert.equal(drains, 1);
  const settings = await store.getSettings();
  assert.equal(settings.autoSyncEnabled, true);
  assert.equal(settings.githubAutoCommitEnabled, true);
});

test("manual relay retry does not enable an automation preference that is off", async () => {
  const store = new MemoryCaptureStore();
  let drains = 0;
  const result = await retryRelayConnection(store, async () => { drains += 1; });
  assert.deepEqual(result, { ok: false, status: null, pendingCount: 0, error: "AUTO_SYNC_OFF" });
  assert.equal(drains, 0);
});
