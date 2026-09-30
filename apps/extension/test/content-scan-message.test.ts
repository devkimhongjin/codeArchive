import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';

test('legacy Jungol preview joins the active managed scan without a second immediate click', async () => {
  const { document } = parseHTML(`<html><body>
    <button role="switch" aria-checked="true">내 제출</button><button aria-label="@mine 필터 해제"></button>
    <table><tr><th>번호</th></tr><tr><td data-col="번호">12345</td>
      <td data-col="문제"><a href="/problem/1520">계단 오르기 #1520</a></td>
      <td data-col="결과">정답 <span>100점</span></td><td data-col="시간">25ms</td>
      <td data-col="메모리">33.0MB</td><td data-col="코드 길이">5B</td>
      <td data-col="언어"><a href="?account=mine&amp;sid=12345">Java 8</a></td></tr></table>
    <button id="more">더 불러오기</button></body></html>`);
  const location = new URL('https://jungol.co.kr/submission?account=mine');
  const window = document.defaultView!;
  Object.defineProperty(window, 'location', { value: location, configurable: true });
  let listener: ((message: unknown, sender: unknown, reply: (value: unknown) => void) => boolean) | undefined;
  const chrome = { runtime: { onMessage: { addListener(callback: typeof listener) { listener = callback; } },
    sendMessage: async () => ({}) } };
  const globals = { document: globalThis.document, window: globalThis.window,
    chrome: globalThis.chrome, MutationObserver: globalThis.MutationObserver,
    setTimeout: globalThis.setTimeout };
  Object.assign(globalThis, { document, window, chrome, MutationObserver: window.MutationObserver,
    setTimeout: ((callback: (...args: unknown[]) => void, _delay?: number) =>
      globals.setTimeout(callback, 1)) as typeof setTimeout });
  const more = document.querySelector<HTMLButtonElement>('#more')!;
  let clicks = 0;
  more.addEventListener('click', () => {
    clicks++;
    const row = document.querySelector<HTMLTableRowElement>('td[data-col="번호"]')!.closest('tr')!.cloneNode(true) as HTMLTableRowElement;
    row.querySelector('td[data-col="번호"]')!.textContent = String(12345 + clicks);
    row.querySelector('td[data-col="언어"] a')!.setAttribute('href', `?account=mine&sid=${12345 + clicks}`);
    document.querySelector('table')!.append(row);
    if (clicks === 2) more.remove();
  });
  try {
    await import('../src/content');
    assert.ok(listener);
    let start: unknown;
    let legacy: unknown;
    listener!({ type: 'HISTORY_SCAN_START' }, null, value => { start = value; });
    listener!({ type: 'HISTORY_PREVIEW' }, null, value => { legacy = value; });
    assert.equal(clicks, 1);
    assert.deepEqual(legacy, start);
    await new Promise(resolve => globals.setTimeout(resolve, 50));
  } finally {
    Object.assign(globalThis, globals);
  }
});
