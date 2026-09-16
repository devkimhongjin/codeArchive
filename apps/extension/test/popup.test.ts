import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { mountPopup } from '../src/popupView';
const html = readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
test('popup distinguishes loading, empty, pending and storage failure with retry', async () => {
  const { document } = parseHTML(html);
  let resolve!: (value: unknown) => void;
  let next: unknown = { pendingCount: 3, settings: {} };
  let first = true;
  mountPopup(document, { extensionId: 'a'.repeat(32), copy: async () => {}, load: () => {
    if (first) { first = false; return new Promise(done => { resolve = done; }); }
    return Promise.resolve(next);
  }});
  assert.equal(document.querySelector('#pending-count')!.textContent, '—');
  resolve({ pendingCount: 0, settings: {} }); await settle();
  assert.equal(document.querySelector('#pending-count')!.textContent, '0');
  (document.querySelector('#refresh') as HTMLButtonElement).click(); await settle();
  assert.equal(document.querySelector('#pending-count')!.textContent, '3');
  next = { pendingCount: 0, settings: null, error: 'STORAGE_ERROR' };
  (document.querySelector('#refresh') as HTMLButtonElement).click(); await settle();
  assert.equal(document.querySelector('#pending-count')!.textContent, '—');
  assert.equal((document.querySelector('#error') as HTMLElement).hidden, false);
  next = { pendingCount: 1, settings: {} };
  (document.querySelector('#refresh') as HTMLButtonElement).click(); await settle();
  assert.equal((document.querySelector('#error') as HTMLElement).hidden, true);
  assert.equal(document.querySelector('#pending-count')!.textContent, '1');
});
test('popup copies actual extension ID and provides a manual fallback', async () => {
  const { document } = parseHTML(html);
  let copied = ''; let fail = false;
  mountPopup(document, { extensionId: 'a'.repeat(32), load: async () => ({ pendingCount: 0, settings: {} }), copy: async text => { if(fail) throw Error(); copied = text; }});
  (document.querySelector('#copy-id') as HTMLButtonElement).click(); await settle();
  assert.equal(copied, 'a'.repeat(32));
  fail = true;
  (document.querySelector('#copy-id') as HTMLButtonElement).click(); await settle();
  assert.match(document.querySelector('#copy-status')!.textContent!, /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.equal(document.querySelector('a.primary')!.getAttribute('href'), 'https://codearchive-dashboard-beta.netlify.app');
});

test('popup renders at most the newest preview records and links them to the local archive', async () => {
  const { document } = parseHTML(html);
  const makeCapture = (captureId: string, observedAt: string, syncState: 'PENDING' | 'SYNCED') => ({
    captureId,
    platform: 'SWEA',
    problemNumber: captureId.slice(0, 4),
    title: `Problem ${captureId.slice(0, 4)}`,
    problemUrl: 'https://swexpertacademy.com/problem/1',
    language: 'Java',
    sourceCode: 'class Solution {}',
    result: 'ACCEPTED',
    observedAt,
    solvedAt: observedAt,
    syncState
  });
  const captures = [
    makeCapture('11111111-1111-4111-8111-111111111111', '2026-09-15T10:00:00.000Z', 'PENDING'),
    makeCapture('22222222-2222-4222-8222-222222222222', '2026-09-15T11:00:00.000Z', 'SYNCED'),
    makeCapture('33333333-3333-4333-8333-333333333333', '2026-09-15T12:00:00.000Z', 'PENDING'),
    makeCapture('44444444-4444-4444-8444-444444444444', '2026-09-15T13:00:00.000Z', 'SYNCED')
  ];
  mountPopup(document, {
    extensionId: 'a'.repeat(32),
    copy: async () => {},
    load: async () => ({ pendingCount: 2, settings: {}, recentCaptures: captures })
  });
  await settle();
  assert.equal(document.querySelectorAll('.recent-item').length, 3);
  assert.match(document.querySelector('.recent-list')!.textContent!, /Problem 1111/);
  assert.doesNotMatch(document.querySelector('.recent-list')!.textContent!, /Problem 4444/);
  assert.equal(document.querySelector('.recent-title')!.getAttribute('href'), 'archive.html#11111111-1111-4111-8111-111111111111');
  assert.equal(document.querySelector('.archive-link')!.textContent?.trim(), '로컬 저장 전체보기 ↗');
});

test('popup recent actions use a capture-specific privileged request without source in state', async () => {
  const { document } = parseHTML(html); const copied: string[] = []; const actions: string[] = [];
  mountPopup(document, {
    extensionId: 'a'.repeat(32), copy: async value => { copied.push(value); },
    copyCapture: async id => { actions.push(`copy:${id}`); return { ok: true, text: 'private source' }; },
    downloadCapture: async id => { actions.push(`download:${id}`); return { ok: true }; },
    load: async () => ({ pendingCount: 0, settings: {}, recentCaptures: [{ captureId: '11111111-1111-4111-8111-111111111111', platform: 'SWEA', problemNumber: '1', title: 'one', problemUrl: 'https://example.test', language: 'Java', result: 'ACCEPTED', observedAt: '2026-01-01T00:00:00.000Z', solvedAt: '2026-01-01T00:00:00.000Z', syncState: 'PENDING' }] })
  });
  await settle();
  assert.equal(document.querySelector('.recent-list')!.textContent!.includes('private source'), false);
  (document.querySelector('[aria-label="one 코드 복사"]') as HTMLButtonElement).click(); await settle();
  (document.querySelector('[aria-label="one 코드 다운로드"]') as HTMLButtonElement).click(); await settle();
  assert.deepEqual(actions, ['copy:11111111-1111-4111-8111-111111111111', 'download:11111111-1111-4111-8111-111111111111']);
  assert.deepEqual(copied, ['private source']);
});
