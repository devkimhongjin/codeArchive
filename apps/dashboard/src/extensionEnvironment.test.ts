import { afterEach, expect, it, vi } from 'vitest'
import { extensionApiUrl, extensionRuntime, openExtensionExternal, subscribeExtensionLogin } from './extensionEnvironment'
import { apiFetch } from './desktop'
import { requestBridge } from './bridge'
import { navigateSameTab } from './navigation'
const id = 'oohlcmihldmfninmdcmanddfmhoonmdl'
function fixture() {
  const sendMessage = vi.fn((_message, callback) => callback({ ok: true }))
  const onMessage = { addListener: vi.fn(), removeListener: vi.fn() }
  const runtime = { id, sendMessage, onMessage }
  const location = { protocol: 'chrome-extension:', hostname: id, assign: vi.fn() }
  const dispatchEvent = vi.fn()
  vi.stubGlobal('window', { chrome: { runtime }, location, dispatchEvent })
  return { runtime, location, dispatchEvent }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('uses only the current extension and fixed API origin, preserving HttpOnly browser sessions', async () => {
  const { runtime, location } = fixture()
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetcher)
  expect(extensionRuntime()).toBe(runtime)
  await apiFetch('/api/auth/me', { credentials: 'omit' })
  expect(fetcher).toHaveBeenCalledWith('https://codearchive-dashboard-beta.netlify.app/api/auth/me', { credentials: 'include' })
  for (const path of ['https://evil.test/api/me', '//evil.test/api/me', '/api/../secret', '/api/\\evil', '/api/%2e%2e/secret']) expect(() => extensionApiUrl(path)).toThrow()
  location.hostname = 'other'
  expect(extensionRuntime()).toBeUndefined()
})
it('uses the internal capability bridge and rejects another extension storage identity', async () => {
  const { runtime } = fixture()
  await expect(requestBridge(id, { type: 'CONNECT' })).resolves.toEqual({ ok: true })
  expect(runtime.sendMessage.mock.calls[0]?.[0]).toEqual({ type: 'DASHBOARD_REQUEST', message: { type: 'CONNECT' } })
  await expect(requestBridge('other', { type: 'CONNECT' })).rejects.toThrow('현재 확장 저장소')
  expect(runtime.sendMessage).toHaveBeenCalledTimes(1)
})
it('opens provider flow through the worker without navigating away from the management page', async () => {
  const { runtime, location, dispatchEvent } = fixture()
  navigateSameTab('/api/oauth2/authorization/github')
  expect(runtime.sendMessage.mock.calls[0]?.[0]).toEqual({ type: 'DASHBOARD_OPEN_EXTERNAL', url: '/api/oauth2/authorization/github', loginNonce: expect.any(String) })
  expect(location.assign).not.toHaveBeenCalled()
  expect(dispatchEvent).toHaveBeenCalled()
})
it('refreshes only the initiating login document after a matching nonce', async () => {
  const { runtime, dispatchEvent } = fixture()
  const completed = vi.fn()
  const dispose = subscribeExtensionLogin(completed)
  await openExtensionExternal('/api/oauth2/authorization/github')
  const loginNonce = (runtime.sendMessage.mock.calls[0]![0] as { loginNonce: string }).loginNonce
  const listener = runtime.onMessage.addListener.mock.calls[0]![0] as (value: unknown, sender: { id?: string; tab?: unknown }, respond: (response: unknown) => void) => void
  const respond = vi.fn(), message = { type: 'DASHBOARD_LOGIN_COMPLETE', loginNonce }
  listener(message, { id: 'other' }, respond)
  listener(message, { id, tab: { id: 3 } }, respond)
  listener({ type: 'unrelated', loginNonce }, { id }, respond)
  listener({ ...message, loginNonce: 'different' }, { id }, respond)
  expect(completed).not.toHaveBeenCalled()
  expect(respond).not.toHaveBeenCalled()
  listener({ ...message, returnQuery: 'githubInstall=success&installationId=12' }, { id }, respond)
  expect(completed).toHaveBeenCalledWith('githubInstall=success&installationId=12')
  expect(respond).toHaveBeenCalledWith({ ready: true, loginNonce })
  listener(message, { id }, respond)
  expect(completed).toHaveBeenCalledTimes(1)
  await openExtensionExternal('/api/oauth2/authorization/github')
  const failedNonce = (runtime.sendMessage.mock.calls[1]![0] as { loginNonce: string }).loginNonce
  listener({ type: 'DASHBOARD_LOGIN_FAILED', loginNonce: failedNonce }, { id }, respond)
  expect(dispatchEvent).toHaveBeenCalled()
  dispose()
  expect(runtime.onMessage.removeListener).toHaveBeenCalledWith(listener)
})
it('cannot acknowledge a return after the initiating document unmounts', async () => {
  const { runtime } = fixture(), completed = vi.fn(), respond = vi.fn()
  const dispose = subscribeExtensionLogin(completed)
  await openExtensionExternal('/api/oauth2/authorization/github')
  const loginNonce = (runtime.sendMessage.mock.calls[0]![0] as { loginNonce: string }).loginNonce
  const listener = runtime.onMessage.addListener.mock.calls[0]![0] as (message: unknown, sender: { id: string }, respond: (response: unknown) => void) => void
  dispose(); listener({ type: 'DASHBOARD_LOGIN_COMPLETE', loginNonce }, { id }, respond)
  expect(respond).not.toHaveBeenCalled(); expect(completed).not.toHaveBeenCalled()
})
