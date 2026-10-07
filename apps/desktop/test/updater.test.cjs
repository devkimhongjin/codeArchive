const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign, createHash } = require('node:crypto');
const { mkdtemp, writeFile, rm, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const { EventEmitter } = require('node:events');
const { validateManifest, createUpdater, isNewer, runInstaller } = require('../src/updater.cjs');
async function cleanupTemporary(directory) {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Test cleanup escaped the temporary directory.');
  await rm(directory, { recursive: true, force: true });
}
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
function envelope(manifest) { return { manifest, signature: sign(null, Buffer.from(JSON.stringify(manifest)), keys.privateKey).toString('base64') }; }
const artifact = 'synthetic installer';
const manifest = { version: '0.2.0', source: { branch: 'master', commit: '1'.repeat(40) }, artifact: { url: 'https://github.com/devkimhongjin/codeArchive/releases/download/desktop-v0.2.0/CodeArchive-Setup-0.2.0.exe', sha256: createHash('sha256').update(artifact).digest('hex') } };
test('updates require the pinned signature, exact release URL and a newer version', () => {
  assert.deepEqual(validateManifest(envelope(manifest), publicKey, '0.1.0'), manifest);
  assert.equal(validateManifest(envelope(manifest), publicKey, '0.2.0'), null);
  const changed = envelope(manifest); changed.manifest = { ...manifest, version: '99.0.0' };
  assert.throws(() => validateManifest(changed, publicKey, '0.1.0'));
  assert.throws(() => validateManifest(envelope({ ...manifest, artifact: { ...manifest.artifact, url: 'https://evil.test/installer.exe' } }), publicKey, '0.1.0'));
  assert.equal(isNewer('0.10.0', '0.9.0'), true);
  assert.throws(() => validateManifest(envelope({ ...manifest, source: { ...manifest.source, branch: 'develop' } }), publicKey, '0.1.0'), /master/);
  assert.throws(() => validateManifest(envelope({ ...manifest, source: { branch: 'master', commit: 'not-a-commit' } }), publicKey, '0.1.0'), /master/);
  const missingSource = { ...manifest }; delete missingSource.source;
  assert.throws(() => validateManifest(envelope(missingSource), publicKey, '0.1.0'), /master/);
});
test('desktop releases are selected independently; a downloaded installer must match the signed hash', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'codearchive-updater-')); t.after(() => cleanupTemporary(directory));
  const publicKeyPath = join(directory, 'public.pem'); await writeFile(publicKeyPath, publicKey);
  let content = artifact;
  const fetcher = async url => {
    if (url.includes('api.github.com')) return Response.json([{ tag_name: 'extension-v9.0.0', prerelease: false }, { tag_name: 'desktop-v0.2.0', prerelease: false }]);
    if (url.endsWith('.json')) return Response.json(envelope(manifest));
    return new Response(content);
  };
  const updater = createUpdater({ version: '0.1.0', publicKeyPath, directory, fetcher });
  assert.equal((await updater.check()).state, 'available');
  content = 'tampered'; await assert.rejects(updater.download());
  assert.equal(updater.status().state, 'error');
  content = artifact; await updater.check(); const installer = await updater.download();
  assert.equal(await readFile(installer, 'utf8'), artifact);
});
test('a subsequent desktop release is available to the already updated app', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'codearchive-next-update-')); t.after(() => cleanupTemporary(directory));
  const publicKeyPath = join(directory, 'public.pem'); await writeFile(publicKeyPath, publicKey);
  let releases = [{ tag_name: 'desktop-v0.2.0', draft: false, prerelease: false }];
  let selected = manifest;
  const fetcher = async url => url.includes('api.github.com') ? Response.json(releases) : url.endsWith('.json') ? Response.json(envelope(selected)) : new Response(artifact);
  const updater = createUpdater({ version: '0.2.0', publicKeyPath, directory, fetcher });
  assert.equal((await updater.check()).state, 'current');
  selected = { ...manifest, version: '0.2.1', artifact: { ...manifest.artifact, url: manifest.artifact.url.replaceAll('0.2.0', '0.2.1') } };
  releases = [{ tag_name: 'desktop-v0.2.2', prerelease: true }, { tag_name: 'desktop-v0.2.1', draft: false, prerelease: false }, ...releases];
  assert.deepEqual(await updater.check(), { state: 'available', version: '0.2.1', message: 'v0.2.1 업데이트가 있습니다.' });
  assert.equal(await readFile(await updater.download(), 'utf8'), artifact);
  releases = []; await updater.check();
  await assert.rejects(updater.download(), /새 버전 확인/);
});
test('silent assisted updates request app relaunch and surface installer launch failures', async () => {
  let unreferenced = false;
  const spawnInstaller = (path, args, options) => {
    assert.equal(path, 'verified-installer.exe');
    assert.ok(args.includes('/S') && args.includes('--updated') && args.includes('--force-run'));
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    const child = new EventEmitter(); child.unref = () => { unreferenced = true; };
    queueMicrotask(() => child.emit('spawn')); return child;
  };
  await runInstaller('verified-installer.exe', spawnInstaller); assert.equal(unreferenced, true);
  await assert.rejects(runInstaller('verified-installer.exe', () => {
    const child = new EventEmitter(); child.unref = () => {};
    queueMicrotask(() => child.emit('error', new Error('Launch refused'))); return child;
  }), /Launch refused/);
});
