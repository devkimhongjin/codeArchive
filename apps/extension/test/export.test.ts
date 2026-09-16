import assert from "node:assert/strict";
import test from "node:test";
import { downloadFilename, exportCode, sourceFileExtension } from "../src/export";
import type { Capture } from "../src/types";

const base = (language: string): Capture => ({ captureId: "capture-1", platform: "SWEA", problemNumber: "123", title: "A/B", problemUrl: "https://example.test", language, sourceCode: "code", result: "ACCEPTED", observedAt: "2026-01-01T00:00:00.000Z", solvedAt: "2026-01-01T00:00:00.000Z", syncState: "PENDING" });

test("export language mapping handles version strings and never leaves a stale Java suffix", () => {
  const matrix: Array<[string, string]> = [["Java 17", "java"], ["Kotlin", "kt"], ["Python3", "py"], ["JavaScript", "js"], ["TypeScript", "ts"], ["C", "c"], ["C++17", "cpp"], ["C#", "cs"], ["Go", "go"], ["Rust", "rs"], ["Ruby", "rb"], ["Swift", "swift"], ["Scala", "scala"], ["SQL", "sql"], ["Unknown", "txt"]];
  for (const [language, extension] of matrix) {
    assert.equal(sourceFileExtension(language), extension);
    assert.equal(downloadFilename(base(language), "solution.java"), `solution.${extension}`);
  }
  assert.equal(downloadFilename(base("Python3"), "solution.java"), "solution.py");
});

test("copy and download headers preserve source and use their independent flag", () => {
  const capture = base("Java");
  assert.equal(exportCode(capture, false), "code");
  assert.match(exportCode(capture, true), /^\/\/ SWEA #123/);
  assert.match(downloadFilename(capture, "{platform}/{number}"), /^SWEA-123\.java$/);
  assert.equal(downloadFilename(base("Python3"), "{name}-{nickname}-{id}.java", { name: "홍 길동", nickname: "길동", id: "42" }), "홍 길동-길동-42.py");
});
