import { describe, expect, it } from "vitest";
import { sweaAdapter } from "./sweaAdapter";

const DETAIL_URL = new URL("https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=ABC");

function documentFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("sweaAdapter", () => {
  it("detects problem number, title, difficulty and url", () => {
    const document = documentFrom('<div class="problem_name">1206. View</div><span class="problem_level">D3</span>');
    const result = sweaAdapter.detect(document, DETAIL_URL);
    expect(result).toEqual({
      status: "detected",
      problem: {
        platform: "SWEA",
        problemNumber: "1206",
        title: "View",
        difficulty: "D3",
        url: DETAIL_URL.href,
      },
      warnings: [],
    });
  });

  it("allows missing difficulty", () => {
    const result = sweaAdapter.detect(documentFrom('<div class="problem_name">1206. View</div>'), DETAIL_URL);
    expect(result.status).toBe("detected");
    if (result.status === "detected") expect(result.problem.difficulty).toBeNull();
  });

  it("returns incomplete when the heading selector is unavailable", () => {
    const result = sweaAdapter.detect(documentFrom("<main></main>"), DETAIL_URL);
    expect(result.status).toBe("incomplete");
    if (result.status === "incomplete") expect(result.missing).toEqual(["problemNumber", "title"]);
  });

  it("rejects non-detail SWEA urls", () => {
    const result = sweaAdapter.detect(documentFrom('<div class="problem_name">1206. View</div>'), new URL("https://swexpertacademy.com/main/code/problem/problemList.do"));
    expect(result).toEqual({ status: "unsupported_page" });
  });
});
