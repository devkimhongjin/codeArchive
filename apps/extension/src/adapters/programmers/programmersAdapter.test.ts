import { describe, expect, it } from "vitest";
import { programmersAdapter } from "./programmersAdapter";

function documentFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("programmersAdapter", () => {
  it("detects the canonical problem identity from the observed lesson URL and title DOM", () => {
    const result = programmersAdapter.detect(
      documentFrom('<div class="challenge-title">카펫</div>'),
      new URL("https://school.programmers.co.kr/learn/courses/30/lessons/42842?language=cpp#editor"),
    );

    expect(result).toEqual({
      status: "detected",
      problem: {
        platform: "PROGRAMMERS",
        problemNumber: "42842",
        title: "카펫",
        difficulty: null,
        url: "https://school.programmers.co.kr/learn/courses/30/lessons/42842",
      },
      warnings: [],
    });
  });

  it("rejects lookalike hosts and reports a missing observed title", () => {
    expect(programmersAdapter.detect(documentFrom(""), new URL("https://example.com/learn/courses/30/lessons/42842")))
      .toEqual({ status: "unsupported_page" });
    expect(programmersAdapter.detect(documentFrom(""), new URL("https://school.programmers.co.kr/learn/courses/30/lessons/42842")))
      .toMatchObject({ status: "incomplete", missing: ["title"] });
  });
});
