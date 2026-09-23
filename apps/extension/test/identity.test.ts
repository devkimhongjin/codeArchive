import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EXTENSION_ID } from '../../dashboard/src/extensionConfig';

test('public manifest key pins the same ID used by the dashboard', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  const hex = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  const id = [...hex].map(digit => String.fromCharCode(97 + parseInt(digit, 16))).join('');
  assert.equal(id, EXTENSION_ID);
  assert.deepEqual(manifest.externally_connectable.matches, [
    'https://codearchive-dashboard-beta.netlify.app/*',
    'http://localhost:5173/*'
  ]);
  assert.deepEqual(manifest.host_permissions, [
    'https://swexpertacademy.com/*',
    'https://school.programmers.co.kr/*',
    'https://jungol.co.kr/*',
    'https://codearchive-dashboard-beta.netlify.app/*',
    'http://localhost:5173/*'
  ]);
  const isolated = manifest.content_scripts.find((script: { world?: string }) => script.world === 'ISOLATED');
  assert.ok(isolated);
  assert.ok(isolated.matches.includes('https://swexpertacademy.com/main/code/problem/problemDetail.do*'));
  assert.ok(isolated.matches.includes('https://swexpertacademy.com/main/code/userProblem/userProblemDetail.do*'));
  assert.ok(isolated.matches.includes('https://jungol.co.kr/problem/*'));
});
