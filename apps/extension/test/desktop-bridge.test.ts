import test from 'node:test';
import assert from 'node:assert/strict';
import { DashboardBridge, DASHBOARD_ORIGIN } from '../src/bridge';
import { MemoryCaptureStore } from '../src/storage';
import { createCapture } from '../src/capture';
import { desktopProof, DesktopConnection, DESKTOP_CONNECTION_KEY } from '../src/desktopConnection';
import { createHmac } from 'node:crypto';
test('desktop challenges use role-bound HMACs and do not transmit the persistent token', async () => {
  const token = 'a'.repeat(64), nonce = 'b'.repeat(64);
  assert.equal(await desktopProof(token, 'server', nonce), createHmac('sha256', token).update(`server:${nonce}`).digest('hex'));
  assert.notEqual(await desktopProof(token, 'client', nonce), await desktopProof(token, 'server', nonce));
});
test('an unverified loopback process cannot authorize requests merely by sending READY', async () => {
  const savedChrome = globalThis.chrome, savedSocket = globalThis.WebSocket;
  let socket: FakeSocket | undefined;
  class FakeSocket {
    static OPEN = 1;
    readyState = 1; closed = false;
    onmessage?: (event: { data: string }) => Promise<void>;
    onclose?: () => void;
    constructor() { socket = this; }
    send() { throw new Error('Unverified peer must not receive a request'); }
    close() { this.closed = true; this.readyState = 3; this.onclose?.(); }
  }
  Object.assign(globalThis, { chrome: { storage: { local: { get: async () => ({ [DESKTOP_CONNECTION_KEY]: { token: 'a'.repeat(64) } }), remove: async () => {} } } }, WebSocket: FakeSocket });
  const connection = new DesktopConnection(new DashboardBridge(new MemoryCaptureStore()));
  try {
    await connection.connect();
    assert.ok(socket);
    await socket.onmessage?.({ data: JSON.stringify({ type: 'READY' }) });
    assert.equal(socket.closed, true);
    assert.equal(connection.status().connected, false);
  } finally { await connection.disconnect(); Object.assign(globalThis, { chrome: savedChrome, WebSocket: savedSocket }); }
});
test('desktop sessions are separate from web and other connections, and preserve read-only/issued ACK semantics', async () => {
  const store = new MemoryCaptureStore();
  const capture = createCapture({ platform: 'JUNGOL', problemNumber: '5187', title: 'fixture', problemUrl: 'https://jungol.co.kr/problem/5187', language: 'Java', sourceCode: 'class A {}', result: 'ACCEPTED' });
  assert.ok(capture); await store.putCapture(capture);
  const bridge = new DashboardBridge(store);
  const id = 'a'.repeat(32);
  const connected = await bridge.handleDesktopMessage({ type: 'CONNECT' }, id); assert.ok('capability' in connected);
  const message = { type: 'GET_LOCAL_ARCHIVE', capability: connected.capability };
  assert.deepEqual(await bridge.handleMessage(message, { url: `${DASHBOARD_ORIGIN}/`, documentId: 'web', tab: { id: 1, url: `${DASHBOARD_ORIGIN}/` } }), { error: 'UNAUTHORIZED' });
  assert.deepEqual(await bridge.handleDesktopMessage(message, 'b'.repeat(32)), { error: 'UNAUTHORIZED' });
  const archive = await bridge.handleDesktopMessage(message, id); assert.ok('captures' in archive && archive.captures.length === 1);
  const ack = { type: 'ACK', capability: connected.capability, captureIds: [capture.captureId] };
  assert.deepEqual(await bridge.handleDesktopMessage(ack, id), { error: 'BAD_REQUEST' });
  await bridge.handleDesktopMessage({ type: 'GET_PENDING', capability: connected.capability }, id);
  assert.deepEqual(await bridge.handleDesktopMessage(ack, id), { ok: true });
  assert.equal(await store.countPending(), 0);
  assert.deepEqual(await bridge.handleDesktopMessage({ type: 'CONNECT' }, 'invalid'), { error: 'UNAUTHORIZED' });
});
test('a captured server challenge cannot be replayed on a fresh connection, even with its nonce field rewritten', async () => {
  const savedChrome = globalThis.chrome, savedSocket = globalThis.WebSocket;
  let socket: FakeSocket | undefined;
  class FakeSocket {
    static OPEN = 1;
    readyState = 1; closed = false; sent: Array<{ type: string; nonce?: string }> = [];
    onopen?: () => void; onmessage?: (event: { data: string }) => Promise<void>; onclose?: () => void;
    constructor() { socket = this; }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.closed = true; this.readyState = 3; this.onclose?.(); }
  }
  const token = 'a'.repeat(64), oldClientNonce = 'c'.repeat(64), serverNonce = 'b'.repeat(64);
  const captured = { type: 'CHALLENGE', clientNonce: oldClientNonce, nonce: serverNonce, proof: createHmac('sha256', token).update(`server:${oldClientNonce}:${serverNonce}`).digest('hex') };
  Object.assign(globalThis, { chrome: { storage: { local: { get: async () => ({ [DESKTOP_CONNECTION_KEY]: { token } }), remove: async () => {} } } }, WebSocket: FakeSocket });
  try {
    for (const rewrite of [false, true]) {
      const connection = new DesktopConnection(new DashboardBridge(new MemoryCaptureStore()));
      try {
        await connection.connect(); assert.ok(socket); socket.onopen?.();
        const hello = socket.sent[0]; assert.ok(hello);
        const freshNonce = hello.nonce;
        assert.match(freshNonce ?? '', /^[a-f0-9]{64}$/); assert.notEqual(freshNonce, oldClientNonce);
        await socket.onmessage?.({ data: JSON.stringify({ ...captured, clientNonce: rewrite ? freshNonce : oldClientNonce }) });
        assert.equal(socket.closed, true); assert.equal(connection.status().connected, false);
        assert.equal(socket.sent.some(message => message.type === 'AUTH'), false);
      } finally { await connection.disconnect(); }
    }
  } finally { Object.assign(globalThis, { chrome: savedChrome, WebSocket: savedSocket }); }
});
test('closing or disconnecting during READY proof does not revive a stale connection', async () => {
  const savedChrome = globalThis.chrome, savedSocket = globalThis.WebSocket;
  const originalSign = crypto.subtle.sign.bind(crypto.subtle);
  const deferred: { release?: () => void } = {};
  const token = 'a'.repeat(64), nonce = 'b'.repeat(64);
  let socket: FakeSocket | undefined;
  class FakeSocket {
    static OPEN = 1;
    readyState = 1; sent: Array<{ type: string; nonce?: string }> = [];
    onopen?: () => void; onmessage?: (event: { data: string }) => Promise<void>; onclose?: () => void;
    constructor() { socket = this; }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  Object.assign(globalThis, { chrome: { storage: { local: { get: async () => ({ [DESKTOP_CONNECTION_KEY]: { token } }), remove: async () => {} } } }, WebSocket: FakeSocket });
  crypto.subtle.sign = async (...args: Parameters<SubtleCrypto['sign']>) => {
    if (new TextDecoder().decode(args[2] as Uint8Array).startsWith('ready:')) await new Promise<void>(resolve => { deferred.release = resolve; });
    return originalSign(...args);
  };
  try {
    for (const action of ['close', 'disconnect']) {
      const connection = new DesktopConnection(new DashboardBridge(new MemoryCaptureStore()));
      try {
        await connection.connect(); assert.ok(socket); socket.onopen?.();
        const hello = socket.sent[0]; assert.ok(hello?.nonce);
        const proof = (role: string) => createHmac('sha256', token).update(`${role}:${hello.nonce}:${nonce}`).digest('hex');
        await socket.onmessage?.({ data: JSON.stringify({ type: 'CHALLENGE', clientNonce: hello.nonce, nonce, proof: proof('server') }) });
        Object.assign(deferred, { release: undefined });
        const pendingReady = socket.onmessage?.({ data: JSON.stringify({ type: 'READY', proof: proof('ready') }) });
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(deferred.release);
        const oldSocket = socket;
        if (action === 'close') socket.close(); else await connection.disconnect();
        deferred.release(); await pendingReady;
        assert.equal(connection.status().connected, false);
        await connection.connect();
        assert.notEqual(socket, oldSocket, 'reconnect must not be skipped due to stale ready state');
      } finally { await connection.disconnect(); }
    }
  } finally { crypto.subtle.sign = originalSign; Object.assign(globalThis, { chrome: savedChrome, WebSocket: savedSocket }); }
});
