// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { ApiError } from './api'

const mocks = vi.hoisted(() => ({ me: vi.fn(), list: vi.fn(), settings: vi.fn(), bridge: vi.fn(), logout: vi.fn(), navigate: vi.fn(), loginComplete: vi.fn(), extension: false }))
vi.mock('./extensionEnvironment', async original => ({ ...await original<typeof import('./extensionEnvironment')>(), extensionRuntime: () => mocks.extension ? { id: 'oohlcmihldmfninmdcmanddfmhoonmdl' } : undefined,
  subscribeExtensionLogin: (callback: (query: string) => void) => { mocks.loginComplete.mockImplementation(callback); return () => mocks.loginComplete.mockReset() },
}))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getMe: mocks.me, getSolutions: mocks.list, getAccountSettings: mocks.settings, logout: mocks.logout }))
vi.mock('./bridge', async original => ({ ...await original<typeof import('./bridge')>(), requestBridge: mocks.bridge }))
vi.mock('./navigation', () => ({ navigateSameTab: mocks.navigate }))
const user = { id: 7, githubId: 'test-connection', githubLogin: 'connection-user' }
const solution = { captureId: 'synthetic-capture', platform: 'SWEA' as const, problemNumber: '1234', title: '연결 테스트 문제', language: 'Java', sourceCode: 'class Main {}', result: 'ACCEPTED' }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.extension = false
  mocks.bridge.mockRejectedValue(new Error('Synthetic disconnected extension'))
  mocks.settings.mockResolvedValue({ version: 1, lightTheme: 'github-light', darkTheme: 'github-dark', autoSyncEnabled: false, githubAutoCommitEnabled: false })
  mocks.logout.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState({}, '', '/') })

it('shows checking and archive loading separately, then automatically closes without a logged-out flash', async () => {
  const session = deferred<typeof user>(), archive = deferred<typeof solution[]>()
  mocks.me.mockReturnValue(session.promise); mocks.list.mockReturnValue(archive.promise)
  render(<App />)
  let dialog = await screen.findByRole('dialog', { name: '서버 연결' })
  expect(within(dialog).getByText('로그인 상태 확인 중')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'GitHub 로그인' })).toBeNull()
  expect(screen.queryByText('이 브라우저에 저장된 풀이가 없습니다.')).toBeNull()
  await act(async () => session.resolve(user))
  expect(within(dialog).getByText('로그인 확인 완료 · 내 풀이 불러오는 중')).toBeTruthy()
  await act(async () => archive.resolve([solution]))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '서버 연결' })).toBeNull())
  expect(screen.getByRole('button', { name: '로그아웃' })).toBeTruthy()
  expect(screen.getAllByText(solution.title).length).toBeGreaterThan(0)
})

it('blocks Escape and backdrop dismissal with no close control until the server is ready', async () => {
  const session = deferred<typeof user>()
  mocks.me.mockReturnValue(session.promise); mocks.list.mockResolvedValue([])
  render(<App />)
  const dialog = await screen.findByRole('dialog', { name: '서버 연결' })
  const cancel = new Event('cancel', { cancelable: true })
  fireEvent(dialog, cancel)
  expect(cancel.defaultPrevented).toBe(true)
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  fireEvent(within(dialog).getByRole('heading', { name: '서버 연결' }), escape)
  expect(escape.defaultPrevented).toBe(true)
  fireEvent.click(dialog)
  expect(screen.queryByRole('button', { name: '서버 연결 안내 닫기' })).toBeNull()
  expect(within(dialog).queryByRole('button', { name: '닫기' })).toBeNull()
  expect(dialog.hasAttribute('open')).toBe(true)
  await act(async () => session.resolve(user))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '서버 연결' })).toBeNull())
})

it('only identifies the session as signed out after a 401 and offers explicit login', async () => {
  mocks.me.mockRejectedValue(new ApiError('Authentication required', 401))
  render(<App />)
  const dialog = await screen.findByRole('dialog', { name: '서버 연결' })
  await within(dialog).findByText('GitHub 로그아웃 상태')
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.navigate).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'GitHub 로그인하기' }))
  expect(mocks.navigate).toHaveBeenCalledWith('/api/oauth2/authorization/github')
  expect(within(dialog).getByText('GitHub 로그인 진행 중')).toBeTruthy()
  expect(dialog.hasAttribute('open')).toBe(true)
})

it('requires login completion and a successful archive reply before unlocking the dashboard', async () => {
  const archive = deferred<typeof solution[]>()
  mocks.me.mockRejectedValueOnce(new ApiError('Authentication required', 401)).mockResolvedValue(user)
  mocks.list.mockReturnValue(archive.promise)
  render(<App />)
  const dialog = await screen.findByRole('dialog', { name: '서버 연결' })
  fireEvent.click(await within(dialog).findByRole('button', { name: 'GitHub 로그인하기' }))
  expect(within(dialog).getByText('GitHub 로그인 진행 중')).toBeTruthy()
  await act(async () => { mocks.loginComplete('') })
  await within(dialog).findByText('로그인 확인 완료 · 내 풀이 불러오는 중')
  expect(dialog.hasAttribute('open')).toBe(true)
  await act(async () => archive.resolve([solution]))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '서버 연결' })).toBeNull())
  expect(screen.getAllByText(solution.title).length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: '로그아웃' })).toBeTruthy()
})

it('shows a login preparation failure inside the mandatory popup and allows another login attempt', async () => {
  mocks.me.mockRejectedValue(new ApiError('Authentication required', 401))
  render(<App />)
  const dialog = await screen.findByRole('dialog', { name: '서버 연결' })
  fireEvent.click(await within(dialog).findByRole('button', { name: 'GitHub 로그인하기' }))
  fireEvent(window, new CustomEvent('codearchive-login-error', { detail: 'Synthetic login preparation failed' }))
  expect(within(dialog).getByRole('alert').textContent).toContain('Synthetic login preparation failed')
  fireEvent.click(within(dialog).getByRole('button', { name: 'GitHub 로그인하기' }))
  expect(mocks.navigate).toHaveBeenCalledTimes(2)
  expect(within(dialog).queryByRole('alert')).toBeNull()
  expect(dialog.hasAttribute('open')).toBe(true)
})

it('does not unlock the dashboard when the session expires before its initial archive reply', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockRejectedValue(new ApiError('Authentication required', 401))
  render(<App />)
  const dialog = await screen.findByRole('dialog', { name: '서버 연결' })
  await within(dialog).findByText('GitHub 로그아웃 상태')
  expect(screen.queryByRole('button', { name: '로그아웃' })).toBeNull()
  expect(within(dialog).getByRole('button', { name: 'GitHub 로그인하기' })).toBeTruthy()
  expect(dialog.hasAttribute('open')).toBe(true)
})

it.each([new ApiError('Unavailable', 503), new ApiError('Forbidden', 403), new TypeError('Failed to fetch')])('does not mistake a connection failure for logout and recovers on explicit retry (%s)', async error => {
  mocks.me.mockRejectedValueOnce(error).mockResolvedValue(user); mocks.list.mockResolvedValue([solution])
  render(<App />)
  const dialog = await screen.findByRole('dialog', { name: '서버 연결' })
  await within(dialog).findByText('서버 연결 실패 · 로그인 상태 확인 불가')
  expect(screen.queryByRole('button', { name: 'GitHub 로그인' })).toBeNull()
  expect(within(dialog).queryByRole('button', { name: 'GitHub 로그인하기' })).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: '다시 연결' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '서버 연결' })).toBeNull())
  expect(mocks.me).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: '로그아웃' })).toBeTruthy()
})

it('distinguishes authenticated archive failure from a failed login check', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockRejectedValue(new ApiError('Unavailable', 503))
  render(<App />)
  const dialog = await screen.findByRole('dialog', { name: '서버 연결' })
  await within(dialog).findByText('로그인 확인 완료 · 풀이 목록 연결 실패')
  expect(screen.getByRole('button', { name: '로그아웃' })).toBeTruthy()
  expect(mocks.navigate).not.toHaveBeenCalled()
})

it('offers a server retry without promising a local archive when the extension archive request fails', async () => {
  mocks.extension = true
  mocks.settings.mockResolvedValue({ version: 1, lightTheme: 'github-light', darkTheme: 'github-dark', autoSyncEnabled: true, githubAutoCommitEnabled: false })
  mocks.me.mockResolvedValue(user); mocks.list.mockRejectedValue(new ApiError('Unavailable', 503))
  render(<App />)
  await screen.findByText('서버의 풀이 목록을 불러오지 못했습니다. 서버 연결을 다시 시도해 주세요.')
  expect(screen.queryByText('라이브 풀이 목록을 불러오지 못했습니다. 이 브라우저의 로컬 기록을 표시합니다.')).toBeNull()
  expect(within(screen.getByRole('dialog', { name: '서버 연결' })).getByText('로그인 확인 완료 · 풀이 목록 연결 실패')).toBeTruthy()
})

it('does not restore a loading session or popup after logout when the old archive reply arrives', async () => {
  const archive = deferred<typeof solution[]>()
  mocks.me.mockResolvedValue(user); mocks.list.mockReturnValue(archive.promise)
  render(<App />)
  await screen.findByRole('button', { name: '로그아웃' })
  // Programmatic auth invalidation still fences the outstanding reply; the
  // native browser modal prevents real pointer access to this background UI.
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  await screen.findByRole('button', { name: 'GitHub 로그인' })
  await act(async () => archive.resolve([solution]))
  expect(screen.getByRole('dialog', { name: '서버 연결' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '로그아웃' })).toBeNull()
  expect(screen.queryByText(solution.title)).toBeNull()
  expect(within(screen.getByRole('dialog', { name: '서버 연결' })).getByText('GitHub 로그아웃 상태')).toBeTruthy()
})

it('stops invalidated loading progress after a failed logout and allows reconnect', async () => {
  const archive = deferred<typeof solution[]>()
  mocks.me.mockResolvedValue(user); mocks.list.mockReturnValueOnce(archive.promise).mockResolvedValue([solution])
  mocks.logout.mockRejectedValue(new ApiError('Synthetic logout failure', 503))
  render(<App />)
  await screen.findByRole('button', { name: '로그아웃' })
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  await screen.findByText('Synthetic logout failure')
  expect((screen.getByRole('button', { name: '서버 연결 새로고침' }) as HTMLButtonElement).disabled).toBe(false)
  await act(async () => archive.resolve([solution]))
  expect(screen.queryByText(solution.title)).toBeNull()
  fireEvent.click(within(screen.getByRole('dialog', { name: '서버 연결' })).getByRole('button', { name: '다시 연결' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '서버 연결' })).toBeNull())
  expect(screen.getAllByText(solution.title).length).toBeGreaterThan(0)
})
