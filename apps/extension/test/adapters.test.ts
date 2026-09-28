import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { ProgrammersAdapter, isProgrammersAccepted } from "../src/adapters/programmers";
import { SweaAdapter, isSweaAccepted } from "../src/adapters/swea";
import { JungolAdapter } from "../src/adapters/jungol";
import { createAdapter } from "../src/adapters";
import { jungolAcceptedResult } from "../src/adapters/jungolResult";

function locationFor(href: string): Location {
  return new URL(href) as unknown as Location;
}

test("Jungol prefers an exact judge request when available", async () => {
  const { document } = parseHTML('<html><body><h1><span>책 정리 로봇</span><span class="limit">2s</span></h1><button id="submit">upload 제출</button><textarea data-codearchive-jungol-source data-codearchive-jungol-problem="4577" data-codearchive-jungol-language="Java 8"></textarea></body></html>');
  const source = document.querySelector("textarea") as HTMLTextAreaElement;
  source.value = "class Click {}";
  let now = Date.now();
  document.documentElement.setAttribute("data-codearchive-editor-sync", `synced:${now}`);
  const adapter = new JungolAdapter(document, locationFor("https://jungol.co.kr/problem/4577"), 120_000, () => now);
  assert.equal(adapter.detectProblem()?.problemUrl, "https://jungol.co.kr/problem/4577");
  assert.equal(adapter.isSubmitControl(document.querySelector("#submit")!), true);
  adapter.beginSubmissionAttempt(new Date(now));
  assert.equal(adapter.detectSubmissionResult(), null, "a click alone must not count");
  assert.equal(adapter.getSubmissionSnapshot()?.editor?.sourceCode, "class Click {}");
  now += 250;
  source.value = "class Request {}";
  source.dataset.codearchiveJungolRequestAt = String(now);
  document.documentElement.setAttribute("data-codearchive-editor-sync", `synced:${now}`);
  now += 250;
  assert.equal(adapter.detectSubmissionResult(), null, "the judge request alone must not count");
  document.body.insertAdjacentHTML("beforeend", '<div class="result-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title-0" aria-describedby="dialog-desc-0"><h2 id="dialog-title-0">정답이에요!</h2><div id="dialog-desc-0">정답 100점 474ms 34,544MB</div><button>닫기</button></div>');
  const detection = adapter.detectSubmissionResult();
  assert.equal(detection?.accepted, true);
  assert.deepEqual(adapter.getSubmissionSnapshot()?.editor, { language: "Java 8", sourceCode: "class Request {}" });
  assert.deepEqual(adapter.collectPerformance(), { executionTime: 474, memoryValue: 34544, memoryUnit: "MB", memoryUsage: 34544 });
  const capture = { problemNumber: "4577", language: "Java 8", sourceCode: "class Request {}" } as Parameters<NonNullable<typeof adapter.confirmCaptureAsync>>[0];
  const confirmed = await adapter.confirmCaptureAsync(capture, detection!);
  assert.equal(confirmed?.solvedAt, new Date(now - 250).toISOString());
  assert.equal(confirmed?.memoryUnit, "MB");
  assert.equal(await adapter.confirmCaptureAsync({ ...capture, sourceCode: "other" }, detection!), null);
  adapter.consumeSubmissionResult(detection!);
  assert.equal(adapter.detectSubmissionResult(), null);
  assert.equal(new JungolAdapter(document, locationFor("https://jungol.co.kr/problem/4577/submission")).detectProblem(), null);
});

test("Jungol saves a fresh accepted dialog with the matching click-time Monaco source when the old judge POST is absent", async () => {
  const { document } = parseHTML('<html><body><h1><span class="name">계단 오르기</span></h1><textarea data-codearchive-jungol-source data-codearchive-jungol-problem="1520" data-codearchive-jungol-language="Java 8"></textarea></body></html>');
  const source = document.querySelector("textarea") as HTMLTextAreaElement;
  const now = Date.now();
  source.value = "class Main {}";
  document.documentElement.setAttribute("data-codearchive-editor-sync", `synced:${now}`);
  const adapter = new JungolAdapter(document, locationFor("https://jungol.co.kr/problem/1520"), 120_000, () => now);
  adapter.beginSubmissionAttempt(new Date(now));
  assert.deepEqual(adapter.getSubmissionSnapshot()?.editor, { language: "Java 8", sourceCode: "class Main {}" });
  assert.equal(source.value, "", "the click-time code remains frozen in the attempt, not in the page DOM");
  assert.equal(adapter.detectSubmissionResult(), null, "code without a new accepted result is insufficient");
  document.body.insertAdjacentHTML("beforeend", '<div class="result-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title-0" aria-describedby="dialog-desc-0"><h2 id="dialog-title-0">정답이에요!</h2><div id="dialog-desc-0">정답 100점 474ms 34,544MB</div><button>닫기</button></div>');
  const detection = adapter.detectSubmissionResult();
  assert.equal(detection?.accepted, true);
  const capture = { problemNumber: "1520", language: "Java 8", sourceCode: "class Main {}" } as Parameters<NonNullable<typeof adapter.confirmCaptureAsync>>[0];
  assert.deepEqual(await adapter.confirmCaptureAsync(capture, detection!), {
    ...capture, executionTime: 474, memoryValue: 34544, memoryUnit: "MB", memoryUsage: 34544,
    solvedAt: new Date(now).toISOString()
  });
  assert.equal(await adapter.confirmCaptureAsync({ ...capture, sourceCode: "other" }, detection!), null);
});

test("Jungol rejects public history and mismatched or unsynced editor source", () => {
  const { document } = parseHTML('<html><body><h1><span>책 정리 로봇</span></h1><table><tr><td>정답 100점</td></tr></table><textarea data-codearchive-jungol-source data-codearchive-jungol-problem="9999" data-codearchive-jungol-language="Java 8"></textarea></body></html>');
  (document.querySelector("textarea") as HTMLTextAreaElement).value = "wrong problem";
  document.documentElement.setAttribute("data-codearchive-editor-sync", `synced:${Date.now()}`);
  const adapter = new JungolAdapter(document, locationFor("https://jungol.co.kr/problem/4577"));
  adapter.beginSubmissionAttempt();
  assert.equal(adapter.detectSubmissionResult(), null);
  assert.equal(adapter.getSubmissionSnapshot()?.editor, null);
});

test("Jungol reads the title only from the new problem heading", () => {
  const { document } = parseHTML('<h1><span class="head"><span class="name">계단 오르기</span><span class="limit">1s 128MB</span></span></h1>');
  const adapter = new JungolAdapter(document, locationFor("https://jungol.co.kr/problem/1520?cursor=abc"));
  assert.equal(adapter.detectProblem()?.title, "계단 오르기");
});

test("Jungol adapter survives a list-to-problem navigation in the same document", () => {
  const { document } = parseHTML('<html><body><h1><span class="name">삼각형둘레</span></h1></body></html>');
  const location = locationFor("https://jungol.co.kr/problem");
  const adapter = createAdapter(document, location);
  assert.equal(adapter?.platform, "JUNGOL");
  assert.equal(adapter.detectProblem(), null, "a list page is not itself a problem capture");
  (location as unknown as URL).pathname = "/problem/1073";
  assert.equal(adapter.detectProblem()?.problemNumber, "1073");
});

test("Jungol result requires one visible complete success dialog", () => {
  const { document } = parseHTML('<html><body><h5>정답이에요!</h5><table><tr><td>정답 100점</td></tr></table></body></html>');
  assert.equal(jungolAcceptedResult(document), null);
  document.body.insertAdjacentHTML("beforeend", '<div id="result" role="dialog" aria-modal="true" aria-labelledby="dialog-title-0" aria-describedby="dialog-desc-0"><button aria-label="닫기"></button><div class="content"><h2 id="dialog-title-0">정답이에요!</h2><div id="dialog-desc-0"><span>정답</span><b>100점</b><span>474ms</span><span>34,544MB</span></div></div><footer><button>닫기</button></footer></div>');
  assert.deepEqual(jungolAcceptedResult(document)?.performance, { executionTime: 474, memoryValue: 34544, memoryUnit: "MB", memoryUsage: 34544 });
  const close = document.querySelector("#result footer button")!;
  close.innerHTML = '<span class="material-symbols-outlined">close</span>닫기';
  assert.deepEqual(jungolAcceptedResult(document)?.performance, { executionTime: 474, memoryValue: 34544, memoryUnit: "MB", memoryUsage: 34544 }, "the live dialog has both an icon close control and a footer close button");
  const description = document.querySelector("#dialog-desc-0")!;
  description.innerHTML = '<span>정답 100점 474ms 34,544MB</span><div>다음 문제도 풀어볼까요?</div><button>다음 문제</button>';
  assert.deepEqual(jungolAcceptedResult(document)?.performance, { executionTime: 474, memoryValue: 34544, memoryUnit: "MB", memoryUsage: 34544 }, "a next-problem button must not be mistaken for the dialog close control");
  description.textContent = "정답 100점 530ms 35,080MB 다음 문제도 풀어볼까요? 다음 문제 배낭채우기 #1077";
  assert.deepEqual(jungolAcceptedResult(document)?.performance, { executionTime: 530, memoryValue: 35080, memoryUnit: "MB", memoryUsage: 35080 }, "the reported success dialog remains accepted with its next-problem suggestion");
  description.textContent = "정답 100점 213 ms 34,184 MB 다음 문제도 풀어볼까요? 다음 문제 요플레 공장 #2194";
  assert.deepEqual(jungolAcceptedResult(document)?.performance, { executionTime: 213, memoryValue: 34184, memoryUnit: "MB", memoryUsage: 34184 }, "the live dialog includes a next-problem suggestion after the metrics");
  for (const invalid of ["오답 100점 474ms 34,544MB", "정답 99점 474ms 34,544MB", "정답 100점 미측정 34,544MB", "정답 100점 474ms 34,544", "정답 100점 474ms 34,544MB 오답"]) {
    description.textContent = invalid;
    assert.equal(jungolAcceptedResult(document), null, invalid);
  }
  description.textContent = "정답 100점 474ms 34,544MB";
  document.querySelector("#result")!.setAttribute("aria-labelledby", "dialog-title-999");
  assert.equal(jungolAcceptedResult(document), null, "a dialog linked to a different title cannot be accepted");
  document.querySelector("#result")!.setAttribute("aria-labelledby", "dialog-title-0");
  document.querySelector("#result")!.setAttribute("hidden", "");
  assert.equal(jungolAcceptedResult(document), null, "hidden history is not a fresh result");
});

test("Jungol rejects a pre-existing result and a second judge request", () => {
  const { document } = parseHTML('<html><body><h1><span>계단 오르기</span></h1><div class="result-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title-0" aria-describedby="dialog-desc-0"><h2 id="dialog-title-0">정답이에요!</h2><div id="dialog-desc-0">정답 100점 474ms 34,544MB</div><button>닫기</button></div><textarea data-codearchive-jungol-source data-codearchive-jungol-problem="1520" data-codearchive-jungol-language="Java 8"></textarea></body></html>');
  const source = document.querySelector("textarea") as HTMLTextAreaElement;
  const now = Date.now();
  const adapter = new JungolAdapter(document, locationFor("https://jungol.co.kr/problem/1520"), 120_000, () => now);
  adapter.beginSubmissionAttempt(new Date(now));
  source.value = "class Main {}";
  source.dataset.codearchiveJungolRequestAt = String(now);
  document.documentElement.setAttribute("data-codearchive-editor-sync", `synced:${now}`);
  assert.equal(adapter.detectSubmissionResult(), null, "unchanged old result cannot satisfy this submit");
  document.querySelector("#dialog-desc-0")!.textContent = "정답 100점 475ms 34,544MB";
  source.dataset.codearchiveJungolRequestAt = String(now + 1);
  assert.equal(adapter.detectSubmissionResult(), null, "a second judge request cannot be matched to the first source snapshot");
});

test("SWEA metadata uses the solving heading and fails closed on contest identity conflict", () => {
  const { document } = parseHTML('<div class="problem_box"><h3>1206. View</h3></div><input id="contestProbId" value="current">');
  const adapter = new SweaAdapter(document, locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=other"));
  assert.equal(adapter.detectProblem(), null);
  const valid = new SweaAdapter(document, locationFor("https://swexpertacademy.com/main/solvingProblem/solvingProblem.do?contestProbId=current"));
  assert.deepEqual(valid.detectProblem(), {
    problemNumber: "1206",
    title: "View",
    problemUrl: "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=current"
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

test("Programmers captures during the modal fade and reuses metrics only for a fresh duplicate notice", () => {
  const { document } = parseHTML('<div class="challenge-title">섬 연결하기</div><nav class="challenge-nav"><button class="dropdown-toggle">Java</button></nav><textarea id="code" name="code"></textarea><div id="modal-dialog" class="modal fade" aria-hidden="true" style="display:none"><h4 class="modal-title">정답입니다!</h4></div><div class="console-content"><table class="console-test-group"><tbody><tr><td class="result passed">통과 (0.61ms, 86.3MB)</td></tr></tbody></table></div>');
  (document.querySelector("#code") as HTMLTextAreaElement).value = "class Solution {}";
  const adapter = new ProgrammersAdapter(document, locationFor("https://school.programmers.co.kr/learn/courses/30/lessons/42861"));
  adapter.beginSubmissionAttempt();
  assert.equal(adapter.detectSubmissionResult(), null);
  const dialog = document.querySelector("#modal-dialog") as HTMLElement;
  dialog.classList.add("show");
  dialog.style.display = "block";
  dialog.removeAttribute("aria-hidden");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  assert.equal(adapter.detectSubmissionResult()?.accepted, true, "the .show transition is authoritative before opacity reaches one");
  assert.equal(adapter.collectPerformance(), null, "unchanged old rows are not associated with this submit");
  const notice = document.createElement("div");
  notice.className = "console-failed";
  notice.textContent = "같은 코드로 채점한 결과가 있습니다.";
  document.querySelector(".console-content")!.prepend(notice);
  assert.deepEqual(adapter.collectPerformance(), { executionTime: 0.61, memoryUsage: 86.3, memoryValue: 86.3, memoryUnit: "MB" });
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
