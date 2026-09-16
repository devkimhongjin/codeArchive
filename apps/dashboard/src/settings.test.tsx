// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { ApiError } from './api'
import type { AccountSettings } from './types'

const mocks = vi.hoisted(() => ({
  me: vi.fn(), list: vi.fn(), settings: vi.fn(), save: vi.fn(), grant: vi.fn(), revoke: vi.fn(), logout: vi.fn(), bridge: vi.fn(),
}))

vi.mock('./api', async (original) => ({
  ...await original<typeof import('./api')>(),
  getMe: mocks.me,
  getSolutions: mocks.list,
  getAccountSettings: mocks.settings,
  updateAccountSettings: mocks.save,
  issueRelayGrant: mocks.grant,
  revokeRelayGrant: mocks.revoke,
  logout: mocks.logout,
}))
vi.mock('./bridge', async (original) => ({ ...await original<typeof import('./bridge')>(), requestBridge: mocks.bridge }))

const user = { id: 17, githubId: 'account-17', githubLogin: 'archive-user' }
const settings: AccountSettings = {
  version: 4, name: '홍길동', nickname: '길동', copyHeader: true, downloadHeader: false,
  downloadFilenameTemplate: '{platform}-{number}-{title}', gitPathTemplate: 'solutions/{language}/{number}-{title}',
  lightTheme: 'one-light', darkTheme: 'dracula', autoSyncEnabled: true, githubAutoCommitEnabled: true,
  githubTargetConfigured: true, githubStatus: 'AVAILABLE', githubInstallationId: 77,
  githubOwner: 'codearchive', githubRepository: 'solutions', githubBranch: 'main', githubRootPath: 'archive',
}

function bridgeMessages(type: string) { return mocks.bridge.mock.calls.filter(([, message]) => (message as { type?: string }).type === type) }

async function openSettings(name = '홍길동') {
  render(<App />)
  await screen.findByRole('button', { name: '로그아웃' })
  fireEvent.click(screen.getByRole('button', { name: '설정' }))
  await screen.findByDisplayValue(name)
}

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })

it('loads the authenticated account draft and renders every required theme choice without obsolete cards', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue(settings)
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'capability-1' }) : Promise.resolve({ ok: true }))
  await openSettings()

  expect(screen.getByDisplayValue('길동')).toBeTruthy()
  expect((screen.getByLabelText('복사할 때 문제 정보 주석 포함') as HTMLInputElement).checked).toBe(true)
  expect((screen.getByLabelText('다운로드할 때 문제 정보 주석 포함') as HTMLInputElement).checked).toBe(false)
  expect(screen.getByLabelText('밝은 테마').querySelectorAll('option')).toHaveLength(5)
  expect(screen.getByLabelText('어두운 테마').querySelectorAll('option')).toHaveLength(5)
  expect(screen.queryByText(/UPCOMING/i)).toBeNull()
  expect(screen.queryByText('Chrome 확장 프로그램 연결')).toBeNull()
})

it('saves a versioned complete settings draft and configures the opaque relay after grant issuance', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue(settings); mocks.save.mockResolvedValue({ ...settings, version: 5 })
  mocks.grant.mockResolvedValue({ endpoint: '/api/relay/captures', secret: 'opaque-relay-secret', generation: 0, expiresAt: '2030-01-01T00:00:00Z' })
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'capability-1' }) : Promise.resolve({ ok: true }))
  await openSettings()
  fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: '새 별명' } })
  fireEvent.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ version: 4, name: '홍길동', nickname: '새 별명', copyHeader: true, downloadHeader: false, downloadFilenameTemplate: settings.downloadFilenameTemplate, gitPathTemplate: settings.gitPathTemplate, lightTheme: 'one-light', darkTheme: 'dracula', autoSyncEnabled: true, githubAutoCommitEnabled: true, githubInstallationId: 77, githubOwner: 'codearchive', githubRepository: 'solutions', githubBranch: 'main', githubRootPath: 'archive' }))
  // Initial automatic connection receives the loaded settings, and save then
  // refreshes that grant with the new optimistic version.
  await waitFor(() => expect(mocks.grant).toHaveBeenCalledTimes(2))
  const configure = bridgeMessages('CONFIGURE_RELAY').slice(-1)[0]?.[1] as Record<string, unknown>
  expect(configure).toEqual(expect.objectContaining({ capability: 'capability-1', autoSyncEnabled: true, githubAutoCommitEnabled: true, githubTargetConfigured: true, relay: expect.objectContaining({ endpoint: '/api/relay/captures', secret: 'opaque-relay-secret', accountId: '17' }) }))
})

it('pushes acknowledged profile/export/theme settings with relay null when automatic sync is OFF', async () => {
  const off = { ...settings, version: 8, autoSyncEnabled: false, githubAutoCommitEnabled: false, name: '오프라인 이름', nickname: '오프 별명', lightTheme: 'solarized-light' as const, darkTheme: 'one-dark-pro' as const }
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue(off); mocks.save.mockResolvedValue({ ...off, version: 9, nickname: '저장 별명' })
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'capability-off' }) : Promise.resolve({ ok: true }))
  await openSettings('오프라인 이름')
  await waitFor(() => expect(bridgeMessages('CONFIGURE_RELAY').some(([, message]) => (message as { relay?: unknown }).relay === null)).toBe(true))
  expect(mocks.grant).not.toHaveBeenCalled()
  const initial = bridgeMessages('CONFIGURE_RELAY').slice(-1)[0][1] as Record<string, unknown>
  expect(initial).toEqual(expect.objectContaining({ relay: null, accountId: '17', name: '오프라인 이름', nickname: '오프 별명', copyHeader: true, downloadHeader: false, lightTheme: 'solarized-light', darkTheme: 'one-dark-pro' }))
  fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: '저장 별명' } })
  fireEvent.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(bridgeMessages('CONFIGURE_RELAY').filter(([, message]) => (message as { relay?: unknown }).relay === null)).toHaveLength(2))
  const saved = bridgeMessages('CONFIGURE_RELAY').slice(-1)[0][1] as Record<string, unknown>
  expect(saved).toEqual(expect.objectContaining({ relay: null, nickname: '저장 별명', accountId: '17' }))
})

it('hands OFF settings to an extension that reconnects after settings were loaded', async () => {
  const off = { ...settings, autoSyncEnabled: false, githubAutoCommitEnabled: false, version: 12, downloadFilenameTemplate: '{nickname}-{number}', lightTheme: 'vitesse-light' as const }
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue(off)
  let connects = 0
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'CONNECT') return ++connects <= 2 ? Promise.reject(new Error('extension offline')) : Promise.resolve({ capability: 'capability-late' })
    return Promise.resolve({ ok: true, captures: [], hasMore: false })
  })
  await openSettings()
  expect(bridgeMessages('CONFIGURE_RELAY')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '동기화' }))
  await waitFor(() => expect(bridgeMessages('CONFIGURE_RELAY').some(([, message]) => (message as { capability?: string }).capability === 'capability-late')).toBe(true))
  const configured = bridgeMessages('CONFIGURE_RELAY').slice(-1)[0][1] as Record<string, unknown>
  expect(configured).toEqual(expect.objectContaining({ relay: null, downloadFilenameTemplate: '{nickname}-{number}', lightTheme: 'vitesse-light', accountId: '17' }))
  expect(mocks.grant).not.toHaveBeenCalled()
})

it('fences an older deferred grant so a newer save is the only relay configuration left applied', async () => {
  let rejectOldGrant!: (reason?: unknown) => void
  const oldGrant = new Promise<never>((_resolve, reject) => { rejectOldGrant = reject })
  const newer = { endpoint: '/api/relay/captures', secret: 'newer-opaque-secret', generation: 5, expiresAt: '2030-01-01T00:00:00Z' }
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue(settings)
  mocks.save.mockResolvedValue({ ...settings, version: 5, nickname: '최신 별명' })
  mocks.grant.mockImplementationOnce(() => oldGrant).mockResolvedValueOnce(newer)
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'capability-race' }) : Promise.resolve({ ok: true }))
  await openSettings()
  await waitFor(() => expect(mocks.grant).toHaveBeenCalledOnce())
  fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: '최신 별명' } })
  fireEvent.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(mocks.grant).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(bridgeMessages('CONFIGURE_RELAY').some(([, message]) => (message as { relay?: { secret?: string } }).relay?.secret === 'newer-opaque-secret')).toBe(true))
  rejectOldGrant(new Error('old grant failed after newer save'))
  await new Promise(resolve => setTimeout(resolve, 0))
  const relayMessages = bridgeMessages('CONFIGURE_RELAY').map(([, message]) => message as { relay?: { secret?: string } | null })
  expect(relayMessages.filter(message => message.relay?.secret === 'newer-opaque-secret')).toHaveLength(1)
  expect(relayMessages.some(message => message.relay?.secret === 'opaque-relay-secret' || message.relay === null)).toBe(false)
})

it('shows an actionable optimistic-concurrency error', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue(settings)
  mocks.save.mockRejectedValue(new ApiError('conflict', 409))
  mocks.bridge.mockResolvedValue({ capability: 'capability-1' })
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: '설정 저장' }))
  expect((await screen.findByRole('alert')).textContent).toContain('다른 창에서 설정이 변경되었습니다')
})

it('renders provider-unavailable state as actionable and keeps GitHub auto-commit disabled', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubStatus: 'PROVIDER_UNAVAILABLE', githubAutoCommitEnabled: false })
  mocks.bridge.mockResolvedValue({ capability: 'capability-1' })
  await openSettings()
  expect(screen.getByText(/GitHub App 서버 설정/)).toBeTruthy()
  expect((screen.getByLabelText('GitHub 자동 커밋') as HTMLInputElement).disabled).toBe(true)
})

it('clears the extension relay immediately on OFF and when logging out', async () => {
  localStorage.setItem('codearchive-relay-device-id', 'dashboardrelay0001')
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue(settings); mocks.logout.mockResolvedValue(undefined)
  mocks.revoke.mockResolvedValue(undefined)
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'capability-1' }) : Promise.resolve({ ok: true }))
  await openSettings()
  fireEvent.click(screen.getByLabelText('자동 동기화'))
  await waitFor(() => expect(bridgeMessages('CONFIGURE_RELAY').some(([, message]) => (message as { relay?: unknown }).relay === null)).toBe(true))
  fireEvent.click(screen.getAllByRole('button', { name: '로그아웃' })[1])
  await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())
  expect(mocks.revoke).toHaveBeenCalled()
})

it('fences and clears the relay when an explicit sync detects an account switch', async () => {
  localStorage.setItem('codearchive-relay-device-id', 'dashboardrelay0002')
  mocks.me.mockResolvedValueOnce(user).mockResolvedValueOnce({ id: 18, githubId: 'account-18', githubLogin: 'other-user' })
  mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue(settings); mocks.revoke.mockResolvedValue(undefined)
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'capability-1' }) : Promise.resolve({ ok: true }))
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: '동기화' }))
  await waitFor(() => expect(bridgeMessages('CONFIGURE_RELAY').some(([, message]) => (message as { relay?: unknown }).relay === null)).toBe(true))
  expect(mocks.revoke).toHaveBeenCalledWith('dashboardrelay0002')
})
