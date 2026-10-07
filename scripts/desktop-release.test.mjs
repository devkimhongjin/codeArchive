import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { validateManifest } = createRequire(import.meta.url)('../apps/desktop/src/updater.cjs');

test('master release signing emits an update accepted by the preceding app version', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'codearchive-release-signing-'));
  t.after(() => {
    if (!resolve(cwd).startsWith(resolve(tmpdir()) + sep)) throw new Error('Test cleanup escaped the temporary directory.');
    rmSync(cwd, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  mkdirSync(join(cwd, 'apps/desktop/src'), { recursive: true });
  mkdirSync(join(cwd, 'docs/releases'), { recursive: true });
  writeFileSync(join(cwd, 'apps/desktop/package.json'), JSON.stringify({ version: '0.1.1' }));
  writeFileSync(join(cwd, 'apps/desktop/src/update-public-key.pem'), publicKey);
  writeFileSync(join(cwd, 'docs/releases/desktop-v0.1.1.md'), '# CodeArchive Desktop v0.1.1\n\nSynthetic fixture.');
  const artifact = 'test installer bytes'; writeFileSync(join(cwd, 'installer.exe'), artifact);
  git('init', '-b', 'master'); git('config', 'user.name', 'Release Test'); git('config', 'user.email', 'test@example.invalid');
  git('add', '.'); git('commit', '-m', 'Release fixture');
  const sha = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/master', sha);
  const env = { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/master', GITHUB_SHA: sha, CODEARCHIVE_DESKTOP_UPDATE_KEY: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const script = fileURLToPath(new URL('./desktop-release.mjs', import.meta.url));
  execFileSync(process.execPath, [script, 'installer.exe', 'update.json'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const update = JSON.parse(readFileSync(join(cwd, 'update.json'), 'utf8'));
  const accepted = validateManifest(update, publicKey, '0.1.0');
  assert.equal(accepted.version, '0.1.1');
  assert.deepEqual(accepted.source, { branch: 'master', commit: sha });
  assert.equal(accepted.artifact.sha256, createHash('sha256').update(artifact).digest('hex'));
  assert.throws(() => execFileSync(process.execPath, [script, 'installer.exe', 'rejected.json'], { cwd, env: { ...env, GITHUB_REF: 'refs/heads/develop' }, stdio: ['ignore', 'pipe', 'pipe'] }));
});
