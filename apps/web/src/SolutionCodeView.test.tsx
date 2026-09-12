import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SolutionCodeView, languageFor, safeTheme } from "./SolutionCodeView";

describe("SolutionCodeView", () => {
  it("maps only supported dashboard labels and falls back unknown labels to raw code", () => {
    expect(languageFor("JAVA")).toBe("java");
    expect(languageFor("TypeScript")).toBe("typescript");
    expect(languageFor("Rust")).toBeNull();
    render(<SolutionCodeView code="unsafe <source>" language="Rust" />);
    expect(screen.getByText("unsafe <source>")).toBeInTheDocument();
  });

  it("uses the safe default for invalid persisted themes", () => {
    expect(safeTheme("not-a-theme")).toBe("github-dark");
    expect(safeTheme("github-light")).toBe("github-light");
  });

  it("keeps the accessible raw source out of the keyboard tab order", async () => {
    render(<SolutionCodeView code="class Main {}" language="Java" />);
    await waitFor(() => expect(screen.getByLabelText("원문 코드")).toHaveAttribute("tabindex", "-1"));
  });
});
