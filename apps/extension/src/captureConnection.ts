import type { CaptureStore } from './storage';
import type { CaptureSettings } from './types';
import { PUBLIC_API_ORIGIN } from '../../../shared/publicApiOrigin';

export type CaptureConnectionStatus = 'READY' | 'LOGIN_REQUIRED' | 'OFFLINE' | 'ACCOUNT_CHANGED' | 'RECONNECT_REQUIRED';
export type CaptureConnection = { status: CaptureConnectionStatus; accountId?: string };
type Store = Pick<CaptureStore, 'getSettings' | 'mutateSettings'>;
class RequestError extends Error { constructor(readonly status: number) { super('Connection check failed'); } }
const same = (a: CaptureSettings, b: CaptureSettings) => a.accountId === b.accountId && a.accountSettingsVersion === b.accountSettingsVersion &&
  a.autoSyncEnabled === b.autoSyncEnabled && a.relay?.secret === b.relay?.secret && a.relay?.generation === b.relay?.generation && a.relay?.status === b.relay?.status;

/** Reuse Chrome's existing HttpOnly cookie. Never turn a relay bearer into a login. */
export async function restoreCaptureSession(store: Store, deviceId: string, fetcher: typeof fetch = fetch): Promise<CaptureConnection> {
  let validatedAccountId: string | undefined;
  const reply = (status: CaptureConnectionStatus): CaptureConnection => ({ status, ...(status === 'READY' ? { accountId: validatedAccountId } : {}) });
  const original = await store.getSettings();
  if (original.autoSyncEnabled !== true || original.relay?.status === 'REVOCATION_PENDING') return reply('RECONNECT_REQUIRED');
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetcher(new URL(path, PUBLIC_API_ORIGIN), { ...init, credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new RequestError(response.status);
    return response;
  }
  try {
    const user = await (await request('/api/auth/me')).json() as { id: number; githubId: string };
    if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.githubId !== 'string' || !/^\d{1,40}$/.test(user.githubId)) return reply('RECONNECT_REQUIRED');
    const accountId = String(user.id);
    validatedAccountId = accountId;
    if (original.accountId && original.accountId !== accountId) return reply('ACCOUNT_CHANGED');
    const accountHeaders = { 'X-CodeArchive-Github-Id': user.githubId };
    const saved = await (await request('/api/settings', { headers: accountHeaders })).json() as { version: number; autoSyncEnabled: boolean; githubAutoCommitEnabled: boolean; githubTargetConfigured: boolean };
    if (!Number.isSafeInteger(saved.version) || saved.version < 0 || saved.autoSyncEnabled !== true ||
      (original.accountSettingsVersion !== undefined && saved.version < original.accountSettingsVersion)) return reply('RECONNECT_REQUIRED');
    if (!same(original, await store.getSettings())) return reply('ACCOUNT_CHANGED');
    const relay = original.relay;
    if (relay?.accountId === accountId && relay.generation === saved.version && ['CONFIRMED', 'OFFLINE', 'RELAY_ERROR'].includes(relay.status)) {
      let endpoint: URL;
      try { endpoint = new URL(relay.endpoint); } catch { return reply('RECONNECT_REQUIRED'); }
      if (endpoint.origin !== PUBLIC_API_ORIGIN || endpoint.pathname !== '/api/relay/captures' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return reply('RECONNECT_REQUIRED');
      try {
        await request('/api/relay/recent', { headers: { Authorization: `Bearer ${relay.secret}` } });
        return reply(same(original, await store.getSettings()) ? 'READY' : 'ACCOUNT_CHANGED');
      } catch (error) { if (!(error instanceof RequestError) || error.status !== 401) throw error; }
    }
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(deviceId)) return reply('RECONNECT_REQUIRED');
    const csrf = await (await request('/api/auth/csrf')).json() as { headerName: string; token: string };
    if (!['X-XSRF-TOKEN', 'X-CSRF-TOKEN'].includes(csrf.headerName) || typeof csrf.token !== 'string' || !csrf.token || csrf.token.length > 1024) return reply('RECONNECT_REQUIRED');
    if (!same(original, await store.getSettings())) return reply('ACCOUNT_CHANGED');
    const grant = await (await request('/api/relay/grants', { method: 'POST', headers: { ...accountHeaders, [csrf.headerName]: csrf.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, generation: saved.version }) })).json() as { endpoint: string; secret: string; generation: number; expiresAt: string };
    const endpoint = new URL(grant.endpoint, PUBLIC_API_ORIGIN);
    if (endpoint.origin !== PUBLIC_API_ORIGIN || endpoint.pathname !== '/api/relay/captures' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      grant.generation !== saved.version || typeof grant.secret !== 'string' || !grant.secret || grant.secret.length > 1024 || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= Date.now()) return reply('RECONNECT_REQUIRED');
    let applied = false;
    await store.mutateSettings(current => {
      if (!same(current, original)) return current;
      applied = true;
      // Only the dashboard's full settings handoff may advance the cached
      // settings version; grant renewal does not refresh all export/theme fields.
      return { ...current, accountId, autoSyncEnabled: true,
        githubAutoCommitEnabled: saved.githubAutoCommitEnabled === true, githubTargetConfigured: saved.githubTargetConfigured === true,
        relay: { accountId, generation: saved.version, secret: grant.secret, endpoint: endpoint.href, status: 'CONFIRMED' } };
    });
    return reply(applied ? 'READY' : 'ACCOUNT_CHANGED');
  } catch (error) {
    return reply(error instanceof RequestError && error.status === 401 ? 'LOGIN_REQUIRED' : error instanceof RequestError && error.status < 500 && error.status !== 408 && error.status !== 429 ? 'RECONNECT_REQUIRED' : 'OFFLINE');
  }
}

export async function restoreCaptureConnection(store: Store, deviceId: string, fetcher: typeof fetch = fetch): Promise<CaptureConnectionStatus> {
  return (await restoreCaptureSession(store, deviceId, fetcher)).status;
}
