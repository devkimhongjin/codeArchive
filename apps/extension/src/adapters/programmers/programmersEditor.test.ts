import { describe, expect, it } from "vitest";
import { detectProgrammersEditor, normalizeProgrammersLanguage } from "./programmersEditor";

function documentFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("programmers editor", () => {
  it("reads the observed language control and hidden CodeMirror source field", () => {
    const document = documentFrom('<nav class="challenge-nav"><button class="dropdown-toggle"> C++ </button></nav><textarea id="code" name="code">vector&lt;int&gt; solution() {}</textarea>');
    expect(detectProgrammersEditor(document)).toEqual({
      status: "detected",
      editor: { language: "C++", code: "vector<int> solution() {}" },
      warnings: [],
    });
  });

  it("normalizes platform language labels and never invents missing code", () => {
    expect(normalizeProgrammersLanguage("Python3")).toBe("Python");
    expect(detectProgrammersEditor(documentFrom('<nav class="challenge-nav"><button class="dropdown-toggle">Java</button></nav>')))
      .toMatchObject({ status: "incomplete", code: null, missing: ["code"] });
  });
});
