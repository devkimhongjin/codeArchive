import assert from "node:assert/strict";
import test from "node:test";

import worker, {
  runInvocations,
} from "../src/index.mjs";

const TOKEN = "dummy-local-invocation-token";
const ENV = { CODEARCHIVE_DURABLE_INVOCATION_TOKEN: TOKEN };

function response(status) {
  return new Response(JSON.stringify({
    success: true,
    data: { status },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("invokes the exact API with one token header and no body", async () => {
  const requests = [];
  const result = await runInvocations({
    env: ENV,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return response("IDLE");
    },
  });

  assert.equal(result.stopped, "IDLE");
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://codearchive-api.onrender.com/api/v1/internal/automation/invoke",
  );
  assert.deepEqual(requests[0].init, {
    method: "POST",
    headers: {
      "X-CodeArchive-Invocation-Token": TOKEN,
    },
  });
  assert.equal("body" in requests[0].init, false);
});

test("continues only on SUCCEEDED and caps one event at five calls", async () => {
  let calls = 0;
  const result = await runInvocations({
    env: ENV,
    fetchImpl: async () => {
      calls += 1;
      return response("SUCCEEDED");
    },
  });

  assert.equal(calls, 5);
  assert.equal(result.attempts, 5);
  assert.deepEqual(result.statuses, [
    "SUCCEEDED",
    "SUCCEEDED",
    "SUCCEEDED",
    "SUCCEEDED",
    "SUCCEEDED",
  ]);
  assert.equal(result.stopped, "CAP");
});

test("stops on every safe non-success status", async (context) => {
  for (const status of ["REJECTED", "UNKNOWN"]) {
    await context.test(status, async () => {
      let calls = 0;
      const result = await runInvocations({
        env: ENV,
        fetchImpl: async () => {
          calls += 1;
          return response(status);
        },
      });

      assert.equal(calls, 1);
      assert.equal(result.stopped, status);
    });
  }
});

test("fails closed for a missing secret without making a request", async () => {
  let calls = 0;
  const result = await runInvocations({
    env: {},
    fetchImpl: async () => {
      calls += 1;
      return response("SUCCEEDED");
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.attempts, 1);
  assert.equal(result.stopped, "configuration");
});

test("stops on non-2xx, transport, and malformed responses without retry", async (context) => {
  await context.test("non-2xx", async () => {
    let calls = 0;
    const result = await runInvocations({
      env: ENV,
      fetchImpl: async () => {
        calls += 1;
        return new Response("upstream failure", { status: 503 });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.stopped, "http");
  });

  await context.test("transport", async () => {
    let calls = 0;
    const result = await runInvocations({
      env: ENV,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("network failure");
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.stopped, "transport");
  });

  await context.test("malformed", async () => {
    let calls = 0;
    const result = await runInvocations({
      env: ENV,
      fetchImpl: async () => {
        calls += 1;
        return new Response("not-json", { status: 200 });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.stopped, "malformed");
  });
});

test("scheduled entry point has no public fetch handler", () => {
  assert.equal(typeof worker.scheduled, "function");
  assert.equal("fetch" in worker, false);
});

test("scheduled entry point runs with dummy local values", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response("IDLE");
  };

  try {
    await worker.scheduled({}, ENV);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 1);
});

test("does not emit token, response, or provider details to logs", async () => {
  const entries = [];
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = (...args) => entries.push(args);
  console.warn = (...args) => entries.push(args);
  console.error = (...args) => entries.push(args);

  try {
    await runInvocations({
      env: ENV,
      fetchImpl: async () => response("SUCCEEDED"),
    });
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }

  assert.deepEqual(entries, []);
});
