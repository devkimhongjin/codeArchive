// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { ApiError } from './api'
import type { AccountSettings } from './types'

const mocks = vi.hoisted(() => ({
  me: vi.fn(), list: vi.fn(), settings: vi.fn(), save: vi.fn(), grant: vi.fn(), revoke: vi.fn(), logout: vi.fn(), bridge: vi.fn(), installations: vi.fn(), startInstallation: vi.fn(), repositories: vi.fn(), branches: vi.fn(), directories: vi.fn(), tree: vi.fn(), emptyBranch: vi.fn(), readmePreview: vi.fn(), initializeReadme: vi.fn(), navigate: vi.fn(),
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
  getGithubInstallations: mocks.installations, startGithubInstallation: mocks.startInstallation, getGithubRepositories: mocks.repositories, getGithubBranches: mocks.branches, getGithubDirectories: mocks.directories, getGithubTree: mocks.tree, getGithubEmptyDefaultBranch: mocks.emptyBranch, getGithubReadmePreview: mocks.readmePreview, initializeGithubReadme: mocks.initializeReadme,
}))
vi.mock('./bridge', async (original) => ({ ...await original<typeof import('./bridge')>(), requestBridge: mocks.bridge }))
vi.mock('./navigation', () => ({ navigateSameTab: mocks.navigate }))

const user = { id: 17, githubId: 'account-17', githubLogin: 'archive-user' }
const settings: AccountSettings = {
  version: 4, name: '홍길동', nickname: '길동', copyHeader: true, downloadHeader: false, githubHeader: false,
  downloadFilenameTemplate: '{platform}-{number}-{title}', gitPathTemplate: 'solutions/{language}/{number}-{title}/{time}', githubCommitMessageTemplate: 'Add {platform} {number} solution',
  lightTheme: 'one-light', darkTheme: 'dracula', autoSyncEnabled: true, githubAutoCommitEnabled: true,
  githubTargetConfigured: true, githubStatus: 'AVAILABLE', githubInstallationId: 77,
  githubOwner: 'codearchive', githubRepository: 'solutions', githubBranch: 'main', githubRootPath: 'archive',
}

function bridgeMessages(type: string) { return mocks.bridge.mock.calls.filter(([, message]) => (message as { type?: string }).type === type) }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

async function openSettings(name = '홍길동') {
  render(<App />)
  await screen.findByRole('button', { name: '로그아웃' })
  fireEvent.click(screen.getByRole('button', { name: '설정' }))
  await screen.findByDisplayValue(name)
}

beforeEach(() => { mocks.emptyBranch.mockResolvedValue({ defaultBranch: 'main' }); mocks.readmePreview.mockResolvedValue({ content: '# CodeArchive\n\n풀이를 자동으로 보관합니다.' }); mocks.initializeReadme.mockResolvedValue({ defaultBranch: 'main' }); mocks.tree.mockImplementation((_githubId: string, _installation: number, _repository: number, _branch: string, path = '') => Promise.resolve({ path, headSha: 'a'.repeat(40), items: path ? [] : [{ name: 'src', path: 'src', type: 'tree', size: 0 }], page: 1, hasMore: false, truncated: false })) })
afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState({}, '', '/'); vi.clearAllMocks() })

it('starts GitHub OAuth in the same tab on the first logged-out click', async () => {
  mocks.me.mockRejectedValue(new ApiError('Authentication is required', 401))
  mocks.bridge.mockRejectedValue(new Error('Extension is unavailable'))

  render(<App />)

  fireEvent.click(await screen.findByRole('button', { name: /^GitHub 로그인/ }))
  expect(mocks.navigate).toHaveBeenCalledOnce()
  expect(mocks.navigate).toHaveBeenCalledWith('/api/oauth2/authorization/github')
  expect(screen.queryByRole('dialog', { name: 'GitHub로 로그인' })).toBeNull()
})

it('starts the signed GitHub App installation flow when no personal installation exists', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockResolvedValue([]); mocks.startInstallation.mockResolvedValue({ status: 'INSTALL_REQUIRED', installations: [], installUrl: 'https://github.com/apps/codearchive/installations/new?state=signed-state' }); mocks.bridge.mockResolvedValue({ capability: 'install-capability' })
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' }))
  await waitFor(() => expect(mocks.startInstallation).toHaveBeenCalledWith('account-17'))
  expect(mocks.navigate).toHaveBeenCalledWith('https://github.com/apps/codearchive/installations/new?state=signed-state')
})

it('rejects an untrusted installation redirect returned by the API', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockResolvedValue([]); mocks.startInstallation.mockResolvedValue({ status: 'INSTALL_REQUIRED', installations: [], installUrl: 'https://example.test/apps/codearchive/installations/new?state=signed-state' }); mocks.bridge.mockResolvedValue({ capability: 'install-capability' })
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' }))
  expect((await screen.findByRole('alert')).textContent).toContain('안전한 GitHub App 설치 주소')
  expect(mocks.navigate).not.toHaveBeenCalled()
})

it('shows one prominent connection action before revealing the target cascade', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.bridge.mockResolvedValue({ capability: 'collapsed-target' })

  await openSettings()

  expect(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' })).toBeTruthy()
  expect(screen.getByText('풀이를 저장할 GitHub 위치를 연결하세요')).toBeTruthy()
  expect(screen.queryByLabelText('GitHub 설치')).toBeNull()
  expect(screen.queryByLabelText('저장소')).toBeNull()
})

it('covers the target panel with a named loading state and blocks saving while GitHub is checked', async () => {
  const installations = deferred<Array<{ id: number; accountLogin: string }>>()
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockReturnValue(installations.promise); mocks.bridge.mockResolvedValue({ capability: 'loading-target' })
  await openSettings()

  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' }))

  expect((await screen.findAllByText('연결 중')).length).toBeGreaterThanOrEqual(1)
  expect(screen.getByText('GitHub에서 안전하게 확인하고 있습니다.')).toBeTruthy()
  expect((screen.getByRole('button', { name: '설정 저장' }) as HTMLButtonElement).disabled).toBe(true)
  installations.resolve([{ id: 9, accountLogin: 'first' }, { id: 10, accountLogin: 'second' }])
  expect(await screen.findByRole('option', { name: 'first' })).toBeTruthy()
  await waitFor(() => expect(screen.queryByText('GitHub에서 안전하게 확인하고 있습니다.')).toBeNull())
})

it('distinguishes an empty repository list and retries the failed stage in place', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }])
  mocks.repositories.mockRejectedValueOnce(new ApiError('요청을 처리하지 못했습니다 (403)', 403)).mockResolvedValueOnce([])
  mocks.bridge.mockResolvedValue({ capability: 'retry-target' })
  await openSettings()

  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' }))
  expect((await screen.findByRole('alert')).textContent).toContain('GitHub App 권한이 없거나 접근이 제한되었습니다.')
  fireEvent.click(screen.getByRole('button', { name: '이 단계 다시 시도' }))

  await waitFor(() => expect(mocks.repositories).toHaveBeenCalledTimes(2))
  expect(await screen.findByText(/선택할 수 있는 저장소가 없습니다/)).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('explains a provider failure and retries branch loading without restarting setup', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }])
  mocks.repositories.mockResolvedValue([{ id: 11, owner: 'archive-user', name: 'repo', fullName: 'archive-user/repo', privateRepository: true, defaultBranch: 'main' }])
  mocks.branches.mockRejectedValueOnce(new ApiError('요청을 처리하지 못했습니다 (503)', 503)).mockResolvedValueOnce([{ name: 'main', protectedBranch: false, commitSha: 'a'.repeat(40) }])
  mocks.bridge.mockResolvedValue({ capability: 'retry-branch' })
  await openSettings()

  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' }))
  await screen.findByRole('option', { name: 'archive-user/repo' })
  fireEvent.change(screen.getByLabelText('저장소'), { target: { value: '11' } })
  expect((await screen.findByRole('alert')).textContent).toContain('GitHub 연결 서비스를 사용할 수 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: '이 단계 다시 시도' }))

  expect(await screen.findByRole('option', { name: 'main' })).toBeTruthy()
  expect(mocks.branches).toHaveBeenCalledTimes(2)
  expect(mocks.repositories).toHaveBeenCalledTimes(1)
})

it('explains a network failure and retries directory loading at the selected path', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }])
  mocks.repositories.mockResolvedValue([{ id: 11, owner: 'archive-user', name: 'repo', fullName: 'archive-user/repo', privateRepository: true, defaultBranch: 'main' }])
  mocks.branches.mockResolvedValue([{ name: 'main', protectedBranch: false, commitSha: 'a'.repeat(40) }])
  mocks.directories.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ currentPath: '', parentPath: '', directories: ['src'] })
  mocks.bridge.mockResolvedValue({ capability: 'retry-directory' })
  await openSettings()

  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' }))
  await screen.findByRole('option', { name: 'archive-user/repo' })
  fireEvent.change(screen.getByLabelText('저장소'), { target: { value: '11' } })
  await screen.findByRole('option', { name: 'main' })
  fireEvent.change(screen.getByLabelText('브랜치'), { target: { value: 'main' } })
  expect((await screen.findByRole('alert')).textContent).toContain('네트워크 연결을 확인하지 못했습니다.')
  fireEvent.click(screen.getByRole('button', { name: '이 단계 다시 시도' }))

  expect(await screen.findByRole('button', { name: 'src/' })).toBeTruthy()
  expect(mocks.directories).toHaveBeenCalledTimes(2)
  expect(mocks.directories).toHaveBeenLastCalledWith('account-17', 9, 11, 'main', '')
})

it('announces repository and branch loading as separate full-panel stages', async () => {
  const repositories = deferred<Array<{ id: number; owner: string; name: string; fullName: string; privateRepository: boolean; defaultBranch: string }>>()
  const branches = deferred<Array<{ name: string; protectedBranch: boolean; commitSha: string }>>()
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }])
  mocks.repositories.mockReturnValue(repositories.promise)
  mocks.branches.mockReturnValue(branches.promise)
  mocks.bridge.mockResolvedValue({ capability: 'stage-target' })
  await openSettings()

  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' }))
  expect((await screen.findAllByText('저장소 확인 중')).length).toBeGreaterThanOrEqual(1)
  repositories.resolve([{ id: 11, owner: 'archive-user', name: 'repo', fullName: 'archive-user/repo', privateRepository: true, defaultBranch: 'main' }])
  await screen.findByRole('option', { name: 'archive-user/repo' })
  fireEvent.change(screen.getByLabelText('저장소'), { target: { value: '11' } })
  expect((await screen.findAllByText('브랜치 확인 중')).length).toBeGreaterThanOrEqual(1)

  branches.resolve([])
  expect(await screen.findByText(/브랜치가 없습니다/)).toBeTruthy()
  await waitFor(() => expect(screen.queryByText('GitHub에서 안전하게 확인하고 있습니다.')).toBeNull())
})

it('opens GitHub repository creation without expanding account permissions and refreshes the list', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }]); mocks.repositories.mockResolvedValue([]); mocks.bridge.mockResolvedValue({ capability: 'new-repository' })
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' }))
  await screen.findByLabelText('저장소')
  fireEvent.click(screen.getByRole('button', { name: '새 저장소 만들기' }))
  const link = screen.getByRole('link', { name: 'GitHub에서 저장소 만들기' }) as HTMLAnchorElement
  expect(link.href).toBe('https://github.com/new')
  expect(link.target).toBe('_blank')
  fireEvent.click(screen.getByRole('button', { name: '저장소 목록 새로고침' }))
  await waitFor(() => expect(mocks.repositories).toHaveBeenCalledTimes(2))
})

it('previews and initializes a verified empty repository with CodeArchive README', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }]); mocks.repositories.mockResolvedValue([{ id: 11, owner: 'archive-user', name: 'new-repo', fullName: 'archive-user/new-repo', privateRepository: true, defaultBranch: null }]); mocks.branches.mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: 'main', protectedBranch: false, commitSha: 'a'.repeat(40) }]); mocks.bridge.mockResolvedValue({ capability: 'empty-repository' })
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' }))
  await screen.findByRole('option', { name: 'archive-user/new-repo' })
  fireEvent.change(screen.getByLabelText('저장소'), { target: { value: '11' } })
  expect(await screen.findByLabelText('README 미리보기')).toBeTruthy()
  expect(screen.getByLabelText('README 미리보기').textContent).toContain('CodeArchive')
  fireEvent.click(screen.getByRole('button', { name: 'README로 초기화' }))
  await waitFor(() => expect(mocks.initializeReadme).toHaveBeenCalledWith('account-17', 9, 11))
  expect(await screen.findByRole('option', { name: 'main' })).toBeTruthy()
})

it('allows first-solution bootstrap only after an empty default branch is verified', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }]); mocks.repositories.mockResolvedValue([{ id: 11, owner: 'archive-user', name: 'new-repo', fullName: 'archive-user/new-repo', privateRepository: true, defaultBranch: null }]); mocks.branches.mockResolvedValue([]); mocks.directories.mockResolvedValue({ currentPath: '', parentPath: '', directories: [] }); mocks.bridge.mockResolvedValue({ capability: 'first-solution' })
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' }))
  await screen.findByRole('option', { name: 'archive-user/new-repo' })
  fireEvent.change(screen.getByLabelText('저장소'), { target: { value: '11' } })
  await screen.findByLabelText('README 미리보기')
  fireEvent.click(screen.getByLabelText('CodeArchive README 추가'))
  fireEvent.change(screen.getByLabelText('브랜치'), { target: { value: 'main' } })
  await waitFor(() => expect(mocks.directories).toHaveBeenCalledWith('account-17', 9, 11, 'main', ''))
  expect(mocks.initializeReadme).not.toHaveBeenCalled()
})

it('shows the selected repository tree and loads another bounded page', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }]); mocks.repositories.mockResolvedValue([{ id: 11, owner: 'archive-user', name: 'repo', fullName: 'archive-user/repo', privateRepository: true, defaultBranch: 'main' }]); mocks.branches.mockResolvedValue([{ name: 'main', protectedBranch: false, commitSha: 'a'.repeat(40) }]); mocks.directories.mockResolvedValue({ currentPath: '', parentPath: '', directories: ['src'] }); mocks.bridge.mockResolvedValue({ capability: 'tree-browser' })
  mocks.tree.mockResolvedValueOnce({ path: '', headSha: 'a'.repeat(40), items: [{ name: 'src', path: 'src', type: 'tree', size: 0 }, { name: 'README.md', path: 'README.md', type: 'blob', size: 42 }], page: 1, hasMore: true, truncated: false })
    .mockResolvedValueOnce({ path: '', headSha: 'a'.repeat(40), items: [{ name: 'Solution.java', path: 'Solution.java', type: 'blob', size: 100 }], page: 2, hasMore: false, truncated: false })
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' }))
  await screen.findByRole('option', { name: 'archive-user/repo' })
  fireEvent.change(screen.getByLabelText('저장소'), { target: { value: '11' } })
  await screen.findByRole('option', { name: 'main' })
  fireEvent.change(screen.getByLabelText('브랜치'), { target: { value: 'main' } })
  expect(await screen.findByText('README.md')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '파일 더 보기' }))
  expect(await screen.findByText('Solution.java')).toBeTruthy()
  expect(mocks.tree).toHaveBeenLastCalledWith('account-17', 9, 11, 'main', '', 2)
})

it('restores the installed account and repository cascade after the setup callback', async () => {
  window.history.replaceState({}, '', '/?githubInstall=success&installationId=9')
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }]); mocks.repositories.mockResolvedValue([{ id: 11, owner: 'archive-user', name: 'repo', fullName: 'archive-user/repo', privateRepository: true, defaultBranch: 'main' }]); mocks.bridge.mockResolvedValue({ capability: 'callback-capability' })
  render(<App />)
  await screen.findByRole('option', { name: 'archive-user/repo' })
  expect(mocks.installations).toHaveBeenCalledWith('account-17')
  expect(mocks.repositories).toHaveBeenCalledWith('account-17', 9, 1)
  expect(window.location.search).toBe('')
})

it.each([
  ['cancelled', 'GitHub App 설치가 완료되지 않았습니다. 다시 연결할 수 있습니다.'],
  ['expired', 'GitHub App 연결 시간이 만료되었습니다. 다시 시도해 주세요.'],
  ['invalid', 'GitHub App 연결 요청이 유효하지 않거나 이미 사용되었습니다.'],
  ['account_mismatch', '현재 로그인한 GitHub 계정과 설치 계정이 일치하지 않습니다.'],
  ['installation_unavailable', 'GitHub App 설치 권한이 없거나 철회되었습니다. 다시 연결해 주세요.'],
  ['provider_unavailable', 'GitHub App 설치 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'],
  ['authentication_required', 'GitHub 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'],
] as const)('shows the fixed %s setup callback result without loading an installation', async (result, message) => {
  window.history.replaceState({}, '', `/?githubInstall=${result}`)
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue(settings); mocks.bridge.mockResolvedValue({ capability: 'callback-error-capability' })

  render(<App />)

  expect(await screen.findByText(message)).toBeTruthy()
  expect(window.location.search).toBe('')
  expect(mocks.installations).not.toHaveBeenCalled()
})

it('uses only the server-verified GitHub target cascade and clears dependent consent', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false }); mocks.save.mockResolvedValue(settings)
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }]); mocks.repositories.mockResolvedValue([{ id: 11, owner: 'archive-user', name: 'repo', fullName: 'archive-user/repo', privateRepository: true, defaultBranch: 'main' }]); mocks.branches.mockResolvedValue([{ name: 'main', protectedBranch: false, commitSha: 'a'.repeat(40) }]); mocks.directories.mockResolvedValueOnce({ currentPath: '', parentPath: '', directories: ['src'] }).mockResolvedValueOnce({ currentPath: 'src', parentPath: '', directories: [] }).mockResolvedValueOnce({ currentPath: '', parentPath: '', directories: ['src'] })
  mocks.bridge.mockResolvedValue({ capability: 'capability' }); await openSettings()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' })); await screen.findByRole('option', { name: 'archive-user' }); fireEvent.change(screen.getByLabelText('GitHub 설치'), { target: { value: '9' } }); await screen.findByRole('option', { name: 'archive-user/repo' }); fireEvent.change(screen.getByLabelText('저장소'), { target: { value: '11' } }); await screen.findByRole('option', { name: 'main' }); fireEvent.change(screen.getByLabelText('브랜치'), { target: { value: 'main' } }); await screen.findByRole('button', { name: 'src/' }); fireEvent.click(screen.getByRole('button', { name: 'src/' })); await screen.findByRole('button', { name: '상위 폴더' }); fireEvent.click(screen.getByRole('button', { name: '상위 폴더' })); await waitFor(() => expect((screen.getByRole('button', { name: '설정 저장' }) as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByRole('button', { name: '설정 저장' })); await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ githubInstallationId: 9, githubOwner: 'archive-user', githubRepository: 'repo', githubBranch: 'main', githubRootPath: null, githubAutoCommitEnabled: false }), 'account-17')); expect(mocks.installations).toHaveBeenCalledWith('account-17'); expect(mocks.repositories).toHaveBeenCalledWith('account-17', 9, 1); expect(mocks.branches).toHaveBeenCalledWith('account-17', 9, 11, 1); expect(mocks.directories).toHaveBeenCalledWith('account-17', 9, 11, 'main', '')
})

it('browses folders without changing the draft target until explicitly selected', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false }); mocks.save.mockResolvedValue(settings)
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }]); mocks.repositories.mockResolvedValue([{ id: 11, owner: 'archive-user', name: 'repo', fullName: 'archive-user/repo', privateRepository: true, defaultBranch: 'main' }]); mocks.branches.mockResolvedValue([{ name: 'main', protectedBranch: false, commitSha: 'a'.repeat(40) }]); mocks.directories.mockResolvedValueOnce({ currentPath: '', parentPath: '', directories: ['src'] }).mockResolvedValueOnce({ currentPath: 'src', parentPath: '', directories: [] })
  mocks.bridge.mockResolvedValue({ capability: 'folder-picker' }); await openSettings()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' })); await screen.findByRole('option', { name: 'archive-user' }); fireEvent.change(screen.getByLabelText('GitHub 설치'), { target: { value: '9' } }); await screen.findByRole('option', { name: 'archive-user/repo' }); fireEvent.change(screen.getByLabelText('저장소'), { target: { value: '11' } }); await screen.findByRole('option', { name: 'main' }); fireEvent.change(screen.getByLabelText('브랜치'), { target: { value: 'main' } })
  fireEvent.click(await screen.findByRole('button', { name: 'src/' }))
  await waitFor(() => expect(screen.getByText('둘러보는 폴더').parentElement?.textContent).toContain('src'))
  expect(screen.getByText('선택한 저장 위치').parentElement?.textContent).toContain('/')
  fireEvent.click(screen.getByRole('button', { name: '이 폴더를 저장 위치로 선택' }))
  expect(screen.getByText('선택한 저장 위치').parentElement?.textContent).toContain('src')
  fireEvent.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ githubRootPath: 'src', githubAutoCommitEnabled: false }), 'account-17'))
})

it('clears cascade placeholders without browsing id zero or an empty branch', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false, githubAutoCommitEnabled: false })
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }]); mocks.repositories.mockResolvedValue([{ id: 11, owner: 'archive-user', name: 'repo', fullName: 'archive-user/repo', privateRepository: true, defaultBranch: 'main' }]); mocks.branches.mockResolvedValue([{ name: 'main', protectedBranch: false, commitSha: 'a'.repeat(40) }]); mocks.directories.mockResolvedValue({ currentPath: '', parentPath: '', directories: ['src'] })
  mocks.bridge.mockResolvedValue({ capability: 'clear-capability' }); await openSettings()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' })); await screen.findByRole('option', { name: 'archive-user' })
  fireEvent.change(screen.getByLabelText('GitHub 설치'), { target: { value: '9' } }); await screen.findByRole('option', { name: 'archive-user/repo' })
  fireEvent.change(screen.getByLabelText('저장소'), { target: { value: '11' } }); await screen.findByRole('option', { name: 'main' })
  fireEvent.change(screen.getByLabelText('브랜치'), { target: { value: 'main' } }); await screen.findByRole('button', { name: 'src/' })
  const directoryCalls = mocks.directories.mock.calls.length; const branchCalls = mocks.branches.mock.calls.length; const repositoryCalls = mocks.repositories.mock.calls.length
  fireEvent.change(screen.getByLabelText('브랜치'), { target: { value: '' } }); await waitFor(() => expect((screen.getByLabelText('브랜치') as HTMLSelectElement).value).toBe(''))
  fireEvent.change(screen.getByLabelText('저장소'), { target: { value: '' } }); await waitFor(() => expect(screen.queryByLabelText('브랜치')).toBeNull())
  fireEvent.change(screen.getByLabelText('GitHub 설치'), { target: { value: '' } }); await waitFor(() => expect((screen.getByLabelText('GitHub 설치') as HTMLSelectElement).value).toBe(''))
  expect(mocks.directories.mock.calls).toHaveLength(directoryCalls); expect(mocks.branches.mock.calls).toHaveLength(branchCalls); expect(mocks.repositories.mock.calls).toHaveLength(repositoryCalls)
  expect(mocks.repositories).not.toHaveBeenCalledWith('account-17', 0); expect(mocks.branches).not.toHaveBeenCalledWith('account-17', 9, 0); expect(mocks.directories).not.toHaveBeenCalledWith('account-17', 9, 11, '')
  expect((screen.getByLabelText('GitHub 자동 커밋') as HTMLInputElement).checked).toBe(false)
  expect(screen.queryByLabelText('저장소')).toBeNull(); expect(screen.queryByLabelText('브랜치')).toBeNull()
})

it('does not restore a stale repository load after its installation is cleared', async () => {
  const oldRepositories = deferred<{ items: Array<{ id: number; owner: string; name: string; fullName: string; privateRepository: boolean; defaultBranch: string }>; hasMore: boolean }>()
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false })
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'old-installation' }]); mocks.repositories.mockReturnValueOnce(oldRepositories.promise); mocks.bridge.mockResolvedValue({ capability: 'repo-race' })
  await openSettings(); fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' })); await screen.findByRole('option', { name: 'old-installation' })
  fireEvent.change(screen.getByLabelText('GitHub 설치'), { target: { value: '9' } }); fireEvent.change(screen.getByLabelText('GitHub 설치'), { target: { value: '' } })
  oldRepositories.resolve({ items: [{ id: 11, owner: 'old', name: 'private', fullName: 'old/private', privateRepository: true, defaultBranch: 'main' }], hasMore: false })
  await waitFor(() => expect(screen.queryByLabelText('저장소')).toBeNull())
  expect(screen.queryByRole('option', { name: 'old/private' })).toBeNull(); expect(screen.queryByRole('alert')).toBeNull()
})

it('does not restore a stale branch load after its upper selection is cleared', async () => {
  const oldBranches = deferred<{ items: Array<{ name: string; protectedBranch: boolean; commitSha: string }>; hasMore: boolean }>()
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false })
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'old-installation' }]); mocks.repositories.mockResolvedValue({ items: [{ id: 11, owner: 'old', name: 'private', fullName: 'old/private', privateRepository: true, defaultBranch: 'main' }], hasMore: false }); mocks.branches.mockReturnValueOnce(oldBranches.promise); mocks.bridge.mockResolvedValue({ capability: 'branch-race' })
  await openSettings(); fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' })); await screen.findByRole('option', { name: 'old-installation' })
  fireEvent.change(screen.getByLabelText('GitHub 설치'), { target: { value: '9' } }); await screen.findByRole('option', { name: 'old/private' }); fireEvent.change(screen.getByLabelText('저장소'), { target: { value: '11' } }); fireEvent.change(screen.getByLabelText('GitHub 설치'), { target: { value: '' } })
  oldBranches.resolve({ items: [{ name: 'old-branch', protectedBranch: false, commitSha: 'a'.repeat(40) }], hasMore: false })
  await waitFor(() => expect(screen.queryByLabelText('브랜치')).toBeNull())
  expect(screen.queryByRole('option', { name: 'old-branch' })).toBeNull(); expect(screen.queryByRole('alert')).toBeNull()
})

it('aggregates bounded repository and branch pages so later choices remain selectable', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubTargetConfigured: false })
  const firstRepositories = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, owner: 'archive-user', name: `repo-${index + 1}`, fullName: `archive-user/repo-${index + 1}`, privateRepository: true, defaultBranch: 'main' }))
  const firstBranches = Array.from({ length: 100 }, (_, index) => ({ name: `branch-${index + 1}`, protectedBranch: false, commitSha: 'a'.repeat(40) }))
  mocks.installations.mockResolvedValue([{ id: 9, accountLogin: 'archive-user' }])
  mocks.repositories.mockResolvedValueOnce({ items: firstRepositories.slice(0, 99), hasMore: true }).mockResolvedValueOnce({ items: [{ id: 101, owner: 'archive-user', name: 'later-repo', fullName: 'archive-user/later-repo', privateRepository: true, defaultBranch: 'release/v1' }], hasMore: false })
  mocks.branches.mockResolvedValueOnce({ items: firstBranches.slice(0, 99), hasMore: true }).mockResolvedValueOnce({ items: [{ name: 'release/v1', protectedBranch: false, commitSha: 'b'.repeat(40) }], hasMore: false })
  mocks.directories.mockResolvedValue({ currentPath: '', parentPath: '', directories: [] })
  mocks.bridge.mockResolvedValue({ capability: 'page-capability' }); await openSettings()
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 연결 및 저장 위치 선택' })); await screen.findByRole('option', { name: 'archive-user' })
  await screen.findByRole('option', { name: 'archive-user/later-repo' })
  expect(mocks.repositories).toHaveBeenCalledWith('account-17', 9, 1); expect(mocks.repositories).toHaveBeenCalledWith('account-17', 9, 2)
  fireEvent.change(screen.getByLabelText('저장소'), { target: { value: '101' } }); await screen.findByRole('option', { name: 'release/v1' })
  expect(mocks.branches).toHaveBeenCalledWith('account-17', 9, 101, 1); expect(mocks.branches).toHaveBeenCalledWith('account-17', 9, 101, 2)
})

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

it('persists an inline code-view theme immediately and refreshes the connected extension settings', async () => {
  const solution = { captureId: 'theme-capture', platform: 'SWEA' as const, problemNumber: '42', title: '테마 풀이', problemUrl: 'https://example.test/42', language: 'Java', sourceCode: 'class Main {}', result: 'ACCEPTED' }
  const saved = { ...settings, version: 5, lightTheme: 'solarized-light' as const, autoSyncEnabled: false, githubAutoCommitEnabled: false }
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([solution]); mocks.settings.mockResolvedValue({ ...settings, autoSyncEnabled: false, githubAutoCommitEnabled: false }); mocks.save.mockResolvedValue(saved)
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'theme-capability' }) : Promise.resolve({ ok: true }))
  render(<App />)
  await screen.findAllByText('테마 풀이')
  fireEvent.change(screen.getByLabelText('밝은 테마'), { target: { value: 'solarized-light' } })
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ version: 4, lightTheme: 'solarized-light', darkTheme: 'dracula' }), 'account-17'))
  await waitFor(() => expect(bridgeMessages('CONFIGURE_RELAY').some(([, message]) => (message as { lightTheme?: string }).lightTheme === 'solarized-light')).toBe(true))
})

it('fails closed and returns to local mode when a GitHub-account assertion is rejected', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ ...settings, autoSyncEnabled: false, githubAutoCommitEnabled: false }); mocks.save.mockRejectedValue(new ApiError('GitHub account changed; reconnect required', 409))
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'assertion-capability' }) : Promise.resolve({ ok: true }))
  await openSettings()
  const configurationsBeforeRejection = bridgeMessages('CONFIGURE_RELAY').length
  fireEvent.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ version: 4 }), 'account-17'))
  await waitFor(() => expect(screen.queryByRole('button', { name: '로그아웃' })).toBeNull())
  expect(screen.getAllByText('GitHub 계정이 변경되었습니다. 다시 연결해 주세요.').length).toBeGreaterThan(0)
  // The reset is allowed to send a null relay cleanup, but cannot issue or
  // configure any account authority after the rejected assertion.
  expect(bridgeMessages('CONFIGURE_RELAY').slice(configurationsBeforeRejection).every(([, message]) => (message as { relay?: unknown }).relay === null)).toBe(true)
  expect(mocks.grant).not.toHaveBeenCalled()
})

it('fails closed when an inline theme save receives an account-mismatch 409', async () => {
  const solution = { captureId: 'theme-account-mismatch', platform: 'SWEA' as const, problemNumber: '45', title: '계정 테마', problemUrl: 'https://example.test/45', language: 'Java', sourceCode: 'class Main {}', result: 'ACCEPTED' }
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([solution]); mocks.settings.mockResolvedValue({ ...settings, autoSyncEnabled: false, githubAutoCommitEnabled: false }); mocks.save.mockRejectedValue(new ApiError('GitHub account changed; reconnect required', 409))
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'theme-assertion-capability' }) : Promise.resolve({ ok: true }))
  render(<App />); await screen.findAllByText('계정 테마')
  const configurationsBeforeRejection = bridgeMessages('CONFIGURE_RELAY').length
  fireEvent.change(screen.getByLabelText('밝은 테마'), { target: { value: 'solarized-light' } })
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ lightTheme: 'solarized-light' }), 'account-17'))
  await waitFor(() => expect(screen.queryByRole('button', { name: '로그아웃' })).toBeNull())
  expect(screen.getAllByText('GitHub 계정이 변경되었습니다. 다시 연결해 주세요.').length).toBeGreaterThan(0)
  expect(bridgeMessages('DISCONNECT').length).toBeGreaterThan(0)
  expect(bridgeMessages('CONFIGURE_RELAY').slice(configurationsBeforeRejection).every(([, message]) => (message as { relay?: unknown }).relay === null)).toBe(true)
  expect(mocks.grant).not.toHaveBeenCalled()
})

it('fails closed when an inline theme conflict refresh detects an account mismatch', async () => {
  const solution = { captureId: 'theme-refresh-mismatch', platform: 'SWEA' as const, problemNumber: '46', title: '테마 새로고침', problemUrl: 'https://example.test/46', language: 'Java', sourceCode: 'class Main {}', result: 'ACCEPTED' }
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([solution]); mocks.settings.mockResolvedValueOnce({ ...settings, autoSyncEnabled: false, githubAutoCommitEnabled: false }).mockRejectedValueOnce(new ApiError('GitHub account changed; reconnect required', 409)); mocks.save.mockRejectedValue(new ApiError('Settings changed; refresh and retry', 409))
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'theme-refresh-capability' }) : Promise.resolve({ ok: true }))
  render(<App />); await screen.findAllByText('테마 새로고침'); await waitFor(() => expect(mocks.settings).toHaveBeenCalledOnce())
  fireEvent.change(screen.getByLabelText('밝은 테마'), { target: { value: 'solarized-light' } })
  await waitFor(() => expect(mocks.settings).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('button', { name: '로그아웃' })).toBeNull())
  expect(mocks.grant).not.toHaveBeenCalled()
  expect(bridgeMessages('DISCONNECT').length).toBeGreaterThan(0)
})

it('coalesces rapid inline theme changes onto the latest acknowledged settings version', async () => {
  const solution = { captureId: 'rapid-theme', platform: 'SWEA' as const, problemNumber: '43', title: '빠른 테마', problemUrl: 'https://example.test/43', language: 'Java', sourceCode: 'class Main {}', result: 'ACCEPTED' }
  const first = deferred<AccountSettings>(); const afterFirst = { ...settings, version: 5, lightTheme: 'solarized-light' as const, autoSyncEnabled: false, githubAutoCommitEnabled: false }; const final = { ...afterFirst, version: 6, darkTheme: 'one-dark-pro' as const }
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([solution]); mocks.settings.mockResolvedValue({ ...settings, autoSyncEnabled: false, githubAutoCommitEnabled: false }); mocks.save.mockReturnValueOnce(first.promise).mockResolvedValueOnce(final)
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'rapid-theme-capability' }) : Promise.resolve({ ok: true }))
  render(<App />); await screen.findAllByText('빠른 테마')
  await waitFor(() => expect((screen.getByLabelText('밝은 테마') as HTMLSelectElement).value).toBe('one-light'))
  fireEvent.change(screen.getByLabelText('밝은 테마'), { target: { value: 'solarized-light' } }); fireEvent.change(screen.getByLabelText('어두운 테마'), { target: { value: 'one-dark-pro' } })
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1)); first.resolve(afterFirst)
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
  expect(mocks.save.mock.calls[1][0]).toEqual(expect.objectContaining({ version: 5, lightTheme: 'solarized-light', darkTheme: 'one-dark-pro' }))
  await waitFor(() => expect(bridgeMessages('CONFIGURE_RELAY').some(([, message]) => (message as { lightTheme?: string; darkTheme?: string }).lightTheme === 'solarized-light' && (message as { darkTheme?: string }).darkTheme === 'one-dark-pro')).toBe(true))
})

it('keeps the latest queued theme locally durable after a failed earlier save and recovers on a later change', async () => {
  const solution = { captureId: 'failed-theme', platform: 'SWEA' as const, problemNumber: '44', title: '실패 테마', problemUrl: 'https://example.test/44', language: 'Java', sourceCode: 'class Main {}', result: 'ACCEPTED' }
  const first = deferred<AccountSettings>(); const recovered = { ...settings, version: 5, lightTheme: 'one-light' as const, darkTheme: 'one-dark-pro' as const, autoSyncEnabled: false, githubAutoCommitEnabled: false }
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([solution]); mocks.settings.mockResolvedValue({ ...settings, autoSyncEnabled: false, githubAutoCommitEnabled: false }); mocks.save.mockReturnValueOnce(first.promise).mockResolvedValueOnce(recovered)
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'failed-theme-capability' }) : Promise.resolve({ ok: true }))
  render(<App />); await screen.findAllByText('실패 테마')
  fireEvent.change(screen.getByLabelText('밝은 테마'), { target: { value: 'solarized-light' } }); fireEvent.change(screen.getByLabelText('어두운 테마'), { target: { value: 'one-dark-pro' } })
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce()); first.resolve(Promise.reject(new Error('unreachable')) as never)
  await waitFor(() => expect(JSON.parse(localStorage.getItem('codearchive-local-code-themes') ?? '{}')).toEqual(expect.objectContaining({ lightTheme: 'solarized-light', darkTheme: 'one-dark-pro' })))
  expect(bridgeMessages('CONFIGURE_RELAY').some(([, message]) => (message as { lightTheme?: string; darkTheme?: string }).lightTheme === 'solarized-light' && (message as { darkTheme?: string }).darkTheme === 'one-dark-pro')).toBe(false)
  fireEvent.change(screen.getByLabelText('밝은 테마'), { target: { value: 'one-light' } })
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
  expect(mocks.save.mock.calls[1][0]).toEqual(expect.objectContaining({ version: 4, lightTheme: 'one-light', darkTheme: 'one-dark-pro' }))
})

it('fences deferred account A settings after logout and account B reconnect', async () => {
  const accountA = { ...user, id: 17, githubId: 'account-A', githubLogin: 'account-a' }
  const accountB = { id: 18, githubId: 'account-B', githubLogin: 'account-b' }
  const deferredA = deferred<AccountSettings>()
  const settingsA = { ...settings, name: 'A 이름', nickname: 'A 별명', githubInstallationId: 77, githubOwner: 'a-private', githubRepository: 'secret-repo', githubBranch: 'main', githubRootPath: 'a-root' }
  const settingsB = { ...settings, version: 9, name: 'B 이름', nickname: 'B 별명', githubInstallationId: 88, githubOwner: 'b-private', githubRepository: 'b-repo', githubBranch: 'release/v1', githubRootPath: 'b-root', autoSyncEnabled: false, githubAutoCommitEnabled: false }
  mocks.me.mockResolvedValueOnce(accountA).mockResolvedValueOnce(accountB); mocks.list.mockResolvedValue([]); mocks.settings.mockReturnValueOnce(deferredA.promise).mockResolvedValueOnce(Promise.resolve(settingsB)); mocks.logout.mockResolvedValue(undefined)
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'account-fence' }) : Promise.resolve({ ok: true }))
  render(<App />); await screen.findByRole('button', { name: '로그아웃' }); await waitFor(() => expect(mocks.settings).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: '로그아웃' })); await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce())
  expect(screen.queryByText('A 이름')).toBeNull(); expect(screen.queryByText(/a-private\/secret-repo/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '서버 연결 새로고침' })); await waitFor(() => expect(screen.queryAllByText('@account-b').length).toBeGreaterThan(0))
  fireEvent.click(screen.getByRole('button', { name: '설정' })); await screen.findByDisplayValue('B 이름')
  deferredA.resolve(settingsA); await new Promise(resolve => setTimeout(resolve, 0))
  expect(screen.getByDisplayValue('B 이름')).toBeTruthy(); expect(screen.queryByText(/a-private\/secret-repo/)).toBeNull()
  expect(bridgeMessages('CONFIGURE_RELAY').some(([, message]) => (message as { accountId?: string }).accountId === '17')).toBe(false)
})

it('fences an ordinary A settings-save success while connect-live replaces A with B', async () => {
  const accountA = { ...user, githubId: 'account-A', githubLogin: 'account-a' }
  const accountB = { id: 18, githubId: 'account-B', githubLogin: 'account-b' }
  const savedA = { ...settings, version: 5, name: 'A 저장됨', nickname: 'A 별명', githubOwner: 'a-private', githubRepository: 'secret-repo', autoSyncEnabled: false, githubAutoCommitEnabled: false }
  const settingsB = { ...settings, version: 9, name: 'B 이름', nickname: 'B 별명', githubOwner: 'b-private', githubRepository: 'b-repo', githubBranch: 'release/v1', githubRootPath: 'b-root', autoSyncEnabled: false, githubAutoCommitEnabled: false }
  const pendingA = deferred<AccountSettings>()
  mocks.me.mockResolvedValueOnce(accountA).mockResolvedValueOnce(accountB); mocks.list.mockRejectedValueOnce(new Error('A archive unavailable')).mockResolvedValueOnce([]); mocks.settings.mockResolvedValueOnce({ ...savedA, version: 4 }).mockResolvedValueOnce(settingsB); mocks.save.mockReturnValueOnce(pendingA.promise); mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  await openSettings('A 저장됨')
  fireEvent.click(screen.getByRole('button', { name: '설정 저장' })); await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
  expect(screen.getByRole('button', { name: '저장 중…' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '서버 연결 새로고침' })); await screen.findByDisplayValue('B 이름')
  pendingA.resolve(savedA); await new Promise(resolve => setTimeout(resolve, 0))
  expect(screen.getByDisplayValue('B 이름')).toBeTruthy(); expect(screen.getByDisplayValue('B 별명')).toBeTruthy()
  expect(screen.queryByText('계정 설정을 저장했습니다.')).toBeNull(); expect(screen.queryByText(/a-private\/secret-repo/)).toBeNull()
  expect((screen.getByRole('button', { name: '설정 저장' }) as HTMLButtonElement).disabled).toBe(false)
  expect(bridgeMessages('CONFIGURE_RELAY').some(([, message]) => (message as { accountId?: string }).accountId === '17')).toBe(false)
})

it('fences an ordinary A settings-save error while connect-live replaces A with B', async () => {
  const accountA = { ...user, githubId: 'account-A', githubLogin: 'account-a' }
  const accountB = { id: 18, githubId: 'account-B', githubLogin: 'account-b' }
  const settingsA = { ...settings, name: 'A 이름', nickname: 'A 별명', githubOwner: 'a-private', githubRepository: 'secret-repo', autoSyncEnabled: false, githubAutoCommitEnabled: false }
  const settingsB = { ...settings, version: 9, name: 'B 이름', nickname: 'B 별명', githubOwner: 'b-private', githubRepository: 'b-repo', githubBranch: 'release/v1', githubRootPath: 'b-root', autoSyncEnabled: false, githubAutoCommitEnabled: false }
  const pendingA = deferred<AccountSettings>()
  mocks.me.mockResolvedValueOnce(accountA).mockResolvedValueOnce(accountB); mocks.list.mockRejectedValueOnce(new Error('A archive unavailable')).mockResolvedValueOnce([]); mocks.settings.mockResolvedValueOnce(settingsA).mockResolvedValueOnce(settingsB); mocks.save.mockReturnValueOnce(pendingA.promise); mocks.bridge.mockRejectedValue(new Error('extension unavailable'))
  await openSettings('A 이름')
  fireEvent.click(screen.getByRole('button', { name: '설정 저장' })); await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: '서버 연결 새로고침' })); await screen.findByDisplayValue('B 이름')
  pendingA.reject(new Error('A save failed')); await new Promise(resolve => setTimeout(resolve, 0))
  expect(screen.getByDisplayValue('B 이름')).toBeTruthy(); expect(screen.getByDisplayValue('B 별명')).toBeTruthy()
  expect(screen.queryByText('A save failed')).toBeNull(); expect((screen.getByRole('button', { name: '설정 저장' }) as HTMLButtonElement).disabled).toBe(false)
  expect(bridgeMessages('CONFIGURE_RELAY').some(([, message]) => (message as { accountId?: string }).accountId === '17')).toBe(false)
})

it('saves a versioned complete settings draft and configures the opaque relay after grant issuance', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue(settings); mocks.save.mockResolvedValue({ ...settings, version: 5 })
  mocks.grant.mockResolvedValue({ endpoint: '/api/relay/captures', secret: 'opaque-relay-secret', generation: 0, expiresAt: '2030-01-01T00:00:00Z' })
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'capability-1' }) : Promise.resolve({ ok: true }))
  await openSettings()
  fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: '새 별명' } })
  fireEvent.click(screen.getByLabelText('GitHub 커밋 시 문제 정보 주석 포함'))
  fireEvent.click(screen.getByRole('button', { name: '설정 저장' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ version: 4, name: '홍길동', nickname: '새 별명', copyHeader: true, downloadHeader: false, githubHeader: true, downloadFilenameTemplate: settings.downloadFilenameTemplate, gitPathTemplate: settings.gitPathTemplate, githubCommitMessageTemplate: 'Add {platform} {number} solution', lightTheme: 'one-light', darkTheme: 'dracula', autoSyncEnabled: true, githubAutoCommitEnabled: true, githubInstallationId: 77, githubOwner: 'codearchive', githubRepository: 'solutions', githubBranch: 'main', githubRootPath: 'archive' }), 'account-17')
  // Initial automatic connection receives the loaded settings, and save then
  // refreshes that grant with the new optimistic version.
  await waitFor(() => expect(mocks.grant).toHaveBeenCalledTimes(2)); expect(mocks.grant.mock.calls.every((call) => call[2] === 'account-17')).toBe(true)
  const configure = bridgeMessages('CONFIGURE_RELAY').slice(-1)[0]?.[1] as Record<string, unknown>
  expect(configure).toEqual(expect.objectContaining({ capability: 'capability-1', autoSyncEnabled: true, githubAutoCommitEnabled: true, githubTargetConfigured: true, relay: expect.objectContaining({ endpoint: '/api/relay/captures', secret: 'opaque-relay-secret', accountId: '17' }) }))
})

it('requires a submission identity token and inserts a selected Git path token', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue(settings)
  mocks.bridge.mockResolvedValue({ capability: 'path-token-capability' })
  await openSettings()
  const input = screen.getByLabelText('Git 저장 경로') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'archive/{number}' } })
  expect(screen.getByRole('alert').textContent).toContain('{capture_ID}')
  expect((screen.getByRole('button', { name: '설정 저장' }) as HTMLButtonElement).disabled).toBe(true)
  input.setSelectionRange(input.value.length, input.value.length)
  fireEvent.click(screen.getByRole('button', { name: '{time}' }))
  expect(input.value).toBe('archive/{number}{time}')
  expect((screen.getByRole('button', { name: '설정 저장' }) as HTMLButtonElement).disabled).toBe(false)
})

it('reuses a matching extension relay without rotating the server grant', async () => {
  mocks.me.mockResolvedValue(user); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue(settings)
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => {
    if (message.type === 'CONNECT') return Promise.resolve({ capability: 'durable-relay-capability' })
    if (message.type === 'REUSE_RELAY') return Promise.resolve({ reused: true })
    return Promise.resolve({ ok: true })
  })
  await openSettings()
  await waitFor(() => expect(bridgeMessages('REUSE_RELAY')).toHaveLength(1))
  expect(bridgeMessages('REUSE_RELAY')[0][1]).toEqual(expect.objectContaining({ accountId: '17', settingsVersion: 4 }))
  expect(mocks.grant).not.toHaveBeenCalled()
  expect(bridgeMessages('CONFIGURE_RELAY')).toHaveLength(0)
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
  expect(screen.getByText(/GitHub App 연결을 사용할 수 없습니다/)).toBeTruthy()
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
  expect(mocks.revoke).toHaveBeenCalledWith('dashboardrelay0002', 'account-17')
})

it('keeps an account-switch archive outage local and opens no replacement relay authority', async () => {
  const accountB = { id: 18, githubId: 'account-18', githubLogin: 'other-user' }
  const settingsA = { ...settings, autoSyncEnabled: false, githubAutoCommitEnabled: false }
  const settingsB = { ...settings, version: 8, name: 'B 사용자', autoSyncEnabled: true, githubAutoCommitEnabled: true, githubInstallationId: 88, githubOwner: 'other-user', githubRepository: 'private-b', githubBranch: 'main', githubRootPath: null }
  mocks.me.mockResolvedValueOnce(user).mockResolvedValueOnce(accountB)
  mocks.list.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('B archive unavailable'))
  mocks.settings.mockResolvedValueOnce(settingsA).mockResolvedValueOnce(settingsB)
  mocks.bridge.mockImplementation((_id: string, message: { type: string }) => message.type === 'CONNECT' ? Promise.resolve({ capability: 'switch-outage-capability' }) : Promise.resolve({ ok: true }))
  await openSettings()
  fireEvent.click(screen.getByRole('button', { name: '동기화' }))
  await screen.findByText('로컬 보관함')
  await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('account-18'))
  expect(screen.getByText('B archive unavailable')).toBeTruthy()
  expect(mocks.grant).not.toHaveBeenCalled()
  expect(bridgeMessages('CONFIGURE_RELAY').some(([, message]) => (message as { accountId?: string; relay?: unknown }).accountId === '18' && (message as { relay?: unknown }).relay !== null)).toBe(false)
})
