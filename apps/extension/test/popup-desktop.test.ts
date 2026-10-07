import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { mountDesktopConnection } from '../src/popupDesktopView';
const html = readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
test('popup gates actions on connection, hides pairing when connected, and returns on disconnect', async () => {
  const { document } = parseHTML(html);
  let connected = false;
  const view = mountDesktopConnection(document, { send: async () => ({ connected }), schedule: () => {} });
  await settle();
  assert.equal(document.querySelector<HTMLElement>('#popup-content')!.hidden, true);
  assert.equal(document.querySelector<HTMLElement>('#desktop-entry')!.hidden, false);
  assert.equal(document.querySelector('#desktop-entry .dashboard-link')?.getAttribute('href'), 'codearchive://app/open');
  connected = true; await view.refresh();
  assert.equal(document.querySelector<HTMLElement>('#popup-content')!.hidden, false);
  assert.equal(document.querySelector<HTMLElement>('#desktop-entry')!.hidden, true);
  assert.equal(document.querySelector('#capture-card .dashboard-link')?.getAttribute('href'), 'codearchive://app/open');
  connected = false; await view.refresh();
  assert.equal(document.querySelector<HTMLElement>('#popup-content')!.hidden, true);
  assert.equal(document.querySelector('#extension-update-check'), null);
});
test('connection lookup failure keeps actions hidden and permits a later successful refresh', async () => {
  const { document } = parseHTML(html);
  let fail = true;
  const view = mountDesktopConnection(document, { send: async () => { if (fail) throw Error('offline'); return { connected: true }; }, schedule: () => {} });
  await settle();
  assert.equal(document.querySelector<HTMLElement>('#popup-content')!.hidden, true);
  assert.match(document.querySelector('#desktop-status')!.textContent!, /확인하지 못했습니다/);
  fail = false; await view.refresh();
  assert.equal(document.querySelector<HTMLElement>('#desktop-entry')!.hidden, true);
});
test('popup shows pairing authentication errors and clears the message after reconnect', async () => {
  const { document } = parseHTML(html);
  let connected = false;
  const message = 'PC 앱과 확장의 연결 정보가 일치하지 않습니다.';
  const view = mountDesktopConnection(document, { send: async () => ({ connected, error: message }), schedule: () => {} });
  await settle();
  assert.equal(document.querySelector('#desktop-feedback')!.textContent, message);
  assert.equal(document.querySelector<HTMLElement>('#popup-content')!.hidden, true);
  connected = true;
  await view.refresh();
  assert.equal(document.querySelector('#desktop-feedback')!.textContent, '');
  assert.equal(document.querySelector<HTMLElement>('#popup-content')!.hidden, false);
});
test('invalid pairing feedback survives the immediate status refresh and later polls', async () => {
  const { document, window } = parseHTML(html);
  let connected = false;
  const failure = '연결 코드가 만료됐거나 올바르지 않습니다.';
  const view = mountDesktopConnection(document, {
    send: async message => message.type === 'DESKTOP_PAIR' ? { error: failure } : { connected, error: 'PC 앱에서 연결 코드를 발급해 주세요.' },
    schedule: () => {},
  });
  await settle();
  document.querySelector<HTMLInputElement>('#desktop-pair-code')!.value = '123456';
  document.querySelector('#desktop-pair-form')!.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await settle();
  assert.equal(document.querySelector('#desktop-feedback')!.textContent, failure);
  await view.refresh();
  assert.equal(document.querySelector('#desktop-feedback')!.textContent, failure);
  connected = true;
  await view.refresh();
  assert.equal(document.querySelector('#desktop-feedback')!.textContent, '');
});
