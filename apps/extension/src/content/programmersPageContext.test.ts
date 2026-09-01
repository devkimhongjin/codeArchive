import { describe, expect, it } from "vitest";
import { getProgrammersPageContext } from "./programmersPageContext";

const URL = new globalThis.URL("https://school.programmers.co.kr/learn/courses/30/lessons/42842?language=java");
function documentFrom(code = "class Solution {}"): Document {
  return new DOMParser().parseFromString(`<div class="challenge-title">카펫</div><nav class="challenge-nav"><button class="dropdown-toggle">Java</button></nav><textarea id="code" name="code">${code}</textarea>`, "text/html");
}

describe("getProgrammersPageContext", () => {
  it("returns current problem/editor state before a final result", () => {
    expect(getProgrammersPageContext(documentFrom(), URL, { status: "none" })).toMatchObject({
      status: "connected_page",
      platform: "PROGRAMMERS",
      problem: { problemNumber: "42842", title: "카펫" },
      editor: { status: "detected", editor: { language: "Java", code: "class Solution {}" } },
      submissionResult: { status: "none" },
    });
  });

  it("exposes only normalized accepted state and automatic-save status", () => {
    expect(getProgrammersPageContext(documentFrom(), URL, {
      status: "observed",
      submission: { result: "ACCEPTED", observedAt: "2026-09-01T00:30:00.000Z" },
      warnings: [],
    }, { status: "saved", solutionId: "programmers-auto:one", savedAt: "2026-09-01T00:30:01.000Z" })).toMatchObject({
      status: "connected_page",
      submissionResult: { status: "observed", submission: { result: "ACCEPTED" } },
      autoSave: { status: "saved" },
    });
  });
});
