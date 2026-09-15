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
  assert.equal(document.querySelector('a.primary')!.getAttribute('href'), 'http://localhost:5173');
});
