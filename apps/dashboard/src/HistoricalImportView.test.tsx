// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HistoricalImportView, selectHistoricalSubmissionIds } from './HistoricalImportView'

const mocks = vi.hoisted(() => ({ bridge: vi.fn(), archive: vi.fn().mockImplementation((_id: string, message: { submissionIds: string[] }) => Promise.resolve({
  localOnly: true, captures: message.submissionIds.map(id => ({ captureId: `capture-${id}`, platform: 'JUNGOL',
    historicalImport: true, historicalSubmissionId: id, problemNumber: id, title: '문제',
    problemUrl: `https://jungol.co.kr/problem/${id}`, language: 'Java', sourceCode: 'class Main {}', result: 'ACCEPTED' })),
})), upload: vi.fn().mockImplementation((captures: { captureId: string }[]) => Promise.resolve({ acceptedCaptureIds: captures.map(c => c.captureId), failures: [] })), commits: vi.fn(), statuses: vi.fn().mockResolvedValue({}), settings: vi.fn().mockResolvedValue({ githubTargetConfigured: false }), serverIds: vi.fn().mockResolvedValue([]), localIds: vi.fn().mockResolvedValue([]), connect: vi.fn().mockResolvedValue({ capability: 'capability', features: ['history-v1'] }), me: vi.fn().mockResolvedValue({ id: 1, githubId: '123' }) }))
vi.mock('./bridge', () => ({ requestBridge: (...args: [string, { type: string }, unknown?]) =>
  args[1]?.type === 'GET_HISTORICAL_BY_SUBMISSION_IDS' ? mocks.archive(...args) :
    args[1]?.type === 'GET_HISTORICAL_SUBMISSION_IDS' ? mocks.localIds(...args).then((submissionIds: string[]) => ({ localOnly: true, submissionIds })) :
      args[1]?.type === 'CONNECT' ? mocks.connect(...args) : mocks.bridge(...args) }))
vi.mock('./api', () => ({ getMe: (...args: unknown[]) => mocks.me(...args), getHistoricalSubmissionIds: (...args: unknown[]) => mocks.serverIds(...args), getHistoricalGithubStatus: (...args: unknown[]) => mocks.statuses(...args), getAccountSettings: (...args: unknown[]) => mocks.settings(...args), bulkUpload: (...args: unknown[]) => mocks.upload(...args), requestHistoricalGithubCommits: (...args: unknown[]) => mocks.commits(...args) }))
afterEach(() => {
  cleanup(); vi.clearAllMocks()
  mocks.settings.mockResolvedValue({ githubTargetConfigured: false })
  mocks.serverIds.mockResolvedValue([])
  mocks.localIds.mockResolvedValue([])
  mocks.connect.mockResolvedValue({ capability: 'capability', features: ['history-v1'] })
  mocks.upload.mockImplementation((captures: { captureId: string }[]) => Promise.resolve({ acceptedCaptureIds: captures.map(capture => capture.captureId), failures: [] }))
})

it('keeps selection and local-only import in the dashboard, with no site-injected controls', async () => {
  const imported = vi.fn()
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) =>
    message.type === 'HISTORY_SCAN_START'
      ? Promise.resolve({ history: { status: 'READY', candidates: [{ submissionId: '12345', problemNumber: '1520', title: '계단 오르기', language: 'Java', executionTime: 25, memoryValue: 33 }], skipped: 0, truncated: false, scanProtocol: 3, paginationClicks: 1 } })
      : Promise.resolve(message.type === 'ACK' ? { ok: true } : { history: { status: 'DONE', saved: 1, duplicate: 0, skipped: 0 } }))
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={imported} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  expect(await screen.findByText(/#1520 · 계단 오르기/)).toBeTruthy()
  expect(mocks.bridge.mock.calls.find(([, message]) => message.type === 'HISTORY_SCAN_START')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '선택한 1건 동기화' }))
  await waitFor(() => expect(imported).toHaveBeenCalledOnce())
  expect(screen.getByRole('status').textContent).toContain('GitHub 커밋은 실행되지 않았습니다')
  const importCall = mocks.bridge.mock.calls.find(([, message]) => message.type === 'HISTORY_IMPORT')
  expect(importCall?.[1]).toEqual({ type: 'HISTORY_IMPORT', capability: 'capability', platform: 'JUNGOL', submissionIds: ['12345'] })
  expect(importCall?.[2]).toEqual({ timeoutMs: 240_000 })
})

it('requires dashboard login before scanning the site or reading server duplicates', () => {
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={null} mode="local" onImported={() => undefined} />)
  expect(screen.getByRole('button', { name: '열린 탭에서 후보 확인' })).toHaveProperty('disabled', true)
  expect(screen.getByText(/CodeArchive 로그인과 서버 연결을 확인한 뒤/)).toBeTruthy()
  expect(mocks.me).not.toHaveBeenCalled()
  expect(mocks.serverIds).not.toHaveBeenCalled()
})

it('shows scan progress without exposing a short partial list, then presents the complete result', async () => {
  const candidates = Array.from({ length: 14 }, (_, index) => ({ submissionId: String(index + 1),
    problemNumber: String(index + 1), title: `문제 ${index + 1}` }))
  let statusCalls = 0
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => Promise.resolve(
    message.type === 'HISTORY_SCAN_START'
      ? { history: { status: 'SCANNING', progress: { phase: 'pages', rows: 13, pagesLoaded: 0, groupsExpanded: 0, groupsTotal: 0 } } }
      : message.type === 'HISTORY_SCAN_STATUS' && ++statusCalls === 1
        ? { history: { status: 'SCANNING', progress: { phase: 'groups', rows: 26, pagesLoaded: 1, groupsExpanded: 1, groupsTotal: 2 } } }
        : { history: { status: 'READY', candidates, truncated: false, scanProtocol: 3, paginationClicks: 1 } }))
  render(<HistoricalImportView extensionId="extension-id" capability="capability"
    user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  const bar = await screen.findByRole('progressbar', { name: '정올 후보 탐색 진행률' })
  expect(bar).toBeTruthy()
  expect(screen.queryByText('#1 · 문제 1')).toBeNull()
  expect(await screen.findByText(/접힌 제출 펼치는 중 · 1\/2그룹/, {}, { timeout: 3000 })).toBeTruthy()
  expect(await screen.findByText(/가져올 정답 제출 후보 14건/, {}, { timeout: 3000 })).toBeTruthy()
  expect(screen.getByRole('button', { name: '선택한 14건 동기화' })).toBeTruthy()
})

it('does not expose an import action when the authenticated server duplicate check fails', async () => {
  mocks.serverIds.mockRejectedValueOnce(new Error('server unavailable'))
  mocks.bridge.mockResolvedValue({ history: { status: 'READY', candidates: [{ submissionId: '12345', problemNumber: '1520', title: '계단 오르기' }], truncated: false, scanProtocol: 3, paginationClicks: 1 } })
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  expect(await screen.findByText(/서버 중복 기록을 확인할 수 없습니다/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /선택한 .*건 동기화/ })).toBeNull()
})

it('sends a locally verified historical capture to the server and acknowledges only accepted IDs', async () => {
  const capture = { captureId: 'capture-1', platform: 'JUNGOL', historicalImport: true, historicalSubmissionId: '12345',
    problemNumber: '1520', title: '계단 오르기', problemUrl: 'https://jungol.co.kr/problem/1520', language: 'Java', sourceCode: 'class Main {}', result: 'ACCEPTED' }
  mocks.archive.mockResolvedValueOnce({ captures: [capture], localOnly: true })
  mocks.upload.mockResolvedValueOnce({ acceptedCaptureIds: ['capture-1'], failures: [] })
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => Promise.resolve(message.type === 'HISTORY_SCAN_START'
    ? { history: { status: 'READY', candidates: [{ submissionId: '12345', problemNumber: '1520', title: '계단 오르기' }], truncated: false, scanProtocol: 3, paginationClicks: 1 } }
    : message.type === 'ACK' ? { ok: true } : { history: { status: 'DONE', saved: 1, duplicate: 0, skipped: 0 } }))
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  await screen.findByText(/#1520 · 계단 오르기/)
  fireEvent.click(screen.getByRole('button', { name: '선택한 1건 동기화' }))
  expect(await screen.findByText(/서버 동기화 1건/)).toBeTruthy()
  expect(mocks.upload).toHaveBeenCalledWith([capture], '123')
  expect(mocks.bridge.mock.calls.find(([, message]) => message.type === 'ACK')?.[1]).toEqual({ type: 'ACK', capability: 'capability', captureIds: ['capture-1'] })
})

it('retries a temporarily skipped submission before counting it as excluded', async () => {
  let importCalls = 0
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => Promise.resolve(
    message.type === 'HISTORY_SCAN_START'
      ? { history: { status: 'READY', candidates: [{ submissionId: '12345', problemNumber: '1520', title: '계단 오르기' }], truncated: false, scanProtocol: 3, paginationClicks: 1 } }
      : message.type === 'HISTORY_IMPORT'
        ? { history: ++importCalls === 1 ? { status: 'DONE', saved: 0, duplicate: 0, skipped: 1 } : { status: 'DONE', saved: 1, duplicate: 0, skipped: 0 } }
        : message.type === 'ACK' ? { ok: true } : { localOnly: true }))
  render(<HistoricalImportView extensionId="extension-id" capability="capability"
    user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  fireEvent.click(await screen.findByRole('button', { name: '선택한 1건 동기화' }))
  expect(await screen.findByText(/1번째 제출을 다시 확인 중입니다/, {}, { timeout: 3000 })).toBeTruthy()
  expect(await screen.findByText(/로컬 신규 1건 · 서버 동기화 1건 · 중복 0건 · 제외 0건/, {}, { timeout: 3000 })).toBeTruthy()
  expect(importCalls).toBe(2)
  expect(mocks.upload).toHaveBeenCalledOnce()
})

it('offers an explicit GitHub commit after sync only for a confirmed target', async () => {
  const target = { version: 4, githubTargetConfigured: true, githubInstallationId: 77,
    githubOwner: 'owner', githubRepository: 'archive', githubBranch: 'develop' }
  const capture = { captureId: 'capture-2', platform: 'JUNGOL', historicalImport: true, historicalSubmissionId: '12345',
    problemNumber: '1520', title: '계단 오르기', problemUrl: 'https://jungol.co.kr/problem/1520', language: 'Java', sourceCode: 'class Main {}', result: 'ACCEPTED' }
  mocks.settings.mockResolvedValue(target)
  mocks.archive.mockResolvedValueOnce({ captures: [capture], localOnly: true })
  mocks.upload.mockResolvedValueOnce({ acceptedCaptureIds: ['capture-2'], failures: [] })
  mocks.commits.mockResolvedValueOnce({ '12345': 'PENDING' })
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => Promise.resolve(message.type === 'HISTORY_SCAN_START'
    ? { history: { status: 'READY', candidates: [{ submissionId: '12345', problemNumber: '1520', title: '계단 오르기' }], truncated: false, scanProtocol: 3, paginationClicks: 1 } }
    : message.type === 'ACK' ? { ok: true } : { history: { status: 'DONE', saved: 1, duplicate: 0, skipped: 0 } }))
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  await screen.findByText(/대상: owner\/archive · develop/)
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 커밋까지 진행' }))
  expect(await screen.findByText(/GitHub 커밋 요청 1건 접수/)).toBeTruthy()
  expect(mocks.commits).toHaveBeenCalledWith('123', {
    submissionIds: ['12345'], settingsVersion: 4, installationId: 77,
    owner: 'owner', repository: 'archive', branch: 'develop',
  })
})

it('recovers a server-saved submission after its local ACK fails', async () => {
  let serverSaved = false
  let locallySaved = false
  let ackCalls = 0
  mocks.serverIds.mockImplementation(() => Promise.resolve(serverSaved ? ['12345'] : []))
  mocks.localIds.mockImplementation(() => Promise.resolve(locallySaved ? ['12345'] : []))
  mocks.upload.mockImplementation((captures: { captureId: string }[]) => {
    serverSaved = true
    return Promise.resolve({ acceptedCaptureIds: captures.map(capture => capture.captureId), failures: [] })
  })
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'HISTORY_SCAN_START') return Promise.resolve({ history: { status: 'READY',
      candidates: [{ submissionId: '12345', problemNumber: '1520', title: '계단 오르기' }],
      truncated: false, scanProtocol: 3, paginationClicks: 1 } })
    if (message.type === 'HISTORY_IMPORT') { locallySaved = true; return Promise.resolve({ history: { status: 'DONE', saved: 1, duplicate: 0, skipped: 0 } }) }
    if (message.type === 'ACK') return Promise.resolve({ ok: ++ackCalls > 1 })
    return Promise.resolve({ localOnly: true, summary: { JUNGOL: { saved: 1, problems: 1, previouslySaved: 0,
      historicalSaved: 1, synced: 0, syncedProblems: 0 }, SWEA: {}, PROGRAMMERS: {} } })
  })
  render(<HistoricalImportView extensionId="extension-id" capability="capability"
    user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  await screen.findByText(/#1520 · 계단 오르기/)
  fireEvent.click(screen.getByRole('button', { name: '선택한 1건 동기화' }))
  expect(await screen.findByText(/서버 동기화 0건까지 확인했습니다/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  expect(await screen.findByText(/이미 서버에 저장된 이 브라우저의 제출/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '선택한 1건 동기화' })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: /제출 #12345/ }))
  fireEvent.click(screen.getByRole('button', { name: '선택한 1건 동기화 확인' }))
  expect(await screen.findByText(/로컬 동기화 표시를 복구했습니다/)).toBeTruthy()
  expect(mocks.upload).toHaveBeenCalledTimes(2)
  expect(ackCalls).toBe(2)
})

it('can request GitHub commits later for submissions already synced to the server', async () => {
  const target = { version: 4, githubTargetConfigured: true, githubInstallationId: 77,
    githubOwner: 'owner', githubRepository: 'archive', githubBranch: 'develop' }
  let serverSaved = false
  let locallySaved = false
  mocks.settings.mockResolvedValue(target)
  mocks.serverIds.mockImplementation(() => Promise.resolve(serverSaved ? ['12345'] : []))
  mocks.localIds.mockImplementation(() => Promise.resolve(locallySaved ? ['12345'] : []))
  mocks.upload.mockImplementation((captures: { captureId: string }[]) => {
    serverSaved = true
    return Promise.resolve({ acceptedCaptureIds: captures.map(capture => capture.captureId), failures: [] })
  })
  mocks.commits.mockRejectedValueOnce(new Error('network failure')).mockResolvedValue({ '12345': 'PENDING' })
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'HISTORY_SCAN_START') return Promise.resolve({ history: { status: 'READY',
      candidates: [{ submissionId: '12345', problemNumber: '1520', title: '계단 오르기' }],
      truncated: false, scanProtocol: 3, paginationClicks: 1 } })
    if (message.type === 'HISTORY_IMPORT') { locallySaved = true; return Promise.resolve({ history: { status: 'DONE', saved: 1, duplicate: 0, skipped: 0 } }) }
    if (message.type === 'ACK') return Promise.resolve({ ok: true })
    return Promise.resolve({ localOnly: true, summary: { JUNGOL: { saved: 1, problems: 1, previouslySaved: 0,
      historicalSaved: 1, synced: 1, syncedProblems: 1 }, SWEA: {}, PROGRAMMERS: {} } })
  })
  render(<HistoricalImportView extensionId="extension-id" capability="capability"
    user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  await screen.findByText(/#1520 · 계단 오르기/)
  fireEvent.click(screen.getByRole('button', { name: '선택한 1건 동기화' }))
  expect(await screen.findByText(/서버 동기화 1건/)).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: /제출 #12345/ }))
  fireEvent.click(screen.getByRole('button', { name: '선택한 저장 제출 GitHub 커밋까지 진행' }))
  expect(await screen.findByText(/GitHub 요청 0건까지 접수했습니다/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '선택한 저장 제출 GitHub 커밋까지 진행' }))
  expect(await screen.findByText(/GitHub 커밋 요청 1건 접수/)).toBeTruthy()
  expect(mocks.commits).toHaveBeenCalledTimes(2)
  expect(mocks.bridge.mock.calls.filter(([, message]) => message.type === 'HISTORY_IMPORT')).toHaveLength(1)
})

it('continues a sequential import after the extension capability expires', async () => {
  mocks.connect.mockResolvedValueOnce({ capability: 'first-run', features: ['history-v1'] })
    .mockResolvedValueOnce({ capability: 'renewed-run', features: ['history-v1'] })
  mocks.bridge.mockImplementation((_id: string, message: { type: string; capability?: string; submissionIds?: string[] }) => {
    if (message.type === 'HISTORY_SCAN_START') return Promise.resolve({ history: { status: 'READY',
      candidates: [{ submissionId: '1', problemNumber: '1', title: '첫 문제' },
        { submissionId: '2', problemNumber: '2', title: '둘째 문제' }],
      truncated: false, scanProtocol: 3, paginationClicks: 1 } })
    if (message.type === 'HISTORY_IMPORT') return message.submissionIds?.[0] === '2' && message.capability === 'first-run'
      ? Promise.reject(new Error('UNAUTHORIZED'))
      : Promise.resolve({ history: { status: 'DONE', saved: 1, duplicate: 0, skipped: 0 } })
    if (message.type === 'ACK') return Promise.resolve({ ok: true })
    return Promise.resolve({ localOnly: true, summary: { JUNGOL: { saved: 0, problems: 0, previouslySaved: 0, historicalSaved: 0, synced: 0, syncedProblems: 0 }, SWEA: { saved: 0, problems: 0, previouslySaved: 0, historicalSaved: 0, synced: 0, syncedProblems: 0 }, PROGRAMMERS: { saved: 0, problems: 0, previouslySaved: 0, historicalSaved: 0, synced: 0, syncedProblems: 0 } } })
  })
  render(<HistoricalImportView extensionId="extension-id" capability="capability"
    user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  await screen.findByText(/#2 · 둘째 문제/)
  fireEvent.click(screen.getByRole('button', { name: '선택한 2건 동기화' }))
  expect(await screen.findByText(/로컬 신규 2건 · 서버 동기화 2건/)).toBeTruthy()
  const imports = mocks.bridge.mock.calls.filter(([, message]) => message.type === 'HISTORY_IMPORT')
  expect(imports.map(([, message]) => [message.submissionIds[0], message.capability])).toEqual([
    ['1', 'first-run'], ['2', 'first-run'], ['2', 'renewed-run'],
  ])
})

it('reissues accepted capture IDs on a fresh capability before retrying ACK', async () => {
  mocks.connect.mockResolvedValueOnce({ capability: 'first-run', features: ['history-v1'] })
    .mockResolvedValueOnce({ capability: 'renewed-run', features: ['history-v1'] })
  mocks.bridge.mockImplementation((_id: string, message: { type: string; capability?: string }) => {
    if (message.type === 'HISTORY_SCAN_START') return Promise.resolve({ history: { status: 'READY',
      candidates: [{ submissionId: '12345', problemNumber: '1520', title: '계단 오르기' }],
      truncated: false, scanProtocol: 3, paginationClicks: 1 } })
    if (message.type === 'HISTORY_IMPORT') return Promise.resolve({ history: { status: 'DONE', saved: 1, duplicate: 0, skipped: 0 } })
    if (message.type === 'ACK') return message.capability === 'first-run'
      ? Promise.reject(new Error('UNAUTHORIZED')) : Promise.resolve({ ok: true })
    return Promise.resolve({ localOnly: true, summary: { JUNGOL: { saved: 0, problems: 0, previouslySaved: 0, historicalSaved: 0, synced: 0, syncedProblems: 0 }, SWEA: { saved: 0, problems: 0, previouslySaved: 0, historicalSaved: 0, synced: 0, syncedProblems: 0 }, PROGRAMMERS: { saved: 0, problems: 0, previouslySaved: 0, historicalSaved: 0, synced: 0, syncedProblems: 0 } } })
  })
  render(<HistoricalImportView extensionId="extension-id" capability="capability"
    user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  await screen.findByText(/#1520 · 계단 오르기/)
  fireEvent.click(screen.getByRole('button', { name: '선택한 1건 동기화' }))
  expect(await screen.findByText(/서버 동기화 1건/)).toBeTruthy()
  expect(mocks.archive).toHaveBeenCalledTimes(2)
  expect(mocks.archive.mock.calls.map(([, message]) => message.capability)).toEqual(['first-run', 'renewed-run'])
  expect(mocks.bridge.mock.calls.filter(([, message]) => message.type === 'ACK').map(([, message]) => message.capability))
    .toEqual(['first-run', 'renewed-run'])
})

it('shows platform-wide previously saved, imported and synced counts instead of a 50-item list', async () => {
  const empty = { saved: 0, problems: 0, previouslySaved: 0, historicalSaved: 0, synced: 0, syncedProblems: 0 }
  mocks.bridge.mockResolvedValue({ localOnly: true, summary: {
    JUNGOL: { saved: 4, problems: 3, previouslySaved: 2, historicalSaved: 2, synced: 3, syncedProblems: 2 },
    SWEA: empty, PROGRAMMERS: empty,
  } })
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  expect(await screen.findByText(/기존 저장 2건 \+ 과거 가져오기 2건/)).toBeTruthy()
  expect(screen.getByText(/로컬 동기화 표시 3건/)).toBeTruthy()
  expect(mocks.bridge.mock.calls[0]?.[1]).toEqual({ type: 'GET_HISTORICAL_SUMMARY', capability: 'capability' })
})

it('removes already saved Jungol submission IDs before applying the selected problem rule', async () => {
  mocks.serverIds.mockResolvedValueOnce(['104'])
  const candidates = [
    { submissionId: '104', problemNumber: '1520', title: '계단 오르기' },
    { submissionId: '103', problemNumber: '1520', title: '계단 오르기' },
    { submissionId: '102', problemNumber: '1073', title: '삼각형둘레' },
  ]
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => Promise.resolve(message.type === 'HISTORY_SCAN_START'
    ? { history: { status: 'READY', candidates, skipped: 113, truncated: false, scanProtocol: 3, paginationClicks: 1 } }
    : { history: { status: 'DONE', saved: 1, duplicate: 0, skipped: 0 } }))
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.change(screen.getByRole('combobox', { name: '동일 문제 제출 선택' }), { target: { value: 'latest' } })
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  expect(await screen.findByText(/가져올 정답 제출 후보 2건/)).toBeTruthy()
  expect(screen.queryByRole('checkbox', { name: /제출 #104/ })).toBeNull()
  expect(screen.getByRole('checkbox', { name: /제출 #103/ })).toHaveProperty('checked', true)
  expect(screen.getByRole('checkbox', { name: /제출 #102/ })).toHaveProperty('checked', true)
  expect(screen.queryByText(/113건/)).toBeNull()
})

it('selects all submissions and imports them one at a time without a ten-item archive cap', async () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({ submissionId: String(index + 1), problemNumber: String(index + 1), title: `문제 ${index + 1}` }))
  mocks.bridge.mockImplementation((_id: string, message: { type: string; submissionIds?: string[] }) =>
    Promise.resolve(message.type === 'HISTORY_SCAN_START'
      ? { history: { status: 'READY', candidates, skipped: 0, truncated: false, scanProtocol: 3, paginationClicks: 1 } }
      : message.type === 'ACK' ? { ok: true } : { history: { status: 'DONE', saved: message.submissionIds?.length ?? 0, duplicate: 0, skipped: 0 } }))
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  await screen.findByText('#12 · 문제 12')
  const last = screen.getByRole('checkbox', { name: /#12 · 문제 12/ })
  expect(last).toHaveProperty('checked', true)
  fireEvent.click(screen.getByRole('button', { name: '선택한 12건 동기화' }))
  await waitFor(() => expect(mocks.bridge.mock.calls.filter(([, message]) => message.type === 'HISTORY_IMPORT')).toHaveLength(12))
  const batches = mocks.bridge.mock.calls.filter(([, message]) => message.type === 'HISTORY_IMPORT')
  expect(batches.map(([, message]) => message.submissionIds.length)).toEqual(Array(12).fill(1))
  expect(await screen.findByText(/로컬 신규 12건/)).toBeTruthy()
  expect(screen.getByRole('progressbar', { name: '과거 풀이 가져오기 진행률' })).toHaveProperty('value', 12)
})

it('selects one accepted submission per problem using newest list order or the best performance', async () => {
  const candidates = [
    { submissionId: '104', problemNumber: '1520', title: '계단 오르기', executionTime: 400, memoryValue: 40 },
    { submissionId: '103', problemNumber: '1520', title: '계단 오르기', executionTime: 200, memoryValue: 60 },
    { submissionId: '102', problemNumber: '1520', title: '계단 오르기', executionTime: 300, memoryValue: 30 },
    { submissionId: '101', problemNumber: '1073', title: '삼각형둘레', executionTime: 100, memoryValue: 33 },
  ]
  expect(selectHistoricalSubmissionIds(candidates, 'all')).toEqual(['104', '103', '102', '101'])
  expect(selectHistoricalSubmissionIds(candidates, 'latest')).toEqual(['104', '101'])
  expect(selectHistoricalSubmissionIds(candidates, 'fastest')).toEqual(['103', '101'])
  expect(selectHistoricalSubmissionIds(candidates, 'lowest-memory')).toEqual(['102', '101'])
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => Promise.resolve(message.type === 'HISTORY_SCAN_START'
    ? { history: { status: 'READY', candidates, skipped: 0, truncated: false, scanProtocol: 3, paginationClicks: 1 } }
    : { localOnly: true, totalCount: 0, captures: [] }))
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.change(screen.getByRole('combobox', { name: '동일 문제 제출 선택' }), { target: { value: 'fastest' } })
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  expect(await screen.findByText(/목록 탐색 완료/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '선택한 2건 동기화' })).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: /제출 #103/ })).toHaveProperty('checked', true)
  expect(screen.getByRole('checkbox', { name: /제출 #104/ })).toHaveProperty('checked', false)
  fireEvent.change(screen.getByRole('combobox', { name: '동일 문제 제출 선택' }), { target: { value: 'lowest-memory' } })
  expect(screen.getByRole('checkbox', { name: /제출 #102/ })).toHaveProperty('checked', true)
})

it('previews Programmers solved candidates without offering unverified source import', async () => {
  mocks.bridge.mockResolvedValue({ history: { status: 'READY', candidates: [{ problemNumber: '42861', title: '섬 연결하기', solvedAt: '2026-09-30 14:00:00' }], skipped: 0, truncated: true } })
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.change(screen.getByRole('combobox', { name: '가져올 사이트' }), { target: { value: 'PROGRAMMERS' } })
  fireEvent.change(screen.getByRole('combobox', { name: '동일 문제 제출 선택' }), { target: { value: 'fastest' } })
  expect(screen.getByRole('combobox', { name: '동일 문제 제출 선택' })).toHaveProperty('value', 'fastest')
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  expect(await screen.findByText(/#42861 · 섬 연결하기/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /로컬에 가져오기/ })).toBeNull()
  expect(screen.getByText(/원본 코드가 없어 저장할 수 없습니다/)).toBeTruthy()
  expect(screen.getByText(/제출별 원본·시간·메모리 검증이 구현된 뒤 적용됩니다/)).toBeTruthy()
})

it('warns about an incomplete Jungol scan even if no accepted candidate was found yet', async () => {
  mocks.bridge.mockResolvedValue({ history: { status: 'READY', candidates: [], skipped: 0, truncated: true, scanProtocol: 3, paginationClicks: 0 } })
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  expect(await screen.findByText(/정올 목록 탐색이 끝나지 않았습니다/)).toBeTruthy()
})

it('does not offer a partial Jungol preview as an import-ready full scan', async () => {
  mocks.bridge.mockResolvedValue({ history: { status: 'READY', candidates: [{ submissionId: '12345', problemNumber: '1520', title: '계단 오르기' }], skipped: 3, truncated: true, scanProtocol: 3, paginationClicks: 0, remainingGroups: 3 } })
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  expect(await screen.findByText(/정올 목록 탐색이 끝나지 않았습니다/)).toBeTruthy()
  expect(screen.queryByText('#1520 · 계단 오르기')).toBeNull()
  expect(screen.queryByRole('button', { name: '선택한 1건 동기화' })).toBeNull()
})

it('rejects a stale Jungol content script reporting thirteen rows as complete', async () => {
  const candidates = Array.from({ length: 13 }, (_, index) => ({
    submissionId: String(index + 1), problemNumber: String(index + 1), title: `문제 ${index + 1}`,
  }))
  mocks.bridge.mockResolvedValue({ history: { status: 'READY', candidates, skipped: 0, truncated: false } })
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  expect(await screen.findByText(/정올 제출 탭에서 이전 버전의 수집 코드가 응답했습니다/)).toBeTruthy()
  expect(screen.queryByText('#13 · 문제 13')).toBeNull()
  expect(screen.queryByRole('button', { name: /로컬에 가져오기/ })).toBeNull()
})

it('refreshes local history after a later submission fails because part may already be saved', async () => {
  const imported = vi.fn()
  const candidates = Array.from({ length: 11 }, (_, index) => ({ submissionId: String(index + 1), problemNumber: String(index + 1), title: `문제 ${index + 1}` }))
  let calls = 0
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'HISTORY_SCAN_START') return Promise.resolve({ history: { status: 'READY', candidates, skipped: 0, truncated: false, scanProtocol: 3, paginationClicks: 1 } })
    if (message.type === 'HISTORY_IMPORT') return Promise.resolve({ history: ++calls <= 10
      ? { status: 'DONE', saved: 1, duplicate: 0, skipped: 0 } : { status: 'FAILED' } })
    return Promise.resolve({ localOnly: true, totalCount: 10, captures: [] })
  })
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={imported} />)
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  await screen.findByText('#11 · 문제 11')
  fireEvent.click(screen.getByRole('button', { name: '선택한 11건 동기화' }))
  expect(await screen.findByText(/가져오기 중단 · 10\/11건 처리/)).toBeTruthy()
  expect(screen.getByRole('progressbar', { name: '과거 풀이 가져오기 진행률' })).toHaveProperty('value', 10)
  await waitFor(() => expect(imported).toHaveBeenCalledOnce())
  expect(mocks.bridge.mock.calls.filter(([, message]) => message.type === 'GET_HISTORICAL_SUMMARY').length).toBeGreaterThanOrEqual(2)
})

it('SWEA only previews candidate problems until own Pass source can be verified', async () => {
  mocks.bridge.mockResolvedValue({ history: { status: 'READY', candidates: [{ problemNumber: '4796', title: '의석이의 우뚝 선 산' }], skipped: 0 } })
  render(<HistoricalImportView extensionId="extension-id" capability="capability" user={{ id: 1, githubId: '123', githubLogin: 'test' }} mode="live" onImported={() => undefined} />)
  fireEvent.change(screen.getByRole('combobox', { name: '가져올 사이트' }), { target: { value: 'SWEA' } })
  fireEvent.change(screen.getByRole('combobox', { name: '동일 문제 제출 선택' }), { target: { value: 'latest' } })
  expect(screen.getByRole('combobox', { name: '동일 문제 제출 선택' })).toHaveProperty('value', 'latest')
  fireEvent.click(screen.getByRole('button', { name: '열린 탭에서 후보 확인' }))
  expect(await screen.findByText(/#4796 · 의석이의 우뚝 선 산/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /로컬에 가져오기/ })).toBeNull()
  expect(screen.getByText(/현재는 후보 미리보기만 지원합니다/)).toBeTruthy()
  expect(screen.getByText(/제출별 원본·시간·메모리 검증이 구현된 뒤 적용됩니다/)).toBeTruthy()
})
