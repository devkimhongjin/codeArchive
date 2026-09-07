import { describe, expect, it } from "vitest";
import { fetchSweaPerformance, parseSweaPerformance, sweaDisplayedCodeLength } from "./sweaPerformance";

const solvingUrl = new URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current");
const observedAt = "2026-09-02T00:00:00.000Z";
const nickname = "tester_123";
const code = "가";

function row({ user = nickname, time = "09:00", memory = "12,345 kb", execution = "123 ms", length = "2" } = {}) {
  return `<div class="problem_smt right_answer"><div class="submitter"><dl class="smt_txt"><dt>${user}</dt><dd>제출일 : 2026-09-02 ${time}</dd></dl></div><div class="info"><ul><li><span>JAVA</span><span>언어</span></li><li><span>${memory}</span><span>메모리</span></li><li><span>${execution}</span><span>실행시간</span></li><li><span>${length}</span><span>코드길이</span></li></ul></div></div>`;
}

function resultDocument(rows: string) {
  return new DOMParser().parseFromString(`<form id="problemForm"><input name="contestProbId" value="current"></form><div class="box-list-inner">${rows}</div>`, "text/html");
}

describe("SWEA performance", () => {
  it("matches SWEA's observed legacy display length for Korean source text", () => {
    expect(sweaDisplayedCodeLength("abc한글")).toBe(7);
    expect(sweaDisplayedCodeLength("abc😀")).toBeNull();
  });
  it("attaches one exact current-user row with strict normalized metrics", () => {
    expect(parseSweaPerformance(resultDocument(row()), nickname, code, observedAt)).toEqual({ executionTime: "123 ms", memoryUsage: "12,345 kb" });
  });

  it("uses SWEA display length and rejects stale, ambiguous, malformed, and wrong-user rows", () => {
    expect(parseSweaPerformance(resultDocument(row({ length: "3" })), nickname, code, observedAt)).toBeNull();
    expect(parseSweaPerformance(resultDocument(row({ user: "other" })), nickname, code, observedAt)).toBeNull();
    expect(parseSweaPerformance(resultDocument(`${row()}${row({ time: "09:01" })}`), nickname, code, observedAt)).toBeNull();
    expect(parseSweaPerformance(resultDocument(row({ time: "08:54" })), nickname, code, observedAt)).toBeNull();
    expect(parseSweaPerformance(resultDocument(row({ time: "08:58" })), nickname, code, observedAt)).toBeNull();
    expect(parseSweaPerformance(resultDocument(row({ memory: "12345 kb" })), nickname, code, observedAt)).toBeNull();
    expect(parseSweaPerformance(resultDocument(row({ execution: "1.5 ms" })), nickname, code, observedAt)).toBeNull();
  });

  it("requires the exact Problem-family solver response and preserves source fallback on fetch failure", async () => {
    const current = new DOMParser().parseFromString(`<div id="Beginner">${nickname}</div>`, "text/html");
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("same-origin");
      expect(String(init?.body)).toContain("contestProbId=current");
      return new Response(resultDocument(row()).documentElement.outerHTML, { status: 200 });
    };
    await expect(fetchSweaPerformance(current, solvingUrl, "current", code, observedAt, fetcher, "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=current"))
      .resolves.toEqual({ executionTime: "123 ms", memoryUsage: "12,345 kb" });
    await expect(fetchSweaPerformance(current, solvingUrl, "current", code, observedAt, async () => { throw new Error("network"); }, "https://swexpertacademy.com/main/code/contestProblem/contestProblemDetail.do"))
      .resolves.toBeUndefined();
  });
});
