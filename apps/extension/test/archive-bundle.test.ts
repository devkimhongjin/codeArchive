import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

const html = readFileSync(new URL('../src/archive.html', import.meta.url), 'utf8');

test('the browser archive bundle applies a selected Shiki palette to Java source', async () => {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../src/archive.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    define: {
      __CODEARCHIVE_VERSION__: '"0.2.0"',
      __CODEARCHIVE_BUILD_ID__: '"test"',
      __CODEARCHIVE_UPDATED_DATE__: '"test"'
    },
    logLevel: 'silent'
  });
  assert.doesNotMatch(bundled.outputFiles[0]!.text, /WebAssembly\.instantiate|wasm-inlined/);
  const { document } = parseHTML(html);
  const capture = {
    captureId: '77777777-7777-4777-8777-777777777777',
    platform: 'JUNGOL',
    problemNumber: '1520',
    title: '계단 오르기',
    problemUrl: 'https://jungol.co.kr/problem/1520',
    language: 'Java',
    sourceCode: 'import java.io.*;\npublic class Main {}',
    result: 'ACCEPTED',
    observedAt: '2026-09-23T06:53:00.000Z',
    syncState: 'SYNCED'
  };
  runInNewContext(bundled.outputFiles[0]!.text, {
    document,
    chrome: { runtime: { sendMessage: async () => ({ captures: [capture], settings: { lightTheme: 'solarized-light', darkTheme: 'dracula' } }) } },
    WebAssembly: undefined,
    atob: undefined,
    TextDecoder,
    TextEncoder,
    URL,
    setTimeout,
    clearTimeout
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(document.querySelector('#archive-count')?.textContent, '1', document.querySelector('#archive-error')?.textContent ?? '');
  const source = document.querySelector<HTMLElement>('.source-code');
  assert.ok(source);
  assert.equal(source.isConnected, true);
  const readTheme = (): string | undefined => source.dataset.shikiTheme;
  const deadline = Date.now() + 5_000;
  while (readTheme() !== 'solarized-light' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(readTheme(), 'solarized-light');
  assert.notEqual(source.style.backgroundColor, '');
  assert.ok(source.querySelector('span[style]'));
  const lightBackground = source.style.backgroundColor;
  const select = document.querySelector<HTMLSelectElement>('.capture-code-theme')!;
  select.querySelector('option[value="solarized-light"]')!.removeAttribute('selected');
  select.querySelector('option[value="dracula"]')!.setAttribute('selected', '');
  select.dispatchEvent(new document.defaultView!.Event('change'));
  const darkDeadline = Date.now() + 5_000;
  while (readTheme() !== 'dracula' && Date.now() < darkDeadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(readTheme(), 'dracula');
  assert.notEqual(source.style.backgroundColor, lightBackground);
});
