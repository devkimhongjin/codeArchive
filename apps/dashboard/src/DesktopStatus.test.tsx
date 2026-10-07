// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DesktopStatusProvider, DesktopVersion, DesktopUpdateNotice, useDesktopStatus } from './DesktopStatus'
import { DesktopSettings } from './DesktopSettings'
import type { DesktopApi, DesktopStatus } from './desktop'
let status: DesktopStatus
const desktopWindow = window as Window & { codeArchiveDesktop?: DesktopApi }
const install = vi.fn(), setAutoUpdate = vi.fn()
function Refresh() { const { refresh } = useDesktopStatus(); return <button onClick={() => void refresh()}>refresh</button> }
beforeEach(() => {
  status = { version: '0.1.1', packaged: true, connected: true, autostart: false, autoUpdate: false, update: { state: 'available', version: '0.1.2', message: 'new' } }
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
  desktopWindow.codeArchiveDesktop = { getStatus: vi.fn(async () => ({ ...status })), reportActivity: vi.fn(async () => {}), installUpdate: install, setAutoUpdate, checkUpdate: vi.fn(async () => status.update) } as unknown as DesktopApi
  install.mockReset(); setAutoUpdate.mockReset().mockImplementation(async value => { status = { ...status, autoUpdate: value } })
})
afterEach(() => { cleanup(); delete desktopWindow.codeArchiveDesktop; vi.restoreAllMocks() })
it('shows a new version in a popup, dismisses once per version, opens again for a subsequent release', async () => {
  render(<DesktopStatusProvider><DesktopVersion /><DesktopUpdateNotice /><Refresh /></DesktopStatusProvider>)
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
  expect(screen.getByText('PC 앱 v0.1.1')).toBeTruthy()
  fireEvent.click(screen.getByText('나중에')); expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByText('refresh')); await act(async () => {})
  expect(screen.queryByRole('dialog')).toBeNull()
  status = { ...status, update: { ...status.update, version: '0.1.3' } }
  fireEvent.click(screen.getByText('refresh')); await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
})
it('waits for another modal to close and reports install errors without discarding the popup', async () => {
  const setup = document.createElement('dialog'); setup.setAttribute('open', ''); document.body.append(setup)
  render(<DesktopStatusProvider><DesktopUpdateNotice /><Refresh /></DesktopStatusProvider>)
  await waitFor(() => expect(desktopWindow.codeArchiveDesktop!.getStatus).toHaveBeenCalled())
  expect(document.querySelector('.desktop-update-dialog[open]')).toBeNull()
  setup.remove(); fireEvent.click(screen.getByText('refresh'))
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
  install.mockRejectedValue(new Error('진행 중인 작업'))
  fireEvent.click(screen.getByText('업데이트 다운로드·적용'))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('진행 중인 작업'))
})
it('settings display current version and save automatic update opt-in through native API', async () => {
  render(<DesktopStatusProvider><DesktopSettings /></DesktopStatusProvider>)
  await waitFor(() => expect(screen.getByText('v0.1.1')).toBeTruthy())
  const toggle = screen.getByLabelText('자동 업데이트') as HTMLInputElement
  expect(toggle.checked).toBe(false); fireEvent.click(toggle)
  await waitFor(() => expect(toggle.checked).toBe(true)); expect(setAutoUpdate).toHaveBeenCalledWith(true)
  fireEvent.click(toggle); await waitFor(() => expect(toggle.checked).toBe(false))
})
it('does not show update UI on the web or popup when already current', async () => {
  status = { ...status, update: { state: 'current', version: null, message: '최신 버전입니다.' } }
  const { unmount } = render(<DesktopStatusProvider><DesktopUpdateNotice /></DesktopStatusProvider>)
  await act(async () => {}); expect(screen.queryByRole('dialog')).toBeNull(); unmount()
  delete desktopWindow.codeArchiveDesktop; render(<DesktopStatusProvider><DesktopVersion /><DesktopUpdateNotice /><DesktopSettings /></DesktopStatusProvider>)
  expect(document.querySelector('.desktop-version')).toBeNull(); expect(document.querySelector('dialog')).toBeNull()
})

it('does not announce the same release again after a periodic check closes its popup', async () => {
  render(<DesktopStatusProvider><DesktopUpdateNotice /><Refresh /></DesktopStatusProvider>)
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
  status = { ...status, update: { state: 'checking', version: null, message: 'checking' } }
  fireEvent.click(screen.getByText('refresh')); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  status = { ...status, update: { state: 'available', version: '0.1.2', message: 'new' } }
  fireEvent.click(screen.getByText('refresh')); await act(async () => {})
  expect(screen.queryByRole('dialog')).toBeNull()
})
