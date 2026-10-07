type DesktopStatus = { version: string; connected: boolean; autostart: boolean; packaged: boolean; update: { state: string; version: string | null; message: string } }
export type DesktopApi = {
  requestBridge(message: Record<string, unknown>): Promise<Record<string, unknown>>
  api(request: { path: string; method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }>
  login(url: string): Promise<unknown>
  getStatus(): Promise<DesktopStatus>
  pair(): Promise<{ code: string; expiresAt: number }>
  disconnect(): Promise<unknown>
  setAutostart(value: boolean): Promise<unknown>
  checkUpdate(): Promise<DesktopStatus['update']>
  installUpdate(): Promise<unknown>
}
export function desktopApi(): DesktopApi | undefined { return typeof window === 'undefined' ? undefined : (window as Window & { codeArchiveDesktop?: DesktopApi }).codeArchiveDesktop }
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const desktop = desktopApi()
  if (!desktop) return fetch(path, init)
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((value, key) => { headers[key] = value })
  const result = await desktop.api({ path, method: init.method ?? 'GET', headers, ...(typeof init.body === 'string' ? { body: init.body } : {}) })
  return new Response([204, 205, 304].includes(result.status) ? null : result.body, { status: result.status, headers: result.headers })
}
