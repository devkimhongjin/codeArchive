import { describe, expect, it } from "vitest";
import { detectSweaSubmissionPerformance } from "./sweaSubmissionPerformance";

function doc(rows: string, nickname = "Beginner"): Document {
  return new DOMParser().parseFromString(`
    <header><span class="name">${nickname}</span></header>
    <form id="contestProbForm">
      <input name="contestProbId" value="current">
      <div class="box-list"><div class="box-list-inner">${rows}</div></div>
    </form>
  `, "text/html");
}

function row({ user = "Beginner", at = "2026-08-25 10:10", result = "Pass", memory = "12,345 kb", time = "67 ms" } = {}): string {
  return `<div class="problem_smt">
    <div class="submitter"><dl class="smt_txt"><dt>#${user}</dt><dd>제출일 : ${at}</dd></dl></div>
    <div class="info"><ul>
      <li><span>Java</span><span>언어</span></li>
      <li><span>${memory}</span><span>메모리</span></li>
      <li><span>${time}</span><span>시간</span></li>
      <li><span>123 Bytes</span><span>코드길이</span></li>
      <li><span>${result}</span><span>결과</span></li>
    </ul></div>
  </div>`;
}

const observedAt = "2026-08-25T01:11:00.000Z"; // 10:11 KST

describe("detectSweaSubmissionPerformance", () => {
  it("selects the unique current-user recent Pass row and preserves display strings", () => {
    const result = detectSweaSubmissionPerformance(doc(row({ memory: " 12,345   kb ", time: " 67   ms " })), observedAt);
    expect(result).toEqual({ status: "detected", performance: { memoryUsage: "12,345 kb", executionTime: "67 ms" } });
  });

  it("ignores other-user and non-Pass rows", () => {
    const result = detectSweaSubmissionPerformance(doc(row({ user: "Other" }) + row({ result: "Fail" })), observedAt);
    expect(result).toEqual({ status: "incomplete", reason: "no_trusted_candidate" });
  });

  it("fails closed when equally recent trusted rows are ambiguous", () => {
    const result = detectSweaSubmissionPerformance(doc(row() + row()), observedAt);
    expect(result).toEqual({ status: "incomplete", reason: "ambiguous_candidate" });
  });

  it("reports missing metrics instead of inventing values", () => {
    const result = detectSweaSubmissionPerformance(doc(row({ memory: "" })), observedAt);
    expect(result).toEqual({ status: "incomplete", reason: "metrics_missing" });
  });

  it("rejects stale rows outside the conservative recent window", () => {
    const result = detectSweaSubmissionPerformance(doc(row({ at: "2026-08-25 09:50" })), observedAt);
    expect(result).toEqual({ status: "incomplete", reason: "no_trusted_candidate" });
  });
});
