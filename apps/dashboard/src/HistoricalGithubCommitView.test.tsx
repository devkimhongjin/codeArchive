// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HistoricalGithubCommitView } from './HistoricalGithubCommitView'
import type { AccountSettings, HistoricalCommitCandidate } from './types'

const mocks = vi.hoisted(() => ({ candidates: vi.fn(), settings: vi.fn(), me: vi.fn(), commit: vi.fn() }))
vi.mock('./api', () => ({ getHistoricalCommitCandidates: mocks.candidates, getAccountSettings: mocks.settings, getMe: mocks.me, requestHistoricalCommitBatch: mocks.commit }))
const user = { id: 1, githubId: 'g', githubLogin: 'account' }
const settings = { version: 7, githubTargetConfigured: true, githubInstallationId: 77, githubOwner: 'owner', githubRepository: 'archive', githubBranch: 'main', githubRootPath: 'solutions', gitPathTemplate: '{platform}/{number}/{capture_ID}', githubAutoCommitEnabled: false } as AccountSettings
const record = (index: number, state: HistoricalCommitCandidate['state'] = 'NONE'): HistoricalCommitCandidate => ({ captureId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, platform: index % 2 ? 'SWEA' : 'PROGRAMMERS', historicalSubmissionId: `site-${index}`, problemNumber: String(index), title: `문제${index}`, language: 'Java', state })
beforeEach(() => { vi.resetAllMocks(); mocks.me.mockResolvedValue(user); mocks.settings.mockResolvedValue(settings); mocks.candidates.mockResolvedValue([record(1), record(2)]); mocks.commit.mockImplementation((_id, request) => Promise.resolve(Object.fromEntries(request.captureIds.map((id: string) => [id, 'PENDING'])))) })
afterEach(() => { cleanup(); vi.useRealTimers() })
async function preview(count = 2) {
  await waitFor(() => expect((screen.getByRole('button', { name: `선택한 ${count}건 커밋 대상 확인` }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: `선택한 ${count}건 커밋 대상 확인` }))
}
it('requires login without loading server records', () => {
  render(<HistoricalGithubCommitView user={null} mode="local" />); expect(mocks.candidates).not.toHaveBeenCalled(); expect(mocks.commit).not.toHaveBeenCalled()
})
it('previews saved account, repository, branch and paths before manual commits with automation OFF', async () => {
  render(<HistoricalGithubCommitView user={user} mode="live" />); await preview()
  expect(screen.getByText('계정 account · owner/archive · 브랜치 main')).toBeTruthy()
  expect(screen.getByText(/solutions\/SWEA\/1\//)).toBeTruthy(); expect(mocks.commit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 커밋 2건 요청' }))
  await screen.findByText(/일괄 커밋 요청 완료 · 2건/)
  expect(mocks.commit).toHaveBeenCalledWith('g', expect.objectContaining({ captureIds: [record(1).captureId, record(2).captureId], settingsVersion: 7, installationId: 77, owner: 'owner', repository: 'archive', branch: 'main' }))
})
it('selects only NONE and FAILED and never retries UNKNOWN or active/completed work', async () => {
  mocks.candidates.mockResolvedValue([record(1), record(2, 'FAILED'), record(3, 'UNKNOWN'), record(4, 'PENDING'), record(5, 'RUNNING'), record(6, 'SUCCEEDED')])
  render(<HistoricalGithubCommitView user={user} mode="live" />); await preview()
  expect(screen.getByText('결과 확인 필요')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 커밋 2건 요청' }))
  await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1)); expect(mocks.commit.mock.calls[0][1].captureIds).toEqual([record(1).captureId, record(2).captureId])
})
it('batches 101 requests without automatic repeated mutations', async () => {
  mocks.candidates.mockResolvedValue(Array.from({ length: 101 }, (_, index) => record(index + 1)))
  render(<HistoricalGithubCommitView user={user} mode="live" />); await preview(101)
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 커밋 101건 요청' }))
  await screen.findByText(/일괄 커밋 요청 완료 · 101건/)
  expect(mocks.commit.mock.calls.map(([, request]) => request.captureIds.length)).toEqual([50, 50, 1])
})
it('stops before external request if saved target settings change', async () => {
  render(<HistoricalGithubCommitView user={user} mode="live" />); await preview()
  mocks.settings.mockResolvedValue({ ...settings, version: 8, githubBranch: 'other' })
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 커밋 2건 요청' }))
  await screen.findByText(/GitHub 설정이 변경되었습니다/); expect(mocks.commit).not.toHaveBeenCalled()
})
it('stops after logout while account confirmation is pending', async () => {
  let resolve!: (value: unknown) => void; mocks.me.mockReturnValue(new Promise(res => { resolve = res }))
  const view = render(<HistoricalGithubCommitView user={user} mode="live" />); await preview()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 커밋 2건 요청' }))
  view.rerender(<HistoricalGithubCommitView user={null} mode="local" />)
  await act(async () => { resolve(user) }); expect(mocks.commit).not.toHaveBeenCalled()
  expect(screen.queryByText('계정 account · owner/archive · 브랜치 main')).toBeNull()
})
it('does not automatically replay an ambiguous response', async () => {
  mocks.commit.mockRejectedValue(new Error('응답 없음'))
  render(<HistoricalGithubCommitView user={user} mode="live" />); await preview()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 커밋 2건 요청' }))
  await screen.findByText(/상태를 새로고침한 뒤/); expect(mocks.commit).toHaveBeenCalledTimes(1)
})
it('disables commit preview if GitHub target is missing', async () => {
  mocks.settings.mockResolvedValue({ ...settings, githubTargetConfigured: false })
  render(<HistoricalGithubCommitView user={user} mode="live" />)
  await screen.findByText(/GitHub 탭에서 저장소/)
  expect((screen.getByRole('button', { name: '선택한 2건 커밋 대상 확인' }) as HTMLButtonElement).disabled).toBe(true)
})

it('counts completion from server status, not from accepted requests', async () => {
  vi.useFakeTimers()
  mocks.candidates.mockResolvedValue([record(1, 'PENDING'), record(2, 'RUNNING')])
  await act(async () => { render(<HistoricalGithubCommitView user={user} mode="live" />) })
  expect(screen.getByText('대기')).toBeTruthy()
  mocks.candidates.mockResolvedValue([record(1, 'SUCCEEDED'), record(2, 'FAILED')])
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(screen.getByText(/완료 1건 · 대기\/진행 0건 · 실패 1건/)).toBeTruthy()
})

it('platform filter limits the commit scope and preview includes only that platform', async () => {
  render(<HistoricalGithubCommitView user={user} mode="live" />)
  await preview()
  fireEvent.click(screen.getByRole('button', { name: '닫기' }))
  fireEvent.change(screen.getByRole('combobox', { name: '커밋 플랫폼' }), { target: { value: 'SWEA' } })
  await preview(1)
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 커밋 1건 요청' }))
  await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1))
  expect(mocks.commit.mock.calls[0][1].captureIds).toEqual([record(1).captureId])
})
