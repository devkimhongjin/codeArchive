import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';

// An animation naming undefined keyframes silently does nothing (e.g. a frozen spinner).
// Covers the popup and the dashboard bundled into the extension.
for (const dir of [new URL('../src/', import.meta.url), new URL('../../dashboard/src/', import.meta.url)]) {
  test(`only defined keyframes are referenced in ${dir.pathname.split('/').slice(-3, -1).join('/')}`, () => {
    const css = readdirSync(dir).filter(name => name.endsWith('.css')).map(name => readFileSync(new URL(name, dir), 'utf8')).join('\n');
    const defined = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(match => match[1]));
    const used = [...css.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)].map(match => (match[1] ?? '').trim().split(/\s+/)[0]).filter(name => name !== 'none');
    assert.ok(used.length > 0);
    assert.deepEqual(used.filter(name => !defined.has(name)), []);
  });
}
