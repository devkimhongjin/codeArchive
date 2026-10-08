const DASHBOARD_ORIGIN = 'https://codearchive-dashboard-beta.netlify.app';

export const DASHBOARD_LOGIN_ROUTE_KEY = 'codearchive-dashboard-login-route';
export type DashboardPageSender = { id?: string; url?: string; frameId?: number; documentId?: string; tab?: { id?: number; url?: string } };
export function dashboardSender(sender: DashboardPageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || sender.frameId !== 0 || !sender.documentId || !Number.isSafeInteger(sender.tab?.id)) return false;
  try {
    const url = new URL(sender.url ?? '');
    const tab = new URL(sender.tab?.url ?? '');
    return url.protocol === 'chrome-extension:' && url.hostname === extensionId && url.pathname === '/dashboard.html' &&
      tab.protocol === url.protocol && tab.hostname === url.hostname && tab.pathname === url.pathname;
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
