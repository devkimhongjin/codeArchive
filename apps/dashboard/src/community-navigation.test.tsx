// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { ApiError } from './api'

const mocks = vi.hoisted(() => ({ me: vi.fn(), list: vi.fn(), settings: vi.fn(), bridge: vi.fn(), community: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getMe: mocks.me, getSolutions: mocks.list, getAccountSettings: mocks.settings, getCommunitySolutions: mocks.community }))
vi.mock('./bridge', async original => ({ ...await original<typeof import('./bridge')>(), requestBridge: mocks.bridge }))

const user = { id: 17, githubId: '100', githubLogin: 'me' }
const solution = { id: 7, captureId: 'capture-7', platform: 'SWEA', problemNumber: '1234', title: '내 문제', problemUrl: 'https://example.test/problem/1234', language: 'JAVA', sourceCode: 'class Mine {}', result: 'ACCEPTED', visibility: 'private' }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState({}, '', '/'); vi.clearAllMocks() })

it('opens the exact problem from the archive and keeps a shareable community URL', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([solution]); mocks.settings.mockRejectedValue(new Error('settings unavailable')); mocks.bridge.mockRejectedValue(new Error('extension unavailable')); mocks.community.mockRejectedValue(new ApiError('Publish first', 403))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '다른 풀이 보기' }))
  expect(await screen.findByRole('heading', { name: '커뮤니티' })).toBeTruthy()
  expect(window.location.search).toContain('view=community')
  expect(window.location.search).toContain('platform=SWEA')
  expect(window.location.search).toContain('problemNumber=1234')
  await waitFor(() => expect(mocks.community).toHaveBeenCalledWith('100', 'SWEA', '1234', '', 0))
  fireEvent.click(screen.getByRole('button', { name: '내 문제로 돌아가기' }))
  expect(window.location.search).toBe('')
  expect(await screen.findByRole('heading', { name: '내 문제' })).toBeTruthy()
})

it('opens the exact problem from its group action and restores it after archive filters', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([solution]); mocks.settings.mockRejectedValue(new Error('settings unavailable')); mocks.bridge.mockRejectedValue(new Error('extension unavailable')); mocks.community.mockRejectedValue(new ApiError('Publish first', 403))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'SWEA #1234 다른 풀이 보기' }))
  expect(window.location.search).toContain('problemNumber=1234')
  fireEvent.click(screen.getByRole('button', { name: '내 문제로 돌아가기' }))
  fireEvent.change(screen.getByLabelText('문제 검색'), { target: { value: 'not-a-match' } })
  fireEvent.click(screen.getByRole('button', { name: '커뮤니티' }))
  fireEvent.change(screen.getByLabelText('커뮤니티 문제 번호'), { target: { value: '1234' } })
  fireEvent.click(screen.getByRole('button', { name: '문제 찾기' }))
  fireEvent.click(screen.getByRole('button', { name: '내 문제로 돌아가기' }))
  expect((screen.getByLabelText('문제 검색') as HTMLInputElement).value).toBe('')
  expect(await screen.findByRole('heading', { name: '내 문제' })).toBeTruthy()
})

it('does not expose account A source while account B archive is pending', async () => {
  const accountB = { id: 18, githubId: '200', githubLogin: 'other' }
  const pendingB = deferred<typeof solution[]>()
  const pendingDisconnect = deferred<{ ok: boolean }>()
  mocks.me.mockResolvedValueOnce(user).mockResolvedValueOnce(accountB)
  mocks.list.mockRejectedValueOnce(new Error('archive unavailable')).mockReturnValueOnce(pendingB.promise)
  mocks.settings.mockRejectedValue(new Error('settings unavailable'))
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'local-capability' }) : message.type === 'GET_LOCAL_ARCHIVE' ? Promise.resolve({ localOnly: true, captures: [solution] }) : message.type === 'DISCONNECT' ? pendingDisconnect.promise : Promise.resolve({ ok: true }))
  render(<App />)
  expect(await screen.findByRole('heading', { name: '내 문제' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '서버 연결 새로고침' }))
  await waitFor(() => expect(mocks.bridge.mock.calls.some(([, message]) => message.type === 'DISCONNECT')).toBe(true))
  expect(screen.queryByRole('heading', { name: '내 문제' })).toBeNull()
  pendingDisconnect.resolve({ ok: true })
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button', { name: '커뮤니티' }))
  expect(screen.getByText('서버 아카이브 연결이 필요합니다')).toBeTruthy()
  expect(screen.queryByText('class Mine {}')).toBeNull()
  pendingB.resolve([])
  await waitFor(() => expect(screen.getByText('문제를 선택해 주세요')).toBeTruthy())
})

it.each([[401, 'Authentication is required'], [409, 'GitHub account changed; reconnect required']] as const)('clears the archive when a community request reports account failure %i', async (status, message) => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([solution]); mocks.settings.mockRejectedValue(new Error('settings unavailable')); mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  mocks.community.mockRejectedValue(new ApiError(message, status))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '다른 풀이 보기' }))
  expect(await screen.findByText('GitHub 로그인이 필요합니다')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '공개하기' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /전체 풀이/ }))
  expect(screen.queryByRole('heading', { name: '내 문제' })).toBeNull()
})

it('restores a community deep link on refresh but shows no fake results while signed out', async () => {
  window.history.replaceState({}, '', '/?view=community&platform=PROGRAMMERS&problemNumber=5678')
  mocks.me.mockRejectedValue(new ApiError('Authentication is required', 401)); mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  render(<App />)
  expect(await screen.findByRole('heading', { name: '커뮤니티' })).toBeTruthy()
  expect(screen.getByText('GitHub 로그인이 필요합니다')).toBeTruthy()
  expect(mocks.community).not.toHaveBeenCalled()
})

it('restores the archive and community route when browser history changes', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([solution]); mocks.settings.mockRejectedValue(new Error('settings unavailable')); mocks.bridge.mockRejectedValue(new Error('extension unavailable')); mocks.community.mockRejectedValue(new ApiError('Publish first', 403))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '다른 풀이 보기' }))
  const communityUrl = `${window.location.pathname}${window.location.search}`
  window.history.replaceState({}, '', '/')
  window.dispatchEvent(new PopStateEvent('popstate'))
  expect(await screen.findByRole('heading', { name: '내 문제' })).toBeTruthy()
  window.history.replaceState({}, '', communityUrl)
  window.dispatchEvent(new PopStateEvent('popstate'))
  expect(await screen.findByRole('heading', { name: '커뮤니티' })).toBeTruthy()
  expect(screen.getByText('SWEA #1234')).toBeTruthy()
})

it('restores guide and settings when navigating browser history', async () => {
  mocks.me.mockRejectedValue(new ApiError('Authentication is required', 401)); mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '연동 가이드' }))
  const guideState = window.history.state
  fireEvent.click(screen.getByRole('button', { name: '설정' }))
  const settingsState = window.history.state
  window.dispatchEvent(new PopStateEvent('popstate', { state: guideState }))
  expect(await screen.findByRole('heading', { name: '연동 가이드' })).toBeTruthy()
  window.dispatchEvent(new PopStateEvent('popstate', { state: settingsState }))
  expect(await screen.findByRole('heading', { name: '설정' })).toBeTruthy()
})
