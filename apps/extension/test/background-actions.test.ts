import assert from "node:assert/strict";
import test from "node:test";
import { loadPopupLocalState, storeCaptureLocalFirst } from "../src/backgroundActions";
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
