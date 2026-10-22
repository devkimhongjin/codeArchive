import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { mountSiteSync } from '../src/siteSyncView';
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
