import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { createCapture } from "../src/capture";
import {
  loadSweaProblemContext,
  loadSweaProblemContextForReferrer,
  storeCaptureWithRetry,
  storeSweaProblemContext
} from "../src/content";
import { SWEA_CONTEXT_LOOKUP_ERROR } from "../src/sweaProblemContext";

function locationFor(href: string): Location {
  return new URL(href) as unknown as Location;
}

function capture() {
  const result = createCapture({
    platform: "SWEA",
    problemNumber: "1868",
    title: "파핑파핑 지뢰찾기",
    problemUrl: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do",
    language: "Java",
    sourceCode: "class Solution {}",
    result: "ACCEPTED"
  });
  assert.ok(result);
  return result;
}

test("content capture retries transient worker failures and preserves the same payload", async () => {
  const delays: number[] = [];
  const messages: unknown[] = [];
  let calls = 0;
  const result = await storeCaptureWithRetry(
    capture(),
    async (message) => {
      messages.push(message);
      calls += 1;
      if (calls < 3) throw new Error("worker unavailable");
      return { ok: true };
    },
    async (delayMs) => { delays.push(delayMs); }
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [50, 150]);
  assert.deepEqual(messages[0], messages[1]);
  assert.deepEqual(messages[1], messages[2]);
});

test("content capture stops after the bounded retry budget", async () => {
  const delays: number[] = [];
  let calls = 0;
  const result = await storeCaptureWithRetry(
    capture(),
    async () => {
      calls += 1;
      return { ok: false, error: "STORAGE_ERROR" };
    },
    async (delayMs) => { delays.push(delayMs); }
  );

  assert.deepEqual(result, { ok: false, error: "STORAGE_ERROR" });
  assert.equal(calls, 4);
  assert.deepEqual(delays, [50, 150, 500]);
});

test("detail-page content sends only a verified SWEA problem context", async () => {
  const { document } = parseHTML('<input id="contestProbId" value="A">');
  const messages: unknown[] = [];
  const stored = await storeSweaProblemContext(
    document,
    locationFor("https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A"),
    async (message) => {
      messages.push(message);
      return { ok: true };
    },
    1_000
  );
  assert.equal(stored, true);
  assert.deepEqual(messages, [{
    type: "STORE_SWEA_PROBLEM_CONTEXT",
    context: {
      contestProbId: "A",
      problemUrl: "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A",
      sourcePath: "/main/code/problem/problemDetail.do",
      observedAt: 1_000
    }
  }]);

  let calls = 0;
  assert.equal(await storeSweaProblemContext(
    document,
    locationFor("https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=B"),
    async () => { calls += 1; return { ok: true }; }
  ), false);
  assert.equal(calls, 0);
});

test("solving-page content requests context by exact referrer", async () => {
  const sourceUrl = "https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?contestProbId=U1";
  const context = {
    contestProbId: "U1",
    problemUrl: sourceUrl,
    sourcePath: "/main/code/userProblem/userProblemDetail.do" as const,
    observedAt: 1_000
  };
  const messages: unknown[] = [];
  assert.deepEqual(await loadSweaProblemContext(sourceUrl, async (message) => {
    messages.push(message);
    return { context };
  }), context);
  assert.deepEqual(messages, [{ type: "GET_SWEA_PROBLEM_CONTEXT", sourceUrl }]);
});

test("solving-page context lookup distinguishes a genuine no-row from runtime or storage failures", async () => {
  const sourceUrl = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=A";
  assert.equal(await loadSweaProblemContext(sourceUrl, async () => ({ context: null, missing: true })), null);
  assert.equal(await loadSweaProblemContext(sourceUrl, async () => ({ context: null, error: "STORAGE_ERROR" })), SWEA_CONTEXT_LOOKUP_ERROR);
  assert.equal(await loadSweaProblemContext(sourceUrl, async () => { throw new Error("worker unavailable"); }), SWEA_CONTEXT_LOOKUP_ERROR);
});

test("SWEA query-less navigation referrers are missing context rather than failed lookups", async () => {
  let calls = 0;
  const send = async () => { calls += 1; return { context: null, error: "INVALID_SWEA_CONTEXT_LOOKUP" }; };
  for (const referrer of [
    "https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do?userId=member",
    "https://swexpertacademy.com/main/code/problem/problemDetail.do",
    "https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do",
    "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do"
  ]) {
    assert.equal(await loadSweaProblemContextForReferrer(referrer, send), null);
  }
  assert.equal(calls, 0);

  assert.equal(
    await loadSweaProblemContextForReferrer("https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=", async () => {
      calls += 1;
      return { context: null, missing: true };
    }),
    SWEA_CONTEXT_LOOKUP_ERROR
  );
  assert.equal(calls, 0);
});
