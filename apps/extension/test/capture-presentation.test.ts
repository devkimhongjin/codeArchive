import assert from "node:assert/strict";
import test from "node:test";
import { formatCaptureMemory, formatExecutionTime, formatSolutionTime } from "../src/capturePresentation";

test("performance presentation distinguishes a real zero from missing data", () => {
  assert.equal(formatExecutionTime(0), "0 ms");
  assert.equal(formatExecutionTime(undefined), "정보 없음");
  assert.equal(formatCaptureMemory({ memoryValue: 0, memoryUnit: "KB" }), "0 KB");
  assert.equal(formatCaptureMemory({}), "정보 없음");
  assert.equal(formatCaptureMemory({ memoryUsage: 12.5 }), "12.5 · 단위 미확인");
});

test("solution time includes date and local clock while rejecting invalid legacy values", () => {
  assert.match(formatSolutionTime("2026-09-18T02:21:00.000Z"), /2026/);
  assert.equal(formatSolutionTime("invalid"), "정보 없음");
});
