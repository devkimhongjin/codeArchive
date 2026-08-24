import { describe, expect, it } from "vitest";
import { getSweaPageContext } from "./sweaPageContext";

const SOLVING_URL = new URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current");

function documentFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

const SOLVING_DOCUMENT = '<div class="problem_box"><h3>1234. Synthetic title</h3></div><input id="contestProbId" value="current"><select id="selectCodeLang"><option selected>Java 17</option></select><textarea id="textSource">current</textarea>';

describe("getSweaPageContext", () => {
  it("returns none before a submission result is observed", () => {
    const result = getSweaPageContext(documentFrom(SOLVING_DOCUMENT), SOLVING_URL, { status: "none" });

    expect(result).toMatchObject({ status: "connected_page", submissionResult: { status: "none" } });
  });

  it("returns the latest in-memory observation without exposing raw result text", () => {
    const result = getSweaPageContext(documentFrom(SOLVING_DOCUMENT), SOLVING_URL, {
      status: "observed",
      submission: { result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" },
      warnings: [],
    });

    expect(result).toMatchObject({
      status: "connected_page",
      submissionResult: { status: "observed", submission: { result: "ACCEPTED", observedAt: "2026-08-24T12:00:00.000Z" } },
    });
  });
});
