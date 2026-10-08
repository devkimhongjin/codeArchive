// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { ApiError } from './api'
import { CODE_THEME_MODE_KEY, DARK_THEMES, LIGHT_THEMES } from '../../../shared/codeThemes'

const mocks = vi.hoisted(() => ({ me: vi.fn(), list: vi.fn(), settings: vi.fn(), bridge: vi.fn(), community: vi.fn(), detail: vi.fn(), comments: vi.fn(), save: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getMe: mocks.me, getSolutions: mocks.list, getAccountSettings: mocks.settings, getCommunitySolutions: mocks.community, getCommunityDetail: mocks.detail, getCommunityComments: mocks.comments, updateAccountSettings: mocks.save }))
vi.mock('./bridge', async original => ({ ...await original<typeof import('./bridge')>(), requestBridge: mocks.bridge }))

const user = { id: 17, githubId: '100', githubLogin: 'me' }
const solution = { id: 7, captureId: 'capture-7', platform: 'SWEA', problemNumber: '1234', title: '내 문제', problemUrl: 'https://example.test/problem/1234', language: 'JAVA', sourceCode: 'class Mine {}', result: 'ACCEPTED', visibility: 'private' }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState({}, '', '/'); vi.clearAllMocks() })

it('shares the saved code theme with the archive, all community picker themes, and a remounted community detail', async () => {
  const original = window.matchMedia
  window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia
  localStorage.setItem(CODE_THEME_MODE_KEY, 'dark')
  let settings = {
    version: 1, name: '', nickname: '테스트', copyHeader: false, downloadHeader: false, githubHeader: false,
    downloadFilenameTemplate: '{platform}-{number}', gitPathTemplate: '{nickname}/{platform}/{number}', githubCommitMessageTemplate: 'Add {platform} {number}',
    lightTheme: 'solarized-light', darkTheme: 'dracula', autoSyncEnabled: false, githubAutoCommitEnabled: false,
  }
  const summary = { id: 44, platform: 'SWEA', problemNumber: '1234', title: '공개 코드', language: 'Java', languageKey: 'java', author: { nickname: '테스트' }, solvedAt: null }
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([solution]); mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  mocks.settings.mockImplementation(async () => settings)
  mocks.save.mockImplementation(async next => { settings = { ...next, version: next.version + 1 }; return settings })
  mocks.community.mockResolvedValue({ items: [summary], page: 0, size: 20, total: 1, hasMore: false })
  mocks.detail.mockResolvedValue({ ...summary, sourceCode: 'class Shared {}', problemUrl: '#' })
  mocks.comments.mockResolvedValue({ items: [], page: 0, size: 20, total: 0, hasMore: false })
  try {
    const view = render(<App />)
    await waitFor(() => expect(document.querySelector('.code-viewer')?.getAttribute('data-shiki-theme')).toBe('dracula'))
    fireEvent.click(screen.getByRole('button', { name: '다른 풀이 보기' }))
    fireEvent.click(await screen.findByRole('button', { name: /테스트.*공개 코드.*코드 보기/ }))
    await waitFor(() => expect(document.querySelector('.code-viewer')?.getAttribute('data-shiki-theme')).toBe('dracula'))
    for (const theme of [...LIGHT_THEMES, ...DARK_THEMES]) {
      fireEvent.change(screen.getByLabelText('코드 보기 테마'), { target: { value: theme } })
      await waitFor(() => expect(document.querySelector('.code-viewer')?.getAttribute('data-shiki-theme')).toBe(theme))
      await waitFor(() => expect(settings.lightTheme === theme || settings.darkTheme === theme).toBe(true))
    }
    const finalTheme = DARK_THEMES[DARK_THEMES.length - 1]!
    fireEvent.click(screen.getByRole('button', { name: '내 문제로 돌아가기' }))
    expect((screen.getByLabelText('코드 보기 테마') as HTMLSelectElement).value).toBe(finalTheme)
    fireEvent.click(screen.getByRole('button', { name: /^커뮤니티$/ }))
    await waitFor(() => expect(document.querySelector('.code-viewer')?.getAttribute('data-shiki-theme')).toBe(finalTheme))
    view.unmount()
    render(<App />)
    await waitFor(() => expect(document.querySelector('.code-viewer')?.getAttribute('data-shiki-theme')).toBe(finalTheme))
    expect((screen.getByLabelText('코드 보기 테마') as HTMLSelectElement).value).toBe(finalTheme)
  } finally { window.matchMedia = original }
}, 15000)

it('opens the exact problem from the archive and keeps a shareable community URL', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([solution]); mocks.settings.mockRejectedValue(new Error('settings unavailable')); mocks.bridge.mockRejectedValue(new Error('extension unavailable')); mocks.community.mockRejectedValue(new ApiError('Publish first', 403))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '다른 풀이 보기' }))
  expect(await screen.findByRole('heading', { name: '커뮤니티' })).toBeTruthy()
  expect(window.location.search).toContain('view=community')
  expect(window.location.search).toContain('platform=SWEA')
  expect(window.location.search).toContain('problemNumber=1234')
  await waitFor(() => expect(mocks.community).toHaveBeenCalledWith('100', 'SWEA', '1234', '', 0, 'submitted'))
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

it('restores settings and GitHub management when navigating browser history', async () => {
  mocks.me.mockRejectedValue(new ApiError('Authentication is required', 401)); mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '설정' }))
  const settingsState = window.history.state
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 관리' }))
  const githubState = window.history.state
  window.dispatchEvent(new PopStateEvent('popstate', { state: settingsState }))
  expect(await screen.findByRole('heading', { name: '설정' })).toBeTruthy()
  window.dispatchEvent(new PopStateEvent('popstate', { state: githubState }))
  expect(await screen.findByRole('heading', { name: 'GitHub 관리' })).toBeTruthy()
  window.dispatchEvent(new PopStateEvent('popstate', { state: { codeArchiveView: 'guide' } }))
  expect(await screen.findByRole('heading', { name: /전체 풀이/ })).toBeTruthy()
})
