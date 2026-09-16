import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { ProgrammersAdapter, isProgrammersAccepted } from "../src/adapters/programmers";
import { SweaAdapter, isSweaAccepted } from "../src/adapters/swea";

function locationFor(href: string): Location {
  return new URL(href) as unknown as Location;
}

test("SWEA metadata uses the solving heading and fails closed on contest identity conflict", () => {
  const { document } = parseHTML('<div class="problem_box"><h3>1206. View</h3></div><input id="contestProbId" value="current">');
  const adapter = new SweaAdapter(document, locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=other"));
  assert.equal(adapter.detectProblem(), null);
  const valid = new SweaAdapter(document, locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current"));
  assert.deepEqual(valid.detectProblem(), {
    problemNumber: "1206",
    title: "View",
    problemUrl: "https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current"
  });
});

test("Programmers accepts only the canonical lesson host/path and hidden #code source", () => {
  const { document } = parseHTML('<div class="challenge-title">카펫</div><nav class="challenge-nav"><button class="dropdown-toggle">C++</button></nav><textarea id="code" name="code"></textarea>');
  (document.querySelector("#code") as HTMLTextAreaElement).value = "vector<int> solution() {}";
  const adapter = new ProgrammersAdapter(document, locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/42842?language=cpp"));
  assert.deepEqual(adapter.detectProblem(), {
    problemNumber: "42842",
    title: "카펫",
    problemUrl: "https://school.programmers.co.kr/learn/courses/30/lessons/42842"
  });
  assert.deepEqual(adapter.detectEditor(), { language: "C++", sourceCode: "vector<int> solution() {}" });
  assert.equal(new ProgrammersAdapter(document, locationFor("https://programmers.co.kr/learn/courses/30/lessons/42842")).detectProblem(), null);
});

test("result phrases are exact and never accept surrounding failure prose", () => {
  assert.equal(isSweaAccepted("PASS입니다."), true);
  assert.equal(isSweaAccepted("축하합니다. Pass입니다.제출이 완료되었습니다."), true);
  assert.equal(isSweaAccepted("축하합니다. Pass입니다.\n제출이 완료되었습니다."), true);
  assert.equal(isSweaAccepted("축하합니다. Pass입니다. 컴파일 오류"), false);
  assert.equal(isSweaAccepted("이전 제출은 축하합니다. Pass입니다.제출이 완료되었습니다."), false);
  assert.equal(isSweaAccepted("PASS입니다. 컴파일 오류"), false);
  assert.equal(isSweaAccepted("PASS"), false);
  assert.equal(isProgrammersAccepted("정답입니다!"), true);
  assert.equal(isProgrammersAccepted("실행 결과: 정답입니다!"), false);
});

test("Programmers optional performance fails closed for malformed or ambiguous groups", () => {
  const { document } = parseHTML('<div class="challenge-title">카펫</div><nav class="challenge-nav"><button class="dropdown-toggle">Java</button></nav><textarea id="code" name="code">class Solution {}</textarea><div id="modal-dialog" class="modal fade" role="dialog" aria-modal="false"><h4 class="modal-title">정답입니다!</h4></div><div class="console-content"><table class="console-test-group"><tbody><tr><td class="result passed">통과 (1s, 2MB)</td></tr></tbody></table></div>');
  const adapter = new ProgrammersAdapter(document, locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/42842"));
  adapter.beginSubmissionAttempt();
  document.querySelector(".console-test-group tbody")!.innerHTML = '<tr><td class="result passed">통과 (1s, 2MB)</td></tr>';
  const dialog = document.querySelector("#modal-dialog") as HTMLElement;
  dialog.classList.add("show");
  dialog.setAttribute("aria-modal", "true");
  assert.equal(adapter.collectPerformance(), null);
});

test('live SWEA submit anchor and language menu are recognized without treating compile as submit', () => {
  const { document } = parseHTML('<div class="problem_box"><h3>1868. 파핑파핑 지뢰찾기</h3></div><select id="sel_lang" name="lang"><option value="J" selected>JAVA (OpenJDK 8)</option></select><textarea id="textSource">class Solution {}</textarea><a id="btnf_proposal" href="#none">제출</a><a id="btnf_compile">컴파일</a>');
  const select = document.querySelector('#sel_lang')!;
  Object.defineProperty(select, 'selectedOptions', { value: [select.querySelector('option')] });
  const adapter = new SweaAdapter(document, locationFor('https://swexpertacademy.com/main/solvingProblem/solvingProblem.do'));
  assert.equal(adapter.isSubmitControl(document.querySelector('#btnf_proposal')!), true);
  assert.equal(adapter.isSubmitControl(document.querySelector('#btnf_compile')!), false);
  assert.deepEqual(adapter.detectEditor(), { language: 'Java', sourceCode: 'class Solution {}' });
  // The solving page has no authoritative result metric row. Never guess MB;
  // the capture therefore retains an explicit UNKNOWN memory unit.
  assert.equal(adapter.collectPerformance(), null);
});
