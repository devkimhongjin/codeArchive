// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { EXTENSION_ID, LEGACY_EXTENSION_ID } from './extensionConfig'
import { BridgeError } from './bridge'

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  list: vi.fn(),
  bulk: vi.fn(),
  grant: vi.fn(),
  settings: vi.fn(),
  bridge: vi.fn(),
}))

vi.mock('./api', async (original) => ({
  ...await original<typeof import('./api')>(),
  getMe: mocks.me,
  getSolutions: mocks.list,
  bulkUpload: mocks.bulk,
  issueRelayGrant: mocks.grant,
  getAccountSettings: mocks.settings,
}))

vi.mock('./bridge', async (original) => ({
  ...await original<typeof import('./bridge')>(),
  requestBridge: mocks.bridge,
}))

const user = { id: 1, githubId: '42', githubLogin: 'private-account' }
const capture = {
  captureId: 'capture-1',
  platform: 'SWEA' as const,
  problemNumber: '1234',
  title: '테스트 풀이',
  problemUrl: 'https://example.test/1234',
  language: 'JavaScript',
  sourceCode: 'console.log(1234)',
  result: 'ACCEPTED' as const,
}
const secondCapture = { ...capture, captureId: 'capture-2', problemNumber: '5678', title: '두 번째 풀이', sourceCode: 'console.log(5678)' }
const liveSettings = {
  version: 4, name: '연결 사용자', nickname: null, copyHeader: false, downloadHeader: false, githubHeader: false,
  downloadFilenameTemplate: '{platform}-{number}-{title}', gitPathTemplate: '{platform}/{number}_{title}/{time}', githubCommitMessageTemplate: 'Add {platform} {number} solution',
  lightTheme: 'github-light' as const, darkTheme: 'github-dark' as const, autoSyncEnabled: true, githubAutoCommitEnabled: true,
  githubTargetConfigured: true, githubStatus: 'AVAILABLE' as const, githubInstallationId: 44, githubOwner: 'private-account', githubRepository: 'archive', githubBranch: 'main', githubRootPath: null,
}

function bridgeCalls(type: string) {
  return mocks.bridge.mock.calls.filter(([, message]) => message.type === type)
}

async function openConnectedSettings() {
  render(<App />)
  await screen.findByRole('button', { name: '로그아웃' })
  fireEvent.click(screen.getByRole('button', { name: '설정' }))
  await waitFor(() => expect(bridgeCalls('CONNECT').length).toBeGreaterThan(0))
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

it('auto-connects only known IDs, falls back for migration and transfers no code until sync', async () => {
  localStorage.setItem('codearchive-extension-id', 'a'.repeat(32))
  mocks.me.mockResolvedValue(user)
  mocks.list.mockResolvedValue([])
  mocks.bridge.mockImplementation((id: string, message: { type: string }) => {
    if (message.type === 'CONNECT' && id === EXTENSION_ID) return Promise.reject(new Error('not installed'))
    if (message.type === 'CONNECT') return Promise.resolve({ capability: 'legacy' })
    return Promise.resolve({ ok: true })
  })
  await openConnectedSettings()
  expect(bridgeCalls('CONNECT').map(([id]) => id)).toEqual([EXTENSION_ID, LEGACY_EXTENSION_ID])
  expect(bridgeCalls('GET_PENDING')).toHaveLength(0)
  expect(screen.queryByLabelText('확장 프로그램 ID')).toBeNull()
  // Ordinary connect/disconnect controls deliberately do not live in Settings.
  expect(screen.queryByText('연결 안 됨')).toBeNull()
})

it('reads only the extension-local archive after unauthenticated startup', async () => {
  mocks.me.mockRejectedValue(new Error('not signed in'))
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT'
    ? Promise.resolve({ capability: 'local-capability' })
    : Promise.resolve({ captures: [], localOnly: true }))
  render(<App />)
  await waitFor(() => expect(bridgeCalls('GET_LOCAL_ARCHIVE')).toHaveLength(1))
  expect(bridgeCalls('GET_PENDING')).toHaveLength(0)
})

it('renews an expired capability within the same explicit sync without uploading twice', async () => {
  mocks.me.mockResolvedValue(user)
  mocks.list.mockResolvedValue([])
  mocks.bulk.mockResolvedValue({ acceptedCaptureIds: ['capture-1'], failures: [] })
  let reads = 0
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'CONNECT') return Promise.resolve({ capability: `cap-${bridgeCalls('CONNECT').length}` })
    if (message.type === 'GET_PENDING') {
      if (reads++ === 0) return Promise.reject(new BridgeError('UNAUTHORIZED'))
      return Promise.resolve({ captures: [capture] })
    }
    return Promise.resolve({ ok: true })
  })
  await openConnectedSettings()
  fireEvent.click(screen.getByRole('button', { name: '동기화' }))
  await waitFor(() => expect(bridgeCalls('ACK')).toHaveLength(1))
  expect(bridgeCalls('CONNECT')).toHaveLength(2)
  expect(mocks.bulk).toHaveBeenCalledOnce()
})

it('keeps the bridge connected after an empty sync and reuses it for the next sync', async () => {
  localStorage.setItem('codearchive-extension-id', 'a'.repeat(32))
  mocks.me.mockResolvedValue(user)
  mocks.list.mockResolvedValue([])
  mocks.bulk.mockResolvedValue({ acceptedCaptureIds: [], failures: [] })
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'CONNECT') return Promise.resolve({ capability: 'cap-empty' })
    if (message.type === 'GET_PENDING') return Promise.resolve({ captures: [] })
    return Promise.resolve({ ok: true })
  })

  await openConnectedSettings()
  fireEvent.click(screen.getByRole('button', { name: '동기화' }))
  await waitFor(() => expect(bridgeCalls('GET_PENDING')).toHaveLength(1))
  expect(bridgeCalls('DISCONNECT')).toHaveLength(0)

  fireEvent.click(screen.getByRole('button', { name: '동기화' }))
  await waitFor(() => expect(bridgeCalls('GET_PENDING')).toHaveLength(2))
  expect(bridgeCalls('CONNECT')).toHaveLength(1)
  expect(bridgeCalls('DISCONNECT')).toHaveLength(0)
})

it('keeps the bridge connected after a successful sync and supports a second page', async () => {
  localStorage.setItem('codearchive-extension-id', 'b'.repeat(32))
  mocks.me.mockResolvedValue(user)
  mocks.list.mockResolvedValue([])
  mocks.bulk.mockResolvedValue({ acceptedCaptureIds: ['capture-1'], failures: [] })
  let pendingRequest = 0
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'CONNECT') return Promise.resolve({ capability: 'cap-success' })
    if (message.type === 'GET_PENDING') {
      pendingRequest += 1
      return Promise.resolve({ captures: pendingRequest === 1 ? [capture] : [] })
    }
    return Promise.resolve({ ok: true })
  })

  await openConnectedSettings()
  fireEvent.click(screen.getByRole('button', { name: '동기화' }))
  await waitFor(() => expect(bridgeCalls('ACK')).toHaveLength(1))
  expect(bridgeCalls('DISCONNECT')).toHaveLength(0)

  fireEvent.click(screen.getByRole('button', { name: '동기화' }))
  await waitFor(() => expect(bridgeCalls('GET_PENDING')).toHaveLength(2))
  expect(bridgeCalls('CONNECT')).toHaveLength(1)
  expect(bridgeCalls('DISCONNECT')).toHaveLength(0)
})

it('retires a failed capability so the next sync reconnects and can retry', async () => {
  localStorage.setItem('codearchive-extension-id', 'c'.repeat(32))
  mocks.me.mockResolvedValue(user)
  mocks.list.mockResolvedValue([])
  mocks.bulk
    .mockRejectedValueOnce(new Error('server unavailable'))
    .mockResolvedValueOnce({ acceptedCaptureIds: ['capture-1'], failures: [] })
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'CONNECT') return Promise.resolve({ capability: `cap-${bridgeCalls('CONNECT').length + 1}` })
    if (message.type === 'GET_PENDING') return Promise.resolve({ captures: [capture] })
    return Promise.resolve({ ok: true })
  })

  await openConnectedSettings()
  fireEvent.click(screen.getByRole('button', { name: '동기화' }))
  await waitFor(() => expect(bridgeCalls('DISCONNECT')).toHaveLength(1))

  fireEvent.click(screen.getByRole('button', { name: '동기화' }))
  await waitFor(() => expect(bridgeCalls('ACK')).toHaveLength(1))
  expect(bridgeCalls('CONNECT')).toHaveLength(2)
})

it('uses local archive records after an authenticated solution-list outage without ACK or upload', async () => {
  mocks.me.mockResolvedValue(user)
  mocks.list.mockRejectedValue(new Error('solutions unavailable'))
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT'
    ? Promise.resolve({ capability: 'local-after-outage' })
    : Promise.resolve({ captures: [capture], localOnly: true }))
  render(<App />)
  await waitFor(() => expect(bridgeCalls('GET_LOCAL_ARCHIVE')).toHaveLength(1))
  expect((await screen.findAllByText('테스트 풀이')).length).toBeGreaterThan(0)
  expect(bridgeCalls('ACK')).toHaveLength(0)
  expect(bridgeCalls('CONFIGURE_RELAY')).toHaveLength(0)
  expect(bridgeCalls('GET_PENDING')).toHaveLength(0)
  expect(mocks.grant).not.toHaveBeenCalled()
  expect(mocks.bulk).not.toHaveBeenCalled()
})

it('keeps a manual live refresh read-only when its solution list fails after settings and bridge connection', async () => {
  mocks.me.mockResolvedValue(user)
  mocks.list.mockRejectedValue(new Error('solution-list outage'))
  mocks.settings.mockResolvedValue(liveSettings)
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT'
    ? Promise.resolve({ capability: 'manual-local-capability' })
    : Promise.resolve({ captures: [capture], localOnly: true }))
  render(<App />)
  await waitFor(() => expect(bridgeCalls('GET_LOCAL_ARCHIVE')).toHaveLength(1))
  await waitFor(() => expect(mocks.settings).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: '서버 연결 새로고침' }))
  await waitFor(() => expect(screen.queryAllByText('solution-list outage').length).toBeGreaterThan(0))
  expect(mocks.grant).not.toHaveBeenCalled()
  expect(bridgeCalls('CONFIGURE_RELAY').filter(([, message]) => (message as { relay?: unknown }).relay !== null)).toHaveLength(0)
  expect(bridgeCalls('GET_PENDING')).toHaveLength(0)
  expect(bridgeCalls('ACK')).toHaveLength(0)
})

it('persists an offline inline code-view theme and seeds the next local archive render', async () => {
  mocks.me.mockRejectedValue(new Error('not signed in'))
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT'
    ? Promise.resolve({ capability: 'offline-theme' })
    : Promise.resolve({ captures: [capture], localOnly: true }))
  const first = render(<App />)
  await screen.findAllByText('테스트 풀이')
  fireEvent.change(screen.getByLabelText('밝은 테마'), { target: { value: 'vitesse-light' } })
  await waitFor(() => expect(JSON.parse(localStorage.getItem('codearchive-local-code-themes') ?? '{}').lightTheme).toBe('vitesse-light'))
  first.unmount()
  render(<App />)
  await screen.findAllByText('테스트 풀이')
  expect((screen.getByLabelText('밝은 테마') as HTMLSelectElement).value).toBe('vitesse-light')
})

it('shows a read-only local pending count without issuing captures for upload', async () => {
  mocks.me.mockRejectedValue(new Error('not signed in'))
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'CONNECT') return Promise.resolve({ capability: 'status-capability', version: '0.2.0' })
    if (message.type === 'GET_STATUS') return Promise.resolve({ pendingCount: 2 })
    if (message.type === 'GET_LOCAL_ARCHIVE') return Promise.resolve({ captures: [], localOnly: true })
    return Promise.resolve({ ok: true })
  })

  render(<App />)
  await waitFor(() => expect(document.querySelector('.sync-count')?.textContent).toBe('2'))
  expect(screen.getByText('확장 프로그램 연결 완료 · v0.2.0')).toBeTruthy()
  expect(screen.getByText('로컬 대기 풀이 2개')).toBeTruthy()
  expect(bridgeCalls('GET_PENDING')).toHaveLength(0)
})

it('separates an unavailable extension from signed-out server state', async () => {
  mocks.me.mockRejectedValue(new Error('not signed in'))
  mocks.bridge.mockRejectedValue(new Error('extension unavailable'))

  render(<App />)
  await waitFor(() => expect(bridgeCalls('CONNECT').length).toBeGreaterThan(0))
  expect(screen.getByText('확장 프로그램 연결 끊김')).toBeTruthy()
  expect(screen.getByText('GitHub 로그인 전')).toBeTruthy()
  expect(screen.getByText('로컬 보관함')).toBeTruthy()
  expect(document.querySelector('.sync-count')?.textContent).toBe('—')
})

it('shows an update action for a connected extension below the compatibility floor', async () => {
  mocks.me.mockRejectedValue(new Error('not signed in'))
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'CONNECT') return Promise.resolve({ capability: 'old-version-capability', version: '0.1.9' })
    if (message.type === 'GET_STATUS') return Promise.resolve({ pendingCount: 0 })
    if (message.type === 'GET_LOCAL_ARCHIVE') return Promise.resolve({ captures: [], localOnly: true })
    return Promise.resolve({ ok: true })
  })

  render(<App />)
  expect(await screen.findByText('확장 프로그램 업데이트 필요 · v0.1.9')).toBeTruthy()
  expect(screen.getByRole('button', { name: '확장 업데이트' })).toBeTruthy()
})

it('refreshes the exact remaining count and exposes a partial sync result', async () => {
  mocks.me.mockResolvedValue(user)
  mocks.list.mockResolvedValue([])
  mocks.bulk.mockResolvedValue({ acceptedCaptureIds: ['capture-1'], failures: [{ captureId: 'capture-2', message: 'retry' }] })
  let statusReads = 0
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'CONNECT') return Promise.resolve({ capability: 'partial-capability' })
    if (message.type === 'GET_STATUS') return Promise.resolve({ pendingCount: statusReads++ === 0 ? 2 : 1 })
    if (message.type === 'GET_PENDING') return Promise.resolve({ captures: [capture, secondCapture] })
    return Promise.resolve({ ok: true })
  })

  await openConnectedSettings()
  await waitFor(() => expect(document.querySelector('.sync-count')?.textContent).toBe('2'))
  fireEvent.click(screen.getByRole('button', { name: '동기화' }))
  await waitFor(() => expect(bridgeCalls('ACK')).toHaveLength(1))
  await waitFor(() => expect(document.querySelector('.sync-count')?.textContent).toBe('1'))
  expect(screen.getByText(/일부 항목은 다시 시도/)).toBeTruthy()
  expect(mocks.bulk).toHaveBeenCalledOnce()
})

it('blocks duplicate sync clicks while one upload is in flight', async () => {
  mocks.me.mockResolvedValue(user)
  mocks.list.mockResolvedValue([])
  let finishUpload!: (value: { acceptedCaptureIds: string[]; failures: never[] }) => void
  mocks.bulk.mockReturnValue(new Promise(resolve => { finishUpload = resolve }))
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'CONNECT') return Promise.resolve({ capability: 'single-flight-capability' })
    if (message.type === 'GET_STATUS') return Promise.resolve({ pendingCount: 1 })
    if (message.type === 'GET_PENDING') return Promise.resolve({ captures: [capture] })
    return Promise.resolve({ ok: true })
  })

  await openConnectedSettings()
  const sync = screen.getByRole('button', { name: '동기화' })
  fireEvent.click(sync)
  fireEvent.click(sync)
  await waitFor(() => expect(mocks.bulk).toHaveBeenCalledOnce())
  expect(bridgeCalls('GET_PENDING')).toHaveLength(1)
  finishUpload({ acceptedCaptureIds: ['capture-1'], failures: [] })
  await waitFor(() => expect(bridgeCalls('ACK')).toHaveLength(1))
})
