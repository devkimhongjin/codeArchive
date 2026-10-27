import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseHTML } from 'linkedom';

test('popup footer links to the GitHub repository in a new tab beside the build label', () => {
  const { document } = parseHTML(readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8'));
  const footer = document.querySelector('#popup-footer')!;
  const link = footer.querySelector<HTMLAnchorElement>('a#github-link')!;
  assert.equal(link.getAttribute('href'), 'https://github.com/devkimhongjin/codeArchive');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.getAttribute('rel') ?? '', /noopener/);
  assert.ok(link.getAttribute('aria-label'));
  assert.equal(footer.lastElementChild, link, 'the link sits at the bottom-right after the build label');
  assert.ok(footer.querySelector('#build-label'));
});

test('the manual pending sync explains what happened in the user\'s terms', async () => {
  const { pendingSyncMessage } = await import('../src/popupView');
  assert.equal(pendingSyncMessage({ ok: true, summary: { status: 'DONE', sent: 2, rejected: 0, remaining: 0 } }), '2개 전송 완료');
  assert.equal(pendingSyncMessage({ ok: true, summary: { status: 'DONE', sent: 1, rejected: 1, remaining: 1, rejection: 'bad unit' } }), '1개 전송 완료 · 1개는 서버가 받지 않아 남겨 두었어요 (사유: bad unit)');
  assert.match(pendingSyncMessage({ ok: true, summary: { status: 'RECONNECT_REQUIRED', sent: 0, rejected: 0, remaining: 3 } }), /대시보드를 열면 연결이 갱신/);
  assert.match(pendingSyncMessage({ ok: true, summary: { status: 'LOGIN_REQUIRED', sent: 0, rejected: 0, remaining: 3 } }), /다시 로그인/);
  assert.match(pendingSyncMessage({ ok: true, summary: { status: 'STOPPED', sent: 1, rejected: 0, remaining: 2, error: 'OFFLINE' } }), /^1개 전송 완료 서버에 연결하지 못했어요/);
  assert.match(pendingSyncMessage(null), /시작하지 못했어요/);
  const { document } = parseHTML(readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8'));
  assert.equal(document.querySelector('#sync-pending')?.textContent, '지금 동기화');
});
