import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { startCapture } from '../src/content';
import { ProgrammersAdapter } from '../src/adapters/programmers';

test('a failed connection warns without blocking the judge, pauses upload, and retries the same capture after login', async () => {
  const { document } = parseHTML('<html><body><div class="challenge-title">Synthetic</div><nav class="challenge-nav"><span class="dropdown-toggle">Java</span></nav><textarea id="code" name="code">class Synthetic {}</textarea><button id="submit-code">제출</button></body></html>');
  const previous = { Element: globalThis.Element, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, { Element: document.defaultView!.Element, MutationObserver: document.defaultView!.MutationObserver });
  const adapter = new ProgrammersAdapter(document, new URL('https://school.programmers.co.kr/learn/courses/30/lessons/72413') as unknown as Location);
  let ready = false, judgeClicks = 0; const stores: Array<{ expectedAccountId?: string }> = [];
  document.getElementById('submit-code')!.addEventListener('click', event => { assert.equal(event.defaultPrevented, false); judgeClicks++; });
  try {
    startCapture(adapter, document, async value => {
      const message = value as { type: string; expectedAccountId?: string };
      if (message.type === 'CHECK_CAPTURE_OWNER') return ready ? { status: 'READY', accountId: '1' } : { status: 'LOGIN_REQUIRED' };
      if (message.type === 'STORE_CAPTURE') stores.push(message);
      return { ok: true };
    });
    (document.getElementById('submit-code') as HTMLButtonElement).click();
    document.body.insertAdjacentHTML('beforeend', '<div id="modal-dialog" class="modal show" role="dialog" aria-modal="true"><h4 class="modal-title">정답입니다!</h4></div>');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(judgeClicks, 1); assert.equal(stores.length, 0); assert.match(document.getElementById('codearchive-connection-notice')!.textContent!, /GitHub 로그인이 필요/);
    ready = true;
    const retry = [...document.querySelectorAll<HTMLButtonElement>('#codearchive-connection-notice button')].find(button => button.textContent === '연결 다시 확인')!;
    retry.click(); await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(stores.length, 1); assert.equal(stores[0]!.expectedAccountId, '1');
    assert.equal(document.getElementById('codearchive-connection-notice'), null); assert.equal(adapter.hasPendingSubmissionAttempt(), false);
  } finally { Object.assign(globalThis, previous); }
});

test('an old storage failure cannot replace the newer attempt connection state or pause its upload', async () => {
  const { document } = parseHTML('<html><body><div class="challenge-title">Synthetic</div><nav class="challenge-nav"><span class="dropdown-toggle">Java</span></nav><textarea id="code" name="code">class Synthetic {}</textarea><button id="submit-code">제출</button></body></html>');
  const previous = { Element: globalThis.Element, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, { Element: document.defaultView!.Element, MutationObserver: document.defaultView!.MutationObserver });
  const adapter = new ProgrammersAdapter(document, new URL('https://school.programmers.co.kr/learn/courses/30/lessons/72413') as unknown as Location);
  let release!: () => void, stores = 0;
  const oldRequest = new Promise<void>(resolve => { release = resolve; });
  const submit = () => {
    (document.getElementById('submit-code') as HTMLButtonElement).click();
    document.querySelector('#modal-dialog')?.remove();
    document.body.insertAdjacentHTML('beforeend', '<div id="modal-dialog" class="modal show" role="dialog" aria-modal="true"><h4 class="modal-title">정답입니다!</h4></div>');
  };
  try {
    startCapture(adapter, document, async value => {
      const message = value as { type: string };
      if (message.type === 'CHECK_CAPTURE_OWNER') return { status: 'READY', accountId: '1' };
      if (message.type === 'STORE_CAPTURE' && ++stores === 1) { await oldRequest; return { ok: false, error: 'ACCOUNT_CHANGED' }; }
      return { ok: true };
    });
    submit(); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(stores, 1);
    submit(); await new Promise(resolve => setTimeout(resolve, 30)); release();
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(stores, 2); assert.equal(adapter.hasPendingSubmissionAttempt(), false);
    assert.equal(document.getElementById('codearchive-connection-notice'), null);
    assert.equal(document.documentElement.getAttribute('data-codearchive-capture-stage'), 'store-acknowledged');
  } finally { release(); Object.assign(globalThis, previous); }
});
