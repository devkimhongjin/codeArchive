const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const { createAutostartPolicy } = require('../src/autostart-policy.cjs');

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'codearchive-autostart-'));
  t.after(async () => {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'codearchive-autostart-')) throw Error('Unsafe cleanup');
    await rm(directory, { recursive: true, force: true });
  });
  let openAtLogin = false;
  const writes = [];
  const options = {
    statePath: join(directory, 'autostart-initialized.json'), legacyPaths: [join(directory, 'setup.json')],
    packaged: true, platform: 'win32', getSettings: () => ({ openAtLogin }),
    setSettings: value => { openAtLogin = value; writes.push(value); },
  };
  return { options, policy: createAutostartPolicy(options), writes, enabled: () => openAtLogin, externalChange: value => { openAtLogin = value; } };
}

test('a fresh Windows installation starts enabled once and preserves a later opt-out', async t => {
  const f = await fixture(t); await f.policy.initialize(); assert.equal(f.enabled(), true);
  await f.policy.setEnabled(false);
  await createAutostartPolicy(f.options).initialize(); assert.equal(f.enabled(), false);
  assert.deepEqual(f.writes, [true, false]);
});

test('existing installs retain their Windows setting, and external disabling is not reversed', async t => {
  const f = await fixture(t); await writeFile(f.options.legacyPaths[0], '{}');
  await f.policy.initialize(); assert.equal(f.enabled(), false); assert.deepEqual(f.writes, []);
  await f.policy.setEnabled(true); f.externalChange(false);
  await createAutostartPolicy(f.options).initialize(); assert.equal(f.enabled(), false);
  assert.deepEqual(f.writes, [true]);
});

test('an already enabled fresh install is kept without rewriting Windows registration', async t => {
  const f = await fixture(t); f.externalChange(true); await f.policy.initialize();
  assert.equal(f.enabled(), true); assert.deepEqual(f.writes, []);
});

test('development, other platforms, invalid input, and failed initialization do not change Windows startup', async t => {
  const f = await fixture(t);
  for (const options of [{ packaged: false }, { platform: 'darwin' }]) {
    const policy = createAutostartPolicy({ ...f.options, ...options });
    await policy.initialize(); await assert.rejects(policy.setEnabled(true));
  }
  await assert.rejects(f.policy.setEnabled('true'));
  await writeFile(f.options.statePath, '{}');
  const failed = createAutostartPolicy({ ...f.options, statePath: join(f.options.statePath, 'blocked.json') });
  await assert.rejects(failed.initialize()); assert.deepEqual(f.writes, []);
});
