const http = require('node:http');
const { randomBytes, randomInt, timingSafeEqual, createHmac } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { EXTENSION_ID, BRIDGE_PORT } = require('./policy.cjs');
const MAX_PAYLOAD = 64 * 1024 * 1024;
function equal(a, b) { return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function proof(token, role, nonce) { return createHmac('sha256', token).update(`${role}:${nonce}`).digest('hex'); }
function createExtensionServer({ token = null, saveToken, onStatus = () => {}, port = BRIDGE_PORT, now = Date.now }) {
  let pair = null, socket = null;
  const pending = new Map();
  let failures = 0;
  const origin = `chrome-extension://${EXTENSION_ID}`;
  const server = http.createServer(async (req, res) => {
    const reject = (status) => { res.writeHead(status); res.end(); };
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.headers.origin !== origin) return reject(403);
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS' && req.url === '/pair') {
      res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return reject(204);
    }
    if (req.method !== 'POST' || req.url !== '/pair') return reject(404);
    if (!pair || now() > pair.expiresAt || failures >= 5) return reject(403);
    const admittedPair = pair;
    let text = '';
    try {
      for await (const chunk of req) { text += chunk; if (text.length > 128) return reject(413); }
      const value = JSON.parse(text);
      if (!pair || pair !== admittedPair || now() > pair.expiresAt || failures >= 5) return reject(403);
      if (!equal(value.code, pair.code)) { failures++; return reject(403); }
      pair = null;
      const next = randomBytes(32).toString('hex');
      await saveToken(next);
      token = next; failures = 0;
      socket?.close();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ token }));
    } catch { reject(400); }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  server.on('upgrade', (req, netSocket, head) => {
    if (req.url !== '/bridge' || req.headers.host !== `127.0.0.1:${server.address().port}` || req.headers.origin !== origin) { netSocket.destroy(); return; }
    sockets.handleUpgrade(req, netSocket, head, ws => sockets.emit('connection', ws));
  });
  sockets.on('connection', ws => {
    let authenticated = false;
    const nonce = randomBytes(32).toString('hex');
    let clientNonce = null;
    const timer = setTimeout(() => ws.close(), 3000);
    if (!token) { ws.close(); return; }
    ws.on('message', async data => {
      let message; try { message = JSON.parse(data.toString()); } catch { ws.close(); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { ws.close(); return; }
      if (!authenticated) {
        if (message.type === 'HELLO' && clientNonce === null && typeof message.nonce === 'string' && /^[a-f0-9]{64}$/.test(message.nonce)) {
          clientNonce = message.nonce;
          ws.send(JSON.stringify({ type: 'CHALLENGE', clientNonce, nonce, proof: proof(token, 'server', `${clientNonce}:${nonce}`) }));
          return;
        }
        if (message.type !== 'AUTH' || !token || !clientNonce || !equal(message.proof, proof(token, 'client', `${clientNonce}:${nonce}`))) { ws.close(); return; }
        authenticated = true; clearTimeout(timer);
        if (socket && socket !== ws) socket.close();
        socket = ws; onStatus(true); ws.send(JSON.stringify({ type: 'READY', proof: proof(token, 'ready', `${clientNonce}:${nonce}`) })); return;
      }
      if (message.type === 'RESPONSE' && typeof message.id === 'string') {
        const job = pending.get(message.id);
        if (job) { clearTimeout(job.timer); pending.delete(message.id); job.resolve(message.response); }
      }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(timer);
      if (socket !== ws) return;
      socket = null; onStatus(false);
      for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('PC 앱과 확장 연결이 끊어졌습니다.')); }
      pending.clear();
    });
  });
  return {
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server.address().port)); }),
    connected: () => socket?.readyState === 1,
    createPairCode: () => { failures = 0; pair = { code: String(randomInt(100000, 1000000)), expiresAt: now() + 120000 }; return { ...pair }; },
    disconnect: async () => { await saveToken(null); token = null; pair = null; socket?.close(); },
    request: message => new Promise((resolve, reject) => {
      if (!socket || socket.readyState !== 1) return reject(new Error('확장 팝업에서 PC 앱 연결 코드를 입력해 주세요.'));
      const id = randomBytes(16).toString('hex');
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('확장 프로그램 응답 시간이 초과되었습니다.')); }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ type: 'REQUEST', id, message }));
    }),
    close: async () => { for (const ws of sockets.clients) ws.terminate(); await new Promise(resolve => server.close(resolve)); }
  };
}
module.exports = { createExtensionServer };
