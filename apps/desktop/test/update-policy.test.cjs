const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const { createUpdatePolicy } = require('../src/update-policy.cjs');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'codearchive-update-policy-'));
  t.after(async () => { if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe cleanup'); await rm(dir, { recursive: true, force: true }); });
  let clock = 0, visible = false, active = false, downloads = 0, installs = 0, deferred = 0;
  const statePath = join(dir, 'preferences.json');
  const updater = { status: () => ({ state: 'available', version: '0.1.2' }), download: async () => { downloads++; return 'verified.exe'; }, defer: () => { deferred++; } };
  const options = { statePath, updater, packaged: true, visible: () => visible, active: () => active, now: () => clock, install: async () => { installs++; } };
  const policy = createUpdatePolicy(options); await policy.load();
  return { policy, updater, options, statePath, advance: () => { clock += 61000; }, visible: value => { visible = value; }, active: value => { active = value; }, counts: () => ({ downloads, installs, deferred }), report: (busy = false, draft = false) => policy.report({ busy, draft }) };
}
test('automatic updates default off, persist strict opt-in, and serialize preference writes', async t => {
  const f = await fixture(t); assert.equal(f.policy.enabled(), false);
  await assert.rejects(f.policy.setEnabled('true')); await f.policy.setEnabled(true);
  const loaded = createUpdatePolicy(f.options); await loaded.load(); assert.equal(loaded.enabled(), true);
  await Promise.all([loaded.setEnabled(false), loaded.setEnabled(true), loaded.setEnabled(false)]);
  const final = createUpdatePolicy(f.options); await final.load(); assert.equal(final.enabled(), false);
  await writeFile(f.statePath, '{bad'); await final.load(); assert.equal(final.enabled(), false);
});
test('automatic apply waits for hidden, idle, fresh renderer status without jobs or drafts', async t => {
  const f = await fixture(t); f.advance(); f.report(); await f.policy.tick(); assert.equal(f.counts().installs, 0);
  await f.policy.setEnabled(true); f.visible(true); await f.policy.tick(); assert.equal(f.counts().installs, 0);
  f.visible(false); f.active(true); await f.policy.tick(); assert.equal(f.counts().installs, 0);
  f.active(false); f.report(true); await f.policy.tick(); assert.equal(f.counts().installs, 0);
  f.advance(); f.report(false, true); await f.policy.tick(); assert.equal(f.counts().installs, 0);
  f.advance(); await f.policy.tick(); assert.equal(f.counts().installs, 0); // stale heartbeat
  f.report(); await f.policy.tick(); assert.equal(f.counts().installs, 1);
});
test('visibility, new work and opt-out are rechecked after download; apply is exclusive', async t => {
  const f = await fixture(t); await f.policy.setEnabled(true); f.advance(); f.report();
  let finish; f.updater.download = () => new Promise(resolve => { finish = resolve; });
  const attempt = f.policy.tick(); assert.equal(f.policy.applying(), true);
  await assert.rejects(f.policy.apply()); f.visible(true); finish('verified.exe'); await attempt;
  assert.equal(f.counts().installs, 0); assert.equal(f.counts().deferred, 1);
  f.visible(false); f.advance(); f.report(); const next = f.policy.tick(); await f.policy.setEnabled(false); finish('verified.exe'); await next;
  assert.equal(f.counts().installs, 0); assert.equal(f.policy.applying(), false);
  const manual = f.policy.apply(); f.active(true); finish('verified.exe'); await assert.rejects(manual); assert.equal(f.counts().installs, 0);
});
test('manual apply is available with auto off, rejects busy state and missing renderer heartbeat', async t => {
  const f = await fixture(t); await assert.rejects(f.policy.apply()); f.report(true); await assert.rejects(f.policy.apply());
  f.report(); await f.policy.apply(); assert.equal(f.counts().installs, 1);
  const dev = createUpdatePolicy({ ...f.options, packaged: false }); await assert.rejects(dev.setEnabled(true)); await assert.rejects(dev.apply());
});

test('recent work delays automatic installation and failed installer launch releases the fence', async t => {
  const f = await fixture(t); await f.policy.setEnabled(true); f.advance(); f.report(); f.policy.touch();
  await f.policy.tick(); assert.equal(f.counts().installs, 0);
  f.advance(); f.report(); await f.policy.tick(); assert.equal(f.counts().installs, 1);
  const throwing = createUpdatePolicy({ ...f.options, install: async () => { assert.equal(throwing.installing(), true); throw Error('cannot launch'); } });
  throwing.report({ busy: false, draft: false }); await assert.rejects(throwing.apply(), /cannot launch/);
  assert.equal(throwing.installing(), false); assert.equal(throwing.applying(), false);
});
