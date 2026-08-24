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
    expect(result).toEqual({ status: "detected", problem: { platform: "SWEA", problemNumber: "1206", title: "View", difficulty: "D3", url: DETAIL_URL.href }, warnings: [] });
  });

  it("reuses problem metadata detection on user problem detail", () => {
    const result = sweaAdapter.detect(documentFrom('<div class="problem_name">1234. Sample</div>'), USER_DETAIL_URL);
    expect(result.status).toBe("detected");
  });

  it("returns solving metadata with editor detection on solving pages", () => {
    const document = documentFrom('<div class="problem_box"><h3>1234. Synthetic title</h3></div><input id="contestProbId" value="ABC"><select id="selectCodeLang"><option selected>Java 17</option></select><textarea id="textSource">public class Main {}</textarea>');
    const result = sweaAdapter.detect(document, SOLVING_URL);
    expect(result.status).toBe("connected_page");
    if (result.status === "connected_page") {
      expect(result.editor).toEqual({ status: "detected", editor: { language: "Java", code: "public class Main {}" }, warnings: [] });
      expect(result.metadata).toEqual({ status: "detected", problem: { problemNumber: "1234", title: "Synthetic title", contestProbId: "ABC" }, warnings: [] });
      expect(result.submissionResult).toEqual({ status: "none" });
    }
  });

  it("returns incomplete when detail heading selector is unavailable", () => {
    const result = sweaAdapter.detect(documentFrom("<main></main>"), USER_DETAIL_URL);
    expect(result.status).toBe("incomplete");
  });

  it("rejects unsupported SWEA urls", () => {
    expect(sweaAdapter.detect(documentFrom("<main></main>"), new URL("https://swexpertacademy.com/main/code/problem/problemList.do"))).toEqual({ status: "unsupported_page" });
  });
});
