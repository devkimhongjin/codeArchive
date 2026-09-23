// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { CommunityView } from './CommunityView'
import type { CommunityRoute } from './communityRoute'
import type { Solution, User } from './types'

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), visibility: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getCommunitySolutions: mocks.list, getCommunityDetail: mocks.detail, setCommunityVisibility: mocks.visibility }))
vi.mock('./CodeBlock', () => ({ CodeBlock: ({ code }: { code: string }) => <pre aria-label="검증 코드">{code}</pre> }))

const user: User = { id: 1, githubId: '100', githubLogin: 'me' }
const own: Solution = { id: 7, captureId: 'mine', platform: 'SWEA', problemNumber: '1234', title: '문제 1234', problemUrl: '#', language: 'JAVA', languageKey: 'java', sourceCode: 'class Mine {}', result: 'ACCEPTED', visibility: 'private' }
const route: CommunityRoute = { platform: 'SWEA', problemNumber: '1234', languageKey: '', page: 0, detailId: null }
const summary = { id: 44, platform: 'SWEA', problemNumber: '1234', title: '다른 풀이', language: 'Java', languageKey: 'java', solvedAt: null, publishedAt: '2026-09-23T00:00:00Z', author: { name: '다른 사용자', nickname: '닉네임', avatarUrl: null } }
const page = { items: [summary], page: 0, size: 20, total: 21, hasMore: true }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

function Harness({ account = user, mode = 'live', initial = route, initialSolutions = [own] }: { account?: User | null; mode?: 'live' | 'local'; initial?: CommunityRoute; initialSolutions?: Solution[] }) {
  const [current, setCurrent] = useState(initial)
  const [solutions, setSolutions] = useState(initialSolutions)
  return <CommunityView user={account} mode={mode} solutions={solutions} route={current} onRouteChange={setCurrent} onReturnToArchive={() => undefined} onVisibilityChanged={(_expectedGithubId, id, visibility, publishedAt) => setSolutions(values => values.map(value => value.id === id ? { ...value, visibility, publishedAt } : value))} onAuthInvalid={() => undefined} onLogin={() => undefined} lightTheme="github-light" darkTheme="github-dark" />
}

beforeEach(() => { mocks.list.mockResolvedValue(page); mocks.detail.mockResolvedValue({ ...summary, problemUrl: '#', sourceCode: 'class Other {}', executionTime: 12, memoryValue: 1024, memoryUnit: 'KB' }); mocks.visibility.mockResolvedValue({ visibility: 'published', publishedAt: '2026-09-23T00:00:00Z' }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('shows login or server connection guidance without requesting community data', () => {
  const view = render(<Harness account={null} mode="local" />)
  expect(screen.getByText('GitHub 로그인이 필요합니다')).toBeTruthy()
  view.rerender(<Harness account={user} mode="local" />)
  expect(screen.getByText('서버 아카이브 연결이 필요합니다')).toBeTruthy()
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.detail).not.toHaveBeenCalled()
})

it('loads only same-problem summaries and fetches source after explicit selection', async () => {
  render(<Harness />)
  expect(await screen.findByText('다른 사용자 · 닉네임')).toBeTruthy()
  expect(mocks.list).toHaveBeenCalledWith('100', 'SWEA', '1234', '', 0)
  expect(mocks.detail).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /다른 사용자.*다른 풀이/ }))
  expect((await screen.findByLabelText('검증 코드')).textContent).toContain('class Other {}')
  expect(mocks.detail).toHaveBeenCalledWith('100', 44)
  fireEvent.click(screen.getByRole('button', { name: '목록으로' }))
  await waitFor(() => expect(screen.queryByLabelText('검증 코드')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('100', 'SWEA', '1234', '', 1))
  fireEvent.change(screen.getByLabelText('커뮤니티 언어 필터'), { target: { value: 'java' } })
  await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('100', 'SWEA', '1234', 'java', 0))
})

it('requires a code-visible confirmation before publishing the viewer’s own solution', async () => {
  mocks.list.mockRejectedValueOnce(new ApiError('Publish your solution first', 403)).mockResolvedValue(page)
  render(<Harness />)
  expect(await screen.findByText(/이 문제의 내 풀이를 먼저 공개해야/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '공개하기' }))
  expect(screen.getByLabelText('공개 대상 코드').textContent).toContain('class Mine {}')
  expect(mocks.visibility).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '이 풀이 공개 확인' }))
  await waitFor(() => expect(mocks.visibility).toHaveBeenCalledWith('100', 7, 'published'))
  expect(await screen.findByText('다른 사용자 · 닉네임')).toBeTruthy()
})

it('does not offer publication for a non-accepted solution', async () => {
  render(<Harness initialSolutions={[{ ...own, result: 'WRONG_ANSWER' }]} />)
  expect(await screen.findByText(/통과한 풀이만 공개 가능/)).toBeTruthy()
  expect((screen.getByRole('button', { name: '공개하기' }) as HTMLButtonElement).disabled).toBe(true)
  expect(mocks.visibility).not.toHaveBeenCalled()
})

it('keeps a valid session when publishing returns an eligibility conflict', async () => {
  mocks.visibility.mockRejectedValue(new ApiError('Only accepted solutions can be published', 409))
  const invalidated = vi.fn()
  render(<CommunityView user={user} mode="live" solutions={[own]} route={route} onRouteChange={vi.fn()} onReturnToArchive={vi.fn()} onVisibilityChanged={vi.fn()} onAuthInvalid={invalidated} onLogin={vi.fn()} lightTheme="github-light" darkTheme="github-dark" />)
  fireEvent.click(await screen.findByRole('button', { name: '공개하기' }))
  fireEvent.click(screen.getByRole('button', { name: '이 풀이 공개 확인' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '통과한 풀이만 공개할 수 있습니다. 풀이 상태를 새로 확인해 주세요.')
  expect(invalidated).not.toHaveBeenCalled()
  expect(screen.getByText('내 풀이 공개 설정')).toBeTruthy()
})

it('never renders a detail from another problem even when a valid ID was supplied', async () => {
  mocks.detail.mockResolvedValue({ ...summary, problemNumber: '9999', sourceCode: 'private-looking code' })
  render(<Harness initial={{ ...route, detailId: 44 }} />)
  expect(await screen.findByText('이 문제의 풀이를 찾지 못했습니다.')).toBeTruthy()
  expect(screen.queryByText('private-looking code')).toBeNull()
})

it('distinguishes an empty result from a server error and offers refresh', async () => {
  mocks.list.mockResolvedValueOnce({ ...page, items: [], total: 0, hasMore: false }).mockRejectedValueOnce(new ApiError('server unavailable', 503)).mockResolvedValueOnce(page)
  render(<Harness />)
  expect(await screen.findByText('이 문제에 공개된 다른 풀이가 없습니다.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '커뮤니티 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
  expect(await screen.findByText('다른 사용자 · 닉네임')).toBeTruthy()
})

it('ignores a visibility response from a previous GitHub account', async () => {
  const pending = deferred<{ visibility: 'published'; publishedAt: string }>()
  mocks.visibility.mockReturnValue(pending.promise)
  const changed = vi.fn()
  const props = { mode: 'live' as const, solutions: [own], route, onRouteChange: vi.fn(), onReturnToArchive: vi.fn(), onVisibilityChanged: changed, onAuthInvalid: vi.fn(), onLogin: vi.fn(), lightTheme: 'github-light' as const, darkTheme: 'github-dark' as const }
  const view = render(<CommunityView {...props} user={user} />)
  fireEvent.click(await screen.findByRole('button', { name: '공개하기' }))
  fireEvent.click(screen.getByRole('button', { name: '이 풀이 공개 확인' }))
  await waitFor(() => expect(mocks.visibility).toHaveBeenCalledWith('100', 7, 'published'))
  view.rerender(<CommunityView {...props} user={{ id: 2, githubId: '200', githubLogin: 'other' }} />)
  pending.resolve({ visibility: 'published', publishedAt: '2026-09-23T00:00:00Z' })
  await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('200', 'SWEA', '1234', '', 0))
  expect(changed).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('풀이 공개 설정 확인')).toBeNull()
  expect((screen.getByRole('button', { name: '공개하기' }) as HTMLButtonElement).disabled).toBe(false)
})
