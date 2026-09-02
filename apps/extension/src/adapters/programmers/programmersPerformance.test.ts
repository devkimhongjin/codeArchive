import { describe, expect, it } from "vitest";
import { findProgrammersResultGroup, parseProgrammersPerformanceGroup, resultGroupMutationRelevant } from "./programmersPerformance";

function group(rows: string, extra = "") {
  return new DOMParser().parseFromString(`<div class="console-content"><table class="console-test-group"><tbody>${rows}</tbody></table></div>${extra}`, "text/html");
}

function result(text: string, className = "result passed") {
  return `<tr><td class="${className}">${text}</td></tr>`;
}

describe("Programmers performance", () => {
  it("averages every passed final-test row to deterministic two-decimal strings", () => {
    const document = group([
      result("통과 (0.01ms, 73.3MB)"), result("통과 (0.02ms, 87.2MB)"), result("통과 (0.03ms, 83.7MB)"),
    ].join(""));
    expect(parseProgrammersPerformanceGroup(findProgrammersResultGroup(document)!)).toEqual({ executionTime: "0.02 ms", memoryUsage: "81.40 MB" });
  });

  it("matches the observed 13-test-case arithmetic average", () => {
    const values = [
      ["0.01", "73.3"], ["0.02", "87.2"], ["0.03", "83.7"], ["0.01", "80.7"], ["0.02", "74.5"],
      ["0.01", "84.2"], ["0.02", "81.8"], ["0.03", "77"], ["0.02", "83.6"], ["0.03", "75.3"],
      ["0.01", "80.9"], ["0.01", "84.4"], ["0.01", "73.8"],
    ];
    const document = group(values.map(([time, memory]) => result(`통과 (${time}ms, ${memory}MB)`)).join(""));
    expect(parseProgrammersPerformanceGroup(findProgrammersResultGroup(document)!)).toEqual({ executionTime: "0.02 ms", memoryUsage: "80.03 MB" });
  });

  it("fails closed when any result is not a valid passed ms/MB row", () => {
    for (const invalid of [
      result("통과 (1ms, 2MB)", "result"),
      result("실패 (1ms, 2MB)"),
      result("통과 (1s, 2MB)"),
      result("통과 (1ms, 2GB)"),
      result("통과 (NaNms, 2MB)"),
    ]) {
      const document = group(`${result("통과 (1ms, 2MB)")}${invalid}`);
      expect(parseProgrammersPerformanceGroup(findProgrammersResultGroup(document)!)).toBeNull();
    }
    expect(parseProgrammersPerformanceGroup(findProgrammersResultGroup(group(""))!)).toBeNull();
  });

  it("requires exactly one result group and ignores passed cells outside it", () => {
    const document = group(result("통과 (1ms, 2MB)"), `<div class="result passed">통과 (999ms, 999MB)</div>`);
    expect(findProgrammersResultGroup(document)).not.toBeNull();
    expect(parseProgrammersPerformanceGroup(findProgrammersResultGroup(document)!)).toEqual({ executionTime: "1.00 ms", memoryUsage: "2.00 MB" });
    const duplicate = new DOMParser().parseFromString(`<div class="console-content"><table class="console-test-group"></table><table class="console-test-group"></table></div>`, "text/html");
    expect(findProgrammersResultGroup(duplicate)).toBeNull();
  });

  it("reports only mutations that prove the current result group changed", () => {
    const document = group(result("통과 (1ms, 2MB)"));
    const table = document.querySelector(".console-test-group")!;
    expect(resultGroupMutationRelevant(document, [])).toBe(false);
    const cell = table.querySelector(".result")!;
    cell.textContent = "통과 (2ms, 3MB)";
    const mutation = { type: "childList", target: cell, addedNodes: [], removedNodes: [] } as unknown as MutationRecord;
    expect(resultGroupMutationRelevant(document, [mutation])).toBe(true);
  });
});
