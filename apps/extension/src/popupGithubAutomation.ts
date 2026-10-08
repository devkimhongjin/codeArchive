import type { CaptureSettings } from './types';
import type { CaptureStore } from './storage';
import type { AccountSettings, RelayGrant, User } from '../../dashboard/src/types';

const API_ORIGIN = 'https://codearchive-dashboard-beta.netlify.app';
type Store = Pick<CaptureStore, 'getSettings' | 'mutateSettings'>;
export type GithubToggleRequest = { enabled: boolean; accountId: string; settingsVersion: number };
export type GithubToggleResult = { ok: boolean; error?: string; needsTarget?: boolean; relayReady?: boolean };
class RequestError extends Error { constructor(readonly status: number) { super('Request failed'); } }
function sameSettings(current: CaptureSettings, expected: CaptureSettings): boolean {
  return current.accountId === expected.accountId && current.accountSettingsVersion === expected.accountSettingsVersion &&
    current.relay?.secret === expected.relay?.secret && current.relay?.generation === expected.relay?.generation;
}

/** Popup-only command: server consent first, then an account/version-fenced relay handoff.
 * Never return session/CSRF/relay credentials or retry an uncertain settings write. */
export async function setPopupGithubAutomation(store: Store, command: GithubToggleRequest,
  deviceId: string, fetcher: typeof fetch = fetch): Promise<GithubToggleResult> {
  const original = await store.getSettings();
  if (!original.accountId || original.accountId !== command.accountId || original.accountSettingsVersion !== command.settingsVersion) return { ok: false, error: 'ACCOUNT_CHANGED' };
  const stillOriginal = async () => sameSettings(await store.getSettings(), original);
  let writeAttempted = false, writeConfirmed = false;
  let pending: CaptureSettings | undefined;
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        fetcher(`${API_ORIGIN}${path}`, { ...init, credentials: 'include', redirect: 'error', signal: controller.signal }).then(async response => {
          if (!response.ok) throw new RequestError(response.status);
          return await response.json() as T;
        }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RequestError(0)); }, 8000); }),
      ]);
      return response;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  try {
    const user = await request<User>('/api/auth/me');
    if (!Number.isSafeInteger(user.id) || String(user.id) !== original.accountId || typeof user.githubId !== 'string' || !/^\d{1,40}$/.test(user.githubId)) return { ok: false, error: 'ACCOUNT_CHANGED' };
    const accountHeader = { 'X-CodeArchive-Github-Id': user.githubId };
    const saved = await request<AccountSettings>('/api/settings', { headers: accountHeader });
    if (saved.version !== command.settingsVersion) return { ok: false, error: 'SETTINGS_CHANGED' };
    if (!saved.githubTargetConfigured || !saved.githubInstallationId || !saved.githubOwner || !saved.githubRepository || !saved.githubBranch) return { ok: false, needsTarget: true };
    if (command.enabled && saved.githubStatus !== 'AVAILABLE') return { ok: false, error: 'PROVIDER_UNAVAILABLE' };
    const csrf = await request<{ headerName: string; token: string }>('/api/auth/csrf');
    if (!['X-XSRF-TOKEN', 'X-CSRF-TOKEN'].includes(csrf.headerName) || typeof csrf.token !== 'string' || !csrf.token || csrf.token.length > 1024) return { ok: false, error: 'SECURITY_TOKEN_ERROR' };
    const headers = { ...accountHeader, [csrf.headerName]: csrf.token, 'Content-Type': 'application/json' };
    if (!await stillOriginal()) return { ok: false, error: 'ACCOUNT_CHANGED' };
    writeAttempted = true;
    // Read the authoritative full snapshot immediately before the conditional PUT.
    // The server validates its version/target and preserves unrelated fields.
    const next = await request<AccountSettings>('/api/settings', { method: 'PUT', headers,
      body: JSON.stringify({ ...saved, autoSyncEnabled: true, githubAutoCommitEnabled: command.enabled }) });
    writeConfirmed = true;
    if (!Number.isSafeInteger(next.version) || next.version < saved.version || next.autoSyncEnabled !== true ||
      next.githubAutoCommitEnabled !== command.enabled || next.githubTargetConfigured !== true) throw new RequestError(0);
    let applied = false;
    await store.mutateSettings(current => {
      if (!sameSettings(current, original)) return current;
      applied = true;
      // PUT revokes old grants. Remove the old bearer before issuing the new one,
      // so an in-flight relay result cannot restore it after this handoff.
      pending = { ...current, accountSettingsVersion: next.version, autoSyncEnabled: true,
        githubAutoCommitEnabled: next.githubAutoCommitEnabled, githubTargetConfigured: true, relay: undefined };
      return pending;
    });
    if (!applied || !pending) return { ok: false, error: 'ACCOUNT_CHANGED' };
    const grant = await request<RelayGrant>('/api/relay/grants', { method: 'POST', headers,
      body: JSON.stringify({ deviceId, generation: next.version }) });
    const endpoint = new URL(grant.endpoint, API_ORIGIN);
    if (endpoint.origin !== API_ORIGIN || endpoint.username || endpoint.password || endpoint.pathname !== '/api/relay/captures' || endpoint.search || endpoint.hash ||
      grant.generation !== next.version || typeof grant.secret !== 'string' || !grant.secret ||
      !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= Date.now()) throw new RequestError(0);
    applied = false;
    await store.mutateSettings(current => {
      if (!sameSettings(current, pending!)) return current;
      applied = true;
      return { ...current, relay: { endpoint: endpoint.href, secret: grant.secret, accountId: original.accountId!, generation: next.version, status: 'CONFIRMED' } };
    });
    return applied ? { ok: true, relayReady: true } : { ok: false, error: 'ACCOUNT_CHANGED' };
  } catch (error) {
    if (pending) return sameSettings(await store.getSettings(), pending) ? { ok: true, relayReady: false, error: 'RELAY_REFRESH_REQUIRED' } : { ok: false, error: 'ACCOUNT_CHANGED' };
    const status = error instanceof RequestError ? error.status : 0;
    if (writeAttempted && (writeConfirmed || status === 0 || status >= 500)) {
      await store.mutateSettings(current => sameSettings(current, original) ? { ...current, relay: undefined } : current);
      return { ok: false, error: 'SAVE_UNCONFIRMED' };
    }
    return { ok: false, error: status === 401 ? 'LOGIN_REQUIRED' : status === 409 ? 'SETTINGS_CHANGED' : 'SAVE_FAILED' };
  }
}
