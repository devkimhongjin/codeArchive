import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EXTENSION_CANDIDATES, EXTENSION_ID, LEGACY_EXTENSION_ID } from '../../dashboard/src/extensionConfig';
import { LEGACY_LOCAL_EXTENSION_ID, STORE_EXTENSION_ID } from '../../../shared/publicApiOrigin';

test('development manifest key retains the local identity while the web fallback selects the Store identity', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  const hex = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  const id = [...hex].map(digit => String.fromCharCode(97 + parseInt(digit, 16))).join('');
  assert.equal(id, LEGACY_LOCAL_EXTENSION_ID);
  assert.equal(LEGACY_EXTENSION_ID, LEGACY_LOCAL_EXTENSION_ID);
  assert.equal(EXTENSION_ID, STORE_EXTENSION_ID);
  assert.deepEqual(EXTENSION_CANDIDATES, [STORE_EXTENSION_ID, LEGACY_LOCAL_EXTENSION_ID]);
  assert.deepEqual(manifest.externally_connectable.matches, [
    'https://codearchive-dashboard-beta.netlify.app/*',
    'http://localhost:5173/*'
  ]);
  assert.deepEqual(manifest.host_permissions, [
    'https://swexpertacademy.com/*',
    'https://school.programmers.co.kr/*',
    'https://jungol.co.kr/*',
    'https://api.github.com/*',
    'https://codearchive-api-stg-e3q54l32da-as.a.run.app/*',
    'https://codearchive-dashboard-beta.netlify.app/*',
    'http://localhost:5173/*'
  ]);
  const isolated = manifest.content_scripts.find((script: { world?: string }) => script.world === 'ISOLATED');
  assert.ok(isolated);
  assert.ok(isolated.matches.includes('https://swexpertacademy.com/main/code/problem/problemDetail.do*'));
  assert.ok(isolated.matches.includes('https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do*'));
  assert.ok(isolated.matches.includes('https://jungol.co.kr/*'));
  assert.ok(isolated.matches.includes('https://school.programmers.co.kr/*'));
  const mainWorld = manifest.content_scripts.find((script: { world?: string }) => script.world === 'MAIN');
  assert.ok(mainWorld?.matches.includes('https://jungol.co.kr/*'), 'list-to-problem SPA navigation must retain the source listener');
  assert.ok(mainWorld?.matches.includes('https://school.programmers.co.kr/*'), 'list-to-lesson SPA navigation must retain the source listener');
});

test('extension pages keep the default CSP without a WebAssembly exception', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(manifest.content_security_policy, undefined);
});
