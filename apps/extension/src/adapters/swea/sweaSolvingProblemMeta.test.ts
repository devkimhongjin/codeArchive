import { describe, expect, it } from "vitest";
import { detectSweaSolvingProblemMeta } from "./sweaSolvingProblemMeta";

const SOLVING_URL = new URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current");

function documentFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("detectSweaSolvingProblemMeta", () => {
  it("parses the documented numeric-dot heading and normalizes whitespace", () => {
    const document = documentFrom(`
      <div class="problem_box"><h3> 1234.  Synthetic\n title  </h3></div>
      <input id="contestProbId" value="old">
      <input name="contestProbId" value="current">
    `);

    expect(detectSweaSolvingProblemMeta(document, SOLVING_URL)).toEqual({
      status: "detected",
      problem: { problemNumber: "1234", title: "Synthetic title", problemContestId: "current" },
      warnings: [],
    });
  });

  it("does not strip an unverified difficulty-looking heading suffix", () => {
    const document = documentFrom('<div class="problem_box"><h3>1234. Synthetic title D2</h3></div>');

    expect(detectSweaSolvingProblemMeta(document, SOLVING_URL)).toEqual({
      status: "detected",
      problem: { problemNumber: "1234", title: "Synthetic title D2", problemContestId: "current" },
      warnings: [],
    });
  });

  it("returns incomplete when the confirmed solving heading is absent or title-less", () => {
    expect(detectSweaSolvingProblemMeta(documentFrom('<h3>1234. Outside confirmed selector</h3>'), SOLVING_URL)).toMatchObject({
      status: "incomplete",
      missing: ["problemNumber", "title"],
    });
    expect(detectSweaSolvingProblemMeta(documentFrom('<div class="problem_box"><h3>1234.</h3></div>'), SOLVING_URL)).toMatchObject({
      status: "incomplete",
      missing: ["problemNumber", "title"],
    });
  });

  it("uses the URL identity when the DOM identity is absent", () => {
    const document = documentFrom('<div class="problem_box"><h3>1234. Synthetic title</h3></div>');

    expect(detectSweaSolvingProblemMeta(document, SOLVING_URL)).toMatchObject({
      status: "detected",
      problem: { problemContestId: "current" },
    });
  });

  it("uses the approved Problem-family handoff when direct page identity is absent", () => {
    const document = documentFrom('<div class="problem_box"><h3>1234. Synthetic title</h3></div>');

    expect(detectSweaSolvingProblemMeta(document, new URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do"), "handoff-id")).toMatchObject({
      status: "detected",
      problem: { problemContestId: "handoff-id" },
    });
  });

  it("blocks trusted metadata when DOM and URL identities conflict", () => {
    const document = documentFrom(`
      <div class="problem_box"><h3>1234. Synthetic title</h3></div>
      <input id="contestProbId" value="other">
    `);

    expect(detectSweaSolvingProblemMeta(document, SOLVING_URL)).toMatchObject({ status: "conflict" });
  });
});
