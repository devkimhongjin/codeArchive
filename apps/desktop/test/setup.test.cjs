const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createSetup } = require('../src/setup.cjs');
test('first-run setup requires a connected extension and persists completion across app launches', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codearchive-setup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const extensionPath = path.join(directory, 'extension'); await mkdir(extensionPath);
  await writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify({ name: 'CodeArchive', version: '0.3.0' }));
  let connected = false, opened;
  const options = { extensionPath, statePath: path.join(directory, 'user', 'setup.json'), connected: () => connected, openFolder: async value => { opened = value; return ''; } };
  const setup = createSetup(options);
  assert.deepEqual(await setup.get(), { extensionPath, extensionVersion: '0.3.0', available: true, completed: false });
  await assert.rejects(() => setup.complete(), /연결/);
  assert.equal((await setup.get()).completed, false);
  await setup.openFolder(); assert.equal(opened, extensionPath);
  connected = true; await setup.complete();
  assert.equal((await createSetup(options).get()).completed, true);
});
test('a missing extension bundle does not open an arbitrary folder', async () => {
  const setup = createSetup({ extensionPath: path.join(tmpdir(), 'codearchive-missing-bundle'), statePath: '', connected: () => false, openFolder: () => { throw new Error('must not open'); } });
  assert.equal((await setup.get()).available, false);
  await assert.rejects(() => setup.openFolder(), /다시 설치/);
});
