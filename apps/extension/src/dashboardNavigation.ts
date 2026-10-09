const DASHBOARD_ORIGIN = 'https://codearchive-dashboard-beta.netlify.app';

export const DASHBOARD_LOGIN_ROUTE_KEY = 'codearchive-dashboard-login-route';
export type DashboardPageSender = { id?: string; url?: string; frameId?: number; documentId?: string; tab?: { id?: number; url?: string } };
export function dashboardSender(sender: DashboardPageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || sender.frameId !== 0 || !sender.documentId || !Number.isSafeInteger(sender.tab?.id)) return false;
  try {
    const url = new URL(sender.url ?? '');
    const tab = sender.tab?.url ? new URL(sender.tab.url) : null;
    return url.protocol === 'chrome-extension:' && url.hostname === extensionId && url.pathname === '/dashboard.html' &&
      (!tab || (tab.protocol === url.protocol && tab.hostname === url.hostname && tab.pathname === url.pathname));
  } catch { return false; }
}
export function dashboardExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000 || value.includes('\\')) return null;
  try {
    const url = new URL(value, DASHBOARD_ORIGIN);
    if (url.username || url.password || url.hash) return null;
    if (url.origin === DASHBOARD_ORIGIN && url.pathname === '/api/oauth2/authorization/github' && !url.search) return url.href;
    if (url.origin === 'https://github.com' && /^\/apps\/[a-z0-9-]+\/installations\/new$/.test(url.pathname)) return url.href;
  } catch { /* Invalid URL. */ }
  return null;
}
export function dashboardLoginReturn(url: string): boolean {
  try { const parsed = new URL(url); return parsed.origin === DASHBOARD_ORIGIN && parsed.pathname === '/' && !parsed.username && !parsed.password; }
  catch { return false; }
}
export function dashboardReturnQuery(url: string): string {
  const source = new URL(url).searchParams;
  const query = new URLSearchParams();
  const result = source.get('githubInstall');
  if (result && ['success', 'cancelled', 'expired', 'invalid', 'account_mismatch', 'installation_unavailable', 'provider_unavailable', 'authentication_required'].includes(result)) {
    query.set('githubInstall', result);
    const id = source.get('installationId');
    if (id && /^[1-9][0-9]{0,15}$/.test(id) && Number.isSafeInteger(Number(id))) query.set('installationId', id);
  }
  return query.toString();
}

export function validDashboardLoginNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

export async function beginDashboardLogin(url: string, dashboardTabId: number, loginNonce: string, api = chrome, now = Date.now()) {
  // Register the route before navigating. An already-signed-in OAuth round-trip
  // can otherwise finish before tabs.create's response has been persisted.
  const tab = await api.tabs.create({ url: 'about:blank' });
  if (!Number.isSafeInteger(tab.id)) throw new Error('Login tab unavailable');
  try {
    await api.storage.session.set({ [DASHBOARD_LOGIN_ROUTE_KEY]: { loginTabId: tab.id, dashboardTabId, loginNonce, expiresAt: now + 10 * 60_000 } });
    await api.tabs.update(tab.id!, { url });
  } catch (error) {
    const saved = (await api.storage.session.get(DASHBOARD_LOGIN_ROUTE_KEY))[DASHBOARD_LOGIN_ROUTE_KEY] as { loginNonce?: unknown } | undefined;
    if (saved?.loginNonce === loginNonce) await api.storage.session.remove(DASHBOARD_LOGIN_ROUTE_KEY);
    await api.tabs.remove(tab.id!).catch(() => undefined);
    throw error;
  }
}

const completing = new Set<number>();
type LoginRoute = { loginTabId: number; dashboardTabId: number; loginNonce: string; expiresAt: number };
function loginRoute(value: unknown): LoginRoute | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const route = value as Partial<LoginRoute>;
  return typeof route.loginTabId === 'number' && Number.isSafeInteger(route.loginTabId) && typeof route.dashboardTabId === 'number' && Number.isSafeInteger(route.dashboardTabId) && validDashboardLoginNonce(route.loginNonce) && typeof route.expiresAt === 'number' && Number.isFinite(route.expiresAt) ? route as LoginRoute : null;
}
export async function completeDashboardLogin(tabId: number, url: string, api = chrome, now = Date.now()): Promise<boolean> {
  if (!dashboardLoginReturn(url) || completing.has(tabId)) return false;
  completing.add(tabId);
  try {
    const route = loginRoute((await api.storage.session.get(DASHBOARD_LOGIN_ROUTE_KEY))[DASHBOARD_LOGIN_ROUTE_KEY]);
    if (!route || route.loginTabId !== tabId || route.expiresAt <= now) return false;
    const dashboard = await api.tabs.get(route.dashboardTabId);
    // Chrome may omit Tab.url without broad tabs permission. Do not require a
    // URL read; the initiating document must acknowledge its in-memory nonce.
    if (dashboard.url) {
      const target = new URL(dashboard.url);
      if (target.protocol !== 'chrome-extension:' || target.hostname !== api.runtime.id || target.pathname !== '/dashboard.html') return false;
    }
    const acknowledged = await api.runtime.sendMessage({ type: new URL(url).searchParams.has('authError') ? 'DASHBOARD_LOGIN_FAILED' : 'DASHBOARD_LOGIN_COMPLETE', loginNonce: route.loginNonce, returnQuery: dashboardReturnQuery(url) });
    if (acknowledged?.ready !== true || acknowledged.loginNonce !== route.loginNonce) return false;
    const latest = loginRoute((await api.storage.session.get(DASHBOARD_LOGIN_ROUTE_KEY))[DASHBOARD_LOGIN_ROUTE_KEY]);
    if (latest?.loginNonce !== route.loginNonce || latest?.loginTabId !== tabId) return false;
    await api.tabs.update(route.dashboardTabId, { active: true });
    if (Number.isSafeInteger(dashboard.windowId)) await api.windows.update(dashboard.windowId, { focused: true });
    await api.storage.session.remove(DASHBOARD_LOGIN_ROUTE_KEY);
    await api.tabs.remove(tabId);
    return true;
  } finally { completing.delete(tabId); }
}
