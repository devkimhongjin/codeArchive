import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
  fetchSweaPerformance,
  parseSweaPerformance,
  sweaDisplayedCodeLength
} from "../src/adapters/sweaPerformance";

const OBSERVED_AT = "2026-09-02T00:00:30.000Z";
const NICKNAME = "tester_123";

function resultRow({
  nickname = NICKNAME,
  time = "09:00",
  memory = "12,345 kb",
  execution = "123 ms",
  codeLength = "2"
} = {}): string {
  return `<div class="problem_smt right_answer">
    <div class="submitter"><dl class="smt_txt"><dt>${nickname}</dt><dd>제출일 : 2026-09-02 ${time}</dd></dl></div>
    <div class="info"><ul>
      <li><span>${memory}</span><span>메모리</span></li>
      <li><span>${execution}</span><span>실행시간</span></li>
      <li><span>${codeLength}</span><span>코드길이</span></li>
    </ul></div>
  </div>`;
}

function resultHtml(rows: string): string {
  return `<form id="problemForm"><input name="contestProbId" value="current"></form><div class="box-list-inner">${rows}</div>`;
}

test("SWEA performance preserves the site's KB unit and millisecond value", () => {
  const { document } = parseHTML(resultHtml(resultRow()));
  assert.equal(sweaDisplayedCodeLength("abc한글"), 7);
  assert.equal(sweaDisplayedCodeLength("abc😀"), null);
  assert.deepEqual(parseSweaPerformance(document, NICKNAME, "가", OBSERVED_AT), {
    executionTime: 123,
    memoryValue: 12_345,
    memoryUnit: "KB"
  });
});

test("SWEA performance rejects wrong user, code length, unit, stale and ambiguous rows", () => {
  assert.equal(parseSweaPerformance(parseHTML(resultHtml(resultRow({ nickname: "other" }))).document, NICKNAME, "가", OBSERVED_AT), null);
  assert.equal(parseSweaPerformance(parseHTML(resultHtml(resultRow({ codeLength: "3" }))).document, NICKNAME, "가", OBSERVED_AT), null);
  assert.equal(parseSweaPerformance(parseHTML(resultHtml(resultRow({ memory: "12 MB" }))).document, NICKNAME, "가", OBSERVED_AT), null);
  assert.equal(parseSweaPerformance(parseHTML(resultHtml(resultRow({ time: "08:55" }))).document, NICKNAME, "가", OBSERVED_AT), null);
  assert.equal(parseSweaPerformance(parseHTML(resultHtml(`${resultRow()}${resultRow()}`)).document, NICKNAME, "가", OBSERVED_AT), null);
});

test("SWEA performance retries a delayed result row with same-origin credentials", async () => {
  const { document } = parseHTML(`<div id="Beginner">${NICKNAME}</div>`);
  let requests = 0;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests += 1;
    assert.equal(new URL(String(input)).pathname, "/main/code/problem/problemSolver.do");
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "same-origin");
    assert.match(String(init?.body), /contestProbId=current/);
    return new Response(resultHtml(requests === 1 ? "" : resultRow()), { status: 200 });
  };

  const result = await fetchSweaPerformance(
    document,
    new URL("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do") as unknown as Location,
    "current",
    "가",
    OBSERVED_AT,
    fetcher,
    async () => undefined
  );

  assert.equal(requests, 2);
  assert.deepEqual(result, { executionTime: 123, memoryValue: 12_345, memoryUnit: "KB" });
});
