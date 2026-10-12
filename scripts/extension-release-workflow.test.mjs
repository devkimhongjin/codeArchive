import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const workflow = readFileSync(new URL('../.github/workflows/extension-release.yml', import.meta.url), 'utf8');
const publish = workflow.split('      - name: Publish GitHub release')[1];
assert.ok(publish, 'Publish step must exist');
const shell = publish.split('        run: |')[1].trimEnd().split(/\r?\n/).slice(1).map(line => line.slice(10)).join('\n');

function invocation(t, refType) {
  const cwd = mkdtempSync(join(tmpdir(), 'codearchive-release-workflow-'));
  t.after(() => {
    if (!resolve(cwd).startsWith(resolve(tmpdir()) + sep)) throw new Error('Temporary cleanup escaped its directory');
    rmSync(cwd, { recursive: true, force: true });
  });
  mkdirSync(join(cwd, 'docs/releases'), { recursive: true }); mkdirSync(join(cwd, 'release'));
  writeFileSync(join(cwd, 'docs/releases/extension-v1.0.1.md'), 'Synthetic release notes\n');
  writeFileSync(join(cwd, 'release/codearchive-extension-metadata.json'), '{}\n');
  const stub = `gh() { if [[ "$1" == "release" && "$2" == "view" ]]; then return 1; fi; printf '%s\\n' "$@" > "$CLI_CAPTURE"; }\n`;
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  execFileSync(bash, ['-s'], { cwd, input: stub + shell, encoding: 'utf8', env: { ...process.env,
    GH_TOKEN: 'synthetic-only', VERSION: '1.0.1', GITHUB_REF_TYPE: refType, GITHUB_SHA: 'a'.repeat(40), CLI_CAPTURE: join(cwd, 'arguments').replaceAll('\\', '/') } });
  return readFileSync(join(cwd, 'arguments'), 'utf8').trim().split(/\r?\n/);
}

test('existing release tag explicitly records master instead of the repository default branch', t => {
  const args = invocation(t, 'tag');
  assert.deepEqual(args.slice(0, 3), ['release', 'create', 'extension-v1.0.1']);
  assert.ok(args.includes('--verify-tag'));
  assert.ok(args.includes('--target'), 'GitHub must not choose the repository default branch');
  assert.equal(args[args.indexOf('--target') + 1], 'master');
});

test('manual master release pins the verified commit even if master advances during execution', t => {
  const args = invocation(t, 'branch');
  assert.equal(args[args.indexOf('--target') + 1], 'a'.repeat(40));
  assert.ok(!args.includes('--verify-tag'));
});
