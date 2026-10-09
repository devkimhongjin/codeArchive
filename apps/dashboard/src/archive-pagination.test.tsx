// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { ApiError } from './api'
import type { Solution } from './types'

const mocks = vi.hoisted(() => ({ me: vi.fn(), list: vi.fn(), settings: vi.fn(), bridge: vi.fn(), community: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getMe: mocks.me, getSolutions: mocks.list, getAccountSettings: mocks.settings, getCommunitySolutions: mocks.community }))
vi.mock('./bridge', async original => ({ ...await original<typeof import('./bridge')>(), requestBridge: mocks.bridge }))
const records: Solution[] = Array.from({ length: 41 }, (_, index) => ({
  captureId: `capture-${index + 1}`, platform: index < 20 ? 'SWEA' : 'PROGRAMMERS',
  problemNumber: String(index + 1), title: `문제 ${index + 1}`, problemUrl: 'https://example.test/problem',
  language: index < 20 ? 'Java' : 'Python', sourceCode: '// synthetic', result: 'ACCEPTED',
  solvedAt: '2026-01-01T00:00:00Z',
}))
const archive = [...records, { ...records[0]!, captureId: 'same-problem-other-submission', language: 'Java 17' }]
const list = () => screen.getByRole('region', { name: '풀이 목록' })
const rows = () => within(list()).queryAllByRole('button', { name: /다른 풀이 보기/ })
const page = () => screen.getByRole('combobox', { name: '풀이 목록 페이지' }) as HTMLSelectElement
async function openArchive() {
  render(<App />)
  await waitFor(() => expect(rows()).toHaveLength(20))
  fireEvent.change(screen.getByRole('combobox', { name: '풀이 정렬' }), { target: { value: 'problem' } })
}
beforeEach(() => {
  mocks.me.mockResolvedValue({ id: 17, githubId: '100', githubLogin: 'fixture' })
  mocks.list.mockResolvedValue(archive)
  mocks.settings.mockRejectedValue(new Error('settings unavailable'))
  mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  mocks.community.mockRejectedValue(new ApiError('Publish first', 403))
})
afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState({}, '', '/'); vi.resetAllMocks() })

it('shows the archive and export controls without the removed analysis feature', async () => {
  await openArchive()
  expect(screen.getByRole('region', { name: '소스 코드' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /^복사$/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /^다운로드$/ })).toBeTruthy()
  expect(screen.getByRole('combobox', { name: '코드 보기 테마' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: '로컬 정적 분석' })).toBeNull()
  expect(screen.queryByRole('button', { name: '기본 정적 검사' })).toBeNull()
  expect(screen.queryByRole('button', { name: '분석 캐시 지우기' })).toBeNull()
})

it('pages 20 problem groups, keeps duplicate submissions together and selects the visible detail', async () => {
  await openArchive()
  expect(rows()).toHaveLength(20)
  expect(within(list()).getByText('풀이 2개')).toBeTruthy()
  expect(within(list()).queryByText('문제 21')).toBeNull()
  expect((screen.getByRole('button', { name: '풀이 이전 페이지' }) as HTMLButtonElement).disabled).toBe(true)
  const scrollList = list().querySelector('.solution-list') as HTMLDivElement
  scrollList.scrollTop = 640
  fireEvent.click(screen.getByRole('button', { name: '풀이 다음 페이지' }))
  expect(scrollList.scrollTop).toBe(0)
  expect(rows()).toHaveLength(20)
  expect(await screen.findByRole('heading', { name: '문제 21' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '설정' }))
  fireEvent.click(screen.getByRole('button', { name: /전체 풀이/ }))
  expect(page().value).toBe('2')
  fireEvent.change(page(), { target: { value: '3' } })
  expect(rows()).toHaveLength(1)
  expect(await screen.findByRole('heading', { name: '문제 41' })).toBeTruthy()
  expect((screen.getByRole('button', { name: '풀이 다음 페이지' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(within(list()).getByRole('button', { name: 'PROGRAMMERS #41 다른 풀이 보기' }))
  fireEvent.click(await screen.findByRole('button', { name: '내 문제로 돌아가기' }))
  expect(page().value).toBe('3')
  expect(await screen.findByRole('heading', { name: '문제 41' })).toBeTruthy()
})

it('resets the page on search, platform, language and sorting changes, including no results', async () => {
  await openArchive()
  fireEvent.change(page(), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText('문제 검색'), { target: { value: '문제 40' } })
  expect(page().value).toBe('1'); expect(rows()).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '검색어 지우기' }))
  fireEvent.change(page(), { target: { value: '2' } })
  fireEvent.click(within(screen.getByRole('group', { name: '플랫폼 필터' })).getByRole('button', { name: 'SWEA' }))
  expect(page().value).toBe('1'); expect(rows()).toHaveLength(20)
  fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
  fireEvent.change(page(), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText('언어 필터'), { target: { value: 'python' } })
  expect(page().value).toBe('1'); expect(rows()).toHaveLength(20)
  fireEvent.change(page(), { target: { value: '2' } })
  fireEvent.change(screen.getByRole('combobox', { name: '풀이 정렬' }), { target: { value: 'oldest' } })
  expect(page().value).toBe('1')
  fireEvent.change(screen.getByLabelText('문제 검색'), { target: { value: 'no-result' } })
  expect(rows()).toHaveLength(0); expect(page().value).toBe('1'); expect(page().disabled).toBe(true)
})

it('clamps a later page after the server archive shrinks', async () => {
  await openArchive()
  fireEvent.change(page(), { target: { value: '3' } })
  mocks.list.mockResolvedValue([records[0]])
  fireEvent.click(screen.getByRole('button', { name: /서버 목록 새로고침/ }))
  await waitFor(() => expect(rows()).toHaveLength(1))
  expect(page().value).toBe('1')
  expect(await screen.findByRole('heading', { name: '문제 1' })).toBeTruthy()
})
