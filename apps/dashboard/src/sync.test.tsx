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
const liveSettings = {
  version: 4, name: '연결 사용자', nickname: null, copyHeader: false, downloadHeader: false,
  downloadFilenameTemplate: '{platform}-{number}-{title}', gitPathTemplate: '{platform}/{number}-{title}',
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
  fireEvent.click(screen.getByRole('button', { name: '라이브 연결 새로고침' }))
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
