import { afterEach, expect, it, vi } from 'vitest'
import { extensionApiUrl, extensionRuntime, subscribeExtensionLogin } from './extensionEnvironment'
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
  expect(runtime.sendMessage.mock.calls[0]?.[0]).toEqual({ type: 'DASHBOARD_OPEN_EXTERNAL', url: '/api/oauth2/authorization/github' })
  expect(location.assign).not.toHaveBeenCalled()
  expect(dispatchEvent).toHaveBeenCalled()
})
it('refreshes only a completed login and reports failure without restarting OAuth', () => {
  const { runtime, dispatchEvent } = fixture()
  const completed = vi.fn()
  const dispose = subscribeExtensionLogin(completed)
  const listener = runtime.onMessage.addListener.mock.calls[0]![0] as (value: unknown, sender: { id?: string; tab?: unknown }) => void
  listener({ type: 'DASHBOARD_LOGIN_COMPLETE' }, { id: 'other' })
  listener({ type: 'DASHBOARD_LOGIN_COMPLETE' }, { id, tab: { id: 3 } })
  listener({ type: 'unrelated' }, { id })
  listener({ type: 'DASHBOARD_LOGIN_FAILED' }, { id })
  expect(completed).not.toHaveBeenCalled()
  expect(dispatchEvent).toHaveBeenCalled()
  listener({ type: 'DASHBOARD_LOGIN_COMPLETE', returnQuery: 'githubInstall=success&installationId=12' }, { id })
  expect(completed).toHaveBeenCalledWith('githubInstall=success&installationId=12')
  dispose()
  expect(runtime.onMessage.removeListener).toHaveBeenCalledWith(listener)
})
