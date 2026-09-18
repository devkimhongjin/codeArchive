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
  mountPopup(document, { copy: async () => {}, load: () => {
    if (first) { first = false; return new Promise(done => { resolve = done; }); }
    return Promise.resolve(next);
  }});
  assert.equal(document.querySelector('#pending-count')!.textContent, '—');
  resolve({ pendingCount: 0, settings: {} }); await settle();
  assert.equal(document.querySelector('#pending-count')!.textContent, '0');
  assert.equal(document.querySelector('#build-label')!.textContent, 'vdev · dev+source-unknown');
  assert.equal(document.querySelector('#updated-label')!.textContent, 'Updated dev');
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
test('popup follows the Figma action hierarchy without legacy connection diagnostics', async () => {
  const { document } = parseHTML(html);
  mountPopup(document, { load: async () => ({ pendingCount: 0, settings: {} }), copy: async () => {} });
  await settle();
  assert.equal(document.querySelector('.connection'), null);
  assert.equal(document.querySelector('#copy-id'), null);
  assert.equal(document.querySelector('#capture-card .dashboard-link')?.getAttribute('href'), 'https://codearchive-dashboard-beta.netlify.app');
  assert.equal(document.querySelector('#recent-card .recent-archive-link')?.getAttribute('href'), 'archive.html');
  assert.equal(document.querySelector('.bottom-actions'), null);
  assert.equal(document.querySelector('.note'), null);
});

test('popup renders at most the newest preview records and links them to the local archive', async () => {
  const { document } = parseHTML(html);
  const makeCapture = (captureId: string, observedAt: string, syncState: 'PENDING' | 'SYNCED', githubCommitStatus?: 'SUCCEEDED') => ({
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
    syncState,
    ...(githubCommitStatus ? { githubCommitStatus } : {})
  });
  const captures = [
    makeCapture('11111111-1111-4111-8111-111111111111', '2026-09-15T10:00:00.000Z', 'PENDING'),
    { ...makeCapture('22222222-2222-4222-8222-222222222222', '2026-09-15T11:00:00.000Z', 'SYNCED', 'SUCCEEDED'), executionTime: 0, memoryValue: 0, memoryUnit: 'KB' },
    makeCapture('33333333-3333-4333-8333-333333333333', '2026-09-15T12:00:00.000Z', 'PENDING'),
    makeCapture('44444444-4444-4444-8444-444444444444', '2026-09-15T13:00:00.000Z', 'SYNCED')
  ];
  mountPopup(document, {
    copy: async () => {},
    load: async () => ({ pendingCount: 2, settings: {}, recentCaptures: captures })
  });
  await settle();
  assert.equal(document.querySelectorAll('.recent-item').length, 3);
  assert.match(document.querySelector('.recent-list')!.textContent!, /Problem 1111/);
  assert.doesNotMatch(document.querySelector('.recent-list')!.textContent!, /Problem 4444/);
  assert.equal(document.querySelector('.recent-title')!.getAttribute('href'), 'archive.html#11111111-1111-4111-8111-111111111111');
  assert.match(document.querySelector('.recent-list')!.textContent!, /GitHub 완료/);
  assert.match(document.querySelector('.recent-list')!.textContent!, /실행 시간 0 ms · 메모리 0 KB/);
  assert.match(document.querySelector('.recent-list')!.textContent!, /실행 시간 정보 없음 · 메모리 정보 없음/);
  assert.match(document.querySelector('.recent-list')!.textContent!, /풀이 시간/);
  assert.equal(document.querySelector('.recent-archive-link')!.textContent?.trim(), '로컬 저장 전체보기 ↗');
});

test('popup recent actions use a capture-specific privileged request without source in state', async () => {
  const { document } = parseHTML(html); const copied: string[] = []; const actions: string[] = [];
  mountPopup(document, {
    copy: async value => { copied.push(value); },
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

test('popup renders local captures before a remote GitHub status request settles', async () => {
  const { document } = parseHTML(html);
  mountPopup(document, {
    copy: async () => {},
    load: async () => ({
      pendingCount: 0,
      settings: {},
      recentCaptures: [{
        captureId: '11111111-1111-4111-8111-111111111111',
        platform: 'PROGRAMMERS',
        problemNumber: '1234',
        title: 'Local first',
        problemUrl: 'https://school.programmers.co.kr/learn/courses/30/lessons/1234',
        language: 'JavaScript',
        result: 'ACCEPTED',
        observedAt: '2026-09-18T00:00:00.000Z',
        solvedAt: '2026-09-18T00:00:00.000Z',
        syncState: 'SYNCED'
      }]
    }),
    loadGithubStatuses: async () => new Promise(() => undefined)
  });

  await settle();
  assert.match(document.querySelector('.recent-list')!.textContent!, /Local first/);
  assert.equal(document.querySelector('#status')!.textContent, '로컬 보관');
});

test('popup keeps automatic download as an independent device-local toggle', async () => {
  const { document } = parseHTML(html);
  const patches: Array<Record<string, boolean>> = [];
  mountPopup(document, {
    copy: async () => {},
    load: async () => ({ pendingCount: 0, settings: { autoDownloadEnabled: false }, recentCaptures: [] }),
    updateSettings: async patch => { patches.push(patch); return { ok: true }; }
  });
  await settle();

  const toggle = document.querySelector('#auto-download') as HTMLInputElement;
  assert.equal(toggle.disabled, false);
  toggle.checked = true;
  toggle.dispatchEvent(new document.defaultView!.Event('change'));
  await settle();

  assert.deepEqual(patches, [{ autoDownloadEnabled: true }]);
});
