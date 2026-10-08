// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HistoricalImportView, selectHistoricalSubmissionIds } from './HistoricalImportView'
import type { Capture, Platform } from './types'

const mocks = vi.hoisted(() => ({ bridge: vi.fn(), me: vi.fn(), ids: vi.fn(), upload: vi.fn() }))
vi.mock('./bridge', () => ({ requestBridge: mocks.bridge }))
vi.mock('./api', () => ({ getMe: mocks.me, getHistoricalSubmissionIds: mocks.ids, bulkUpload: mocks.upload }))
const user = { id: 1, githubId: 'g', githubLogin: 'u' }
const props = { extensionId: 'extension', capability: 'cap', user, mode: 'live' as const, onImported: vi.fn() }
function capture(index: number, platform: Platform = 'JUNGOL'): Capture {
  return { captureId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, platform, historicalImport: true,
    historicalSubmissionId: platform === 'JUNGOL' ? String(index) : platform === 'SWEA' ? `Aa${String(index).padStart(8, '0')}` : `pg:user:${index}:2026-01-01T00:00:00.000+09:00:java`,
    problemNumber: String(index), title: `문제${index}`, language: 'Java', sourceCode: 'private source', problemUrl: 'https://example.test', result: 'ACCEPTED' }
}
function setup(captures: Capture[]) {
  mocks.bridge.mockImplementation((_id: string, message: { type: string; submissionIds?: string[]; platform?: string }) => {
    if (message.type === 'GET_HISTORICAL_METADATA') return Promise.resolve({ localOnly: true, records: captures.map(({ sourceCode: _code, ...record }) => record) })
    if (message.type === 'GET_HISTORICAL_BY_SUBMISSION_IDS') return Promise.resolve({ localOnly: true, captures: captures.filter(record => record.platform === message.platform && message.submissionIds?.includes(record.historicalSubmissionId!)) })
    return Promise.resolve({ ok: true })
  })
}
async function start(count: number) {
  await waitFor(() => expect((screen.getByRole('button', { name: `선택한 ${count}건 일괄 동기화` }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: `선택한 ${count}건 일괄 동기화` }))
}
beforeEach(() => { vi.resetAllMocks(); mocks.me.mockResolvedValue(user); mocks.ids.mockResolvedValue([]); mocks.upload.mockImplementation((captures: Capture[]) => Promise.resolve({ acceptedCaptureIds: captures.map(record => record.captureId), failures: [] })) })
afterEach(cleanup)
it('preserves deterministic same-problem selection', () => {
  const rows = [{ submissionId: '3', problemNumber: '1', executionTime: 30 }, { submissionId: '2', problemNumber: '1', executionTime: 10 }]
  expect(selectHistoricalSubmissionIds(rows, 'fastest')).toEqual(['2'])
})
it('lists all platforms without login and does not expose code or upload', async () => {
  setup([capture(1), capture(2, 'SWEA'), capture(3, 'PROGRAMMERS')])
  render(<HistoricalImportView {...props} user={null} mode="local" />)
  expect(await screen.findByText('로컬 문제 3건 · 제출 3건 · 서버 기록 미확인')).toBeTruthy()
  expect(screen.queryByText('private source')).toBeNull(); expect(mocks.ids).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '과거 풀이 수집 열기' }))
  await waitFor(() => expect(mocks.bridge).toHaveBeenCalledWith('extension', { type: 'OPEN_HISTORY', capability: 'cap' }))
})
it('syncs all three platforms and ACKs only server accepted captures', async () => {
  const captures = [capture(1), capture(2, 'SWEA'), capture(3, 'PROGRAMMERS')]; setup(captures)
  render(<HistoricalImportView {...props} />); await start(3)
  await screen.findByText('동기화 완료 · 문제 3건 · 제출 3건')
  expect(mocks.upload.mock.calls.map(([records]) => records[0].platform)).toEqual(['JUNGOL', 'SWEA', 'PROGRAMMERS'])
  expect(mocks.bridge.mock.calls.filter(([, message]) => message.type === 'ACK').map(([, message]) => message.captureIds)).toEqual(captures.map(record => [record.captureId]))
})
it('batches 132 submissions and separates problem and submission counts', async () => {
  const captures = Array.from({ length: 132 }, (_, index) => ({ ...capture(index + 1), problemNumber: String(index % 2) })); setup(captures)
  render(<HistoricalImportView {...props} />); await start(132)
  await screen.findByText('동기화 완료 · 문제 2건 · 제출 132건')
  expect(mocks.upload.mock.calls.map(([records]) => records.length)).toEqual([50, 50, 32])
})
it('uses platform-qualified server duplicate IDs, independent of local sync flags', async () => {
  setup([capture(1), { ...capture(2, 'SWEA'), historicalSubmissionId: '1' }])
  mocks.ids.mockImplementation((_account: string, platform: string) => Promise.resolve(platform === 'JUNGOL' ? ['1'] : []))
  render(<HistoricalImportView {...props} />); await start(1)
  await screen.findByText('동기화 완료 · 문제 1건 · 제출 1건')
  expect(mocks.upload.mock.calls[0][0][0].platform).toBe('SWEA')
})
it('ACKs partial success, continues to other platforms, retains failed selection for retry', async () => {
  const captures = [capture(1), capture(2), capture(3, 'SWEA')]; setup(captures)
  mocks.upload.mockImplementation((records: Capture[]) => Promise.resolve({ acceptedCaptureIds: records.filter(record => record.captureId !== captures[1].captureId).map(record => record.captureId), failures: [] }))
  render(<HistoricalImportView {...props} />); await start(3)
  await screen.findByText('동기화 완료 · 문제 2건 · 제출 2건 · 실패 1건 (선택을 유지했습니다)')
  expect(screen.getByRole('button', { name: '선택한 1건 일괄 동기화' })).toBeTruthy()
  expect(mocks.bridge.mock.calls.filter(([, message]) => message.type === 'ACK').flatMap(([, message]) => message.captureIds)).toEqual([captures[0].captureId, captures[2].captureId])
})
it('does not ACK unexpected server acceptance IDs', async () => {
  setup([capture(1)]); mocks.upload.mockResolvedValue({ acceptedCaptureIds: ['foreign'], failures: [] })
  render(<HistoricalImportView {...props} />); await start(1)
  await screen.findByText(/서버 수락 응답을 검증하지 못했습니다/)
  expect(mocks.bridge.mock.calls.filter(([, message]) => message.type === 'ACK')).toHaveLength(0)
})
it('stops before upload when authenticated account changes', async () => {
  setup([capture(1)]); mocks.me.mockResolvedValue({ id: 2, githubId: 'other' })
  render(<HistoricalImportView {...props} />); await start(1)
  await screen.findByText(/로그인 계정 또는 확장 연결이 변경/); expect(mocks.upload).not.toHaveBeenCalled()
})
it('ignores late local records after capability change', async () => {
  let resolve!: (value: unknown) => void; const old = new Promise(res => { resolve = res })
  setup([capture(2)]); const original = mocks.bridge.getMockImplementation()!
  mocks.bridge.mockImplementation((id, message) => message.capability === 'old' ? old : original(id, message))
  const view = render(<HistoricalImportView {...props} capability="old" />)
  view.rerender(<HistoricalImportView {...props} capability="new" />)
  await screen.findByText('정올 2 · 문제2 · Java')
  await act(async () => { resolve({ localOnly: true, records: [capture(1)] }) })
  expect(screen.queryByText('정올 1 · 문제1 · Java')).toBeNull()
})
it('does not continue after unmount while authenticating', async () => {
  setup([capture(1)]); let resolve!: (value: unknown) => void
  mocks.me.mockReturnValue(new Promise(res => { resolve = res }))
  const view = render(<HistoricalImportView {...props} />); await start(1)
  view.unmount(); await act(async () => { resolve(user) }); expect(mocks.upload).not.toHaveBeenCalled()
})
it('cancellation acknowledges in-flight success and prevents the next batch', async () => {
  const captures = Array.from({ length: 51 }, (_, index) => capture(index + 1)); setup(captures)
  let resolve!: (value: unknown) => void; mocks.upload.mockReturnValue(new Promise(res => { resolve = res }))
  render(<HistoricalImportView {...props} />); await start(51)
  await waitFor(() => expect(mocks.upload).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: '동기화 중단' }))
  await act(async () => { resolve({ acceptedCaptureIds: captures.slice(0, 50).map(record => record.captureId), failures: [] }) })
  await screen.findByText('동기화 중단 · 문제 50건 · 제출 50건'); expect(mocks.upload).toHaveBeenCalledTimes(1)
})

it('uploads verified enrichment even when the native submission already exists remotely', async () => {
  const record = { ...capture(1, 'SWEA'), metadataPending: true }; setup([record]); mocks.ids.mockResolvedValue([record.historicalSubmissionId]);
  render(<HistoricalImportView {...props} />); await start(1);
  await screen.findByText('동기화 완료 · 문제 1건 · 제출 1건');
  expect(mocks.upload.mock.calls[0][0][0].metadataPending).toBe(true);
  expect(mocks.bridge.mock.calls.filter(([, message]) => message.type === 'ACK')).toHaveLength(1);
});
it('retains failed enrichment without acknowledging it as synchronized', async () => {
  const record = { ...capture(1, 'SWEA'), metadataPending: true }; setup([record]); mocks.ids.mockResolvedValue([record.historicalSubmissionId]);
  mocks.upload.mockResolvedValue({ acceptedCaptureIds: [], failures: [] });
  render(<HistoricalImportView {...props} />); await start(1);
  await screen.findByText(/실패 1건/);
  expect(mocks.bridge.mock.calls.filter(([, message]) => message.type === 'ACK')).toHaveLength(0);
});
