// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

const mocks = vi.hoisted(() => ({ me: vi.fn(), list: vi.fn(), logout: vi.fn(), bridge: vi.fn() }))
vi.mock('./api', async (original) => ({
  ...await original<typeof import('./api')>(),
  getMe: mocks.me,
  getSolutions: mocks.list,
  logout: mocks.logout,
}))
vi.mock('./bridge', async (original) => ({
  ...await original<typeof import('./bridge')>(),
  requestBridge: mocks.bridge,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })

it('clears the authenticated screen when sync cleanup finishes during server logout', async () => {
  const pending = deferred<{ captures: never[] }>()
  const loggedOut = deferred<void>()
  const user = { id: 1, githubId: '42', githubLogin: 'private-account' }
  localStorage.setItem('codearchive-extension-id', 'a'.repeat(32))
  mocks.me.mockResolvedValue(user)
  mocks.list.mockResolvedValue([])
  mocks.logout.mockReturnValue(loggedOut.promise)
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'CONNECT') return Promise.resolve({ capability: 'valid-session-capability' })
    if (message.type === 'GET_PENDING') return pending.promise
    return Promise.resolve({ ok: true })
  })
  render(<App />)
  await screen.findByRole('button', { name: '로그아웃' })
  fireEvent.click(screen.getByRole('button', { name: /^동기화$/ }))
  await waitFor(() => expect(mocks.bridge.mock.calls.some(([, message]) => message.type === 'GET_PENDING')).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())
  await act(async () => { pending.resolve({ captures: [] }) })
  await act(async () => { loggedOut.resolve() })
  await waitFor(() => expect(screen.queryByRole('button', { name: '로그아웃' })).toBeNull())
  expect(screen.getByText('로컬 보관함')).toBeTruthy()
  expect(screen.queryByText('private-account')).toBeNull()
})
