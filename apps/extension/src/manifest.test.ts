import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";

describe("extension manifest", () => {
  it("injects the SWEA content script on ContestProblem detail pages", () => {
    const matches = manifest.content_scripts.flatMap((script) => script.matches);
    expect(matches).toContain("https://swexpertacademy.com/main/code/contestProblem/contestProblemDetail.do*");
  });
});
