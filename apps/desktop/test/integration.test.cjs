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
test('a persisted key mismatch is reported without erasing the extension key or sending authenticated requests', async () => {
  const { DesktopConnection, DESKTOP_CONNECTION_KEY } = await import('../../extension/src/desktopConnection.ts');
  const { DashboardBridge } = await import('../../extension/src/bridge.ts');
  const { MemoryCaptureStore } = await import('../../extension/src/storage.ts');
  const savedChrome = globalThis.chrome, savedSocket = globalThis.WebSocket;
  let removed = false;
  const savedKey = 'b'.repeat(64);
  let lastSocket;
  const server = createExtensionServer({ port: 0, token: 'a'.repeat(64), saveToken: async () => { throw Error('No pairing changes expected'); } });
  const port = await server.listen();
  class OwnedSocket extends NativeSocket {
    constructor() { super(`ws://127.0.0.1:${port}/bridge`, { origin: 'chrome-extension://oohlcmihldmfninmdcmanddfmhoonmdl' }); lastSocket = this; }
  }
  Object.assign(globalThis, { chrome: { storage: { local: { get: async () => ({ [DESKTOP_CONNECTION_KEY]: { token: savedKey } }), remove: async () => { removed = true; } } } }, WebSocket: OwnedSocket });
  const connection = new DesktopConnection(new DashboardBridge(new MemoryCaptureStore()));
  try {
    await connection.connect();
    const deadline = Date.now() + 2000;
    while (!connection.status().error && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(connection.status().connected, false);
    assert.match(connection.status().error, /연결 정보가 일치하지 않습니다/);
    assert.equal(removed, false);
    assert.equal(server.connected(), false);
    await assert.rejects(server.request({ type: 'CONNECT' }));
    while (lastSocket.readyState !== NativeSocket.CLOSED && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(lastSocket.readyState, NativeSocket.CLOSED);
    // Production DESKTOP_STATUS starts reconnect and returns immediately,
    // before the new handshake completes. It must retain the last failure.
    const polled = await connection.connect().then(() => connection.status());
    assert.match(polled.error, /연결 정보가 일치하지 않습니다/);
    assert.equal(removed, false);
  } finally { await connection.disconnect(); await server.close(); Object.assign(globalThis, { chrome: savedChrome, WebSocket: savedSocket }); }
});
