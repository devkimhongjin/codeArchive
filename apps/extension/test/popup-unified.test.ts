import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { mountPopup } from '../src/popupView';
test('popup opens its bundled management page and does not require a PC app', async () => {
  const { document } = parseHTML(readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8'));
  mountPopup(document, { load: async () => ({ pendingCount: 2, settings: {} }), copy: async () => {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.querySelector<HTMLElement>('#popup-content')!.hidden, false);
  assert.equal(document.querySelector('#desktop-entry'), null);
  assert.equal(document.querySelector('.dashboard-link')?.getAttribute('href'), 'dashboard.html');
  assert.equal(document.querySelector('.dashboard-link')?.getAttribute('target'), '_blank');
  assert.equal(document.querySelector('#pending-count'), null);
});
