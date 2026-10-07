import { DashboardBridge } from './bridge';
export const DESKTOP_CONNECTION_KEY = 'codearchive-desktop-connection';
const ENDPOINT = 'http://127.0.0.1:18791';
type Pairing = { token: string };
export async function desktopProof(token: string, role: 'client' | 'server' | 'ready', nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${role}:${nonce}`));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export class DesktopConnection {
  private socket: WebSocket | null = null;
  private ready = false;
  private connecting = false;
  private generation = 0;
  constructor(private readonly bridge: DashboardBridge) {}
  status() { return { connected: this.ready }; }
  async pair(code: string) {
    if (!/^\d{6}$/.test(code)) throw new Error('PC 앱에 표시된 6자리 연결 코드를 입력해 주세요.');
    const response = await fetch(`${ENDPOINT}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('연결 코드가 만료됐거나 올바르지 않습니다. PC 앱에서 코드를 다시 발급해 주세요.');
    const value = await response.json() as Pairing;
    if (!/^[a-f0-9]{64}$/.test(value.token)) throw new Error('PC 앱 연결 응답이 올바르지 않습니다.');
    await chrome.storage.local.set({ [DESKTOP_CONNECTION_KEY]: { token: value.token } });
    this.generation++; this.socket?.close(); this.socket = null; this.ready = false; this.connecting = false;
    await this.connect(); return { ok: true };
  }
  async disconnect() {
    await chrome.storage.local.remove(DESKTOP_CONNECTION_KEY);
    this.generation++; this.socket?.close(); this.socket = null; this.ready = false; this.connecting = false;
    return { ok: true };
  }
  async connect() {
    if (this.ready || this.connecting) return;
    this.connecting = true;
    const generation = this.generation;
    let saved: Pairing | undefined;
    try { saved = (await chrome.storage.local.get(DESKTOP_CONNECTION_KEY))[DESKTOP_CONNECTION_KEY] as Pairing | undefined; }
    catch { this.connecting = false; return; }
    if (generation !== this.generation) return;
    if (!saved || !/^[a-f0-9]{64}$/.test(saved.token)) { this.connecting = false; return; }
    const socket = new WebSocket('ws://127.0.0.1:18791/bridge'); this.socket = socket;
    const id = crypto.randomUUID().replaceAll('-', '');
    const clientNonce = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    let serverNonce = '';
    let serverVerified = false;
    const current = () => this.socket === socket && generation === this.generation && socket.readyState === WebSocket.OPEN;
    const timeout = setTimeout(() => { if (!this.ready) socket.close(); }, 5000);
    const heartbeat = setInterval(() => { if (this.socket === socket && this.ready && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'HEARTBEAT' })); }, 20000);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'HELLO', nonce: clientNonce }));
    socket.onmessage = async event => {
      if (this.socket !== socket) return;
      let payload: { type?: string; id?: string; message?: unknown; nonce?: string; clientNonce?: string; proof?: string };
      try { payload = JSON.parse(String(event.data)); } catch { socket.close(); return; }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { socket.close(); return; }
      if (payload.type === 'CHALLENGE' && !this.ready) {
        if (payload.clientNonce !== clientNonce || typeof payload.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(payload.nonce)) { socket.close(); return; }
        const expected = await desktopProof(saved.token, 'server', `${clientNonce}:${payload.nonce}`);
        if (!current()) return;
        if (payload.proof !== expected) { socket.close(); return; }
        serverNonce = payload.nonce;
        serverVerified = true;
        const proof = await desktopProof(saved.token, 'client', `${clientNonce}:${serverNonce}`);
        if (current()) socket.send(JSON.stringify({ type: 'AUTH', proof }));
        return;
      }
      if (payload.type === 'READY') {
        if (!serverVerified) { socket.close(); return; }
        const expected = await desktopProof(saved.token, 'ready', `${clientNonce}:${serverNonce}`);
        if (!current()) return;
        if (payload.proof !== expected) { socket.close(); return; }
        this.ready = true; this.connecting = false; clearTimeout(timeout); return;
      }
      if (this.ready && payload.type === 'REQUEST' && typeof payload.id === 'string' && /^[a-f0-9]{32}$/.test(payload.id)) {
        void this.bridge.handleDesktopMessage(payload.message, id).catch(() => ({ error: 'BAD_REQUEST' })).then(response => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'RESPONSE', id: payload.id, response }));
        });
      }
    };
    socket.onclose = () => { clearTimeout(timeout); clearInterval(heartbeat); if (this.socket === socket) { this.socket = null; this.ready = false; this.connecting = false; } };
    socket.onerror = () => socket.close();
  }
}
