const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign, createHash } = require('node:crypto');
const { mkdtemp, writeFile, rm, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { validateManifest, createUpdater, isNewer } = require('../src/updater.cjs');
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
function envelope(manifest) { return { manifest, signature: sign(null, Buffer.from(JSON.stringify(manifest)), keys.privateKey).toString('base64') }; }
const artifact = 'synthetic installer';
const manifest = { version: '0.2.0', artifact: { url: 'https://github.com/devkimhongjin/codeArchive/releases/download/desktop-v0.2.0/CodeArchive-Setup-0.2.0.exe', sha256: createHash('sha256').update(artifact).digest('hex') } };
test('updates require the pinned signature, exact release URL and a newer version', () => {
  assert.deepEqual(validateManifest(envelope(manifest), publicKey, '0.1.0'), manifest);
  assert.equal(validateManifest(envelope(manifest), publicKey, '0.2.0'), null);
  const changed = envelope(manifest); changed.manifest = { ...manifest, version: '99.0.0' };
  assert.throws(() => validateManifest(changed, publicKey, '0.1.0'));
  assert.throws(() => validateManifest(envelope({ ...manifest, artifact: { ...manifest.artifact, url: 'https://evil.test/installer.exe' } }), publicKey, '0.1.0'));
  assert.equal(isNewer('0.10.0', '0.9.0'), true);
});
test('desktop releases are selected independently; a downloaded installer must match the signed hash', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'codearchive-updater-')); t.after(() => rm(directory, { recursive: true, force: true }));
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
