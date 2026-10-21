import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseHTML } from 'linkedom';

test('popup footer links to the GitHub repository in a new tab beside the build label', () => {
  const { document } = parseHTML(readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8'));
  const footer = document.querySelector('#popup-footer')!;
  const link = footer.querySelector<HTMLAnchorElement>('a#github-link')!;
  assert.equal(link.getAttribute('href'), 'https://github.com/devkimhongjin/codeArchive');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.getAttribute('rel') ?? '', /noopener/);
  assert.ok(link.getAttribute('aria-label'));
  assert.equal(footer.lastElementChild, link, 'the link sits at the bottom-right after the build label');
  assert.ok(footer.querySelector('#build-label'));
});
