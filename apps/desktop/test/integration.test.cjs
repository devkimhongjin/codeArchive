const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket: NativeSocket } = require('ws');
const { createExtensionServer } = require('../src/extension-server.cjs');
test('production DesktopConnection and desktop server complete mutual authentication and local reads together', async () => {
  const { DesktopConnection, DESKTOP_CONNECTION_KEY } = await import('../../extension/src/desktopConnection.ts');
  const { DashboardBridge } = await import('../../extension/src/bridge.ts');
  const { MemoryCaptureStore } = await import('../../extension/src/storage.ts');
  const token = 'a'.repeat(64), savedChrome = globalThis.chrome, savedSocket = globalThis.WebSocket;
  const server = createExtensionServer({ port: 0, token, saveToken: async () => {} });
  const port = await server.listen();
  class OwnedSocket extends NativeSocket {
    constructor() { super(`ws://127.0.0.1:${port}/bridge`, { origin: 'chrome-extension://oohlcmihldmfninmdcmanddfmhoonmdl' }); }
  }
  Object.assign(globalThis, { chrome: { storage: { local: { get: async () => ({ [DESKTOP_CONNECTION_KEY]: { token } }), remove: async () => {} } } }, WebSocket: OwnedSocket });
  const connection = new DesktopConnection(new DashboardBridge(new MemoryCaptureStore()));
  try {
    await connection.connect();
    const deadline = Date.now() + 2000;
    while (!connection.status().connected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(connection.status().connected, true);
    const connected = await server.request({ type: 'CONNECT' });
    assert.equal(typeof connected.capability, 'string');
    const archive = await server.request({ type: 'GET_LOCAL_ARCHIVE', capability: connected.capability });
    assert.deepEqual(archive.captures, []); assert.equal(archive.localOnly, true);
  } finally { await connection.disconnect(); await server.close(); Object.assign(globalThis, { chrome: savedChrome, WebSocket: savedSocket }); }
});
