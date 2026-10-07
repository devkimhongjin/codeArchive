const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createDiagnostics } = require('../src/diagnostics.cjs');
test('connection report keeps the latest HTTP outcome and fixed profile metadata without session bodies', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codearchive-report-'));
  const file = path.join(directory, 'report.json');
  const report = createDiagnostics({ statePath: file, version: '0.1.2', userData: 'owned-profile', accountStorage: 'owned-account', pairing: 'restored', connected: false });
  await report.flush();
  const startup = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(startup.connection, 'disconnected');
  assert.deepEqual(startup.authentication, { state: 'not-checked', status: null });
  void report.authentication(401);
  void report.authentication(200);
  void report.connection('connected');
  await report.flush();
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    version: '0.1.2', userData: 'owned-profile', accountStorage: 'owned-account', pairing: 'restored',
    authentication: { state: 'authenticated', status: 200 }, connection: 'connected',
  });
  await report.authentication(null);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).authentication, { state: 'network-error', status: null });
});
