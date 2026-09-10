import test from "node:test";
import assert from "node:assert/strict";
import { keepMainApiAwake } from "./index.mjs";

test("scheduled keepalive performs exactly one credential-free GET", async () => {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    return new Response("health body should not be read", { status: 200 });
  };

  await keepMainApiAwake({
    fetchImpl,
    env: {
    MAIN_API_HEALTH_URL: "https://beta.example.test/actuator/health",
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://beta.example.test/actuator/health");
  assert.deepEqual(calls[0][1], { method: "GET", redirect: "error" });
});

test("transport and HTTP failures stay quiet and do not retry", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("synthetic failure");
  };

  await assert.doesNotReject(() => keepMainApiAwake({ fetchImpl }));
  assert.equal(calls, 1);
});
