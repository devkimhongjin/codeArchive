// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { apiFetch, type DesktopApi } from './desktop'
import { requestBridge, BridgeError } from './bridge'
import { EXTENSION_ID } from './extensionConfig'
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
