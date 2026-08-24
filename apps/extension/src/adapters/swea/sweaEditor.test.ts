import { describe, expect, it } from "vitest";
import { detectSweaEditor, normalizeSweaLanguage } from "./sweaEditor";

const URL = new globalThis.URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=ABC");

function documentFrom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("sweaEditor", () => {
  it("normalizes supported SWEA language labels", () => {
    expect(normalizeSweaLanguage("Java 17")).toBe("Java");
    expect(normalizeSweaLanguage("Python 3")).toBe("Python");
    expect(normalizeSweaLanguage("C++14")).toBe("C++");
    expect(normalizeSweaLanguage("JavaScript")).toBe("JavaScript");
  });

  it("preserves the exact source value including whitespace", () => {
    const code = "public class Main {\n    \n}\n";
    const document = documentFrom(`<select id="selectCodeLang"><option selected>Java 17</option></select><textarea id="textSource"></textarea>`);
    const textarea = document.querySelector("#textSource") as HTMLTextAreaElement;
    textarea.value = code;
    expect(detectSweaEditor(document, URL)).toEqual({
      status: "detected",
      editor: { language: "Java", code },
      warnings: [],
    });
  });

  it("returns structured incomplete when source field is missing", () => {
    const result = detectSweaEditor(documentFrom('<select id="selectCodeLang"><option selected>Python 3</option></select>'), URL);
    expect(result.status).toBe("incomplete");
    if (result.status === "incomplete") expect(result.missing).toEqual(["code"]);
  });

  it("does not trust an existing source value when editor sync failed", () => {
    const document = documentFrom('<select id="selectCodeLang"><option selected>Java 17</option></select><textarea id="textSource">stale</textarea>');
    const result = detectSweaEditor(document, URL, false);
    expect(result.status).toBe("incomplete");
    if (result.status === "incomplete") {
      expect(result.code).toBeNull();
      expect(result.missing).toEqual(["code"]);
      expect(result.warnings).toContain("SWEA 편집기 최신 코드 동기화에 실패했습니다.");
    }
  });
});
