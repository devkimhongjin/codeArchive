const { mkdir, writeFile, rename } = require('node:fs/promises');
const path = require('node:path');

// Only fixed states, HTTP status numbers and profile paths are recorded. Never
// retain request/response bodies, cookies, pairing keys or login URLs.
function createDiagnostics({ statePath, version, userData, accountStorage, pairing, connected }) {
  const state = { version, userData, accountStorage, pairing, connection: connected ? 'connected' : 'disconnected', authentication: { state: 'not-checked', status: null } };
  let pending = Promise.resolve();
  const save = () => {
    const snapshot = JSON.stringify(state, null, 2);
    pending = pending.then(async () => {
      await mkdir(path.dirname(statePath), { recursive: true });
      const temporary = `${statePath}.tmp`;
      await writeFile(temporary, snapshot);
      await rename(temporary, statePath);
    }).catch(() => {}); // Diagnostics must never block normal app use.
    return pending;
  };
  void save();
  return {
    authentication(status) {
      state.authentication = { state: status === null ? 'network-error' : status === 200 ? 'authenticated' : status === 401 ? 'login-required' : 'http-error', status };
      return save();
    },
    connection(value) {
      state.connection = value;
      return save();
    },
    flush: () => pending,
  };
}
module.exports = { createDiagnostics };
