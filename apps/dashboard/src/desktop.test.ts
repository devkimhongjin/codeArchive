// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { apiFetch, type DesktopApi } from './desktop'
import { requestBridge, BridgeError } from './bridge'
import { EXTENSION_ID } from './extensionConfig'
import { navigateSameTab } from './navigation'
const desktopWindow = window as Window & { codeArchiveDesktop?: DesktopApi }
afterEach(() => { delete desktopWindow.codeArchiveDesktop; vi.restoreAllMocks() })
it('desktop routes JSON API requests through the native session and bridge without Chrome runtime', async () => {
  const api = vi.fn().mockResolvedValue({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' })
  const bridge = vi.fn().mockResolvedValue({ pendingCount: 2 })
  desktopWindow.codeArchiveDesktop = { api, requestBridge: bridge } as unknown as DesktopApi
  const response = await apiFetch('/api/solutions/bulk', { method: 'POST', headers: { 'X-CodeArchive-Account': 'fixture' }, body: '{}' })
  expect(await response.json()).toEqual({ ok: true })
  expect(api).toHaveBeenCalledWith({ path: '/api/solutions/bulk', method: 'POST', headers: { 'x-codearchive-account': 'fixture' }, body: '{}' })
  expect(await requestBridge(EXTENSION_ID, { type: 'GET_STATUS' })).toEqual({ pendingCount: 2 })
  bridge.mockResolvedValue({ error: 'UNAUTHORIZED' })
  await expect(requestBridge(EXTENSION_ID, { type: 'ACK' })).rejects.toBeInstanceOf(BridgeError)
  await expect(requestBridge('other-extension', { type: 'CONNECT' })).rejects.toBeInstanceOf(BridgeError)
})
it('web requests continue through fetch when the app bridge is absent', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  await apiFetch('/api/auth/me')
  expect(fetcher).toHaveBeenCalledWith('/api/auth/me', {})
})
it('native web login reports server readiness failures and distinguishes installation guidance', async () => {
  const login = vi.fn().mockRejectedValue(new Error("Error invoking remote method 'desktop:login': Error: 서버에 PC 앱 웹 로그인 기능이 아직 적용되지 않았습니다."))
  desktopWindow.codeArchiveDesktop = { login } as unknown as DesktopApi
  const start = vi.fn(), failed = vi.fn()
  window.addEventListener('codearchive-login-start', start); window.addEventListener('codearchive-login-error', failed)
  try {
    navigateSameTab('/api/oauth2/authorization/github')
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())
    expect((failed.mock.calls[0][0] as CustomEvent).detail).toBe('서버에 PC 앱 웹 로그인 기능이 아직 적용되지 않았습니다.')
    expect((start.mock.calls[0][0] as CustomEvent).detail).toBe('login')
    navigateSameTab('https://github.com/apps/codearchive/installations/new?state=fixture')
    expect((start.mock.calls[1][0] as CustomEvent).detail).toBe('install')
  } finally { window.removeEventListener('codearchive-login-start', start); window.removeEventListener('codearchive-login-error', failed) }
})
