import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { previewJungolHistory } from "../src/historicalJungol";

const profile = `<a class="crumb" href="/account/9">@mine</a><a href="/account/9/edit">정보 수정</a><a class="active" href="/account/9/submission">제출현황</a>`;
const location = new URL("https://jungol.co.kr/account/9/submission") as unknown as Location;
const wide = `<tr><td data-col="번호"><span class="sl-id">2001</span></td><td data-col="제출자"><a href="/account/9">mine</a></td>
  <td data-col="문제"><a href="/problem/2000">Fixture #2000</a></td><td data-col="결과">정답 <span>100점</span></td>
  <td data-col="시간">1511<span>ms</span>·</td><td data-col="메모리">60.5<span>MB</span>·</td><td data-col="코드 길이">5<span>B</span></td>
  <td data-col="언어"><a href="?sid=2001">Java 8</a></td></tr>`;
// The same row once Jungol folds number, code length, memory and time for a narrow table.
const narrow = `<tr><td data-col="제출자"><a href="/account/9">mine</a></td>
  <td data-col="문제"><a href="/problem/2000">Fixture #2000</a></td><td data-col="결과">정답 <span>100점</span></td>
  <td data-col="언어"><a href="?sid=2001">Java 8</a></td>
  <td class="sl-td-folded"><span class="sl-folded"><span class="sl-folded-mark" aria-hidden="true">…</span> <span class="sr-only">번호 2001 · 시간 1511ms · 메모리 60.5MB · 코드 길이 5B</span></span></td></tr>`;

test("Jungol candidates are identical whether or not the table folds its columns", () => {
  const read = (row: string) => {
    const { document } = parseHTML(`<html><body>${profile}<table>${row}</table></body></html>`);
    return previewJungolHistory(document, location);
  };
  const expected = { status: "READY", skipped: 0, truncated: false, candidates: [{ submissionId: "2001", problemNumber: "2000", title: "Fixture",
    language: "Java 8", detailUrl: "https://jungol.co.kr/account/9/submission?sid=2001", codeByteLength: 5, executionTime: 1511, memoryValue: 60.5 }] };
  assert.deepEqual(read(wide), expected);
  assert.deepEqual(read(narrow), expected);
});

test("a folded number that disagrees with the submission link is rejected", () => {
  const { document } = parseHTML(`<html><body>${profile}<table>${narrow.replace("번호 2001", "번호 2002")}</table></body></html>`);
  const preview = previewJungolHistory(document, location);
  assert.equal(preview.status, "READY");
  assert.equal(preview.candidates.length, 0);
});
