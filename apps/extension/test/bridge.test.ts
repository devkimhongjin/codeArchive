import assert from "node:assert/strict";
import test from "node:test";
import { DashboardBridge, DASHBOARD_ORIGIN } from "../src/bridge";
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
