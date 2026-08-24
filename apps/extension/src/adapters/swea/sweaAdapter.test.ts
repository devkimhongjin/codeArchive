import { describe, expect, it } from "vitest";
import { getSweaPageKind, sweaAdapter } from "./sweaAdapter";

const DETAIL_URL = new URL("https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=ABC");
const USER_DETAIL_URL = new URL("https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do?contestProbId=ABC");
const SOLVING_URL = new URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=ABC");

function documentFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("sweaAdapter", () => {
  it("classifies supported SWEA page kinds", () => {
    expect(getSweaPageKind(DETAIL_URL)).toBe("problem_detail");
    expect(getSweaPageKind(USER_DETAIL_URL)).toBe("user_problem_detail");
    expect(getSweaPageKind(SOLVING_URL)).toBe("solving");
    expect(getSweaPageKind(new URL("https://swexpertacademy.com/main/code/problem/problemList.do"))).toBeNull();
  });

  it("detects problem metadata on normal problem detail", () => {
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

  it("reuses problem metadata detection on user problem detail", () => {
    const result = sweaAdapter.detect(documentFrom('<div class="problem_name">1234. Sample</div>'), USER_DETAIL_URL);
    expect(result.status).toBe("detected");
    if (result.status === "detected") {
      expect(result.problem.problemNumber).toBe("1234");
      expect(result.problem.title).toBe("Sample");
    }
  });

  it("returns a connected solving state without guessing selectors", () => {
    expect(sweaAdapter.detect(documentFrom("<main></main>"), SOLVING_URL)).toEqual({
      status: "connected_page",
      platform: "SWEA",
      pageKind: "solving",
      url: SOLVING_URL.href,
    });
  });

  it("returns incomplete when detail heading selector is unavailable", () => {
    const result = sweaAdapter.detect(documentFrom("<main></main>"), USER_DETAIL_URL);
    expect(result.status).toBe("incomplete");
    if (result.status === "incomplete") expect(result.missing).toEqual(["problemNumber", "title"]);
  });

  it("rejects unsupported SWEA urls", () => {
    const result = sweaAdapter.detect(documentFrom('<div class="problem_name">1206. View</div>'), new URL("https://swexpertacademy.com/main/code/problem/problemList.do"));
    expect(result).toEqual({ status: "unsupported_page" });
  });
});
