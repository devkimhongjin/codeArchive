import assert from "node:assert/strict";
import test from "node:test";
import { activeSubmissionProgress, SUBMISSION_PROGRESS_TTL_MS, updateSubmissionProgress } from "../src/submissionProgress";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const start = { tabId: 4, attemptId: firstId, platform: "JUNGOL" as const, problemNumber: "1520", title: "문제", phase: "CAPTURING" as const };

test("temporary capture progress moves from collecting to saving and is removed after storage", () => {
  const collecting = updateSubmissionProgress([], start, 1_000);
  assert.equal(collecting[0]?.phase, "CAPTURING");
  const saving = updateSubmissionProgress(collecting, { tabId: 4, attemptId: firstId, phase: "SAVING" }, 2_000);
  assert.equal(saving[0]?.phase, "SAVING");
  assert.equal(saving[0]?.startedAt, 1_000);
  assert.deepEqual(updateSubmissionProgress(saving, { tabId: 4, attemptId: firstId, phase: "CLEAR" }, 3_000), []);
});

test("failure or expiry removes progress without creating a saved capture", () => {
  const collecting = updateSubmissionProgress([], start, 1_000);
  assert.deepEqual(updateSubmissionProgress(collecting, { tabId: 4, attemptId: firstId, phase: "CLEAR" }, 2_000), []);
  assert.deepEqual(activeSubmissionProgress(collecting, 1_000 + SUBMISSION_PROGRESS_TTL_MS), []);
});

test("a late result from an old attempt cannot clear or advance a newer click", () => {
  const old = updateSubmissionProgress([], start, 1_000);
  const current = updateSubmissionProgress(old, { ...start, attemptId: secondId }, 2_000);
  assert.deepEqual(updateSubmissionProgress(current, { tabId: 4, attemptId: firstId, phase: "SAVING" }, 3_000), current);
  assert.deepEqual(updateSubmissionProgress(current, { tabId: 4, attemptId: firstId, phase: "CLEAR" }, 3_000), current);
  assert.equal(current[0]?.attemptId, secondId);
});

test("invalid progress is never shown", () => {
  assert.deepEqual(activeSubmissionProgress([{ ...start, startedAt: 1_000, title: "" }], 2_000), []);
  assert.deepEqual(activeSubmissionProgress([{ ...start, startedAt: 1_000, phase: "SYNCED" }], 2_000), []);
});
