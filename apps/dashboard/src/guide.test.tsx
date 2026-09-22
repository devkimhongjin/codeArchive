// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

const mocks = vi.hoisted(() => ({ me: vi.fn(), list: vi.fn(), bridge: vi.fn(), latestRelease: vi.fn() }))

vi.mock('./api', async (original) => ({
  ...await original<typeof import('./api')>(),
  getMe: mocks.me,
  getSolutions: mocks.list,
}))
vi.mock('./bridge', async (original) => ({ ...await original<typeof import('./bridge')>(), requestBridge: mocks.bridge }))
vi.mock('./extensionRelease', async (original) => ({
  ...await original<typeof import('./extensionRelease')>(),
  fetchLatestExtensionRelease: mocks.latestRelease,
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  vi.clearAllMocks()
})

it('documents the current local-first relay and GitHub App setup flow without legacy manual IDs', async () => {
  mocks.me.mockRejectedValue(new Error('signed out'))
  mocks.list.mockResolvedValue([])
  mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  mocks.latestRelease.mockRejectedValue(new Error('release unavailable'))

  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '연동 가이드' }))

  expect(await screen.findByRole('heading', { name: '확장 프로그램 설치' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '첫 PASS를 로컬에 저장' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'GitHub 로그인 · 자동 연결' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '자동 동기화 설정' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'GitHub App · 저장 위치 선택' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '저장 결과 확인' })).toBeTruthy()
  expect(screen.getByText(/동기화 대기·동기화됨/).textContent).toContain('GitHub 완료')
  expect(screen.getByText(/동기화 대기·동기화됨/).textContent).toContain('커밋 확인 필요')
  expect(screen.getByText(/동기화 대기·동기화됨/).textContent).toContain('자동 커밋 안 함')
  const recovery = screen.getByRole('region', { name: '연결 상태별 복구 방법' })
  expect(recovery.textContent).toContain('확인 대기')
  expect(recovery.textContent).toContain('릴레이 설정 필요')
  expect(recovery.textContent).toContain('연결 재시도')
  expect(recovery.textContent).toContain('인증 만료')
  expect(recovery.textContent).toContain('확장 재연결')
  expect(recovery.textContent).toContain('서버 폐기 대기')
  expect(recovery.textContent).toContain('커밋 실패 · 확인 필요')
  expect(recovery.textContent).toContain('자동 커밋 안 함')
  expect(screen.getByText('PASS → 로컬 저장 → 릴레이 자동 동기화 → GitHub 자동 커밋')).toBeTruthy()
  expect(screen.queryByText(/확장 프로그램 ID를 입력하세요/)).toBeNull()
  expect(screen.queryByText(/ID를 붙여 넣으세요/)).toBeNull()
  expect(screen.queryByText(/수동 (ID|연결)/)).toBeNull()
})
