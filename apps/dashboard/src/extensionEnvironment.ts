import { PUBLIC_API_ORIGIN } from '../../../shared/publicApiOrigin'
// Extension pages share Chrome's HttpOnly session; credentials are never read by JS.
export const EXTENSION_API_ORIGIN = PUBLIC_API_ORIGIN
type ExtensionRuntime = {
  id?: string
  lastError?: { message?: string }
  sendMessage(message: unknown, callback: (response: unknown) => void): unknown
  onMessage?: { addListener(listener: (message: unknown, sender: { id?: string; tab?: unknown }, respond: (response: unknown) => void) => void): void; removeListener(listener: (message: unknown, sender: { id?: string; tab?: unknown }, respond: (response: unknown) => void) => void): void }
}
type ExtensionWindow = Window & { chrome?: { runtime?: ExtensionRuntime } }
export function extensionRuntime(): ExtensionRuntime | undefined {
  if (typeof window === 'undefined' || window.location.protocol !== 'chrome-extension:') return undefined
  const runtime = (window as ExtensionWindow).chrome?.runtime
  return runtime?.id === window.location.hostname ? runtime : undefined
}
export function extensionApiUrl(path: string): string {
  if (!path.startsWith('/api/') || path.includes('\\')) throw new Error('허용되지 않은 API 경로입니다.')
  const url = new URL(path, EXTENSION_API_ORIGIN)
  if (url.origin !== EXTENSION_API_ORIGIN || !url.pathname.startsWith('/api/')) throw new Error('허용되지 않은 API 경로입니다.')
  return url.href
}
export function extensionMessage<T>(message: unknown): Promise<T> {
  const runtime = extensionRuntime()
  if (!runtime) return Promise.reject(new Error('확장 관리 화면에서만 사용할 수 있습니다.'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('확장 응답 시간이 초과되었습니다.')), 10000)
    try { runtime.sendMessage(message, response => {
      clearTimeout(timer)
      if (runtime.lastError?.message) { reject(new Error(runtime.lastError.message)); return }
      if (!response || typeof response !== 'object' || Array.isArray(response)) { reject(new Error('확장 응답을 확인하지 못했습니다.')); return }
      const error = (response as { error?: unknown }).error
      if (typeof error === 'string') { reject(new Error(error)); return }
      resolve(response as T)
    }) } catch (error) { clearTimeout(timer); reject(error) }
  })
}
let pendingLoginNonce: string | null = null
export async function openExtensionExternal(url: string): Promise<unknown> {
  let target = url
  if (url === '/api/oauth2/authorization/github' || url === extensionApiUrl('/api/oauth2/authorization/github')) {
    const csrfResponse = await fetch(extensionApiUrl('/api/auth/csrf'), { credentials: 'include' })
    if (!csrfResponse.ok) throw new Error('로그인 보안 토큰을 확인하지 못했습니다.')
    const csrf = await csrfResponse.json() as { headerName?: unknown; token?: unknown }
    if ((csrf.headerName !== 'X-XSRF-TOKEN' && csrf.headerName !== 'X-CSRF-TOKEN') || typeof csrf.token !== 'string' || !csrf.token) throw new Error('로그인 보안 토큰을 확인하지 못했습니다.')
    const started = await fetch(extensionApiUrl('/api/extension-login/start'), { method: 'POST', credentials: 'include', headers: { [csrf.headerName]: csrf.token } })
    if (!started.ok) throw new Error('로그인 준비를 시작하지 못했습니다.')
    const payload = await started.json() as { authorizationUrl?: unknown }
    if (payload.authorizationUrl !== '/api/oauth2/authorization/github') throw new Error('로그인 준비를 확인하지 못했습니다.')
    target = extensionApiUrl(payload.authorizationUrl)
  }
  const loginNonce = crypto.randomUUID()
  pendingLoginNonce = loginNonce
  try { return await extensionMessage({ type: 'DASHBOARD_OPEN_EXTERNAL', url: target, loginNonce }) }
  catch (error) { if (pendingLoginNonce === loginNonce) pendingLoginNonce = null; throw error }
}
export function subscribeExtensionLogin(onComplete: (returnQuery: string) => void): () => void {
  const runtime = extensionRuntime()
  const listener = (message: unknown, sender: { id?: string; tab?: unknown }, respond: (response: unknown) => void) => {
    if (sender?.id !== runtime?.id || sender.tab) return
    if (!message || typeof message !== 'object') return
    const value = message as { type?: string; returnQuery?: string; loginNonce?: string }
    if (!['DASHBOARD_LOGIN_COMPLETE', 'DASHBOARD_LOGIN_FAILED'].includes(value.type ?? '') || !pendingLoginNonce || value.loginNonce !== pendingLoginNonce) return
    pendingLoginNonce = null
    respond({ ready: true, loginNonce: value.loginNonce })
    if (value.type === 'DASHBOARD_LOGIN_COMPLETE') onComplete(typeof value.returnQuery === 'string' ? value.returnQuery : '')
    if (value.type === 'DASHBOARD_LOGIN_FAILED') window.dispatchEvent(new CustomEvent('codearchive-login-error', { detail: 'GitHub 로그인을 완료하지 못했습니다. 다시 시도해 주세요.' }))
  }
  runtime?.onMessage?.addListener(listener)
  return () => { pendingLoginNonce = null; runtime?.onMessage?.removeListener(listener) }
}
