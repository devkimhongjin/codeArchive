import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { masterReleaseSource } from './release-source.mjs';

test('only master dispatches and tags on its first-parent history may release', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'codearchive-release-source-'));
  t.after(() => {
    if (!resolve(cwd).startsWith(resolve(tmpdir()) + sep)) throw new Error('Test cleanup escaped the temporary directory.');
    rmSync(cwd, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-b', 'master'); git('config', 'user.name', 'Release Test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(cwd, 'source.txt'), 'initial'); git('add', '.'); git('commit', '-m', 'Initial master');
  const master = git('rev-parse', 'HEAD');
  git('tag', '-a', 'desktop-v0.1.1', '-m', 'Release'); git('tag', 'extension-v0.3.0');
  git('checkout', '-b', 'develop');
  writeFileSync(join(cwd, 'feature.txt'), 'feature'); git('add', '.'); git('commit', '-m', 'Feature');
  const feature = git('rev-parse', 'HEAD'); git('tag', 'desktop-v0.1.2');
  git('checkout', 'master'); git('merge', '--no-ff', 'develop', '-m', 'Promote to master');
  const promoted = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/master', promoted);
  const check = (sha, ref, event = 'push', kind = 'desktop') => masterReleaseSource({ cwd, sha, ref, event, kind });
  assert.deepEqual(check(promoted, 'refs/heads/master', 'workflow_dispatch'), { branch: 'master', commit: promoted });
  git('checkout', '--detach', master);
  assert.deepEqual(check(master, 'refs/tags/desktop-v0.1.1'), { branch: 'master', commit: master });
  assert.equal(check(master, 'refs/tags/extension-v0.3.0', 'push', 'extension').branch, 'master');
  assert.throws(() => check(master, 'refs/heads/develop', 'workflow_dispatch'), /master workflow/);
  assert.throws(() => check(master, 'refs/tags/desktop-v0.1.2'), /tag differs/);
  assert.throws(() => check(promoted, 'refs/heads/master', 'workflow_dispatch'), /Checked-out source/);
  assert.throws(() => check(master, 'refs/tags/desktop-v0.1.1', 'pull_request'), /master workflow/);
  git('checkout', '--detach', feature);
  assert.throws(() => check(feature, 'refs/tags/desktop-v0.1.2'), /first-parent/);
});
