// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HistoricalGithubCommitView } from './HistoricalGithubCommitView'
import type { AccountSettings, HistoricalCommitCandidate } from './types'

const mocks = vi.hoisted(() => ({ candidates: vi.fn(), settings: vi.fn(), me: vi.fn(), commit: vi.fn(), reconcile: vi.fn() }))
vi.mock('./api', () => ({ getHistoricalCommitCandidates: mocks.candidates, getGithubCommitCandidates: mocks.candidates, getAccountSettings: mocks.settings, getMe: mocks.me, requestHistoricalCommitBatch: mocks.commit, requestGithubCommitBatch: mocks.commit, reconcileHistoricalCommit: mocks.reconcile, reconcileGithubCommit: mocks.reconcile }))
const user = { id: 1, githubId: 'g', githubLogin: 'account' }
const settings = { version: 7, githubTargetConfigured: true, githubInstallationId: 77, githubOwner: 'owner', githubRepository: 'archive', githubBranch: 'main', githubRootPath: 'solutions', gitPathTemplate: '{platform}/{number}/{capture_ID}', githubAutoCommitEnabled: false } as AccountSettings
const record = (index: number, state: HistoricalCommitCandidate['state'] = 'NONE'): HistoricalCommitCandidate => ({ captureId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, platform: index % 2 ? 'SWEA' : 'PROGRAMMERS', historicalSubmissionId: `site-${index}`, problemNumber: String(index), title: `문제${index}`, language: 'Java', state })
beforeEach(() => { vi.resetAllMocks(); mocks.me.mockResolvedValue(user); mocks.settings.mockResolvedValue(settings); mocks.candidates.mockResolvedValue([record(1), record(2)]); mocks.commit.mockImplementation((_id, request) => Promise.resolve(Object.fromEntries(request.captureIds.map((id: string) => [id, 'PENDING'])))) })
afterEach(() => { cleanup(); vi.useRealTimers() })
it('selects uncommitted server solutions including new automatic captures without historical IDs', async () => {
  const normal = { ...record(1), historicalSubmissionId: null }
  mocks.candidates.mockResolvedValue([normal, record(2, 'SUCCEEDED'), record(3, 'PENDING'), record(4, 'UNKNOWN'), record(5, 'FAILED')])
  render(<HistoricalGithubCommitView user={user} mode="live" allSolutions />)
  await preview(2)
  fireEvent.click(await screen.findByRole('button', { name: 'GitHub 커밋 2건 요청' }))
  await waitFor(() => expect(mocks.commit).toHaveBeenCalledOnce())
  expect(mocks.commit.mock.calls[0][1].captureIds).toEqual([normal.captureId, record(5).captureId])
})
async function preview(count = 2) {
  await waitFor(() => expect((screen.getByRole('button', { name: `선택한 ${count}건 커밋 대상 확인` }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: `선택한 ${count}건 커밋 대상 확인` }))
}
it('previews and requests only the duplicate-policy winners and invalidates on platform or policy change', async () => {
  const older = { ...record(1), solvedAt: '2026-10-01T00:00:00Z' }, newer = { ...record(3), problemNumber: older.problemNumber, solvedAt: '2026-10-02T00:00:00Z' }
  const separate = { ...record(2), problemNumber: older.problemNumber }
  mocks.candidates.mockResolvedValue([older, newer, separate, { ...record(5, 'SUCCEEDED'), problemNumber: older.problemNumber }])
  render(<HistoricalGithubCommitView user={user} mode="live" allSolutions selectionMetrics={[{ ...older, executionTime: 1 }, { ...newer, executionTime: 2 }]} />)
  await preview(3)
  fireEvent.change(screen.getByLabelText('커밋 중복 문제 처리'), { target: { value: 'latest' } })
  expect(screen.queryByRole('button', { name: 'GitHub 커밋 3건 요청' })).toBeNull()
  await preview(2)
  fireEvent.change(screen.getByLabelText('커밋 플랫폼'), { target: { value: 'SWEA' } })
  expect(screen.queryByRole('button', { name: 'GitHub 커밋 2건 요청' })).toBeNull()
  fireEvent.change(screen.getByLabelText('커밋 중복 문제 처리'), { target: { value: 'fastest' } })
  await preview(1)
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 커밋 1건 요청' }))
  await waitFor(() => expect(mocks.commit).toHaveBeenCalledOnce())
  expect(mocks.commit.mock.calls[0][1].captureIds).toEqual([older.captureId])
})
it('rejects a stale preview if refreshed metrics choose a different submission', async () => {
  const first = record(1), second = { ...record(3), problemNumber: first.problemNumber }
  mocks.candidates.mockResolvedValue([first, second])
  const view = render(<HistoricalGithubCommitView user={user} mode="live" allSolutions selectionMetrics={[{ ...first, executionTime: 1 }, { ...second, executionTime: 2 }]} />)
  await preview(2)
  fireEvent.change(screen.getByLabelText('커밋 중복 문제 처리'), { target: { value: 'fastest' } })
  await preview(1)
  view.rerender(<HistoricalGithubCommitView user={user} mode="live" allSolutions selectionMetrics={[{ ...first, executionTime: 3 }, { ...second, executionTime: 2 }]} />)
  expect((screen.getByRole('button', { name: 'GitHub 커밋 1건 요청' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 커밋 1건 요청' }))
  expect(mocks.commit).not.toHaveBeenCalled()
})
it('maps only selected native submission IDs to server capture IDs before commit confirmation', async () => {
  const chosen = record(1), outside = { ...record(2), historicalSubmissionId: chosen.historicalSubmissionId }
  mocks.candidates.mockResolvedValue([chosen, outside, record(3)])
  render(<HistoricalGithubCommitView user={user} mode="live" selectionScope={{ batchId: 'SWEA:123', platform: 'SWEA', submissionIds: [chosen.historicalSubmissionId] }} previewRequest={1} />)
  fireEvent.click(await screen.findByRole('button', { name: 'GitHub 커밋 1건 요청' }))
  await waitFor(() => expect(mocks.commit).toHaveBeenCalledOnce())
  expect(mocks.commit.mock.calls[0][1].captureIds).toEqual([chosen.captureId])
  expect(screen.queryByText(/문제2|문제3/)).toBeNull()
})
it('does not preview a scope missing any server submission', async () => {
  render(<HistoricalGithubCommitView user={user} mode="live" selectionScope={{ batchId: 'SWEA:123', platform: 'SWEA', submissionIds: ['site-1', 'missing'] }} previewRequest={1} />)
  await screen.findByText(/서버에 모두 동기화되지 않았습니다/)
  expect(screen.queryByRole('button', { name: /GitHub 커밋 .*건 요청/ })).toBeNull()
  expect(mocks.commit).not.toHaveBeenCalled()
})
it('drops the old preview immediately when a different collection selection replaces it', async () => {
  const first = { batchId: 'SWEA:123', platform: 'SWEA' as const, submissionIds: ['site-1'] }
  const second = { batchId: 'SWEA:124', platform: 'SWEA' as const, submissionIds: ['site-3'] }
  const view = render(<HistoricalGithubCommitView user={user} mode="live" selectionScope={first} previewRequest={1} />)
  await screen.findByRole('button', { name: 'GitHub 커밋 1건 요청' })
  let resolve!: (records: HistoricalCommitCandidate[]) => void
  mocks.candidates.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  view.rerender(<HistoricalGithubCommitView user={user} mode="live" selectionScope={second} previewRequest={1} />)
  expect(screen.queryByRole('button', { name: 'GitHub 커밋 1건 요청' })).toBeNull()
  await act(async () => { resolve([record(1), record(3)]) })
  fireEvent.click(await screen.findByRole('button', { name: 'GitHub 커밋 1건 요청' }))
  await waitFor(() => expect(mocks.commit).toHaveBeenCalledOnce())
  expect(mocks.commit.mock.calls[0][1].captureIds).toEqual([record(3).captureId])
})
it('requires a read comparison before allowing explicit uncertain-job retry', async () => {
  mocks.candidates.mockResolvedValue([record(1, 'UNKNOWN')])
  mocks.reconcile.mockResolvedValueOnce({ captureId: record(1).captureId, state: 'UNKNOWN', comparison: 'MISSING', diagnostic: 'BLOB_UNCONFIRMED', retryAllowed: true })
    .mockResolvedValueOnce({ captureId: record(1).captureId, state: 'PENDING', comparison: 'MISSING', diagnostic: 'BLOB_UNCONFIRMED', retryAllowed: false })
  render(<HistoricalGithubCommitView user={user} mode="live" />)
  fireEvent.click(await screen.findByRole('button', { name: 'GitHub 결과 대조' }))
  fireEvent.click(await screen.findByRole('button', { name: '대조 후 재시도 요청' }))
  await screen.findByText('대조 후 재시도를 요청했습니다.')
  expect(mocks.reconcile.mock.calls).toEqual([['g', record(1).captureId, 7, false], ['g', record(1).captureId, 7, true]])
  expect(mocks.commit).not.toHaveBeenCalled()
})
it('keeps an unverifiable legacy job uncertain without a retry button', async () => {
  mocks.candidates.mockResolvedValue([record(1, 'UNKNOWN')])
  mocks.reconcile.mockResolvedValue({ captureId: record(1).captureId, state: 'UNKNOWN', comparison: 'CONTEXT_UNAVAILABLE', diagnostic: 'UNSPECIFIED', retryAllowed: false })
  render(<HistoricalGithubCommitView user={user} mode="live" />)
  fireEvent.click(await screen.findByRole('button', { name: 'GitHub 결과 대조' }))
  await screen.findByText(/원래 작업의 계정·설정·출력 기록/)
  expect(screen.queryByRole('button', { name: '대조 후 재시도 요청' })).toBeNull()
})
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
  await screen.findByText(/GitHub 관리에서 저장소/)
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

it('reports queued and running server commits as work until terminal states arrive', async () => {
  const report = vi.fn().mockResolvedValue(undefined)
  const desktopWindow = window as Window & { codeArchiveDesktop?: import('./desktop').DesktopApi }
  desktopWindow.codeArchiveDesktop = { reportActivity: report } as unknown as import('./desktop').DesktopApi
  try {
    mocks.candidates.mockResolvedValue([record(1, 'PENDING'), record(2, 'RUNNING')])
    render(<HistoricalGithubCommitView user={user} mode="live" />)
    await screen.findByText('진행 중')
    await waitFor(() => expect(report).toHaveBeenLastCalledWith({ busy: true, draft: false }))
    mocks.candidates.mockResolvedValue([record(1, 'SUCCEEDED'), record(2, 'FAILED')])
    fireEvent.click(screen.getByRole('button', { name: '서버·커밋 상태 새로고침' }))
    await waitFor(() => expect(report).toHaveBeenLastCalledWith({ busy: false, draft: false }))
  } finally { cleanup(); delete desktopWindow.codeArchiveDesktop }
})

for (const failure of ['rejected', 'missing', 'ambiguous']) {
  it(`invalidates the prior commit preview immediately on refresh and retains no readiness after ${failure} validation`, async () => {
    const scope = { batchId: 'SWEA:123', platform: 'SWEA' as const, submissionIds: ['site-1'] }
    render(<HistoricalGithubCommitView user={user} mode="live" selectionScope={scope} previewRequest={1} />)
    await screen.findByRole('button', { name: 'GitHub 커밋 1건 요청' })
    let resolve!: (records: HistoricalCommitCandidate[]) => void, reject!: (error: Error) => void
    mocks.candidates.mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail }))
    fireEvent.click(screen.getByRole('button', { name: '서버·커밋 상태 새로고침' }))
    expect(screen.queryByRole('button', { name: 'GitHub 커밋 1건 요청' })).toBeNull()
    expect((screen.getByRole('button', { name: '선택한 1건 커밋 대상 확인' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      if (failure === 'rejected') reject(new Error('refresh failed'))
      else resolve(failure === 'missing' ? [] : [record(1), { ...record(1), captureId: record(3).captureId }])
    })
    expect(screen.queryByRole('button', { name: /GitHub 커밋 .*건 요청/ })).toBeNull()
    expect((screen.getByRole('button', { name: '선택한 0건 커밋 대상 확인' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.commit).not.toHaveBeenCalled()
  })
}
