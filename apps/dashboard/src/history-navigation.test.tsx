// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

const mocks = vi.hoisted(() => ({ me: vi.fn(), bridge: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getMe: mocks.me, getSolutions: async () => [] }))
vi.mock('./bridge', async original => ({ ...await original<typeof import('./bridge')>(), requestBridge: mocks.bridge }))
vi.mock('./HistoricalCollectionView', async () => {
  const { useState } = await import('react')
  return { HistoricalCollectionView: ({ onSelectionChange }: { onSelectionChange: (scope: { batchId: string; platform: 'JUNGOL'; submissionIds: string[] } | null) => void }) => {
    const [count, setCount] = useState(0)
    return <div><button onClick={() => { setCount(value => value + 1); onSelectionChange({ batchId: 'JUNGOL:123', platform: 'JUNGOL', submissionIds: ['1'] }) }}>수집 완료 {count}</button><button onClick={() => onSelectionChange(null)}>새 수집 시작</button></div>
  } }
})
vi.mock('./HistoricalGithubCommitView', async () => {
  const { useState } = await import('react')
  return { HistoricalGithubCommitView: () => { const [count, setCount] = useState(0); return <div>서버 과거 풀이 커밋<button onClick={() => setCount(value => value + 1)}>커밋 작업 {count}</button></div> } }
})

afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState({}, '', '/'); vi.clearAllMocks() })

it('separates history management and preserves both operations across action and navigation changes', async () => {
  mocks.me.mockResolvedValue({ id: 1, githubId: 'g', githubLogin: 'account' })
  mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  render(<App />)
  expect(screen.queryByText('로컬 과거 풀이 동기화')).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: '과거 풀이 관리' }))
  expect(window.location.search).toBe('?view=history')
  expect(screen.getByRole('heading', { name: '저장 안내' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '일괄 GitHub 커밋' })).toBeNull()
  expect(screen.queryByRole('button', { name: '검증 작업 0' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '수집 완료 0' }))
  expect(await screen.findByText('서버 등록 확인 · 제출 1건')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '일괄 GitHub 커밋' }))
  fireEvent.click(screen.getByRole('button', { name: '커밋 작업 0' }))
  fireEvent.click(screen.getByRole('button', { name: '설정' }))
  expect(screen.queryByRole('button', { name: '커밋 작업 1' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /전체 풀이/ }))
  expect(screen.queryByRole('button', { name: '커밋 작업 1' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '과거 풀이 관리' }))
  expect(screen.getByRole('button', { name: '수집 완료 1' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '커밋 작업 1' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '새 수집 시작' }))
  expect(screen.queryByRole('button', { name: '일괄 GitHub 커밋' })).toBeNull()
  expect(screen.queryByRole('button', { name: /과거 풀이 가져오기/ })).toBeNull()
})

it('opens the history tab from its URL and restores it through browser navigation', async () => {
  mocks.me.mockResolvedValue({ id: 1, githubId: 'g', githubLogin: 'account' })
  mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  window.history.replaceState({}, '', '/?view=history')
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '수집 완료 0' }))
  expect(await screen.findByText('서버 등록 확인 · 제출 1건')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /전체 풀이/ }))
  window.history.replaceState({}, '', '/?view=history')
  fireEvent(window, new PopStateEvent('popstate'))
  expect(screen.getByRole('heading', { name: '과거 풀이 관리' })).toBeTruthy()
})
