import assert from "node:assert/strict";
import test from "node:test";
import { requestLocalHistoryMessage } from "../src/localHistoryConnection";

const target = { tabId: 7, url: "https://jungol.co.kr/account/9/submission" };
const disconnected = () => new Error("Could not establish connection. Receiving end does not exist.");

test("an explicit scan reconnects a missing receiver once, then retries", async () => {
  let sends = 0, connections = 0;
  const result = await requestLocalHistoryMessage(target, { type: "LOCAL_HISTORY_SCAN_START" }, {
    currentUrl: async () => target.url,
    connect: async id => { assert.equal(id, target.tabId); connections++; },
    send: async (_id, message) => { assert.equal(message.type, "LOCAL_HISTORY_SCAN_START"); if (++sends === 1) throw disconnected(); return { status: "SCANNING" }; }
  });
  assert.deepEqual(result, { status: "SCANNING" });
  assert.equal(sends, 2); assert.equal(connections, 1);
});

test("status, import and cancel cannot reconnect or replay a missing receiver", async () => {
  for (const type of ["LOCAL_HISTORY_STATUS", "LOCAL_HISTORY_IMPORT_START", "LOCAL_HISTORY_CANCEL"] as const) {
    let sends = 0;
    const result = await requestLocalHistoryMessage(target, { type }, {
      currentUrl: async () => target.url,
      connect: async () => assert.fail("passive or storage commands cannot inject"),
      send: async () => { sends++; throw disconnected(); }
    });
    assert.deepEqual(result, { status: "CONNECTION_REQUIRED" }); assert.equal(sends, 1);
  }
});

test("a closed message port is never treated as proof that no scan started", async () => {
  const result = await requestLocalHistoryMessage(target, { type: "LOCAL_HISTORY_SCAN_START" }, {
    currentUrl: async () => target.url,
    connect: async () => assert.fail("must not duplicate an already-started scan"),
    send: async () => { throw new Error("The message port closed before a response was received."); }
  });
  assert.deepEqual(result, { status: "CONNECTION_FAILED" });
});

test("navigation or a closed tab prevents connection and replay", async () => {
  for (const url of ["https://jungol.co.kr/", "https://jungol.co.kr/account/10/submission", undefined]) {
    const result = await requestLocalHistoryMessage(target, { type: "LOCAL_HISTORY_SCAN_START" }, {
      currentUrl: async () => url,
      connect: async () => assert.fail("not an owned source"),
      send: async () => assert.fail("not an owned source")
    });
    assert.deepEqual(result, { status: "INTERRUPTED" });
  }
  let sends = 0, moved = false;
  const result = await requestLocalHistoryMessage(target, { type: "LOCAL_HISTORY_SCAN_START" }, {
    currentUrl: async () => moved ? "https://jungol.co.kr/account/10/submission" : target.url,
    connect: async () => { moved = true; },
    send: async () => { sends++; throw disconnected(); }
  });
  assert.deepEqual(result, { status: "INTERRUPTED" }); assert.equal(sends, 1);
});

test("a failed reconnect is bounded and a subsequent explicit retry can succeed", async () => {
  let connections = 0, sends = 0;
  const services = {
    currentUrl: async () => target.url,
    connect: async () => { connections++; },
    send: async () => { sends++; if (sends < 4) throw disconnected(); return { status: "SCANNING" }; }
  };
  assert.deepEqual(await requestLocalHistoryMessage(target, { type: "LOCAL_HISTORY_SCAN_START" }, services), { status: "CONNECTION_FAILED" });
  assert.equal(sends, 2);
  assert.deepEqual(await requestLocalHistoryMessage(target, { type: "LOCAL_HISTORY_SCAN_START" }, services), { status: "SCANNING" });
  assert.equal(sends, 4); assert.equal(connections, 2);
});
