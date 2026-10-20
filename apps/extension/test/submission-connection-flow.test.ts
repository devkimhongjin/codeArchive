import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { startCapture } from '../src/content';
import { ProgrammersAdapter } from '../src/adapters/programmers';

test('an accepted submission is stored at once without any connection prompt on the site', async () => {
  const { document } = parseHTML('<html><body><div class="challenge-title">Synthetic</div><nav class="challenge-nav"><span class="dropdown-toggle">Java</span></nav><textarea id="code" name="code">class Synthetic {}</textarea><button id="submit-code">제출</button></body></html>');
  const previous = { Element: globalThis.Element, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, { Element: document.defaultView!.Element, MutationObserver: document.defaultView!.MutationObserver });
  const adapter = new ProgrammersAdapter(document, new URL('https://school.programmers.co.kr/learn/courses/30/lessons/72413') as unknown as Location);
  let judgeClicks = 0; const messages: string[] = [];
  document.getElementById('submit-code')!.addEventListener('click', event => { assert.equal(event.defaultPrevented, false); judgeClicks++; });
  try {
    startCapture(adapter, document, async value => {
      const message = value as { type: string };
      messages.push(message.type);
      return message.type === 'STORE_CAPTURE' ? { ok: true, created: true, queued: true } : { ok: true };
    });
    (document.getElementById('submit-code') as HTMLButtonElement).click();
    document.body.insertAdjacentHTML('beforeend', '<div id="modal-dialog" class="modal show" role="dialog" aria-modal="true"><h4 class="modal-title">정답입니다!</h4></div>');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(judgeClicks, 1);
    assert.equal(messages.filter(type => type === 'STORE_CAPTURE').length, 1);
    assert.ok(!messages.some(type => type.startsWith('CHECK_CAPTURE')), 'the click must not wait on a connection check');
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.equal(adapter.hasPendingSubmissionAttempt(), false);
  } finally { Object.assign(globalThis, previous); }
});

test('a worker that cannot queue the capture never shows a page prompt', async () => {
  const { document } = parseHTML('<html><body><div class="challenge-title">Synthetic</div><nav class="challenge-nav"><span class="dropdown-toggle">Java</span></nav><textarea id="code" name="code">class Synthetic {}</textarea><button id="submit-code">제출</button></body></html>');
  const previous = { Element: globalThis.Element, MutationObserver: globalThis.MutationObserver };
  Object.assign(globalThis, { Element: document.defaultView!.Element, MutationObserver: document.defaultView!.MutationObserver });
  const adapter = new ProgrammersAdapter(document, new URL('https://school.programmers.co.kr/learn/courses/30/lessons/72413') as unknown as Location);
  try {
    startCapture(adapter, document, async value => (value as { type: string }).type === 'STORE_CAPTURE' ? { ok: false, error: 'LOGIN_REQUIRED' } : { ok: true });
    (document.getElementById('submit-code') as HTMLButtonElement).click();
    document.body.insertAdjacentHTML('beforeend', '<div id="modal-dialog" class="modal show" role="dialog" aria-modal="true"><h4 class="modal-title">정답입니다!</h4></div>');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.equal(document.documentElement.getAttribute('data-codearchive-capture-stage'), 'store-unavailable');
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
