import assert from "node:assert/strict";
import test from "node:test";
import { formatCaptureMemory, formatExecutionTime, formatSolutionTime } from "../src/capturePresentation";

test("performance presentation distinguishes a real zero from missing data", () => {
  assert.equal(formatExecutionTime(0), "0 ms");
  assert.equal(formatExecutionTime(undefined), "정보 없음");
  assert.equal(formatCaptureMemory({ memoryValue: 0, memoryUnit: "KB" }), "0 KB");
  assert.equal(formatCaptureMemory({}), "정보 없음");
  assert.equal(formatCaptureMemory({ memoryUsage: 12.5 }), "12 · 단위 미확인");
});

test("performance presentation truncates only the final display value", () => {
  assert.equal(formatExecutionTime(747.0900000000003), "747 ms");
  assert.equal(formatExecutionTime(9.99), "9 ms");
  assert.equal(formatExecutionTime(0.9), "0 ms");
  assert.equal(formatCaptureMemory({ memoryValue: 123.37931034482759, memoryUnit: "MB" }), "123 MB");
  assert.equal(formatCaptureMemory({ memoryValue: 9.99, memoryUnit: "KB" }), "9 KB");
  assert.equal(formatCaptureMemory({ memoryValue: Number.NaN, memoryUnit: "MB" }), "정보 없음");
  assert.equal(formatCaptureMemory({ memoryValue: Number.POSITIVE_INFINITY, memoryUnit: "MB" }), "정보 없음");
  assert.equal(formatCaptureMemory({ memoryValue: -1, memoryUnit: "MB" }), "정보 없음");
});

test("solution time includes date and local clock while rejecting invalid legacy values", () => {
  assert.match(formatSolutionTime("2026-09-18T02:21:00.000Z"), /2026/);
  assert.equal(formatSolutionTime("invalid"), "정보 없음");
});
