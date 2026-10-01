// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HistoricalImportView, selectHistoricalSubmissionIds } from './HistoricalImportView'

const mocks = vi.hoisted(() => ({ bridge: vi.fn(), me: vi.fn(), ids: vi.fn(), upload: vi.fn() }))
vi.mock('./bridge', () => ({ requestBridge: mocks.bridge }))
vi.mock('./api', () => ({ getMe: mocks.me, getHistoricalSubmissionIds: mocks.ids, bulkUpload: mocks.upload }))
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

it('uses deterministic same-problem selection while the extension owns collection', () => {
  const rows = [
    { submissionId: '3', problemNumber: '1', executionTime: 30, memoryValue: 10 },
    { submissionId: '2', problemNumber: '1', executionTime: 10, memoryValue: 20 },
    { submissionId: '1', problemNumber: '2', executionTime: 20, memoryValue: 12 },
  ]
  expect(selectHistoricalSubmissionIds(rows, 'latest')).toEqual(['3', '1'])
  expect(selectHistoricalSubmissionIds(rows, 'fastest')).toEqual(['2', '1'])
  expect(selectHistoricalSubmissionIds(rows, 'lowest-memory')).toEqual(['3', '1'])
})

it('loads retained local records and opens extension collection without requiring a CodeArchive login', async () => {
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'GET_HISTORICAL_SUBMISSION_IDS'
    ? Promise.resolve({ localOnly: true, submissionIds: ['123'] }) : Promise.resolve({ history: { status: 'OPENED' } }))
  render(<HistoricalImportView extensionId="extension" capability="cap" user={null} mode="local" onImported={() => undefined} />)
  expect(await screen.findByText('정올 제출 #123')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /확장 프로그램에서 정올 과거 풀이 수집 열기/ }))
  await waitFor(() => expect(mocks.bridge).toHaveBeenCalledWith('extension', { type: 'OPEN_HISTORY', capability: 'cap' }))
  expect(screen.getByText(/서버 동기화는 CodeArchive 로그인 후 직접 실행/)).toBeTruthy()
})

it('manually syncs local records without a source preview and ACKs only accepted captures', async () => {
  const capture = { captureId: '11111111-1111-4111-8111-111111111111', platform: 'JUNGOL', historicalImport: true, historicalSubmissionId: '123' }
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'GET_HISTORICAL_SUBMISSION_IDS') return Promise.resolve({ localOnly: true, submissionIds: ['123'] })
    if (message.type === 'GET_HISTORICAL_BY_SUBMISSION_IDS') return Promise.resolve({ localOnly: true, captures: [capture] })
    if (message.type === 'ACK') return Promise.resolve({ ok: true })
    return Promise.resolve({ history: { status: 'OPENED' } })
  })
  mocks.me.mockResolvedValue({ id: 1, githubId: 'g' })
  mocks.ids.mockResolvedValue([])
  mocks.upload.mockResolvedValue({ acceptedCaptureIds: [capture.captureId], failures: [] })
  render(<HistoricalImportView extensionId="extension" capability="cap" user={{ id: 1, githubId: 'g', githubLogin: 'u' }} mode="live" onImported={() => undefined} />)
  await screen.findByText('정올 제출 #123')
  fireEvent.click(screen.getByRole('button', { name: '선택한 1건 수동 서버 동기화' }))
  expect(await screen.findByText(/서버 동기화 1건을 확인했습니다/)).toBeTruthy()
  expect(mocks.bridge).toHaveBeenCalledWith('extension', { type: 'ACK', capability: 'cap', captureIds: [capture.captureId] })
})

it('reconciles server-known local records and batches more than fifty retained submissions', async () => {
  const ids = Array.from({ length: 132 }, (_, index) => String(index + 1))
  mocks.bridge.mockImplementation((_id: string, message: { type: string; submissionIds?: string[] }) => {
    if (message.type === 'GET_HISTORICAL_SUBMISSION_IDS') return Promise.resolve({ localOnly: true, submissionIds: ids })
    if (message.type === 'GET_HISTORICAL_BY_SUBMISSION_IDS') return Promise.resolve({ localOnly: true, captures: message.submissionIds!.map(id => ({ captureId: `00000000-0000-4000-8000-${id.padStart(12, '0')}`, platform: 'JUNGOL', historicalImport: true, historicalSubmissionId: id })) })
    if (message.type === 'ACK') return Promise.resolve({ ok: true })
    return Promise.resolve({})
  })
  mocks.me.mockResolvedValue({ id: 1, githubId: 'g' })
  mocks.ids.mockResolvedValue(['1'])
  mocks.upload.mockImplementation((captures: { captureId: string }[]) => Promise.resolve({ acceptedCaptureIds: captures.map(capture => capture.captureId), failures: [] }))
  render(<HistoricalImportView extensionId="extension" capability="cap" user={{ id: 1, githubId: 'g', githubLogin: 'u' }} mode="live" onImported={() => undefined} />)
  await screen.findByText('정올 제출 #132')
  fireEvent.click(screen.getByRole('button', { name: '선택한 132건 수동 서버 동기화' }))
  await screen.findByText(/서버 동기화 132건을 확인했습니다/)
  expect(mocks.upload.mock.calls.map(([captures]) => captures.length)).toEqual([49, 50, 32])
  expect(mocks.bridge.mock.calls.filter(([, message]) => message.type === 'ACK')).toHaveLength(3)
})

it('ACKs a server-known record without uploading it', async () => {
  const capture = { captureId: '22222222-2222-4222-8222-222222222222', platform: 'JUNGOL', historicalImport: true, historicalSubmissionId: '7' }
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'GET_HISTORICAL_SUBMISSION_IDS'
    ? Promise.resolve({ localOnly: true, submissionIds: ['7'] }) : message.type === 'GET_HISTORICAL_BY_SUBMISSION_IDS'
      ? Promise.resolve({ localOnly: true, captures: [capture] }) : Promise.resolve({ ok: true }))
  mocks.me.mockResolvedValue({ id: 1, githubId: 'g' }); mocks.ids.mockResolvedValue(['7'])
  render(<HistoricalImportView extensionId="extension" capability="cap" user={{ id: 1, githubId: 'g', githubLogin: 'u' }} mode="live" onImported={() => undefined} />)
  await screen.findByText('정올 제출 #7'); fireEvent.click(screen.getByRole('button', { name: '선택한 1건 수동 서버 동기화' }))
  expect(await screen.findByText(/서버 동기화 1건을 확인했습니다/)).toBeTruthy()
  expect(mocks.upload).not.toHaveBeenCalled()
  expect(mocks.bridge).toHaveBeenCalledWith('extension', { type: 'ACK', capability: 'cap', captureIds: [capture.captureId] })
})

it('ACKs accepted captures before reporting a partial server response', async () => {
  const captures = ['1', '2'].map(id => ({ captureId: `33333333-3333-4333-8333-${id.padStart(12, '0')}`, platform: 'JUNGOL', historicalImport: true, historicalSubmissionId: id }))
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'GET_HISTORICAL_SUBMISSION_IDS'
    ? Promise.resolve({ localOnly: true, submissionIds: ['1', '2'] }) : message.type === 'GET_HISTORICAL_BY_SUBMISSION_IDS'
      ? Promise.resolve({ localOnly: true, captures }) : Promise.resolve({ ok: true }))
  mocks.me.mockResolvedValue({ id: 1, githubId: 'g' }); mocks.ids.mockResolvedValue([]); mocks.upload.mockResolvedValue({ acceptedCaptureIds: [captures[0].captureId], failures: [{ captureId: captures[1].captureId }] })
  render(<HistoricalImportView extensionId="extension" capability="cap" user={{ id: 1, githubId: 'g', githubLogin: 'u' }} mode="live" onImported={() => undefined} />)
  await screen.findByText('정올 제출 #2'); fireEvent.click(screen.getByRole('button', { name: '선택한 2건 수동 서버 동기화' }))
  expect(await screen.findByText('일부 서버 저장 실패')).toBeTruthy()
  expect(mocks.bridge).toHaveBeenCalledWith('extension', { type: 'ACK', capability: 'cap', captureIds: [captures[0].captureId] })
})

it('does not ACK after the signed-in account changes during an upload', async () => {
  const capture = { captureId: '44444444-4444-4444-8444-444444444444', platform: 'JUNGOL', historicalImport: true, historicalSubmissionId: '1' }
  let finishUpload: ((value: unknown) => void) | undefined
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'GET_HISTORICAL_SUBMISSION_IDS'
    ? Promise.resolve({ localOnly: true, submissionIds: ['1'] }) : message.type === 'GET_HISTORICAL_BY_SUBMISSION_IDS'
      ? Promise.resolve({ localOnly: true, captures: [capture] }) : Promise.resolve({ ok: true }))
  mocks.me.mockResolvedValue({ id: 1, githubId: 'g' }); mocks.ids.mockResolvedValue([])
  mocks.upload.mockImplementation(() => new Promise(resolve => { finishUpload = resolve }))
  const props = { extensionId: 'extension', capability: 'cap', mode: 'live' as const, onImported: () => undefined }
  const view = render(<HistoricalImportView {...props} user={{ id: 1, githubId: 'g', githubLogin: 'u' }} />)
  await screen.findByText('정올 제출 #1'); fireEvent.click(screen.getByRole('button', { name: '선택한 1건 수동 서버 동기화' }))
  await waitFor(() => expect(finishUpload).toBeTypeOf('function'))
  view.rerender(<HistoricalImportView {...props} user={{ id: 2, githubId: 'other', githubLogin: 'other' }} />)
  finishUpload!({ acceptedCaptureIds: [capture.captureId], failures: [] })
  await waitFor(() => expect((screen.getByRole('button', { name: '선택한 1건 수동 서버 동기화' }) as HTMLButtonElement).disabled).toBe(false))
  expect(mocks.bridge.mock.calls.filter(([, message]) => message.type === 'ACK')).toHaveLength(0)
})

it('ignores a stale local-list rejection after the extension capability changes', async () => {
  const oldList = deferred<{ localOnly: true; submissionIds: string[] }>()
  mocks.bridge.mockImplementation((_id: string, message: { type: string; capability: string }) => {
    if (message.type !== 'GET_HISTORICAL_SUBMISSION_IDS') return Promise.resolve({})
    return message.capability === 'old' ? oldList.promise : Promise.resolve({ localOnly: true, submissionIds: ['2'] })
  })
  const props = { extensionId: 'extension', user: null, mode: 'local' as const, onImported: () => undefined }
  const view = render(<HistoricalImportView {...props} capability="old" />)
  await waitFor(() => expect(mocks.bridge).toHaveBeenCalled())
  view.rerender(<HistoricalImportView {...props} capability="new" />)
  expect(await screen.findByText('정올 제출 #2')).toBeTruthy()
  oldList.reject(new Error('old capability failed'))
  await Promise.resolve(); await Promise.resolve()
  expect(screen.queryByText('확장 프로그램의 로컬 과거 풀이를 불러올 수 없습니다.')).toBeNull()
  expect(screen.getByText('정올 제출 #2')).toBeTruthy()
})

it('ignores stale resolved local IDs after the extension capability changes', async () => {
  const oldList = deferred<{ localOnly: true; submissionIds: string[] }>()
  mocks.bridge.mockImplementation((_id: string, message: { type: string; capability: string }) => {
    if (message.type !== 'GET_HISTORICAL_SUBMISSION_IDS') return Promise.resolve({})
    return message.capability === 'old' ? oldList.promise : Promise.resolve({ localOnly: true, submissionIds: ['2'] })
  })
  const props = { extensionId: 'extension', user: null, mode: 'local' as const, onImported: () => undefined }
  const view = render(<HistoricalImportView {...props} capability="old" />)
  await waitFor(() => expect(mocks.bridge).toHaveBeenCalled())
  view.rerender(<HistoricalImportView {...props} capability="new" />)
  expect(await screen.findByText('정올 제출 #2')).toBeTruthy()
  oldList.resolve({ localOnly: true, submissionIds: ['1'] })
  await Promise.resolve(); await Promise.resolve()
  expect(screen.queryByText('정올 제출 #1')).toBeNull()
  expect(screen.getByText('정올 제출 #2')).toBeTruthy()
})

it('does not let an invalidated sync error overwrite a newer capability message', async () => {
  const oldMe = deferred<{ id: number; githubId: string }>()
  mocks.bridge.mockImplementation((_id: string, message: { type: string; capability: string }) => {
    if (message.type === 'GET_HISTORICAL_SUBMISSION_IDS') return Promise.resolve({ localOnly: true, submissionIds: ['1'] })
    if (message.type === 'OPEN_HISTORY') return Promise.resolve({ history: { status: 'OPENED' } })
    return Promise.resolve({})
  })
  mocks.me.mockReturnValue(oldMe.promise)
  const props = { extensionId: 'extension', user: { id: 1, githubId: 'g', githubLogin: 'u' }, mode: 'live' as const, onImported: () => undefined }
  const view = render(<HistoricalImportView {...props} capability="old" />)
  await screen.findByText('정올 제출 #1'); fireEvent.click(screen.getByRole('button', { name: '선택한 1건 수동 서버 동기화' }))
  view.rerender(<HistoricalImportView {...props} capability="new" />)
  await screen.findByText('정올 제출 #1')
  fireEvent.click(screen.getByRole('button', { name: /확장 프로그램에서 정올 과거 풀이 수집 열기/ }))
  expect(await screen.findByText('확장 프로그램에서 정올 과거 풀이 화면을 열었습니다.')).toBeTruthy()
  oldMe.reject(new Error('old sync failure'))
  await Promise.resolve(); await Promise.resolve()
  expect(screen.queryByText('old sync failure')).toBeNull()
  expect(screen.getByText('확장 프로그램에서 정올 과거 풀이 화면을 열었습니다.')).toBeTruthy()
})

it('does not continue sync after unmount while authenticating', async () => {
  const waitingMe = deferred<{ id: number; githubId: string }>()
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'GET_HISTORICAL_SUBMISSION_IDS'
    ? Promise.resolve({ localOnly: true, submissionIds: ['1'] }) : Promise.resolve({}))
  mocks.me.mockReturnValue(waitingMe.promise)
  const view = render(<HistoricalImportView extensionId="extension" capability="cap" user={{ id: 1, githubId: 'g', githubLogin: 'u' }} mode="live" onImported={() => undefined} />)
  await screen.findByText('정올 제출 #1'); fireEvent.click(screen.getByRole('button', { name: '선택한 1건 수동 서버 동기화' }))
  view.unmount(); waitingMe.resolve({ id: 1, githubId: 'g' }); await Promise.resolve(); await Promise.resolve()
  expect(mocks.ids).not.toHaveBeenCalled()
  expect(mocks.bridge.mock.calls.filter(([, message]) => message.type === 'GET_HISTORICAL_BY_SUBMISSION_IDS' || message.type === 'ACK')).toHaveLength(0)
})

it('does not report a completed import after unmount while ACK is pending', async () => {
  const capture = { captureId: '55555555-5555-4555-8555-555555555555', platform: 'JUNGOL', historicalImport: true, historicalSubmissionId: '1' }
  const waitingAck = deferred<{ ok: true }>(); const imported = vi.fn()
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'GET_HISTORICAL_SUBMISSION_IDS') return Promise.resolve({ localOnly: true, submissionIds: ['1'] })
    if (message.type === 'GET_HISTORICAL_BY_SUBMISSION_IDS') return Promise.resolve({ localOnly: true, captures: [capture] })
    if (message.type === 'ACK') return waitingAck.promise
    return Promise.resolve({})
  })
  mocks.me.mockResolvedValue({ id: 1, githubId: 'g' }); mocks.ids.mockResolvedValue([]); mocks.upload.mockResolvedValue({ acceptedCaptureIds: [capture.captureId], failures: [] })
  const view = render(<HistoricalImportView extensionId="extension" capability="cap" user={{ id: 1, githubId: 'g', githubLogin: 'u' }} mode="live" onImported={imported} />)
  await screen.findByText('정올 제출 #1'); fireEvent.click(screen.getByRole('button', { name: '선택한 1건 수동 서버 동기화' }))
  await waitFor(() => expect(mocks.bridge.mock.calls.some(([, message]) => message.type === 'ACK')).toBe(true))
  view.unmount(); waitingAck.resolve({ ok: true }); await Promise.resolve(); await Promise.resolve()
  expect(imported).not.toHaveBeenCalled()
})
