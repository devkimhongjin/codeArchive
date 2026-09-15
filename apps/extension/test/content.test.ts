import assert from "node:assert/strict";
import test from "node:test";
import { createCapture } from "../src/capture";
import { storeCaptureWithRetry } from "../src/content";

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
