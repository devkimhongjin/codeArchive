import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { mountSiteSync, type SiteSyncPage } from '../src/siteSyncView';
import { jungolSyncPage } from '../src/siteSyncPages';

const captureId = '00000000-0000-4000-8000-000000000001';
const row = (id: string, result = '정답 <span>100점</span>') => `<tr><td data-col="번호"><span class="sl-id">${id}</span></td>
  <td data-col="제출자"><a href="/account/9">mine</a></td><td data-col="문제"><a href="/problem/2000">Fixture #2000</a></td>
  <td data-col="결과">${result}</td><td data-col="코드 길이">5<span>B</span></td><td data-col="언어"><a href="?sid=${id}">Java 8</a></td></tr>`;
const tick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

function fixture(rows: string) {
  const { document } = parseHTML(`<html><head></head><body><a class="crumb" href="/account/9">@mine</a><a href="/account/9/edit">정보 수정</a>
    <a class="active" href="/account/9/submission">제출현황</a><table>${rows}</table></body></html>`);
  const location = new URL('https://jungol.co.kr/account/9/submission') as unknown as Location;
  return { document, location };
}
const controls = (document: Document, id: string) => {
  const host = [...document.querySelectorAll<HTMLElement>('.codearchive-sync-host')].find(node => node.dataset.codearchiveSyncId === id)!;
  const box = host.shadowRoot!.querySelector<HTMLElement>('.codearchive-sync')!;
  const [sync, commit] = [...box.querySelectorAll<HTMLButtonElement>('button')];
  return { host, box, sync: sync!, commit: commit!, state: box.querySelector('.codearchive-sync-state')!.textContent };
};

test('accepted own rows get sync and commit buttons enabled only when each action applies', async () => {
  const { document, location } = fixture(row('2001') + row('2002') + row('2003', '오답 <span>0점</span>'));
  const sent: Array<{ type: string; captureIds?: string[]; rows?: Array<{ submissionId: string }> }> = [];
  let commitState = 'NONE';
  const send = async (message: unknown) => {
    const value = message as typeof sent[number]; sent.push(value);
    if (value.type === 'SITE_SYNC_STATUS') return { ok: true, githubReady: true, problems: [], rows: value.rows!.map(item => item.submissionId === '2001'
      ? { submissionId: '2001', state: 'REGISTERED', captureId, commit: commitState } : { submissionId: item.submissionId, state: 'UNREGISTERED' }) };
    if (value.type === 'SITE_SYNC_COMMIT') { commitState = 'PENDING'; return { ok: true, states: { [captureId]: 'PENDING' } }; }
    return { ok: false };
  };
  const handle = mountSiteSync(document, jungolSyncPage(document, location, send), send);
  await tick();
  assert.deepEqual(sent[0]!.rows!.map(item => item.submissionId), ['2001', '2002'], 'a wrong answer is not offered');
  assert.equal(document.querySelectorAll('.codearchive-sync-host').length, 2);
  assert.equal(document.querySelector('td[data-col="결과"]')!.textContent!.replace(/\s+/g, ' ').trim(), '정답 100점', 'the site cell text is unchanged');
  const registered = controls(document, '2001'), missing = controls(document, '2002');
  assert.equal(registered.sync.disabled, true); assert.equal(registered.commit.disabled, false); assert.equal(registered.state, '등록됨');
  assert.equal(missing.sync.disabled, false); assert.equal(missing.commit.disabled, true); assert.equal(missing.state, '미등록');

  // The site opens the submission detail on row click; our controls must not.
  let rowClicks = 0;
  registered.host.closest('tr')!.addEventListener('click', () => { rowClicks++; });
  registered.commit.click();
  await tick();
  assert.equal(rowClicks, 0);
  assert.deepEqual(sent.find(item => item.type === 'SITE_SYNC_COMMIT')!.captureIds, [captureId]);
  const after = controls(document, '2001');
  assert.equal(after.commit.disabled, true, 'a pending commit cannot be requested again');
  assert.equal(after.state, '커밋 요청됨');
  handle.dispose();
  assert.equal(document.querySelectorAll('.codearchive-sync-host').length, 0);
});

test('without a GitHub target or a signed-in extension the controls stay disabled with the reason', async () => {
  for (const [status, expected] of [
    [{ ok: true, githubReady: false, problems: [], rows: [{ submissionId: '2001', state: 'REGISTERED', captureId, commit: 'NONE' }] }, '등록됨'],
    [{ ok: false, error: 'LOGIN_REQUIRED' }, 'CodeArchive 로그인 필요']
  ] as const) {
    const { document, location } = fixture(row('2001'));
    const send = async () => status;
    const handle = mountSiteSync(document, jungolSyncPage(document, location, send), send);
    await tick();
    const view = controls(document, '2001');
    assert.equal(view.sync.disabled, true); assert.equal(view.commit.disabled, true); assert.equal(view.state, expected);
    handle.dispose();
  }
});

test('Jungol rows read their exact time from the hover tooltip so a live capture can match', async () => {
  const { parseJungolKstTimestamp } = await import('../src/historicalJungol');
  assert.equal(parseJungolKstTimestamp('2026. 10. 20. 오후 3:12:05'), '2026-10-20T06:12:05.000Z');
  assert.equal(parseJungolKstTimestamp('2026. 10. 20. 오전 12:00:00'), '2026-10-19T15:00:00.000Z');
  assert.equal(parseJungolKstTimestamp('10월 20일'), null);
  const timed = row('2001').replace('</tr>', '<td data-col="시각"><div role="button" aria-expanded="false"><div class="target"><span class="time">5분 전</span></div></div></td></tr>');
  const { document, location } = fixture(timed);
  const trigger = document.querySelector<HTMLElement>('td[data-col="시각"] [role="button"]')!;
  let clicks = 0;
  trigger.addEventListener('click', () => { clicks++; });
  trigger.addEventListener('mouseenter', () => setTimeout(() => {
    trigger.setAttribute('aria-expanded', 'true');
    const paper = document.createElement('div'); paper.className = 'paper'; paper.innerHTML = '<div class="content">2026. 10. 20. 오후 3:12:05</div>'; trigger.append(paper);
  }, 5));
  trigger.addEventListener('mouseleave', () => { trigger.setAttribute('aria-expanded', 'false'); trigger.querySelector('.paper')?.remove(); });
  const sent: Array<{ type: string; rows?: Array<{ submissionId: string; solvedAt?: string }> }> = [];
  const send = async (message: unknown) => { sent.push(message as typeof sent[number]); return { ok: true, githubReady: true, problems: [], rows: [{ submissionId: '2001', state: 'UNREGISTERED' }] }; };
  const previous = globalThis.MutationObserver; globalThis.MutationObserver = document.defaultView!.MutationObserver;
  try {
    const handle = mountSiteSync(document, jungolSyncPage(document, location, send), send);
    await tick(200);
    assert.equal(sent[0]!.rows![0]!.solvedAt, undefined, 'the first answer is shown without waiting for tooltips');
    assert.equal(sent[1]!.rows![0]!.solvedAt, '2026-10-20T06:12:05.000Z', 'an unregistered row is asked again with its exact time');
    assert.equal(clicks, 0, 'reading the time never clicks the row');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'the tooltip is closed again');
    handle.dispose();
  } finally { globalThis.MutationObserver = previous; }
});

test('returning to the list reads the server state again for submissions made in another window', async () => {
  const { document, location } = fixture(row('2001'));
  let registered = false, statusReads = 0;
  const send = async (message: unknown) => {
    if ((message as { type: string }).type !== 'SITE_SYNC_STATUS') return { ok: false };
    statusReads++;
    return { ok: true, githubReady: true, problems: [], rows: [registered ? { submissionId: '2001', state: 'REGISTERED', captureId, commit: 'SUCCEEDED' } : { submissionId: '2001', state: 'UNREGISTERED' }] };
  };
  const handle = mountSiteSync(document, jungolSyncPage(document, location, send), send);
  await tick();
  assert.equal(controls(document, '2001').state, '미등록');
  registered = true;
  document.defaultView!.dispatchEvent(new (document.defaultView!.Event)('focus'));
  await tick();
  assert.equal(statusReads, 2);
  assert.equal(controls(document, '2001').state, '커밋 완료');
  handle.dispose();
});

test('SWEA problem cards say what the server holds, keep sync available, and explain what sync does', async () => {
  const { document } = parseHTML('<html><body><div id="c1"></div><div id="c2"></div><div id="c3"></div></body></html>');
  const syncs: string[] = [];
  const card = (id: string, problemNumber: string) => ({ id, anchor: document.getElementById(id)!, problemNumber,
    async sync() { syncs.push(id); return { ok: true, message: '모두 등록됨' }; } });
  const page: SiteSyncPage = { platform: 'SWEA', targets: () => [card('c1', '1'), card('c2', '2'), card('c3', '3')] };
  const send = async () => ({ ok: true, githubReady: true, rows: [], problems: [
    { problemNumber: '1', registered: 3, uncommitted: [captureId] }, { problemNumber: '2', registered: 2, uncommitted: [] }] });
  const handle = mountSiteSync(document, page, send);
  await tick();
  const [first, second, third] = ['c1', 'c2', 'c3'].map(id => controls(document, id));
  const stateTitle = (item: ReturnType<typeof controls>) => item.box.querySelector<HTMLElement>('.codearchive-sync-state')!.title;

  // The count is the server's; it cannot show that the site holds nothing more.
  assert.equal(first!.state, '서버 3건 등록 · 1건 커밋 전 · 추가분은 동기화로 확인');
  assert.equal(second!.state, '서버 2건 등록 · 추가분은 동기화로 확인');
  assert.equal(third!.state, '서버에 없음 · 동기화로 등록');
  for (const item of [first!, second!, third!]) assert.equal(item.sync.disabled, false, 'a problem card always allows checking the site again');
  assert.equal(first!.commit.disabled, false); assert.equal(second!.commit.disabled, true);

  // Hover text states the limit of the number and what the button does.
  assert.match(stateTitle(second!), /3건|2건/);
  assert.match(stateTitle(second!), /더 있는지는 동기화를 눌러야 확인할 수 있습니다/);
  assert.match(stateTitle(third!), /정답 제출이 없습니다.*읽어 등록합니다/);
  assert.equal(second!.sync.title, '이 문제의 사이트 정답 제출을 읽어, 서버에 없는 것만 등록합니다');

  // The result of pressing sync replaces the explanation.
  second!.sync.click();
  await tick();
  const after = controls(document, 'c2');
  assert.deepEqual(syncs, ['c2']);
  assert.equal(after.state, '모두 등록됨');
  assert.equal(stateTitle(after), '');
  handle.dispose();
});

test('rows keep their own sync wording; only problem cards use the card wording', async () => {
  const { document, location } = fixture(row('2001') + row('2002'));
  const send = async (message: unknown) => ({ ok: true, githubReady: true, problems: [], rows: (message as { rows: Array<{ submissionId: string }> }).rows.map(item => ({ submissionId: item.submissionId, state: 'UNREGISTERED' })) });
  const handle = mountSiteSync(document, jungolSyncPage(document, location, send), send);
  await tick();
  const item = controls(document, '2001');
  assert.equal(item.state, '미등록');
  assert.equal(item.sync.title, 'CodeArchive 서버에 이 풀이를 등록합니다');
  assert.equal(item.box.querySelector<HTMLElement>('.codearchive-sync-state')!.title, '');
  handle.dispose();
});
