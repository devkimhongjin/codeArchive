import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import { loadJungolHistoryPreview } from "../src/historicalJungol";

test("confirmed final page uses short quiet windows instead of four full request timeouts", async () => {
  const row = (id: number) => `<tr><td data-col="번호">${id}</td><td data-col="문제"><a href="/problem/1000">Fixture #1000</a></td>
    <td data-col="결과">정답 <span>100점</span></td><td data-col="코드 길이">5B</td>
    <td data-col="언어"><a href="?account=mine&amp;sid=${id}">Java 8</a></td></tr>`;
  const { document } = parseHTML(`<html><body><button role="switch" aria-checked="true">내 제출</button>
    <button aria-label="@mine 필터 해제"></button><table>${row(2001)}</table><button id="more">더 불러오기</button></body></html>`);
  document.querySelector("#more")!.addEventListener("click", () => {
    const tbody = document.createElement("tbody"); tbody.innerHTML = row(2002); document.querySelector("table")!.append(tbody);
    document.querySelector("#more")!.remove();
  });
  const original = { setTimeout: globalThis.setTimeout, MutationObserver: globalThis.MutationObserver };
  const delays: number[] = [];
  globalThis.MutationObserver = document.defaultView!.MutationObserver;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    delays.push(delay ?? 0); return original.setTimeout(callback, 1);
  }) as typeof setTimeout;
  try {
    const result = await loadJungolHistoryPreview(document, new URL("https://jungol.co.kr/submission?account=mine") as unknown as Location);
    assert.equal(result.status, "READY");
    if (result.status === "READY") { assert.equal(result.truncated, false); assert.equal(result.candidates.length, 2); }
    assert.deepEqual(delays, [2_000, 2_000, 2_000, 2_000, 5_000]);
    delays.length = 0;
    const again = await loadJungolHistoryPreview(document, new URL("https://jungol.co.kr/submission?account=mine") as unknown as Location);
    assert.equal(again.status, "READY");
    if (again.status === "READY") assert.equal(again.truncated, false);
    assert.deepEqual(delays, [2_000, 2_000, 2_000, 2_000, 5_000], "confirmed prior pagination must retain the short budget on retries");
  } finally { Object.assign(globalThis, original); }
});
