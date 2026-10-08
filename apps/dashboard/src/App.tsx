import { normalizeDifficulty, difficultyKey } from '../../../shared/difficulty'
import { StaticAnalysisPanel } from './StaticAnalysisPanel'
import { CodeThemePreview } from './CodeThemePreview'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HistoricalCollectionScope } from '../../../shared/historicalCollectionScope'
import { DesktopSettings } from './DesktopSettings'
import { useDesktopWork, markDesktopDraft } from './DesktopActivity'
import { DesktopStatusProvider, DesktopVersion, DesktopUpdateNotice } from './DesktopStatus'
import { DesktopSetup } from './DesktopSetup'
import {
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  Download,
  ExternalLink,
  GitBranch,
  Link2,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { ApiError, addGithubFile, bulkUpload, enableAccountAutomaticSync, getAccountSettings, getMe, getSolutions, issueRelayGrant, logout, revokeRelayGrant, updateAccountSettings, getGithubInstallations, startGithubInstallation, getGithubRepositories, getGithubBranches, getGithubDirectories, getGithubTree, getGithubEmptyDefaultBranch, getGithubReadmePreview, initializeGithubReadme, previewGithubTreeOperation, commitGithubTreeOperation } from './api'
import { BridgeError, parseAckResponse, parseBridgeStatusResponse, parseConnectResponse, parsePendingResponse, parseRelayReuseResponse, relayHandoffKey, requestBridge } from './bridge'
import { requestIsCurrent, type RequestFence } from './requestFence'
import { acceptedIdsForAck } from './syncLogic'
import { DARK_THEMES, GITHUB_LOGIN_URL, LIGHT_THEMES, type AccountSettings, type BulkResponse, type GithubAddFileRequest, type GithubSavedTarget, type GithubTreeOperationPreview, type Solution, type Toast, type User, type ViewName } from './types'
import { CodeBlock, CodeThemeSelect } from './CodeBlock'
import { GithubRepositoryBrowser } from './GithubRepositoryBrowser'
import { EXTENSION_ID, LEGACY_EXTENSION_ID, EXTENSION_CANDIDATES } from './extensionConfig'
import { readExportSettings, EXPORT_SETTINGS_KEY, exportCode, downloadFilename, githubCommitMessage, gitPath, sourceFileExtension, DEFAULT_DOWNLOAD_FILENAME_TEMPLATE, DEFAULT_GITHUB_COMMIT_MESSAGE_TEMPLATE, DEFAULT_GIT_PATH_TEMPLATE, GIT_PATH_TOKENS, FILENAME_TOKENS, COMMIT_MESSAGE_TOKENS, hasGitSubmissionIdentityToken, type ExportSettings } from './codeExport'
import { DEFAULT_HEADER_FIELDS, HEADER_FIELDS, HEADER_FIELD_LABELS, normalizedHeaderFields, type HeaderField } from '../../../shared/headerFields'
import { navigateSameTab } from './navigation'
import './styles.css'
import { canonicalLanguageDisplayName, canonicalLanguageKey } from '../../../shared/language'
import { filterAndSortSolutions, groupSolutions, type SolutionGroup, type SolutionSort } from './solutionQuery'
import { BUILD_METADATA, buildLabel, updatedLabel } from '../../../shared/buildMetadata'
import { EXTENSION_RELEASE, isVersionAtLeast } from './extensionRelease'
import { formatExecutionTime, formatMemory } from './performancePresentation'
import { CommunityView } from './CommunityView'
import { HistoricalImportView } from './HistoricalImportView'
import { HistoricalCollectionView } from './HistoricalCollectionView'
import { HistoricalGithubCommitView } from './HistoricalGithubCommitView'
import { formatKstDate, formatKstDateTime } from '../../../shared/timePresentation'
import { readCommunityRoute, readView, urlForView, type CommunityRoute } from './communityRoute'
import { CommunitySettings } from './CommunitySettings'
import { CODE_THEME_MODE_KEY, isLightTheme, type CodeTheme, type CodeThemeMode } from '../../../shared/codeThemes'
import { extensionRuntime, subscribeExtensionLogin } from './extensionEnvironment'

const ARCHIVE_PAGE_SIZE = 20

type IconName =
  | 'book'
  | 'check'
  | 'chevron'
  | 'clock'
  | 'close'
  | 'code'
  | 'copy'
  | 'download'
  | 'external'
  | 'filter'
  | 'github'
  | 'link'
  | 'logout'
  | 'menu'
  | 'refresh'
  | 'search'
  | 'settings'
  | 'spark'
  | 'sync'
  | 'user'

type SyncBridgeContext = {
  generation: number
  operation: number
  capability: string
  extensionId: string
}

function Icon({ name, size = 18, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
  const icons = {
    book: BookOpen,
    check: Check,
    chevron: ChevronRight,
    clock: Clock3,
    close: X,
    code: Code2,
    copy: Copy,
    download: Download,
    external: ExternalLink,
    filter: SlidersHorizontal,
    github: GitBranch,
    link: Link2,
    logout: LogOut,
    menu: Menu,
    refresh: RefreshCw,
    search: Search,
    settings: Settings,
    spark: Sparkles,
    sync: RefreshCw,
    user: UserRound,
  } as const
  const IconComponent = icons[name]
  return <IconComponent size={size} strokeWidth={strokeWidth} aria-hidden="true" />
}

function ProfileAvatar({ user, large = false }: { user: User; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [user.avatarUrl])
  return <span className={`account-avatar ${large ? 'large' : ''}`}>
    {user.avatarUrl && !failed
      ? <img src={user.avatarUrl} alt={`${displayUser(user)} GitHub 프로필`} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <Icon name="user" size={large ? 18 : 15} />}
  </span>
}

function normalizeSolution(value: unknown, index = 0): Solution {
  const raw = (value ?? {}) as Record<string, unknown>
  const read = (...keys: string[]) => keys.map((key) => raw[key]).find((item) => item !== undefined && item !== null)
  const rawPlatform = String(read('platform') ?? 'SWEA').toUpperCase()
  const platform = rawPlatform === 'PROGRAMMERS' || rawPlatform === 'JUNGOL' ? rawPlatform : 'SWEA'
  const rawId = read('id')
  const id = typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0 ? rawId : undefined
  const rawVisibility = read('visibility')
  return {
    id,
    difficulty: normalizeDifficulty(platform, String(read('problemNumber', 'problem_number') ?? ''), String(read('problemUrl', 'problem_url') ?? ''), raw.difficulty),
    captureId: String(read('captureId', 'capture_id') ?? `remote-${index}`),
    platform,
    problemNumber: String(read('problemNumber', 'problem_number') ?? '—'),
    title: String(read('title', 'problemTitle', 'problem_title') ?? '이름 없는 풀이'),
    problemUrl: String(read('problemUrl', 'problem_url') ?? '#'),
    language: String(read('language') ?? 'Unknown'),
    languageKey: String(read('languageKey', 'language_key') ?? canonicalLanguageKey(String(read('language') ?? 'Unknown'))),
    sourceCode: String(read('sourceCode', 'source_code') ?? ''),
    result: String(read('result') ?? 'ACCEPTED'),
    observedAt: read('observedAt', 'observed_at') as string | undefined,
    solvedAt: read('solvedAt', 'solved_at') as string | undefined,
    executionTime: read('executionTime', 'execution_time') as number | string | undefined,
    memoryUsage: read('memoryUsage', 'memory_usage') as number | string | undefined,
    memoryValue: read('memoryValue', 'memory_value') as number | string | undefined,
    memoryUnit: read('memoryUnit', 'memory_unit') as Solution['memoryUnit'],
    historicalImport: read('historicalImport', 'historical_import') === true,
    historicalSubmissionId: read('historicalSubmissionId', 'historical_submission_id') as string | undefined,
    visibility: rawVisibility === 'published' || rawVisibility === 'private' ? rawVisibility : undefined,
    publishedAt: read('publishedAt', 'published_at') as string | undefined,
  }
}

function formatDate(value?: string) {
  return formatKstDate(value, '기록 없음', true)
}

function formatObservedTime(value?: string) {
  return formatKstDateTime(value, '기록 없음')
}



function displayUser(user: User) {
  const name = user.name?.trim()
  return name ? `${name} (@${user.githubLogin})` : `@${user.githubLogin}`
}

const LOCAL_THEME_KEY = 'codearchive-local-code-themes'
function readCodeThemeMode(): CodeThemeMode {
  try {
    const stored = localStorage.getItem(CODE_THEME_MODE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* Use the system preference when browser storage is unavailable. */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function readLocalThemes(): Pick<AccountSettings, 'lightTheme' | 'darkTheme'> {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_THEME_KEY) ?? '{}') as Record<string, unknown>
    return {
      lightTheme: LIGHT_THEMES.includes(value.lightTheme as AccountSettings['lightTheme']) ? value.lightTheme as AccountSettings['lightTheme'] : 'github-light',
      darkTheme: DARK_THEMES.includes(value.darkTheme as AccountSettings['darkTheme']) ? value.darkTheme as AccountSettings['darkTheme'] : 'github-dark',
    }
  } catch { return { lightTheme: 'github-light', darkTheme: 'github-dark' } }
}
function persistLocalThemes(settings: Pick<AccountSettings, 'lightTheme' | 'darkTheme'>) {
  try { localStorage.setItem(LOCAL_THEME_KEY, JSON.stringify(settings)) } catch { /* Preview remains usable. */ }
}
const defaultAccountSettings = (): AccountSettings => ({ version: 0, name: null, nickname: null, copyHeader: false, downloadHeader: false, githubHeader: false, copyHeaderFields: [...DEFAULT_HEADER_FIELDS], downloadHeaderFields: [...DEFAULT_HEADER_FIELDS], githubHeaderFields: [...DEFAULT_HEADER_FIELDS], downloadFilenameTemplate: DEFAULT_DOWNLOAD_FILENAME_TEMPLATE, gitPathTemplate: DEFAULT_GIT_PATH_TEMPLATE, githubCommitMessageTemplate: DEFAULT_GITHUB_COMMIT_MESSAGE_TEMPLATE, ...readLocalThemes(), autoSyncEnabled: false, communityPublicByDefault: true, communityDuplicateVisibility: 'all', githubAutoCommitEnabled: false, githubTargetConfigured: false, githubStatus: 'TARGET_MISSING', githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null })

function savedGithubTarget(settings: AccountSettings): GithubSavedTarget | null {
  return settings.githubTargetConfigured && settings.githubInstallationId && settings.githubOwner && settings.githubRepository && settings.githubBranch
    ? { installationId: settings.githubInstallationId, owner: settings.githubOwner, repository: settings.githubRepository, branch: settings.githubBranch, rootPath: settings.githubRootPath }
    : null
}
const RELAY_DEVICE_KEY = 'codearchive-relay-device-id'

type GithubInstallReturn = {
  result: 'success' | 'cancelled' | 'expired' | 'invalid' | 'account_mismatch' | 'installation_unavailable' | 'provider_unavailable' | 'authentication_required'
  installationId: number | null
}

function readGithubInstallReturn(): GithubInstallReturn | null {
  const params = new URLSearchParams(window.location.search)
  const result = params.get('githubInstall')
  if (!result || !['success', 'cancelled', 'expired', 'invalid', 'account_mismatch', 'installation_unavailable', 'provider_unavailable', 'authentication_required'].includes(result)) return null
  const rawInstallationId = params.get('installationId')
  const installationId = rawInstallationId && /^[1-9][0-9]{0,19}$/.test(rawInstallationId) ? Number(rawInstallationId) : null
  if (result === 'success' && (!installationId || !Number.isSafeInteger(installationId))) return { result: 'invalid', installationId: null }
  return { result: result as GithubInstallReturn['result'], installationId }
}

function trustedGithubInstallUrl(value: string | null): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com'
      && /^\/apps\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?\/installations\/new$/.test(url.pathname)
      && Boolean(url.searchParams.get('state'))
  } catch { return false }
}

function githubTargetErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'GitHub 로그인 세션이 만료되었습니다. 다시 로그인한 뒤 시도해 주세요.'
    if (error.status === 403) return 'GitHub App 권한이 없거나 접근이 제한되었습니다. GitHub 설치의 저장소 접근 권한을 확인한 뒤 다시 시도해 주세요.'
    if (error.status === 404) return '선택한 GitHub 대상을 찾지 못했습니다. 설치와 저장 위치를 다시 확인해 주세요.'
    if (error.status >= 500) return 'GitHub 연결 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.'
    return fallback
  }
  if (error instanceof TypeError || (error instanceof Error && /failed to fetch|network(?:error| request failed)|load failed/i.test(error.message))) {
    return '네트워크 연결을 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'
  }
  return fallback
}

function relayDeviceId() {
  const existing = localStorage.getItem(RELAY_DEVICE_KEY)
  if (existing && /^[A-Za-z0-9_-]{16,100}$/.test(existing)) return existing
  const generated = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `dashboard${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
  localStorage.setItem(RELAY_DEVICE_KEY, generated)
  return generated
}

export default function App() {
  const [githubInstallReturn, setGithubInstallReturn] = useState(readGithubInstallReturn)
  const [view, setView] = useState<ViewName>(() => readGithubInstallReturn() ? 'github' : readView())
  const [communityRoute, setCommunityRoute] = useState<CommunityRoute>(readCommunityRoute)
  const [mode, setMode] = useState<'local' | 'live'>('local')
  const [codeThemeMode, setCodeThemeMode] = useState<CodeThemeMode>(readCodeThemeMode)
  // Async bridge/settings work outlives the render that created it. Keep the
  // authorization mode in a ref so a failed API read cannot be followed by a
  // stale live-mode closure issuing relay authority.
  const modeRef = useRef(mode)
  modeRef.current = mode
  const [authResolved, setAuthResolved] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const userRef = useRef<User | null>(user)
  userRef.current = user
  const [solutions, setSolutions] = useState<Solution[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState<'ALL' | 'SWEA' | 'PROGRAMMERS' | 'JUNGOL'>('ALL')
  const [languageFilter, setLanguageFilter] = useState('ALL')
  const [difficultyFilter, setDifficultyFilter] = useState('ALL')
  const [solutionSort, setSolutionSort] = useState<SolutionSort>('latest')
  const [solutionPage, setSolutionPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [extensionId, setExtensionId] = useState<string>(EXTENSION_ID)
  const currentExtensionId = useRef<string>(EXTENSION_ID)
  const [autoConnect, setAutoConnect] = useState(true)
  const connectInFlight = useRef(false)
  const [exportSettings, setExportSettings] = useState(readExportSettings)
  const [accountSettings, setAccountSettings] = useState<AccountSettings>(defaultAccountSettings)
  const [savedTarget, setSavedTarget] = useState<GithubSavedTarget | null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [bridgeCapability, setBridgeCapability] = useState<string | null>(null)
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null)
  const [historySupported, setHistorySupported] = useState(false)
  const [historicalScope, setHistoricalScope] = useState<HistoricalCollectionScope | null>(null)
  const [historicalCommitPreview, setHistoricalCommitPreview] = useState(0)
  const [historicalSyncBusy, setHistoricalSyncBusy] = useState(false)
  const [historicalCommitBusy, setHistoricalCommitBusy] = useState(false)
  const receiveHistoricalScope = useCallback((scope: HistoricalCollectionScope | null) => {
    setHistoricalScope(scope); setHistoricalCommitPreview(0)
  }, [])
  const [historicalOpened, setHistoricalOpened] = useState(() => readView() === 'history')
  const [historicalRevision, setHistoricalRevision] = useState(0)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [pendingCountState, setPendingCountState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [lastSyncState, setLastSyncState] = useState<'idle' | 'success' | 'partial' | 'failed'>('idle')
  const [syncing, setSyncing] = useState(false)
  useDesktopWork(syncing || settingsBusy || loading)
  const toastId = useRef(0)
  const accountGeneration = useRef(0)
  const syncInFlight = useRef(false)
  const bridgeCapabilityRef = useRef<string | null>(null)
  const solutionOperation = useRef(0)
  const bridgeOperation = useRef(0)
  const logoutOperation = useRef(0)
  const authMutationInFlight = useRef<number | null>(null)
  // A bridge can connect before /api/settings resolves.  Keep the server-loaded
  // draft separate from React's render timing so a connection never receives
  // defaults as if they were acknowledged account settings.
  const accountSettingsRef = useRef<AccountSettings>(accountSettings)
  const settingsLoadedRef = useRef<{ accountId: number; generation: number; version: number } | null>(null)
  const relayHandoffRef = useRef<string | null>(null)
  const relayHandoffInFlight = useRef(new Set<string>())
  const relayHandoffOperation = useRef(0)
  const themeSaveRequested = useRef(0)
  const themeSaveCompleted = useRef(0)
  const themeSaving = useRef(false)
  const themeQueueGeneration = useRef(0)

  const updateAccountSettingsDraft = (next: AccountSettings) => {
    // A draft change (especially an immediate local OFF) invalidates any
    // grant request that was started for the preceding server version.
    relayHandoffOperation.current += 1
    accountSettingsRef.current = next
    relayHandoffRef.current = null
    setAccountSettings(next)
  }

  const clearAccountDraft = () => {
    setSavedTarget(null)
    themeQueueGeneration.current += 1
    themeSaveRequested.current = 0
    themeSaveCompleted.current = 0
    themeSaving.current = false
    settingsLoadedRef.current = null
    // A completion from the prior identity must not keep the replacement
    // account's controls disabled or surface its error in the new profile.
    setSettingsBusy(false)
    setSettingsError(null)
    updateAccountSettingsDraft(defaultAccountSettings())
  }

  const updateCodeThemes = (themes: Pick<AccountSettings, 'lightTheme' | 'darkTheme'>) => {
    const next = { ...accountSettingsRef.current, ...themes }
    updateAccountSettingsDraft(next)
    // A disconnected archive still has a useful, durable browser-only preference.
    if (!user || mode === 'local') { persistLocalThemes(next); return }
    const generation = accountGeneration.current
    const account = user
    const queueGeneration = themeQueueGeneration.current
    themeSaveRequested.current += 1
    if (themeSaving.current) return
    themeSaving.current = true
    void (async () => {
      try {
        while (queueGeneration === themeQueueGeneration.current && generation === accountGeneration.current && themeSaveCompleted.current < themeSaveRequested.current) {
          const request = themeSaveRequested.current
          const draft = accountSettingsRef.current
          let saved: AccountSettings
          try { saved = await updateAccountSettings(draft, account.githubId) }
          catch (error) {
            if (error instanceof ApiError && error.status === 409) {
              // A session/account assertion mismatch is not an optimistic
              // settings conflict. Close authority before attempting a
              // refresh, and apply the same rule if the refresh detects it.
              if (await handleExpectedAccountChange(error, account.githubId)) return
              let latest: AccountSettings
              try { latest = await getAccountSettings(account.githubId) }
              catch (refreshError) {
                if (await handleExpectedAccountChange(refreshError, account.githubId)) return
                throw refreshError
              }
              if (queueGeneration !== themeQueueGeneration.current || generation !== accountGeneration.current || userRef.current?.id !== account.id) return
              const merged = { ...latest, lightTheme: accountSettingsRef.current.lightTheme, darkTheme: accountSettingsRef.current.darkTheme }
              accountSettingsRef.current = merged
              setAccountSettings(merged)
              continue
            }
            // A later UI change may have arrived while this PUT was pending.
            // Never make the older captured draft durable in that case: finish
            // the current queue locally with the latest visible selection. A
            // subsequent explicit change starts a fresh request from the last
            // acknowledged settings version.
            if (queueGeneration !== themeQueueGeneration.current || generation !== accountGeneration.current || userRef.current?.id !== account.id) return
            themeSaveCompleted.current = themeSaveRequested.current
            persistLocalThemes(accountSettingsRef.current)
            const message = error instanceof Error ? error.message : '코드 보기 테마를 저장하지 못했습니다.'
            setSettingsError(message)
            showToast('info', `미리보기에는 적용했습니다. ${message}`)
            return
          }
          if (queueGeneration !== themeQueueGeneration.current || generation !== accountGeneration.current || userRef.current?.id !== account.id) return
          themeSaveCompleted.current = request
          if (request !== themeSaveRequested.current) {
            const newer = { ...accountSettingsRef.current, version: saved.version }
            accountSettingsRef.current = newer
            setAccountSettings(newer)
            continue
          }
          relayHandoffOperation.current += 1
          accountSettingsRef.current = saved
          settingsLoadedRef.current = { accountId: account.id, generation, version: saved.version }
          relayHandoffRef.current = null
          setAccountSettings(saved)
          updateExportSettings({ copyHeader: saved.copyHeader, downloadHeader: saved.downloadHeader, copyHeaderFields: normalizedHeaderFields(saved.copyHeaderFields), downloadHeaderFields: normalizedHeaderFields(saved.downloadHeaderFields), filenameTemplate: saved.downloadFilenameTemplate, gitPathTemplate: saved.gitPathTemplate })
          await configureRelay(saved, account, generation)
        }
      } catch (error) {
        if (queueGeneration !== themeQueueGeneration.current || generation !== accountGeneration.current || userRef.current?.id !== account.id) return
        const message = error instanceof Error ? error.message : '코드 보기 테마를 저장하지 못했습니다.'
        setSettingsError(message)
      } finally { if (queueGeneration === themeQueueGeneration.current) themeSaving.current = false }
    })()
  }

  const chooseCodeTheme = (theme: CodeTheme, persistImmediately: boolean) => {
    const nextMode = isLightTheme(theme) ? 'light' : 'dark'
    setCodeThemeMode(nextMode)
    try { localStorage.setItem(CODE_THEME_MODE_KEY, nextMode) } catch { /* The current preview still updates. */ }
    const nextThemes = isLightTheme(theme)
      ? { lightTheme: theme, darkTheme: accountSettingsRef.current.darkTheme }
      : { lightTheme: accountSettingsRef.current.lightTheme, darkTheme: theme }
    if (persistImmediately) updateCodeThemes(nextThemes)
    else updateAccountSettingsDraft({ ...accountSettingsRef.current, ...nextThemes })
  }

  const showToast = (kind: Toast['kind'], message: string) => {
    toastId.current += 1
    setToast({ id: toastId.current, kind, message })
  }
  useEffect(() => {
    const started = (event: Event) => showToast('info', (event as CustomEvent<string>).detail === 'install'
      ? '웹브라우저에서 GitHub App 설치를 마친 뒤 연결 버튼을 다시 눌러 주세요.'
      : extensionRuntime() ? '새 탭에서 GitHub 로그인을 완료하면 이 화면으로 돌아옵니다.' : '웹브라우저에서 로그인한 뒤 PC 앱 로그인을 승인해 주세요.')
    const failed = (event: Event) => showToast('error', (event as CustomEvent<string | null>).detail || '웹 로그인을 완료하지 못했습니다. 다시 시도해 주세요.')
    window.addEventListener('codearchive-login-start', started)
    window.addEventListener('codearchive-login-error', failed)
    return () => { window.removeEventListener('codearchive-login-start', started); window.removeEventListener('codearchive-login-error', failed) }
  }, [])

  const refreshSolutions = async (expectedGeneration?: number, expectedGithubId?: string) => {
    const generation = expectedGeneration ?? accountGeneration.current
    const intendedGithubId = expectedGithubId ?? user?.githubId
    if (!intendedGithubId) return
    const fence: RequestFence = { generation, operation: ++solutionOperation.current }
    if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current)) return
    setLoading(true)
    setLoadError(null)
    try {
      const remote = (await getSolutions(intendedGithubId)).map(normalizeSolution)
      if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current)) return
      setSolutions(remote)
      setSelectedId(remote[0]?.captureId ?? '')
    } catch (error) {
      if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current)) return
      const message = error instanceof Error ? error.message : '풀이 목록을 불러오지 못했습니다.'
      setLoadError(message)
      throw error
    } finally {
      if (requestIsCurrent(fence, accountGeneration.current, solutionOperation.current)) setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const fence: RequestFence = { generation: accountGeneration.current, operation: ++solutionOperation.current }
    // A successful session silently upgrades the fixture screen to live data.
    // A missing backend or a 401 intentionally keeps the clearly labelled demo available.
    void getMe()
      .then(async (nextUser) => {
        if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current, active)) return
        if (userRef.current && userRef.current.id !== nextUser.id) clearAccountDraft()
        setUser(nextUser)
        try {
          const remote = (await getSolutions(nextUser.githubId)).map(normalizeSolution)
          if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current, active)) return
          setMode('live')
          setSolutions(remote)
          setSelectedId(remote[0]?.captureId ?? '')
        } catch {
          if (requestIsCurrent(fence, accountGeneration.current, solutionOperation.current, active)) {
            setMode('local')
            setLoadError('라이브 풀이 목록을 불러오지 못했습니다. 이 브라우저의 로컬 기록을 표시합니다.')
          }
        }
      })
      .catch(() => undefined)
      .finally(() => { if (active) setAuthResolved(true) })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!user) { settingsLoadedRef.current = null; setSavedTarget(null); updateAccountSettingsDraft(defaultAccountSettings()); return }
    let active = true
    const generation = accountGeneration.current
    const loadingFor = user
    const stillCurrent = () => active && generation === accountGeneration.current && userRef.current?.id === loadingFor.id
    settingsLoadedRef.current = null
    void Promise.resolve(getAccountSettings(loadingFor.githubId)).then(async serverResponse => {
      if (!stillCurrent()) return;
      if (extensionRuntime() && !serverResponse.autoSyncEnabled) serverResponse = await enableAccountAutomaticSync(loadingFor.githubId);
      if (!stillCurrent()) return
      const server = { ...serverResponse, communityPublicByDefault: serverResponse.communityPublicByDefault ?? true, communityDuplicateVisibility: serverResponse.communityDuplicateVisibility ?? 'all', nickname: serverResponse.nickname?.trim() || loadingFor.githubLogin, githubCommitMessageTemplate: serverResponse.githubCommitMessageTemplate || DEFAULT_GITHUB_COMMIT_MESSAGE_TEMPLATE, copyHeaderFields: normalizedHeaderFields(serverResponse.copyHeaderFields), downloadHeaderFields: normalizedHeaderFields(serverResponse.downloadHeaderFields), githubHeaderFields: normalizedHeaderFields(serverResponse.githubHeaderFields) }
      // One-way migration: old browser-only export choices only seed the first
      // server version, and never overwrite an existing account preference.
      const migrated = server.version === 0 && !server.copyHeader && !server.downloadHeader && server.downloadFilenameTemplate === '{platform}-{number}-{title}'
        ? { ...server, copyHeader: exportSettings.copyHeader, downloadHeader: exportSettings.downloadHeader, downloadFilenameTemplate: exportSettings.filenameTemplate, gitPathTemplate: exportSettings.gitPathTemplate ?? server.gitPathTemplate }
        : server
      relayHandoffOperation.current += 1
      accountSettingsRef.current = migrated
      setAccountSettings(migrated)
      setSavedTarget(savedGithubTarget(server))
      setExportSettings({ copyHeader: migrated.copyHeader, downloadHeader: migrated.downloadHeader, copyHeaderFields: migrated.copyHeaderFields, downloadHeaderFields: migrated.downloadHeaderFields, filenameTemplate: migrated.downloadFilenameTemplate, gitPathTemplate: migrated.gitPathTemplate })
      settingsLoadedRef.current = { accountId: loadingFor.id, generation, version: migrated.version }
      // If automatic connection won the race against settings loading, now send
      // the authoritative settings. configureRelay is declared below but is
      // invoked asynchronously after the component has finished initialization.
      if (bridgeCapabilityRef.current) void configureRelay(migrated, loadingFor, generation, bridgeCapabilityRef.current, true)
    }).catch(error => { if (stillCurrent()) { if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { void handleExpectedAccountChange(error, loadingFor.githubId); return } setSettingsError(error instanceof Error ? error.message : '계정 설정을 불러오지 못했습니다.') } })
    return () => { active = false }
  }, [user?.id])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('authError') === 'github') {
      // The callback only exposes a fixed, safe error state. Never render an
      // arbitrary query value supplied by a failed OAuth provider.
      showToast('error', 'GitHub 로그인에 실패했습니다. 다시 시도해 주세요.')
    } else if (githubInstallReturn) {
      const messages: Record<GithubInstallReturn['result'], [Toast['kind'], string]> = {
        success: ['info', 'GitHub App 설치 결과를 확인하고 있습니다.'],
        cancelled: ['info', 'GitHub App 설치가 완료되지 않았습니다. 다시 연결할 수 있습니다.'],
        expired: ['error', 'GitHub App 연결 시간이 만료되었습니다. 다시 시도해 주세요.'],
        invalid: ['error', 'GitHub App 연결 요청이 유효하지 않거나 이미 사용되었습니다.'],
        account_mismatch: ['error', '현재 로그인한 GitHub 계정과 설치 계정이 일치하지 않습니다.'],
        installation_unavailable: ['error', 'GitHub App 설치 권한이 없거나 철회되었습니다. 다시 연결해 주세요.'],
        provider_unavailable: ['error', 'GitHub App 설치 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'],
        authentication_required: ['error', 'GitHub 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'],
      }
      showToast(...messages[githubInstallReturn.result])
    } else return
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.delete('authError')
    nextUrl.searchParams.delete('githubInstall')
    nextUrl.searchParams.delete('installationId')
    window.history.replaceState({}, document.title, `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`)
  }, [])

  const languages = useMemo(() => {
    const options = new Map<string, string>()
    for (const solution of solutions) {
      const key = solution.languageKey ?? canonicalLanguageKey(solution.language)
      if (!options.has(key)) options.set(key, canonicalLanguageDisplayName(solution.language))
    }
    return [
      { key: 'ALL', label: '모든 언어' },
      ...Array.from(options, ([key, label]) => ({ key, label })).sort((left, right) => left.label.localeCompare(right.label)),
    ]
  }, [solutions])

  const filteredSolutions = useMemo(() => {
    return filterAndSortSolutions(solutions, { query, platform: platformFilter, languageKey: languageFilter, difficulty: difficultyFilter, sort: solutionSort })
  }, [difficultyFilter, languageFilter, platformFilter, query, solutionSort, solutions])

  const solutionGroups = useMemo(() => groupSolutions(filteredSolutions), [filteredSolutions])
  const solutionPageCount = Math.max(1, Math.ceil(solutionGroups.length / ARCHIVE_PAGE_SIZE))
  const currentSolutionPage = Math.min(solutionPage, solutionPageCount)
  const pagedSolutionGroups = useMemo(() => solutionGroups.slice((currentSolutionPage - 1) * ARCHIVE_PAGE_SIZE, currentSolutionPage * ARCHIVE_PAGE_SIZE), [solutionGroups, currentSolutionPage])

  useEffect(() => { setSolutionPage(1) }, [user?.githubId, mode])
  useEffect(() => {
    if (solutionPage !== currentSolutionPage) setSolutionPage(currentSolutionPage)
  }, [solutionPage, currentSolutionPage])
  useEffect(() => { if (view === 'history') setHistoricalOpened(true) }, [view])

  useEffect(() => {
    if (!pagedSolutionGroups.some(group => group.submissions.some(solution => solution.captureId === selectedId))) {
      setSelectedId(pagedSolutionGroups[0]?.submissions[0]?.captureId ?? '')
    }
  }, [selectedId, pagedSolutionGroups])

  const selectedGroup = solutionGroups.find((group) => group.submissions.some((solution) => solution.captureId === selectedId)) ?? solutionGroups[0] ?? null
  const selectedSolution = selectedGroup?.submissions.find((solution) => solution.captureId === selectedId) ?? selectedGroup?.submissions[0] ?? null

  const changeView = (nextView: ViewName) => {
    setView(nextView)
    setMobileNavOpen(false)
    window.history.pushState({ codeArchiveView: nextView }, '', urlForView(nextView, communityRoute))
  }
  const changeCommunityRoute = (nextRoute: CommunityRoute) => {
    setCommunityRoute(nextRoute)
    setView('community')
    setMobileNavOpen(false)
    window.history.pushState({ codeArchiveView: 'community' }, '', urlForView('community', nextRoute))
  }
  useEffect(() => {
    const restoreRoute = (event: PopStateEvent) => {
      const savedView = event.state?.codeArchiveView
      setView(savedView === 'guide' ? 'solutions' : savedView === 'settings' || savedView === 'github' ? savedView : readView())
      setCommunityRoute(readCommunityRoute())
    }
    window.addEventListener('popstate', restoreRoute)
    return () => window.removeEventListener('popstate', restoreRoute)
  }, [])
  const returnToArchive = (platform: Solution['platform'], problemNumber: string) => {
    const own = solutions.find(solution => solution.platform === platform && solution.problemNumber === problemNumber)
    setQuery('')
    setPlatformFilter('ALL')
    setLanguageFilter('ALL')
    const groups = groupSolutions(filterAndSortSolutions(solutions, { query: '', platform: 'ALL', languageKey: 'ALL', sort: solutionSort }))
    const groupIndex = groups.findIndex(group => group.platform === platform && group.problemNumber === problemNumber)
    setSolutionPage(groupIndex < 0 ? 1 : Math.floor(groupIndex / ARCHIVE_PAGE_SIZE) + 1)
    if (own) setSelectedId(own.captureId)
    changeView('solutions')
  }

  const refreshPendingCount = async (
    capability = bridgeCapabilityRef.current,
    candidate = currentExtensionId.current,
    showLoading = false,
  ) => {
    if (!capability) {
      setPendingCountState('idle')
      return null
    }
    if (showLoading) setPendingCountState('loading')
    try {
      const { pendingCount: nextCount } = parseBridgeStatusResponse(await requestBridge(candidate, { type: 'GET_STATUS', capability }))
      if (capability !== bridgeCapabilityRef.current || candidate !== currentExtensionId.current) return null
      setPendingCount(nextCount)
      setPendingCountState('ready')
      return nextCount
    } catch {
      if (capability === bridgeCapabilityRef.current && candidate === currentExtensionId.current) setPendingCountState('error')
      return null
    }
  }

  const connectLive = async () => {
    if (authMutationInFlight.current !== null) return
    let fence: RequestFence = { generation: accountGeneration.current, operation: ++solutionOperation.current }
    setLoading(true)
    setLoadError(null)
    try {
      const nextUser = await getMe()
      if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current)) return
      // A valid session alone is not authority to leave local/read-only mode.
      // In particular, a list outage must not race settings/bridge effects into
      // issuing a relay grant before the archive is actually live.
      if (userRef.current && userRef.current.id !== nextUser.id) {
        // A reconnect can replace an authenticated identity without a logout.
        // Resetting the bridge first advances the authority generation and
        // fails closed before any A-owned save/grant response can reach B.
        const bridgeReset = resetBridge()
        setMode('local')
        setSolutions([])
        setSelectedId('')
        await bridgeReset
        if (authMutationInFlight.current !== null) return
        clearAccountDraft()
        fence = { generation: accountGeneration.current, operation: ++solutionOperation.current }
      }
      setUser(nextUser)
      const remote = (await getSolutions(nextUser.githubId)).map(normalizeSolution)
      if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current)) return
      setMode('live')
      setSolutions(remote)
      setSelectedId(remote[0]?.captureId ?? '')
      showToast('success', '서버 아카이브에 연결했습니다.')
    } catch (error) {
      if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current)) return
      if (error instanceof ApiError && error.status === 401) {
        setMode('local')
        setUser(null)
        setSolutions([])
        setSelectedId('')
        showToast('info', '먼저 로그인하면 내 풀이를 불러올 수 있습니다.')
        navigateSameTab(GITHUB_LOGIN_URL)
      } else {
        setMode('local')
        const message = error instanceof Error ? error.message : '서버에 연결하지 못했습니다.'
        setLoadError(message)
        showToast('error', message)
      }
    } finally {
      if (requestIsCurrent(fence, accountGeneration.current, solutionOperation.current)) setLoading(false)
    }
  }

  useEffect(() => subscribeExtensionLogin(returnQuery => {
    if (returnQuery) {
      const query = new URLSearchParams(returnQuery)
      const url = new URL(window.location.href)
      for (const key of ['githubInstall', 'installationId']) {
        const value = query.get(key)
        if (value) url.searchParams.set(key, value)
      }
      window.history.replaceState({}, '', url)
      setGithubInstallReturn(readGithubInstallReturn())
      setView('github')
    }
    void connectLive()
  }), [])

  const resetBridge = async () => {
    // Invalidate an in-flight sync before asking the extension to disconnect.
    // Every account or bridge change therefore fences both the upload and ACK step.
    accountGeneration.current += 1
    solutionOperation.current += 1
    relayHandoffOperation.current += 1
    const resetOperation = ++bridgeOperation.current
    setLoading(false)
    const capability = bridgeCapabilityRef.current
    const disconnectExtensionId = currentExtensionId.current
    // Capture this before any asynchronous bridge work. A later render for B
    // must never turn an A cleanup into a B-scoped revocation request.
    const accountForRevocation = userRef.current
    // Stop the extension before the asynchronous server revocation. This is
    // intentionally fail-closed during offline logout/account switching.
    if (disconnectExtensionId && capability) {
      void requestBridge(disconnectExtensionId, { type: 'CONFIGURE_RELAY', capability, relay: null }).catch(() => undefined)
    }
    const deviceId = localStorage.getItem(RELAY_DEVICE_KEY)
    if (deviceId && accountForRevocation) void revokeRelayGrant(deviceId, accountForRevocation.githubId).catch(() => undefined)
    const shouldDisconnect = Boolean(disconnectExtensionId && capability)
    if (shouldDisconnect) {
      try {
        await requestBridge(disconnectExtensionId, { type: 'DISCONNECT', capability })
      } catch {
        // A disconnected or reloaded extension is already reset from the dashboard's perspective.
      }
    }
    // A reconnect may begin while DISCONNECT is in flight. Do not let this
    // older reset clear the newer connection when its request completes.
    if (bridgeOperation.current !== resetOperation) return
    setBridgeStatus('disconnected')
    setExtensionVersion(null)
    bridgeCapabilityRef.current = null
    setBridgeCapability(null)
  }

  const handleExpectedAccountChange = async (error: unknown, expectedGithubId: string) => {
    if (!(error instanceof ApiError) || error.status !== 409 || error.message !== 'GitHub account changed; reconnect required') return false
    // An A-owned response is harmless once B is rendered; never let it clear
    // B. If A is still current, fence its authority and clear its source before
    // waiting for an extension disconnect that may take several seconds.
    if (userRef.current?.githubId !== expectedGithubId) return true
    const bridgeReset = resetBridge()
    clearAccountDraft()
    setUser(null)
    setMode('local')
    setSolutions([])
    setSelectedId('')
    setView('solutions')
    setLoadError('GitHub 계정이 변경되었습니다. 다시 연결해 주세요.')
    showToast('info', 'GitHub 계정이 변경되었습니다. 다시 연결해 주세요.')
    await bridgeReset
    return true
  }

  const invalidateCommunityAuth = (expectedGithubId: string) => {
    if (userRef.current?.githubId !== expectedGithubId || modeRef.current !== 'live') return
    // Fence all A-owned requests immediately, then remove A's archive before
    // any asynchronous bridge disconnect can finish.
    modeRef.current = 'local'
    void resetBridge()
    clearAccountDraft()
    setMode('local')
    setSolutions([])
    setSelectedId('')
    setUser(null)
    setLoadError('GitHub 연결이 변경되거나 만료되었습니다. 다시 로그인해 주세요.')
    showToast('info', 'GitHub 연결이 변경되거나 만료되었습니다. 다시 로그인해 주세요.')
  }

  const beginLogoutMutation = () => {
    if (authMutationInFlight.current !== null) return null
    const operation = ++logoutOperation.current
    authMutationInFlight.current = operation
    return operation
  }

  const logoutMutationIsCurrent = (operation: number) =>
    authMutationInFlight.current === operation

  const handleLogout = async () => {
    const operation = beginLogoutMutation()
    if (operation === null) {
      showToast('info', '인증 요청을 처리 중입니다.')
      return
    }
    try {
      await resetBridge()
      try {
        await logout()
        if (!logoutMutationIsCurrent(operation)) return
      } catch (error) {
        if (!logoutMutationIsCurrent(operation)) return
        if (!(error instanceof ApiError && error.status === 401)) {
          showToast('error', error instanceof Error ? error.message : '로그아웃하지 못했습니다. 다시 시도해 주세요.')
          return
        }
        // A 401 means the server session is already gone, so local state can be cleared.
      }
      // Sync cleanup may change the bridge generation while logout is pending.
      // Only the logout operation owns this completion, and it fences every
      // outstanding data response again before clearing the authenticated UI.
      accountGeneration.current += 1
      solutionOperation.current += 1
      bridgeOperation.current += 1
      setLoading(false)
      setLoadError(null)
      clearAccountDraft()
      setUser(null)
      setMode('local')
      setSolutions([])
      setSelectedId('')
      setView('solutions')
      showToast('info', '로그아웃했습니다. 이 브라우저의 로컬 보관함을 확인할 수 있습니다.')
    } finally {
      if (authMutationInFlight.current === operation) authMutationInFlight.current = null
    }
  }

  const connectBridge = async (silent = false, legacyOnly = false) => {
    if (authMutationInFlight.current !== null || connectInFlight.current) return false
    connectInFlight.current = true
    const fence: RequestFence = { generation: accountGeneration.current, operation: ++bridgeOperation.current }
    setBridgeStatus('connecting')
    setPendingCountState('loading')
    setExtensionVersion(null)
    const oldCapability = bridgeCapabilityRef.current
    const oldId = currentExtensionId.current
    bridgeCapabilityRef.current = null
    setBridgeCapability(null)
    try {
      if (oldCapability) await requestBridge(oldId, { type: 'DISCONNECT', capability: oldCapability }).catch(() => undefined)
      for (const candidate of legacyOnly ? [LEGACY_EXTENSION_ID] : EXTENSION_CANDIDATES) {
        if (!requestIsCurrent(fence, accountGeneration.current, bridgeOperation.current)) return false
        try {
          const { capability, version, historySupported: supportsHistory } = parseConnectResponse(await requestBridge(candidate, { type: 'CONNECT' }))
          if (!requestIsCurrent(fence, accountGeneration.current, bridgeOperation.current)) {
            await requestBridge(candidate, { type: 'DISCONNECT', capability }).catch(() => undefined)
            return false
          }
          currentExtensionId.current = candidate
          setExtensionId(candidate)
          bridgeCapabilityRef.current = capability
          setBridgeCapability(capability)
          setBridgeStatus('connected')
          setExtensionVersion(version)
          setHistorySupported(supportsHistory)
          void refreshPendingCount(capability, candidate, true)
          // A capability is bound to this dashboard document by the extension.
          // This is a read-only fallback, never an upload or ACK authority.
          if (!user || modeRef.current === 'local') {
            try {
              const response = await requestBridge(candidate, { type: 'GET_LOCAL_ARCHIVE', capability, limit: 50 }) as { captures?: unknown; localOnly?: unknown }
              if (response.localOnly === true && Array.isArray(response.captures) && requestIsCurrent(fence, accountGeneration.current, bridgeOperation.current)) {
                const local = response.captures.map(normalizeSolution)
                setMode('local')
                setSolutions(local)
                setSelectedId(local[0]?.captureId ?? '')
              }
            } catch { /* Local fallback remains empty if the extension is unavailable. */ }
          }
          const loaded = settingsLoadedRef.current
          if (modeRef.current === 'live' && user && loaded && loaded.accountId === user.id && loaded.generation === fence.generation) {
            void configureRelay(accountSettingsRef.current, user, fence.generation, capability, true)
          }
          if (!silent) showToast('success', '확장 프로그램을 연결했습니다.')
          return capability
        } catch { /* Only the two known installation identities are eligible. */ }
      }
      if (requestIsCurrent(fence, accountGeneration.current, bridgeOperation.current)) {
        setBridgeStatus('disconnected')
        setPendingCountState('idle')
        setExtensionVersion(null)
        if (!silent) showToast('error', '확장 프로그램을 찾지 못했습니다. 설치 후 다시 시도해 주세요.')
      }
      return false
    } finally { connectInFlight.current = false }
  }

  useEffect(() => {
    if (!authResolved || !autoConnect) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    const tick = async () => {
      if (!active) return
      const capability = bridgeCapabilityRef.current
      const operation = bridgeOperation.current
      if (capability && currentExtensionId.current === EXTENSION_ID && !syncInFlight.current && authMutationInFlight.current === null) {
        try {
          parseAckResponse(await requestBridge(EXTENSION_ID, { type: 'PING', capability }))
          void refreshPendingCount(capability, EXTENSION_ID)
        }
        catch {
          if (active && operation === bridgeOperation.current && capability === bridgeCapabilityRef.current) {
            bridgeCapabilityRef.current = null
            setBridgeCapability(null)
            setBridgeStatus('disconnected')
            setPendingCountState('idle')
            setExtensionVersion(null)
          }
        }
      }
      if (!active) return
      if (!bridgeCapabilityRef.current && !syncInFlight.current) await connectBridge(true)
      if (active) timer = setTimeout(tick, Math.min(30000, 2000 * 2 ** Math.min(attempts++, 4)))
    }
    void tick()
    return () => {
      active = false
      clearTimeout(timer)
      bridgeOperation.current += 1
      const capability = bridgeCapabilityRef.current
      bridgeCapabilityRef.current = null
      setBridgeCapability(null)
      setBridgeStatus('disconnected')
      setPendingCountState('idle')
      setExtensionVersion(null)
      if (capability) void requestBridge(currentExtensionId.current, { type: 'DISCONNECT', capability }).catch(() => undefined)
    }
  }, [user?.githubId, authResolved, autoConnect, mode])

  const relayConfiguration = (capability: string, saved: AccountSettings, account: User, relay: { endpoint: string; secret: string; generation: number } | null) => ({
    type: 'CONFIGURE_RELAY' as const,
    capability,
    relay: relay && { endpoint: relay.endpoint, secret: relay.secret, accountId: String(account.id), generation: relay.generation },
    settingsVersion: saved.version,
    // These are deliberately present for relay:null as well: the extension
    // owns no server profile/export/theme data and must refresh them while OFF.
    accountId: String(account.id),
    autoSyncEnabled: relay !== null,
    githubAutoCommitEnabled: relay !== null && saved.githubAutoCommitEnabled,
    githubTargetConfigured: saved.githubTargetConfigured,
    copyHeader: saved.copyHeader,
    downloadHeader: saved.downloadHeader,
    copyHeaderFields: normalizedHeaderFields(saved.copyHeaderFields),
    downloadHeaderFields: normalizedHeaderFields(saved.downloadHeaderFields),
    downloadFilenameTemplate: saved.downloadFilenameTemplate,
    gitPathTemplate: saved.gitPathTemplate,
    name: saved.name,
    nickname: saved.nickname,
    lightTheme: saved.lightTheme,
    darkTheme: saved.darkTheme,
  })

  const clearRelay = () => {
    const capability = bridgeCapabilityRef.current
    if (capability && user) {
      // The extension treats a null relay as an immediate durable OFF. Do this
      // before revocation so an unreachable dashboard cannot leave it running.
      void requestBridge(currentExtensionId.current, relayConfiguration(capability, accountSettingsRef.current, user, null)).catch(() => undefined)
    }
    const deviceId = localStorage.getItem(RELAY_DEVICE_KEY)
    if (deviceId && user) void revokeRelayGrant(deviceId, user.githubId).catch(() => undefined)
  }

  const configureRelay = async (saved: AccountSettings, account: User, generation: number, requestedCapability = bridgeCapabilityRef.current, silent = false) => {
    if (modeRef.current !== 'live') return
    const capability = requestedCapability
    if (!capability) {
      if (!silent && saved.autoSyncEnabled) showToast('info', '자동 동기화는 확장 프로그램이 연결되면 적용됩니다.')
      return
    }
    if (generation !== accountGeneration.current || settingsLoadedRef.current?.accountId !== account.id || settingsLoadedRef.current?.generation !== generation) return
    // Capabilities are intentionally ephemeral and disappear whenever Chrome
    // suspends the MV3 worker. The durable handoff identity is the installed
    // extension plus account settings version, not that transient capability.
    const handoffKey = relayHandoffKey(currentExtensionId.current, account.id, saved.version, saved.autoSyncEnabled)
    if (relayHandoffRef.current === handoffKey || relayHandoffInFlight.current.has(handoffKey)) return
    const operation = ++relayHandoffOperation.current
    const stillCurrent = () =>
      operation === relayHandoffOperation.current &&
      generation === accountGeneration.current &&
      bridgeCapabilityRef.current === capability &&
      settingsLoadedRef.current?.accountId === account.id &&
      settingsLoadedRef.current?.generation === generation &&
      settingsLoadedRef.current?.version === saved.version
    if (!stillCurrent()) return
    relayHandoffInFlight.current.add(handoffKey)
    try {
      if (!saved.autoSyncEnabled) {
        await requestBridge(currentExtensionId.current, relayConfiguration(capability, saved, account, null))
        if (stillCurrent()) relayHandoffRef.current = handoffKey
        return
      }
      // Chrome may terminate an idle MV3 service worker, which intentionally
      // drops the in-memory dashboard capability. The relay itself is durable
      // in IndexedDB, so reconnecting must reuse it instead of rotating a
      // server grant every heartbeat. No bearer secret crosses this check.
      let relayReused = false
      try {
        relayReused = parseRelayReuseResponse(await requestBridge(currentExtensionId.current, {
          type: 'REUSE_RELAY', capability, accountId: String(account.id), settingsVersion: saved.version,
        })).reused
      } catch {
        // Compatibility with extension builds that predate REUSE_RELAY: they
        // receive one ordinary grant and persist it using CONFIGURE_RELAY.
      }
      if (!stillCurrent()) return
      if (relayReused) {
        relayHandoffRef.current = handoffKey
        return
      }
      const grant = await issueRelayGrant(relayDeviceId(), saved.version, account.githubId)
      if (!stillCurrent()) return
      await requestBridge(currentExtensionId.current, relayConfiguration(capability, saved, account, grant))
      if (stillCurrent()) relayHandoffRef.current = handoffKey
    } catch (error) {
      if (stillCurrent()) {
        if (await handleExpectedAccountChange(error, account.githubId)) return
        if (saved.autoSyncEnabled) clearRelay()
        setSettingsError(error instanceof Error ? `자동 동기화 설정에 실패했습니다: ${error.message}` : '자동 동기화 설정에 실패했습니다.')
      }
    } finally {
      relayHandoffInFlight.current.delete(handoffKey)
    }
  }

  const updateExportSettings = (next: ExportSettings) => {
    setExportSettings(next)
    try { localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify(next)) }
    catch { showToast('info', '설정은 현재 화면에 적용됐지만 브라우저에 저장하지 못했습니다.') }
  }

  const saveAccountSettings = async () => {
    if (!user || settingsBusy) return
    const generation = accountGeneration.current
    const savingFor = user
    const savingDraft = accountSettingsRef.current
    if (!hasGitSubmissionIdentityToken(savingDraft.gitPathTemplate)) {
      setSettingsError('Git 저장 경로에 {capture_ID} 또는 {time}을 추가해 주세요.')
      return
    }
    const stillCurrent = () => generation === accountGeneration.current && userRef.current?.id === savingFor.id
    setSettingsBusy(true); setSettingsError(null)
    try {
      const saved = await updateAccountSettings(extensionRuntime() ? { ...savingDraft, autoSyncEnabled: true } : savingDraft, savingFor.githubId)
      if (stillCurrent()) {
        relayHandoffOperation.current += 1
        accountSettingsRef.current = saved
        settingsLoadedRef.current = { accountId: savingFor.id, generation, version: saved.version }
        relayHandoffRef.current = null
        setAccountSettings(saved)
        setSavedTarget(savedGithubTarget(saved))
        updateExportSettings({ copyHeader: saved.copyHeader, downloadHeader: saved.downloadHeader, copyHeaderFields: normalizedHeaderFields(saved.copyHeaderFields), downloadHeaderFields: normalizedHeaderFields(saved.downloadHeaderFields), filenameTemplate: saved.downloadFilenameTemplate, gitPathTemplate: saved.gitPathTemplate })
        await configureRelay(saved, savingFor, generation)
        if (stillCurrent() && modeRef.current === 'live') {
          await refreshSolutions(generation, savingFor.githubId).catch(() => { if (stillCurrent()) showToast('info', '설정은 저장됐습니다. 풀이 목록을 새로고침해 주세요.') })
        }
        if (stillCurrent()) showToast('success', '계정 설정을 저장했습니다.')
      }
    } catch (error) {
      if (!stillCurrent()) return
      if (await handleExpectedAccountChange(error, savingFor.githubId)) return
      const message = error instanceof ApiError && error.status === 409 ? '다른 창에서 설정이 변경되었습니다. 새로고침 후 다시 저장해 주세요.' : error instanceof Error ? error.message : '설정을 저장하지 못했습니다.'
      setSettingsError(message)
    } finally { if (stillCurrent()) setSettingsBusy(false) }
  }

  const syncPending = async () => {
    if (authMutationInFlight.current !== null) return
    if (syncing || syncInFlight.current) return
    if (!user || mode !== 'live') {
      showToast('info', '로그인한 라이브 모드에서만 동기화할 수 있습니다.')
      navigateSameTab(GITHUB_LOGIN_URL)
      return
    }
    let syncExtensionId = currentExtensionId.current
    syncInFlight.current = true
    setSyncing(true)
    setLastSyncState('idle')
    let syncContext: SyncBridgeContext | null = null
    let needsFreshCapability = false
    try {
      const syncGeneration = accountGeneration.current
      let latestUser: User
      try {
        latestUser = await getMe()
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await resetBridge()
          setUser(null)
          setMode('local')
          setSolutions([])
          setSelectedId('')
          showToast('info', '세션이 만료되었습니다. 다시 로그인해 주세요.')
          navigateSameTab(GITHUB_LOGIN_URL)
          return
        }
        throw error
      }
      if (syncGeneration !== accountGeneration.current) return
      const currentUserKey = user.githubId
      const latestUserKey = latestUser.githubId
      if (currentUserKey !== latestUserKey) {
        await resetBridge()
        clearAccountDraft()
        setUser(latestUser)
        // A replacement session is read-only until its own archive succeeds.
        // This prevents settings/auto-connect effects from opening relay
        // authority while an account-switch archive request is unavailable.
        setMode('local')
        setSolutions([])
        setSelectedId('')
        const replacementGeneration = accountGeneration.current
        try {
          await refreshSolutions(replacementGeneration, latestUser.githubId)
          if (replacementGeneration === accountGeneration.current && userRef.current?.githubId === latestUser.githubId) setMode('live')
        } catch {
          // The cleared list is safer than retaining records from the previous account.
          if (replacementGeneration === accountGeneration.current) setMode('local')
        }
        showToast('info', '계정이 변경되어 브리지를 초기화했습니다. 다시 동기화해 주세요.')
        return
      }
      let syncCapability = bridgeCapabilityRef.current
      if (!syncCapability) {
        const connectedCapability = await connectBridge()
        if (!connectedCapability) return
        syncCapability = connectedCapability
        syncExtensionId = currentExtensionId.current
      }
      syncContext = {
        generation: syncGeneration,
        operation: bridgeOperation.current,
        capability: syncCapability,
        extensionId: syncExtensionId,
      }
      const syncBridgeIsCurrent = () =>
        syncContext !== null &&
        syncContext.generation === accountGeneration.current &&
        syncContext.operation === bridgeOperation.current &&
        syncContext.capability === bridgeCapabilityRef.current &&
        syncContext.extensionId === currentExtensionId.current
      if (!syncBridgeIsCurrent()) {
        showToast('info', '계정 또는 브리지 상태가 바뀌어 동기화를 중단했습니다.')
        return
      }
      const readPending = () => requestBridge(syncExtensionId, { type: 'GET_PENDING', capability: syncCapability, limit: 50 })
      let pendingResponse: object
      try { pendingResponse = await readPending() }
      catch (error) {
        // An idle capability may expire, especially during migration from an
        // older extension without heartbeat support. Reconnect once within the
        // same explicit sync action; never replay a partially uploaded batch.
        if (!(error instanceof BridgeError) || error.message !== 'UNAUTHORIZED' || !syncBridgeIsCurrent()) throw error
        const renewed = await connectBridge(true, syncExtensionId === LEGACY_EXTENSION_ID)
        if (!renewed || syncGeneration !== accountGeneration.current) return
        syncCapability = renewed
        syncExtensionId = currentExtensionId.current
        syncContext = { generation: syncGeneration, operation: bridgeOperation.current, capability: renewed, extensionId: syncExtensionId }
        pendingResponse = await readPending()
      }
      const { captures } = parsePendingResponse(pendingResponse)
      if (!syncBridgeIsCurrent()) {
        showToast('info', '계정 또는 브리지 상태가 바뀌어 동기화를 중단했습니다.')
        return
      }
      if (!captures.length) {
        setPendingCount(0)
        setPendingCountState('ready')
        setLastSyncState('success')
        showToast('info', '새로 가져올 풀이가 없습니다.')
        return
      }
      if (!syncBridgeIsCurrent()) {
        showToast('info', '계정 또는 브리지 상태가 바뀌어 동기화를 중단했습니다.')
        return
      }
      const result: BulkResponse = await bulkUpload(captures, latestUser.githubId)
      const accepted = acceptedIdsForAck(result.acceptedCaptureIds, captures.map((capture) => capture.captureId))
      const failedCount = result.failures?.length ?? 0
      // A pending record is issued only once per capability. Any partial
      // response leaves failed records issued, so the capability must be
      // discarded before the next attempt can retry them.
      needsFreshCapability = failedCount > 0 || accepted.length < captures.length
      if (accepted.length) {
        if (!syncBridgeIsCurrent()) {
          showToast('info', '계정 또는 브리지 상태가 바뀌어 ACK를 보내지 않았습니다.')
          return
        }
        const ackResponse = await requestBridge(syncExtensionId, {
          type: 'ACK',
          capability: syncCapability,
          captureIds: accepted,
        })
        parseAckResponse(ackResponse)
      }
      if (!syncBridgeIsCurrent()) {
        showToast('info', '계정 또는 브리지 상태가 바뀌어 동기화를 중단했습니다.')
        return
      }
      await refreshPendingCount(syncCapability, syncExtensionId)
      setLastSyncState(failedCount ? 'partial' : 'success')
      await refreshSolutions(syncGeneration, latestUser.githubId)
      const pageHint = captures.length === 50 ? ' 다음 50개는 다시 동기화해 주세요.' : ''
      showToast(
        failedCount ? 'info' : 'success',
        failedCount ? `${accepted.length}개 저장 · ${failedCount}개는 저장하지 못했습니다.${pageHint}` : `${accepted.length}개 풀이를 저장했습니다.${pageHint}`,
      )
    } catch (error) {
      if (syncContext) needsFreshCapability = true
      setLastSyncState('failed')
      if (syncContext) await refreshPendingCount(syncContext.capability, syncContext.extensionId)
      showToast('error', error instanceof Error ? error.message : '동기화에 실패했습니다.')
    } finally {
      if (needsFreshCapability && syncContext) {
        // Only this sync may retire its capability. If logout, an extension
        // change, or a user reconnect already advanced the bridge fence, the
        // newer connection owns the state and must remain untouched.
        const isCurrent =
          syncContext.generation === accountGeneration.current &&
          syncContext.operation === bridgeOperation.current &&
          syncContext.capability === bridgeCapabilityRef.current &&
          syncContext.extensionId === currentExtensionId.current
        if (isCurrent) await resetBridge()
      }
      syncInFlight.current = false
      setSyncing(false)
    }
  }

  const copyCode = async () => {
    if (!selectedSolution) return
    try {
      await navigator.clipboard.writeText(exportCode(selectedSolution, exportSettings.copyHeader, normalizedHeaderFields(exportSettings.copyHeaderFields)))
      showToast('success', '코드를 클립보드에 복사했습니다.')
    } catch {
      showToast('error', '클립보드에 복사하지 못했습니다.')
    }
  }

  const downloadCode = () => {
    if (!selectedSolution) return
    const objectUrl = URL.createObjectURL(new Blob([exportCode(selectedSolution, exportSettings.downloadHeader, normalizedHeaderFields(exportSettings.downloadHeaderFields))], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = downloadFilename(selectedSolution, exportSettings.filenameTemplate, { name: accountSettings.name, nickname: accountSettings.nickname, id: user?.id })
    anchor.click()
    URL.revokeObjectURL(objectUrl)
    showToast('success', '소스 파일을 다운로드했습니다.')
  }

  const pendingBadge = syncing
    ? (pendingCount ?? '…')
    : pendingCountState === 'loading'
      ? '…'
      : lastSyncState === 'partial' && pendingCountState === 'ready'
      ? pendingCount
      : bridgeStatus === 'connected' && pendingCountState === 'ready'
      ? pendingCount
      : bridgeStatus === 'connected' && pendingCountState === 'error' ? '?' : '—'
  const pendingDescription = syncing
    ? '로컬 대기 풀이를 서버로 전송 중'
    : lastSyncState === 'partial' ? `${pendingCount ?? '일부'}개 대기 · 일부 항목은 다시 시도해 주세요.`
      : lastSyncState === 'failed' ? '마지막 동기화에 실패했습니다. 다시 시도해 주세요.'
        : pendingCountState === 'loading' ? '로컬 대기 건수를 확인하고 있습니다.'
          : pendingCountState === 'error' ? '로컬 대기 건수를 확인하지 못했습니다.'
            : pendingCountState === 'ready' ? `로컬 대기 풀이 ${pendingCount ?? 0}개`
              : '확장 프로그램이 연결되면 로컬 대기 건수를 확인합니다.'
  const extensionStatusLabel = bridgeStatus === 'connected'
    ? extensionVersion && !isVersionAtLeast(extensionVersion, EXTENSION_RELEASE.minimumExtensionVersion)
      ? `확장 프로그램 업데이트 필요 · v${extensionVersion}`
      : extensionVersion ? `확장 프로그램 연결 완료 · v${extensionVersion}` : '확장 프로그램 연결 완료 · 버전 확인 불가'
    : bridgeStatus === 'connecting' ? '확장 프로그램 연결 중' : '확장 프로그램 연결 끊김'
  const extensionUpdateRequired = bridgeStatus === 'connected' && extensionVersion !== null && !isVersionAtLeast(extensionVersion, EXTENSION_RELEASE.minimumExtensionVersion)
  const serverStatusLabel = mode === 'live' && user
    ? `서버 연결 완료 · ${displayUser(user)}`
    : user ? '서버 연결 오류' : 'GitHub 로그인 전'

  return (
    <DesktopStatusProvider><div className="app-shell">
      <DesktopSetup />
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => changeView('solutions')} aria-label="CodeArchive 홈">
            <span className="brand-copy">
              <span className="brand-name">CodeArchive</span>
              <span className="brand-release"><span className="brand-beta">BETA</span><span className="brand-updated">{updatedLabel()}</span></span>
            </span>
          </button>
          <button className="mobile-menu" onClick={() => setMobileNavOpen((open) => !open)} aria-label="메뉴 열기">
            <Icon name="menu" size={21} />
          </button>
          <nav className={`main-nav ${mobileNavOpen ? 'is-open' : ''}`} aria-label="주 메뉴">
            <button className={view === 'solutions' ? 'nav-item active' : 'nav-item'} onClick={() => changeView('solutions')}>
              전체 풀이 <span className="nav-count">{solutions.length}</span>
            </button>
            <button className={view === 'history' ? 'nav-item active' : 'nav-item'} onClick={() => changeView('history')}>
              과거 풀이 관리
            </button>
            <button className={view === 'community' ? 'nav-item active' : 'nav-item'} onClick={() => changeView('community')}>
              커뮤니티
            </button>
            <button className={view === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => changeView('settings')}>
              설정
            </button>
            <button className={view === 'github' ? 'nav-item active' : 'nav-item'} onClick={() => changeView('github')}>
              GitHub 관리
            </button>
          </nav>
          <div className="topbar-actions">
            <button
              className={`sync-button ${syncing ? 'is-loading' : ''} ${lastSyncState === 'partial' || lastSyncState === 'failed' ? 'has-warning' : ''}`}
              onClick={() => void syncPending()}
              disabled={syncing}
              aria-label="동기화"
              aria-describedby="pending-sync-help"
              title="로컬 대기 풀이를 서버로 전송"
            >
              <Icon name="sync" size={16} />
              <span>{syncing ? '동기화 중' : '동기화'}</span>
              <b className="sync-count" aria-hidden="true">{pendingBadge}</b>
            </button>
            {user ? (
              <div className="account-menu">
                <ProfileAvatar user={user} />
                <span className="account-identity">{displayUser(user)}</span>
                <button className="logout-button" onClick={() => void handleLogout()} aria-label="로그아웃">
                  <Icon name="logout" size={16} />
                </button>
              </div>
            ) : (
              <button className="login-button" onClick={() => navigateSameTab(GITHUB_LOGIN_URL)}>
                GitHub 로그인 <Icon name="github" size={14} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="page-content">
        <DesktopVersion /><DesktopUpdateNotice />
        <section className={`connection-banner is-${bridgeStatus} ${extensionUpdateRequired ? 'needs-update' : ''}`} role="status">
          <div className="connection-icon"><Icon name={bridgeStatus === 'connected' ? 'check' : bridgeStatus === 'connecting' ? 'sync' : 'link'} size={17} /></div>
          <div className="connection-copy">
            <strong>{extensionStatusLabel}</strong>
            <span>{serverStatusLabel}</span>
            {mode === 'local' && <em>로컬 보관함</em>}
            <small id="pending-sync-help">{pendingDescription}</small>
          </div>
          <div className="connection-actions">
            {mode === 'local' && !user && <button className="banner-action" onClick={() => navigateSameTab(GITHUB_LOGIN_URL)}>GitHub로 로그인 <Icon name="github" size={14} /></button>}
            {mode === 'local' && <button className="banner-secondary" onClick={() => void connectLive()} disabled={loading}><Icon name="refresh" size={14} /> 서버 연결 새로고침</button>}
            {extensionUpdateRequired && <a className="banner-secondary update-extension" href={EXTENSION_RELEASE.releaseHistoryUrl} target="_blank" rel="noopener noreferrer">확장 업데이트</a>}
            {bridgeStatus === 'disconnected' && <button className="banner-secondary" onClick={() => void connectBridge()} disabled={loading}>확장 재연결</button>}
            {mode === 'live' && user && <button className="server-refresh" onClick={() => void refreshSolutions(undefined, user.githubId)} disabled={loading} title="서버 아카이브 목록을 다시 읽습니다."><Icon name="refresh" size={14} /> 서버 목록 새로고침</button>}
          </div>
        </section>
        {loadError && (
          <section className="load-error" role="alert"><Icon name="close" size={17} /><span>{loadError}</span><button onClick={() => setLoadError(null)} aria-label="오류 닫기"><Icon name="close" size={15} /></button></section>
        )}

        {view === 'solutions' && <>
          <SolutionsView
            solutions={solutions}
            filteredSolutions={filteredSolutions}
            solutionGroups={pagedSolutionGroups}
            problemCount={solutionGroups.length}
            page={currentSolutionPage}
            pageCount={solutionPageCount}
            onPageChange={setSolutionPage}
            selectedSolution={selectedSolution}
            selectedGroup={selectedGroup}
            selectedId={selectedId}
            query={query}
            platformFilter={platformFilter}
            languageFilter={languageFilter}
            difficultyFilter={difficultyFilter}
            setDifficultyFilter={value => { setDifficultyFilter(value); setSolutionPage(1) }}
            languages={languages}
            solutionSort={solutionSort}
            loading={loading}
            mode={mode}
            setQuery={value => { setQuery(value); setSolutionPage(1) }}
            setPlatformFilter={value => { setPlatformFilter(value); setSolutionPage(1) }}
            setLanguageFilter={value => { setLanguageFilter(value); setSolutionPage(1) }}
            setSolutionSort={value => { setSolutionSort(value); setSolutionPage(1) }}
            setSelectedId={setSelectedId}
            onCopy={copyCode}
            onDownload={downloadCode}
            lightTheme={accountSettings.lightTheme}
            darkTheme={accountSettings.darkTheme}
            onOtherSolutions={(platform, problemNumber) => changeCommunityRoute({ platform, problemNumber, languageKey: '', page: 0, detailId: null })}
            codeThemeMode={codeThemeMode}
            onCodeThemeChange={(theme) => chooseCodeTheme(theme, true)}
          />
        </>}
        <section hidden={view !== 'history'} className="history-management" aria-label="과거 풀이 관리">
          <div className="page-heading">
            <h1>과거 풀이 관리</h1>
            <p>사이트별 과거 풀이를 수집하고, 서버 동기화와 GitHub 커밋을 순서대로 진행하세요.</p>
          </div>
          <div className="history-storage-guide">
            <h2>저장 안내</h2>
            <p><strong>과거 풀이 수집</strong>은 본인 제출의 원본을 확인해 이 브라우저에 저장합니다. <strong>일괄 동기화</strong>는 선택한 풀이를 서버에 저장하고, <strong>일괄 GitHub 커밋</strong>은 서버 풀이를 연결된 저장소에 커밋합니다.</p>
            <p>수집은 로그인 없이 가능합니다. 수집 완료 후 원본 확인을 마친 선택 제출만 일괄 동기화·GitHub 커밋할 수 있으며, 서버 작업에는 로그인이 필요합니다.</p>
          </div>
          {historicalOpened && <>
          <HistoricalCollectionView extensionId={extensionId} capability={bridgeCapability} supported={historySupported} disabled={historicalSyncBusy || historicalCommitBusy} onSelectionChange={receiveHistoricalScope} />
          <div hidden={!historicalScope}>{historicalScope && <HistoricalImportView selectionScope={historicalScope} onBusyChange={setHistoricalSyncBusy} onCommitReady={() => setHistoricalCommitPreview(value => value + 1)} extensionId={extensionId} capability={bridgeCapability} supported={historySupported} user={user} mode={mode} onImported={() => {
            setHistoricalRevision(value => value + 1)
            if (modeRef.current === 'live' && userRef.current) {
              void refreshSolutions(accountGeneration.current, userRef.current.githubId).catch(() => undefined)
              return
            }
            const capability = bridgeCapabilityRef.current
            if (!capability || modeRef.current !== 'local') return
            const generation = accountGeneration.current
            const connectedExtensionId = currentExtensionId.current
            void requestBridge(currentExtensionId.current, { type: 'GET_LOCAL_ARCHIVE', capability, limit: 50 })
              .then((response: { captures?: unknown; localOnly?: unknown }) => {
                if (generation !== accountGeneration.current || capability !== bridgeCapabilityRef.current ||
                    connectedExtensionId !== currentExtensionId.current || modeRef.current !== 'local' ||
                    response.localOnly !== true || !Array.isArray(response.captures)) return
                setSolutions(response.captures.map(normalizeSolution))
              }).catch(() => undefined)
          }} />}</div>
          <div hidden={!historicalScope || !historicalCommitPreview}>{historicalScope && historicalCommitPreview > 0 && <HistoricalGithubCommitView selectionScope={historicalScope} previewRequest={historicalCommitPreview} onBusyChange={setHistoricalCommitBusy} user={user} mode={mode} revision={historicalRevision} />}</div>
          </>}
        </section>
        {view === 'community' && <CommunityView
          user={user}
          mode={mode}
          solutions={solutions}
          route={communityRoute}
          onRouteChange={changeCommunityRoute}
          onReturnToArchive={returnToArchive}
          onVisibilityChanged={(expectedGithubId, id, visibility, publishedAt) => { if (userRef.current?.githubId === expectedGithubId && modeRef.current === 'live') { setSolutions(current => current.map(solution => solution.id === id ? { ...solution, visibility, publishedAt } : solution)); void refreshSolutions(accountGeneration.current, expectedGithubId).catch(() => showToast('info', '공개 설정은 저장됐습니다. 풀이 목록을 새로고침해 주세요.')) } }}
          onAuthInvalid={invalidateCommunityAuth}
          onLogin={() => navigateSameTab(GITHUB_LOGIN_URL)}
          lightTheme={accountSettings.lightTheme}
          darkTheme={accountSettings.darkTheme}
          codeThemeMode={codeThemeMode}
          onCodeThemeChange={theme => chooseCodeTheme(theme, true)}
        />}
        {(view === 'settings' || view === 'github') && (
          <SettingsView key={user?.id ?? 'local'}
            section={view}
            user={user}
            exportSettings={exportSettings}
            updateExportSettings={updateExportSettings}
            accountSettings={accountSettings}
            savedTarget={savedTarget}
            updateAccountSettings={next => { markDesktopDraft(); updateAccountSettingsDraft(next) }}
            codeThemeMode={codeThemeMode}
            onCodeThemeChange={(theme) => chooseCodeTheme(theme, false)}
            settingsBusy={settingsBusy}
            settingsError={settingsError}
            onSaveSettings={() => void saveAccountSettings()}
            onCommunityPublished={expectedGithubId => { if (userRef.current?.githubId === expectedGithubId && modeRef.current === 'live') void refreshSolutions(accountGeneration.current, expectedGithubId).catch(() => showToast('info', '공개는 완료됐습니다. 풀이 목록을 새로고침해 주세요.')) }}
            onAutoSyncDisabled={clearRelay}
            previewSolution={selectedSolution ?? { captureId: 'preview', platform: 'SWEA', problemNumber: '0000', title: '미리보기', problemUrl: 'https://example.com/problem/0000', language: 'Java', sourceCode: '', result: 'ACCEPTED', solvedAt: '2026-01-01T00:00:00Z', executionTime: 123, memoryValue: 2048, memoryUnit: 'KB' }}
            onLogin={() => navigateSameTab(GITHUB_LOGIN_URL)}
            onLogout={() => void handleLogout()}
            onExpectedAccountChange={(expectedGithubId) => void handleExpectedAccountChange(new ApiError('GitHub account changed; reconnect required', 409), expectedGithubId)}
            githubInstallReturn={githubInstallReturn}
            accountSettingsReady={Boolean(user && settingsLoadedRef.current?.accountId === user.id)}
          />
        )}
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span className="footer-brand">CodeArchive</span>
          <span>풀이를 모으고, 다시 푸는 흐름을 가볍게</span>
          <span className="footer-version" title={`Updated ${BUILD_METADATA.updatedDate}`}>{buildLabel()}</span>
        </div>
      </footer>

      {toast && <ToastView toast={toast} onClose={() => setToast(null)} />}
    </div></DesktopStatusProvider>
  )
}

function SolutionsView({
  solutions,
  filteredSolutions,
  solutionGroups,
  problemCount,
  page,
  pageCount,
  onPageChange,
  selectedSolution,
  selectedGroup,
  selectedId,
  query,
  platformFilter,
  languageFilter,
  difficultyFilter,
  setDifficultyFilter,
  languages,
  solutionSort,
  loading,
  mode,
  setQuery,
  setPlatformFilter,
  setLanguageFilter,
  setSolutionSort,
  setSelectedId,
  onCopy,
  onDownload,
  lightTheme,
  darkTheme,
  onOtherSolutions,
  codeThemeMode,
  onCodeThemeChange,
}: {
  solutions: Solution[]
  filteredSolutions: Solution[]
  solutionGroups: SolutionGroup[]
  problemCount: number
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  selectedSolution: Solution | null
  selectedGroup: SolutionGroup | null
  selectedId: string
  query: string
  platformFilter: 'ALL' | 'SWEA' | 'PROGRAMMERS' | 'JUNGOL'
  languageFilter: string
  difficultyFilter: string
  setDifficultyFilter: (value: string) => void
  languages: Array<{ key: string; label: string }>
  solutionSort: SolutionSort
  loading: boolean
  mode: 'local' | 'live'
  setQuery: (value: string) => void
  setPlatformFilter: (value: 'ALL' | 'SWEA' | 'PROGRAMMERS' | 'JUNGOL') => void
  setLanguageFilter: (value: string) => void
  setSolutionSort: (value: SolutionSort) => void
  setSelectedId: (value: string) => void
  onCopy: () => void
  onDownload: () => void
  lightTheme: AccountSettings['lightTheme']
  darkTheme: AccountSettings['darkTheme']
  onOtherSolutions: (platform: Solution['platform'], problemNumber: string) => void
  codeThemeMode: CodeThemeMode
  onCodeThemeChange: (theme: CodeTheme) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [page, query, platformFilter, languageFilter, difficultyFilter, solutionSort])
  return (
    <section className="solutions-layout" aria-label="풀이 아카이브">
      <div className="solutions-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" /> ARCHIVE / SOLUTIONS</p>
          <h1>전체 풀이 <span>{solutions.length}</span></h1>
          <p className="heading-subtitle">여러 플랫폼에 흩어진 풀이를 한 곳에서 살펴보세요.</p>
        </div>
        <div className="heading-meta"><span className="heading-meta-label">SOURCE</span><strong>{mode === 'local' ? '이 브라우저' : '서버 아카이브'}</strong></div>
      </div>
      <div className="search-toolbar">
        <label className="search-box">
          <Icon name="search" size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="문제 이름, 번호, 언어 검색" aria-label="문제 검색" />
          {query && <button onClick={() => setQuery('')} aria-label="검색어 지우기"><Icon name="close" size={15} /></button>}
        </label>
        <div className="filter-group" role="group" aria-label="플랫폼 필터">
          <span className="filter-label"><Icon name="filter" size={15} /> FILTER</span>
          {(['ALL', 'SWEA', 'PROGRAMMERS', 'JUNGOL'] as const).map((filter) => (
            <button key={filter} className={platformFilter === filter ? 'filter-pill active' : 'filter-pill'} onClick={() => setPlatformFilter(filter)}>
              {filter === 'ALL' ? '전체' : filter === 'PROGRAMMERS' ? '프로그래머스' : filter === 'JUNGOL' ? '정올' : filter}
            </button>
          ))}
        </div>
        <select value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value)} aria-label="언어 필터">
          {languages.map((language) => <option key={language.key} value={language.key}>{language.label}</option>)}
        </select>
        <select aria-label="난이도 필터" value={difficultyFilter} onChange={event => setDifficultyFilter(event.target.value)}><option value="ALL">모든 난이도</option><option value="UNKNOWN">미확인</option>{[...new Set(solutions.filter(item => item.difficulty).map(item => difficultyKey(item.platform, item.difficulty)))].sort().map(key => <option key={key} value={key}>{key.replace(':', ' ')}</option>)}</select>
        <label className="archive-theme-picker">코드 보기 테마 <CodeThemeSelect value={codeThemeMode === 'dark' ? darkTheme : lightTheme} onChange={onCodeThemeChange} /></label>
        {(query || platformFilter !== 'ALL' || languageFilter !== 'ALL' || difficultyFilter !== 'ALL') && <button className="filter-reset" onClick={() => { setQuery(''); setPlatformFilter('ALL'); setLanguageFilter('ALL'); setDifficultyFilter('ALL') }}><Icon name="close" size={13} /> 필터 초기화</button>}
      </div>

      <div className="content-grid">
        <section className="solution-list-panel" aria-label="풀이 목록">
          <div className="panel-heading">
            <div><span className="panel-title">풀이 목록</span><span className="panel-count">문제 {problemCount}건</span></div>
            <label className="panel-sort">정렬 <select aria-label="풀이 정렬" value={solutionSort} onChange={(event) => setSolutionSort(event.target.value as SolutionSort)}><option value="latest">최신 저장순</option><option value="oldest">오래된 저장순</option><option value="problem">문제 번호순</option><option value="title">문제 제목순</option></select></label>
          </div>
          <nav className="archive-pagination" aria-label="풀이 페이지">
            <span className="archive-page-range">{problemCount ? `${(page - 1) * ARCHIVE_PAGE_SIZE + 1}–${Math.min(page * ARCHIVE_PAGE_SIZE, problemCount)}` : '0'} / {problemCount}문제</span>
            <div>
              <button type="button" aria-label="풀이 이전 페이지" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>이전</button>
              <select aria-label="풀이 목록 페이지" value={page} disabled={loading || !problemCount} onChange={event => onPageChange(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} / {pageCount}</option>)}</select>
              <button type="button" aria-label="풀이 다음 페이지" disabled={loading || page >= pageCount} onClick={() => onPageChange(page + 1)}>다음</button>
            </div>
          </nav>
          <div className="solution-list" ref={listRef}>
            {loading && <ListSkeleton />}
            {!loading && solutionGroups.length === 0 && <EmptyList mode={mode} />}
            {!loading && solutionGroups.map((group) => (
              <SolutionGroupRow key={group.key} group={group} selected={group.key === selectedGroup?.key} onSelect={() => setSelectedId(group.submissions[0]!.captureId)} onOtherSolutions={() => onOtherSolutions(group.platform, group.problemNumber)} />
            ))}
          </div>
          <div className="list-footer"><span><span className="status-dot" /> {mode === 'local' ? '로컬 기록 · 업로드 전' : '서버와 연결됨'}</span><span>제출 {filteredSolutions.length} / {solutions.length}건</span></div>
        </section>
        <SolutionDetail solution={selectedSolution} group={selectedGroup} onSelectSubmission={setSelectedId} mode={mode} onCopy={onCopy} onDownload={onDownload} lightTheme={lightTheme} darkTheme={darkTheme} codeThemeMode={codeThemeMode} onOtherSolutions={onOtherSolutions} />
      </div>
    </section>
  )
}

function SolutionGroupRow({ group, selected, onSelect, onOtherSolutions }: { group: SolutionGroup; selected: boolean; onSelect: () => void; onOtherSolutions: () => void }) {
  const latest = group.submissions[0]!
  const languageLabels = Array.from(new Set(group.submissions.map(solution => canonicalLanguageDisplayName(solution.language)))).join(', ')
  return (
    <div className="solution-group-entry"><button className={`solution-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <span className={`platform-logo ${group.platform === 'SWEA' ? 'swea' : group.platform === 'JUNGOL' ? 'jungol' : 'programmers'}`}>{group.platform === 'SWEA' ? 'S' : group.platform === 'JUNGOL' ? 'J' : 'P'}</span>
      <span className="solution-row-main">
        <span className="solution-row-top"><span className="solution-platform">{group.platform}</span><span className="solution-result">풀이 {group.submissions.length}개</span></span>
        <span className="solution-title">{group.title}</span><small>{group.submissions.find(item => item.difficulty)?.difficulty?.label ?? '난이도 미확인'}</small>
        <span className="solution-row-bottom"><span>#{group.problemNumber}</span><span className="row-divider" /><span>{languageLabels}</span><span className="row-time"><Icon name="clock" size={12} /> {formatDate(latest.solvedAt ?? latest.observedAt)}</span></span>
      </span>
      <Icon name="chevron" size={17} />
    </button><button type="button" className="solution-group-community" aria-label={`${group.platform} #${group.problemNumber} 다른 풀이 보기`} onClick={onOtherSolutions}>다른 풀이 보기</button></div>
  )
}

function SolutionDetail({ solution, group, onSelectSubmission, mode, onCopy, onDownload, lightTheme, darkTheme, codeThemeMode, onOtherSolutions }: { solution: Solution | null; group: SolutionGroup | null; onSelectSubmission: (captureId: string) => void; mode: 'local' | 'live'; onCopy: () => void; onDownload: () => void; lightTheme: AccountSettings['lightTheme']; darkTheme: AccountSettings['darkTheme']; codeThemeMode: CodeThemeMode; onOtherSolutions: (platform: Solution['platform'], problemNumber: string) => void }) {
  return (
    <section className="solution-detail" aria-label="선택한 풀이 상세">
      {!solution ? (
        <div className="detail-empty"><div className="detail-empty-icon"><Icon name="code" size={25} /></div><h2>풀이를 선택해 주세요</h2><p>왼쪽 목록에서 기록을 선택하면<br />소스 코드와 실행 정보를 볼 수 있습니다.</p></div>
      ) : (
        <>
          <div className="detail-heading">
            <div className="detail-heading-main">
              <div className="detail-breadcrumb"><span>{solution.platform}</span><Icon name="chevron" size={12} /><span>#{solution.problemNumber}</span></div>
              <h2>{solution.title}</h2>
              <div className="detail-subline"><span>{solution.difficulty?.label ?? '난이도 미확인'}</span><span>{canonicalLanguageDisplayName(solution.language)}</span><span className="row-divider" /><span>풀이 시간 {formatObservedTime(solution.solvedAt ?? solution.observedAt)}</span></div>
            </div>
            <div className="detail-heading-actions"><button type="button" className="problem-link" onClick={() => onOtherSolutions(solution.platform, solution.problemNumber)}>다른 풀이 보기</button><a className="problem-link" href={solution.problemUrl} target="_blank" rel="noreferrer">문제 보기 <Icon name="external" size={14} /></a></div>
          </div>
          <div className="metrics-row">
            <MetricCard label="실행 시간" value={formatExecutionTime(solution.executionTime)} icon="clock" />
            <MetricCard label="메모리 사용량" value={formatMemory(solution)} icon="spark" />
            <MetricCard label="풀이 시간" value={formatObservedTime(solution.solvedAt ?? solution.observedAt)} icon="check" />
          </div>
          {group && group.submissions.length > 1 && <label className="submission-picker">제출 기록<select aria-label="제출 기록" value={solution.captureId} onChange={(event) => onSelectSubmission(event.target.value)}>{group.submissions.map((submission, index) => <option key={submission.captureId} value={submission.captureId}>{index + 1}. {formatObservedTime(submission.solvedAt ?? submission.observedAt)} · {canonicalLanguageDisplayName(submission.language)}</option>)}</select></label>}
          <div className="code-toolbar"><div className="code-toolbar-title"><Icon name="code" size={16} /> 소스 코드 <span>{sourceFileExtension(solution.language)}</span></div><div className="code-actions"><button onClick={onCopy}><Icon name="copy" size={14} /> 복사</button><button onClick={onDownload}><Icon name="download" size={14} /> 다운로드</button></div></div>
          <CodeBlock code={solution.sourceCode} language={solution.language} lightTheme={lightTheme} darkTheme={darkTheme} activeMode={codeThemeMode} />
          <StaticAnalysisPanel captureId={solution.captureId} language={solution.language} source={solution.sourceCode} />
          <div className="detail-note"><Icon name="spark" size={14} /><span>{solution.historicalImport ? mode === 'live' ? '과거 풀이를 명시적으로 서버에 동기화한 기록입니다. 자동 GitHub 커밋은 실행되지 않습니다.' : '이 브라우저에 보관한 과거 풀이입니다. 과거 풀이 관리 탭에서 서버 동기화와 GitHub 커밋을 요청할 수 있습니다.' : mode === 'local' ? '이 브라우저의 로컬 기록입니다. 로그인 후 명시적으로 동기화할 수 있습니다.' : '이 기록은 연결된 확장 프로그램에서 관측한 제출 결과를 바탕으로 합니다.'}</span></div>
        </>
      )}
    </section>
  )
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: IconName }) {
  return <div className="metric-card"><span className="metric-icon"><Icon name={icon} size={15} /></span><span className="metric-label">{label}</span><strong>{value}</strong></div>
}


function ListSkeleton() {
  return <div className="skeleton-list">{[1, 2, 3, 4].map((item) => <div className="skeleton-row" key={item}><span /><div><i /><i /><i /></div></div>)}</div>
}

function EmptyList({ mode }: { mode: 'local' | 'live' }) {
  return <div className="empty-list"><div className="empty-list-icon"><Icon name="search" size={20} /></div><strong>{mode === 'live' ? '아직 저장된 풀이가 없습니다.' : '이 브라우저에 저장된 풀이가 없습니다.'}</strong><span>{mode === 'live' ? '확장 프로그램을 연결해 첫 풀이를 가져와 보세요.' : '확장 프로그램에서 통과한 풀이를 저장하거나 로그인 후 수동 동기화를 해보세요.'}</span></div>
}

function TokenTemplateInput({ id, label, value, tokens, maxLength, onChange }: { id: string; label: string; value: string; tokens: readonly string[]; maxLength: number; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const insert = (token: string) => {
    const start = input.current?.selectionStart ?? value.length
    const end = input.current?.selectionEnd ?? start
    const next = value.slice(0, start) + token + value.slice(end)
    if (next.length > maxLength) return
    onChange(next)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(start + token.length, start + token.length) })
  }
  return <><label htmlFor={id}>{label}</label><div className="git-path-token-list" aria-label={`${label} 토큰`}>{tokens.map(token => <button type="button" key={token} onClick={() => insert(token)}>{token}</button>)}</div><input ref={input} id={id} maxLength={maxLength} value={value} onChange={event => onChange(event.target.value)} /></>
}

function HeaderFieldsPicker({ label, fields, solution, onChange }: { label: string; fields: readonly HeaderField[]; solution: Solution; onChange: (fields: HeaderField[]) => void }) {
  return <div className="header-fields-picker" role="group" aria-label={`${label} 주석 항목`}><p>포함할 정보</p><div className="header-field-options">{HEADER_FIELDS.map(field => <label key={field}><input type="checkbox" checked={fields.includes(field)} onChange={event => onChange(event.target.checked ? HEADER_FIELDS.filter(candidate => candidate === field || fields.includes(candidate)) : fields.filter(candidate => candidate !== field))} />{HEADER_FIELD_LABELS[field]}</label>)}</div><p>수집되지 않은 값은 주석에서 생략합니다.</p><pre aria-label={`${label} 주석 미리보기`}>{exportCode({ ...solution, sourceCode: '' }, true, fields) || '선택한 항목이 없거나 이 언어의 안전한 주석 형식을 알 수 없습니다.'}</pre></div>
}

function SettingsView({
  section,
  user,
  exportSettings,
  updateExportSettings,
  accountSettings,
  savedTarget,
  updateAccountSettings,
  codeThemeMode,
  onCodeThemeChange,
  settingsBusy,
  settingsError,
  onSaveSettings,
  onCommunityPublished,
  onAutoSyncDisabled,
  previewSolution,
  onLogin,
  onLogout,
  onExpectedAccountChange,
  githubInstallReturn,
  accountSettingsReady,
}: {
  section: 'settings' | 'github'
  user: User | null
  exportSettings: ExportSettings
  updateExportSettings: (settings: ExportSettings) => void
  accountSettings: AccountSettings
  savedTarget: GithubSavedTarget | null
  updateAccountSettings: (settings: AccountSettings) => void
  codeThemeMode: CodeThemeMode
  onCodeThemeChange: (theme: CodeTheme) => void
  settingsBusy: boolean
  settingsError: string | null
  onSaveSettings: () => void
  onCommunityPublished: (expectedGithubId: string) => void
  onAutoSyncDisabled: () => void
  previewSolution: Solution
  onLogin: () => void
  onLogout: () => void
  onExpectedAccountChange: (expectedGithubId: string) => void
  githubInstallReturn: GithubInstallReturn | null
  accountSettingsReady: boolean
}) {
  const [installations, setInstallations] = useState<import('./types').GithubInstallation[]>([])
  const [showTargetSetup, setShowTargetSetup] = useState(false)
  const [repositories, setRepositories] = useState<import('./types').GithubRepositoryTarget[]>([])
  const [branches, setBranches] = useState<import('./types').GithubBranchTarget[]>([])
  const [directory, setDirectory] = useState<import('./types').GithubDirectoryTarget | null>(null)
  const [tree, setTree] = useState<import('./types').GithubTreePage | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [additionMode, setAdditionMode] = useState<'file' | 'folder'>('file')
  const [additionName, setAdditionName] = useState('')
  const [additionContent, setAdditionContent] = useState('')
  const [additionMessage, setAdditionMessage] = useState('')
  const [additionPreview, setAdditionPreview] = useState<GithubAddFileRequest | null>(null)
  const [additionError, setAdditionError] = useState<string | null>(null)
  const [additionSuccess, setAdditionSuccess] = useState<string | null>(null)
  const [treeOperation, setTreeOperation] = useState<'MOVE' | 'DELETE'>('MOVE')
  const [treeOperationSource, setTreeOperationSource] = useState('')
  const [treeOperationDestination, setTreeOperationDestination] = useState('')
  const [treeOperationMessage, setTreeOperationMessage] = useState('')
  const [treeOperationPreview, setTreeOperationPreview] = useState<GithubTreeOperationPreview | null>(null)
  const [treeOperationError, setTreeOperationError] = useState<string | null>(null)
  const [treeOperationSuccess, setTreeOperationSuccess] = useState<string | null>(null)
  const treeOperationPreviewGeneration = useRef(0)
  const clearTreeOperationPreview = () => { treeOperationPreviewGeneration.current += 1; setTreeOperationPreview(null); setTreeOperationError(null); setTreeOperationSuccess(null) }
  const [targetBusy, setTargetBusy] = useState(false)
  const [targetStep, setTargetStep] = useState<'idle' | 'connecting' | 'repositories' | 'branches' | 'directories' | 'initializing' | 'adding'>('idle')
  const [targetError, setTargetError] = useState<string | null>(null)
  const [targetErrorStep, setTargetErrorStep] = useState<'connecting' | 'repositories' | 'branches' | 'directories' | null>(null)
  const [repositoriesLoaded, setRepositoriesLoaded] = useState(false)
  const [branchesLoaded, setBranchesLoaded] = useState(false)
  const [repositoryId, setRepositoryId] = useState<number | null>(null)
  const [emptyDefaultBranch, setEmptyDefaultBranch] = useState<string | null>(null)
  const [readmePreview, setReadmePreview] = useState<string | null>(null)
  const [includeReadme, setIncludeReadme] = useState(true)
  const [createGuideOpen, setCreateGuideOpen] = useState(false)
  const [awaitingRepositoryCreation, setAwaitingRepositoryCreation] = useState(false)
  const targetOperation = useRef(0)
  const gitPathInput = useRef<HTMLInputElement>(null)
  const gitPathHasIdentity = hasGitSubmissionIdentityToken(accountSettings.gitPathTemplate)
  const insertGitPathToken = (token: string) => {
    const input = gitPathInput.current
    const start = input?.selectionStart ?? accountSettings.gitPathTemplate.length
    const end = input?.selectionEnd ?? start
    const next = accountSettings.gitPathTemplate.slice(0, start) + token + accountSettings.gitPathTemplate.slice(end)
    updateAccountSettings({ ...accountSettings, gitPathTemplate: next.slice(0, 240) })
    requestAnimationFrame(() => { gitPathInput.current?.focus(); gitPathInput.current?.setSelectionRange(start + token.length, start + token.length) })
  }
  const loadAllPages = async <T,>(fetchPage:(page:number)=>Promise<{items:T[];hasMore:boolean}|T[]>, key:(value:T)=>string|number) => { const values:T[]=[];const seen=new Set<string|number>();for(let page=1;page<=100;page+=1){const response=await fetchPage(page);const current=Array.isArray(response)?response:response.items;for(const value of current){const id=key(value);if(!seen.has(id)){seen.add(id);values.push(value)}}if(Array.isArray(response)?current.length<100:!response.hasMore)break}return values }
  const clearTargetFeedback = () => { setTargetError(null); setTargetErrorStep(null) }
  const finishTargetOperation = (operation: number) => {
    if (operation !== targetOperation.current) return
    setTargetBusy(false)
    setTargetStep('idle')
  }
  const chooseInstallation = async (id: number | null) => {
    const operation = ++targetOperation.current
    setAdditionPreview(null); setAdditionError(null); setAdditionSuccess(null)
    clearTreeOperationPreview()
    if (id === null) {
      updateAccountSettings({ ...accountSettings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubAutoCommitEnabled: false })
      setRepositoryId(null); setRepositories([]); setBranches([]); setDirectory(null); setTree(null); setTreeError(null); setEmptyDefaultBranch(null); setReadmePreview(null)
      setRepositoriesLoaded(false); setBranchesLoaded(false); setTargetBusy(false); setTargetStep('idle'); clearTargetFeedback()
      return
    }
    if (!user) return
    const githubId = user.githubId
    updateAccountSettings({ ...accountSettings, githubInstallationId: id, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubAutoCommitEnabled: false })
    setRepositoryId(null); setRepositories([]); setBranches([]); setDirectory(null); setTree(null); setTreeError(null); setEmptyDefaultBranch(null); setReadmePreview(null)
    setRepositoriesLoaded(false); setBranchesLoaded(false); setTargetBusy(true); setTargetStep('repositories'); clearTargetFeedback()
    try {
      const values = await loadAllPages(page => getGithubRepositories(githubId, id, page), repo => repo.id)
      if (operation === targetOperation.current) { setRepositories(values); setRepositoriesLoaded(true) }
    } catch (error) {
      if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(githubId); return }
      if (operation === targetOperation.current) { setTargetError(githubTargetErrorMessage(error, '저장소를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')); setTargetErrorStep('repositories') }
    } finally { finishTargetOperation(operation) }
  }
  const chooseRepository = async (id: number | null) => {
    const operation = ++targetOperation.current
    setAdditionPreview(null); setAdditionError(null); setAdditionSuccess(null)
    clearTreeOperationPreview()
    if (id === null) {
      updateAccountSettings({ ...accountSettings, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubAutoCommitEnabled: false })
      setRepositoryId(null); setBranches([]); setDirectory(null); setTree(null); setTreeError(null); setEmptyDefaultBranch(null); setReadmePreview(null); setBranchesLoaded(false); setTargetBusy(false); setTargetStep('idle'); clearTargetFeedback()
      return
    }
    const repo = repositories.find(value => value.id === id)
    if (!repo || !accountSettings.githubInstallationId || !user) return
    const githubId = user.githubId
    const installation = accountSettings.githubInstallationId
    setRepositoryId(id)
    updateAccountSettings({ ...accountSettings, githubOwner: repo.owner, githubRepository: repo.name, githubBranch: null, githubRootPath: null, githubAutoCommitEnabled: false })
    setBranches([]); setDirectory(null); setTree(null); setTreeError(null); setEmptyDefaultBranch(null); setReadmePreview(null); setBranchesLoaded(false); setTargetBusy(true); setTargetStep('branches'); clearTargetFeedback()
    try {
      const values = await loadAllPages(page => getGithubBranches(githubId, installation, id, page), branch => branch.name)
      if (operation !== targetOperation.current) return
      setBranches(values); setBranchesLoaded(true)
      if (values.length === 0) {
        const [empty, preview] = await Promise.all([getGithubEmptyDefaultBranch(githubId, installation, id), getGithubReadmePreview(githubId)])
        if (operation === targetOperation.current) {
          setEmptyDefaultBranch(empty.defaultBranch)
          setReadmePreview(preview.content)
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(githubId); return }
      if (operation === targetOperation.current) { setTargetError(githubTargetErrorMessage(error, '브랜치를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')); setTargetErrorStep('branches') }
    } finally { finishTargetOperation(operation) }
  }
  const chooseBranch = async (branch: string, path = '', selectPath = true) => {
    const operation = ++targetOperation.current
    setAdditionPreview(null); setAdditionError(null); setAdditionSuccess(null)
    clearTreeOperationPreview()
    if (!branch) {
      updateAccountSettings({ ...accountSettings, githubBranch: null, githubRootPath: null, githubAutoCommitEnabled: false })
      setDirectory(null); setTree(null); setTreeError(null); setTargetBusy(false); setTargetStep('idle'); clearTargetFeedback()
      return
    }
    if (!accountSettings.githubInstallationId || !repositoryId || !user) return
    const githubId = user.githubId
    const installation = accountSettings.githubInstallationId
    const repository = repositoryId
    if (selectPath) updateAccountSettings({ ...accountSettings, githubBranch: branch, githubRootPath: path || null, githubAutoCommitEnabled: false })
    setDirectory(null); setTree(null); setTreeError(null); setTargetBusy(true); setTargetStep('directories'); clearTargetFeedback()
    try {
      const value = await getGithubDirectories(githubId, installation, repository, branch, path)
      if (operation === targetOperation.current) setDirectory(value)
      try {
        const files = await getGithubTree(githubId, installation, repository, branch, path)
        if (operation === targetOperation.current) setTree(files)
      } catch (error) {
        if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(githubId); return }
        if (operation === targetOperation.current) setTreeError(githubTargetErrorMessage(error, '파일 구조를 불러오지 못했습니다. 다시 시도해 주세요.'))
      }
    } catch (error) {
      if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(githubId); return }
      if (operation === targetOperation.current) { setTargetError(githubTargetErrorMessage(error, '폴더를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')); setTargetErrorStep('directories') }
    } finally { finishTargetOperation(operation) }
  }
  const loadMoreTree = async () => {
    const current = tree
    if (!current?.hasMore || !accountSettings.githubInstallationId || !repositoryId || !accountSettings.githubBranch || !user || targetBusy) return
    const operation = ++targetOperation.current
    setAdditionPreview(null)
    clearTreeOperationPreview()
    setTargetBusy(true); setTargetStep('directories'); setTreeError(null)
    try {
      const next = await getGithubTree(user.githubId, accountSettings.githubInstallationId,
        repositoryId, accountSettings.githubBranch, current.path, current.page + 1)
      if (operation !== targetOperation.current) return
      if (next.headSha !== current.headSha || next.path !== current.path) {
        setTree(null)
        setTreeError('브랜치 내용이 변경됐습니다. 현재 폴더를 다시 확인해 주세요.')
      } else setTree({ ...next, items: [...current.items, ...next.items] })
    } catch (error) {
      if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(user.githubId); return }
      if (operation === targetOperation.current) setTreeError(githubTargetErrorMessage(error, '다음 파일 목록을 불러오지 못했습니다. 다시 시도해 주세요.'))
    } finally { finishTargetOperation(operation) }
  }
  const previewAddition = () => {
    setAdditionError(null); setAdditionSuccess(null); setAdditionPreview(null)
    if (!tree?.headSha || !directory || !accountSettings.githubBranch || tree.path !== directory.currentPath || tree.hasMore || tree.truncated) { setAdditionError('파일 목록을 끝까지 확인한 뒤 다시 시도해 주세요.'); return }
    if (branches.find(value => value.name === accountSettings.githubBranch)?.protectedBranch) { setAdditionError('보호된 브랜치에는 여기서 파일을 추가할 수 없습니다.'); return }
    const name = additionName.trim()
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name.includes('..') || name.toLowerCase() === '.git' || (additionMode === 'file' && name.toLowerCase() === '.gitkeep')) { setAdditionError('이름은 영문·숫자·점·밑줄·하이픈만 사용하고 100자 이내로 입력해 주세요.'); return }
    if (tree.items.some(entry => entry.name.toLowerCase() === name.toLowerCase())) { setAdditionError('같은 이름의 파일이나 폴더가 이미 있습니다.'); return }
    if (new TextEncoder().encode(additionContent).length > 65536) { setAdditionError('파일 내용은 64KB 이내로 입력해 주세요.'); return }
    const path = [directory.currentPath, name, additionMode === 'folder' ? '.gitkeep' : ''].filter(Boolean).join('/')
    const message = additionMessage.trim() || `Add ${path}`
    if (message.length > 200 || /[\x00-\x1f\x7f]/.test(message)) { setAdditionError('커밋 메시지는 한 줄, 200자 이내로 입력해 주세요.'); return }
    setAdditionPreview({ branch: accountSettings.githubBranch, path, content: additionMode === 'folder' ? '' : additionContent, message, expectedHeadSha: tree.headSha, placeholder: additionMode === 'folder' })
  }
  const confirmAddition = async () => {
    if (!additionPreview || !user || !accountSettings.githubInstallationId || !repositoryId || !tree || !directory || targetBusy) return
    if (additionPreview.branch !== accountSettings.githubBranch || additionPreview.expectedHeadSha !== tree.headSha || (additionPreview.placeholder ? !additionPreview.path.startsWith(directory.currentPath ? `${directory.currentPath}/` : '') : false)) { setAdditionPreview(null); setAdditionError('선택한 브랜치나 폴더가 변경됐습니다. 다시 미리보기 해주세요.'); return }
    // The file commit changes this tree's HEAD. Any move/delete preview tied to
    // the old tree must disappear before the write request starts.
    clearTreeOperationPreview()
    const operation = ++targetOperation.current
    setTargetBusy(true); setTargetStep('adding'); setAdditionError(null); setAdditionSuccess(null)
    try {
      const result = await addGithubFile(user.githubId, accountSettings.githubInstallationId, repositoryId, additionPreview)
      if (operation !== targetOperation.current) return
      setAdditionPreview(null); setAdditionContent(''); setAdditionName(''); setAdditionMessage('')
      setAdditionSuccess(`커밋 완료 · ${result.commitSha.slice(0, 7)}`)
      try {
        const updated = await getGithubTree(user.githubId, accountSettings.githubInstallationId, repositoryId, accountSettings.githubBranch!, directory.currentPath)
        if (operation === targetOperation.current) setTree(updated)
      } catch {
        if (operation === targetOperation.current) { setTree(null); setTreeError('커밋은 완료됐지만 파일 목록을 새로 불러오지 못했습니다. 다시 확인해 주세요.') }
      }
    } catch (error) {
      if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(user.githubId); return }
      if (operation === targetOperation.current) setAdditionError(error instanceof ApiError && error.status === 409 ? '파일·폴더가 이미 있거나 브랜치가 변경됐습니다. 파일 목록을 새로 확인해 주세요.' : githubTargetErrorMessage(error, '커밋 결과를 확인하지 못했습니다. 저장소를 새로고침한 뒤 재시도해 주세요.'))
    } finally { finishTargetOperation(operation) }
  }
  const previewTreeOperation = async () => {
    setTreeOperationError(null); setTreeOperationSuccess(null); setTreeOperationPreview(null)
    if (!tree?.headSha || !user || !accountSettings.githubInstallationId || !repositoryId || !accountSettings.githubBranch || tree.hasMore || tree.truncated || !!treeError) { setTreeOperationError('파일 목록을 끝까지 확인한 뒤 다시 시도해 주세요.'); return }
    if (branches.find(value => value.name === accountSettings.githubBranch)?.protectedBranch) { setTreeOperationError('보호된 브랜치에서는 파일 이동이나 삭제를 할 수 없습니다.'); return }
    const sourcePath = treeOperationSource.trim(), destinationPath = treeOperationDestination.trim()
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(sourcePath) || sourcePath.split('/').some(part => part === '.' || part === '..' || part.toLowerCase() === '.git')) { setTreeOperationError('원본 경로는 저장소의 안전한 상대 경로여야 합니다.'); return }
    if (treeOperation === 'MOVE' && (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(destinationPath) || destinationPath === sourcePath || destinationPath.startsWith(`${sourcePath}/`))) { setTreeOperationError('이동할 위치는 원본 외부의 안전한 상대 경로여야 합니다.'); return }
    const message = treeOperationMessage.trim() || `${treeOperation === 'MOVE' ? 'Move' : 'Delete'} ${sourcePath}`
    if (message.length > 200 || /[\x00-\x1f\x7f]/.test(message)) { setTreeOperationError('커밋 메시지는 한 줄, 200자 이내로 입력해 주세요.'); return }
    const previewGeneration = ++treeOperationPreviewGeneration.current
    const operation = ++targetOperation.current
    setTargetBusy(true); setTargetStep('adding')
    try {
      const preview = await previewGithubTreeOperation(user.githubId, accountSettings.githubInstallationId, repositoryId, { operation: treeOperation, branch: accountSettings.githubBranch, sourcePath, destinationPath: treeOperation === 'MOVE' ? destinationPath : null, message, expectedHeadSha: tree.headSha })
      if (operation === targetOperation.current && previewGeneration === treeOperationPreviewGeneration.current) setTreeOperationPreview(preview)
    } catch (error) {
      if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(user.githubId); return }
      if (operation === targetOperation.current) setTreeOperationError(githubTargetErrorMessage(error, '변경 미리보기를 만들지 못했습니다. 파일 목록을 새로고침한 뒤 다시 시도해 주세요.'))
    } finally { finishTargetOperation(operation) }
  }
  const confirmTreeOperation = async () => {
    if (!treeOperationPreview || !user || !accountSettings.githubInstallationId || !repositoryId || targetBusy) return
    if (!tree?.headSha || !accountSettings.githubBranch || treeOperationPreview.branch !== accountSettings.githubBranch || treeOperationPreview.expectedHeadSha !== tree.headSha) {
      treeOperationPreviewGeneration.current += 1
      setTreeOperationPreview(null)
      setTreeOperationError('브랜치나 파일 목록이 변경됐습니다. 변경 미리보기를 다시 만들어 주세요.')
      return
    }
    const preview = treeOperationPreview
    // A confirmation can be ambiguous after the request leaves the browser.
    // Remove the action immediately so it cannot become a retry affordance.
    treeOperationPreviewGeneration.current += 1
    setTreeOperationPreview(null)
    const operation = ++targetOperation.current
    setTargetBusy(true); setTargetStep('adding'); setTreeOperationError(null); setTreeOperationSuccess(null)
    try {
      const result = await commitGithubTreeOperation(user.githubId, accountSettings.githubInstallationId, repositoryId, preview.previewId)
      if (operation !== targetOperation.current) return
      setTreeOperationSource(''); setTreeOperationDestination(''); setTreeOperationMessage('')
      setTreeOperationSuccess(`커밋 완료 · ${result.commitSha.slice(0, 7)}. 복구가 필요하면 GitHub에서 이 커밋을 되돌리세요.`)
      try { const updated = await getGithubTree(user.githubId, accountSettings.githubInstallationId, repositoryId, accountSettings.githubBranch!, directory?.currentPath ?? ''); if (operation === targetOperation.current) setTree(updated) }
      catch { if (operation === targetOperation.current) { setTree(null); setTreeError('커밋 결과를 확인했지만 파일 목록을 새로 불러오지 못했습니다. GitHub에서 커밋 SHA를 확인해 주세요.') } }
    } catch (error) {
      if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(user.githubId); return }
      if (operation === targetOperation.current) setTreeOperationError(githubTargetErrorMessage(error, '커밋 결과를 확인하지 못했습니다. GitHub에서 변경 여부를 확인하고 다시 시도하지 마세요.'))
    } finally { finishTargetOperation(operation) }
  }
  const loadInstallations = async (preferredInstallationId?: number | null) => {
    if (!user) return
    const githubId = user.githubId
    const operation = ++targetOperation.current
    setTargetBusy(true); setTargetStep('connecting'); clearTargetFeedback()
    try {
      const values = await getGithubInstallations(githubId)
      if (operation !== targetOperation.current) return
      setInstallations(values)
      const preferred = preferredInstallationId && values.some(value => value.id === preferredInstallationId) ? preferredInstallationId : values.length === 1 ? values[0].id : null
      if (preferred) await chooseInstallation(preferred)
      else if (preferredInstallationId) { setTargetError('설치한 GitHub App을 현재 계정에서 확인하지 못했습니다. 다시 연결해 주세요.'); setTargetErrorStep('connecting') }
    } catch (error) {
      if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(githubId); return }
      if (operation === targetOperation.current) { setTargetError(githubTargetErrorMessage(error, 'GitHub 설치를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')); setTargetErrorStep('connecting') }
    } finally { finishTargetOperation(operation) }
  }
  const beginGithubConnection = async () => {
    if (!user) return
    const githubId = user.githubId
    const operation = ++targetOperation.current
    setTargetBusy(true); setTargetStep('connecting'); clearTargetFeedback()
    try {
      const existing = await getGithubInstallations(githubId)
      if (operation !== targetOperation.current) return
      const result = existing.length ? { status: 'AVAILABLE' as const, installations: existing, installUrl: null } : await startGithubInstallation(githubId)
      if (operation !== targetOperation.current) return
      setInstallations(result.installations)
      if (result.status === 'INSTALL_REQUIRED') {
        if (!trustedGithubInstallUrl(result.installUrl)) { setTargetError('안전한 GitHub App 설치 주소를 확인하지 못했습니다.'); setTargetErrorStep('connecting'); return }
        navigateSameTab(result.installUrl)
        return
      }
      const preferred = accountSettings.githubInstallationId && result.installations.some(value => value.id === accountSettings.githubInstallationId) ? accountSettings.githubInstallationId : result.installations.length === 1 ? result.installations[0].id : null
      if (preferred) await chooseInstallation(preferred)
    } catch (error) {
      if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(githubId); return }
      if (operation === targetOperation.current) { setTargetError(githubTargetErrorMessage(error, 'GitHub App 연결을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.')); setTargetErrorStep('connecting') }
    } finally { finishTargetOperation(operation) }
  }
  const initializeEmptyRepository = async () => {
    const installation = accountSettings.githubInstallationId
    const repository = repositoryId
    if (!user || !installation || !repository || !emptyDefaultBranch || !readmePreview || !includeReadme) return
    const githubId = user.githubId
    const operation = ++targetOperation.current
    setTargetBusy(true); setTargetStep('initializing'); clearTargetFeedback()
    try {
      const result = await initializeGithubReadme(githubId, installation, repository)
      if (operation !== targetOperation.current) return
      if (result.defaultBranch !== emptyDefaultBranch) throw new Error('GitHub 기본 브랜치가 변경되었습니다. 저장소를 다시 확인해 주세요.')
      await chooseRepository(repository)
    } catch (error) {
      if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(githubId); return }
      if (operation === targetOperation.current) { setTargetError(githubTargetErrorMessage(error, 'README 초기화 결과를 확인하지 못했습니다. 브랜치를 다시 확인해 주세요.')); setTargetErrorStep('branches') }
    } finally { finishTargetOperation(operation) }
  }
  useEffect(() => { if(!accountSettingsReady||!user||githubInstallReturn?.result!=='success'||!githubInstallReturn.installationId)return;void loadInstallations(githubInstallReturn.installationId) }, [accountSettingsReady,user?.id,githubInstallReturn?.result,githubInstallReturn?.installationId])
  useEffect(() => {
    if (!awaitingRepositoryCreation || !accountSettings.githubInstallationId || !user) return
    const resume = () => {
      setAwaitingRepositoryCreation(false)
      void chooseInstallation(accountSettings.githubInstallationId)
    }
    window.addEventListener('focus', resume)
    return () => window.removeEventListener('focus', resume)
  }, [awaitingRepositoryCreation, accountSettings.githubInstallationId, user?.id])
  const draftTargetConfigured = Boolean(accountSettings.githubInstallationId && accountSettings.githubOwner?.trim() && accountSettings.githubRepository?.trim() && accountSettings.githubBranch?.trim())
  // Match the settings API's root-path validation before offering a selection.
  const browsedRoot = directory?.currentPath ?? ''
  const browsedRootSavable = !browsedRoot || (browsedRoot.length <= 240 && !browsedRoot.includes('..') && !browsedRoot.includes('\\') && !/^[A-Za-z]:/.test(browsedRoot) && !/[\x00-\x1f\x7f]/.test(browsedRoot) && browsedRoot.split('/').every(segment => {
    const base = segment.replace(/\.[^.]*$/, '')
    return !!segment && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)
  }))
  const providerUnavailable = accountSettings.githubStatus === 'PROVIDER_UNAVAILABLE'
  const targetPanelExpanded = draftTargetConfigured || installations.length > 0 || accountSettings.githubInstallationId !== null || targetBusy || targetError !== null
  const targetLoadingText = targetStep === 'connecting' ? '연결 중' : targetStep === 'repositories' ? '저장소 확인 중' : targetStep === 'branches' ? '브랜치 확인 중' : targetStep === 'directories' ? '폴더 확인 중' : targetStep === 'initializing' ? 'README 초기화 중' : targetStep === 'adding' ? '파일 커밋 중' : null
  const targetStateText = targetLoadingText ?? (targetError ? '재시도 필요' : draftTargetConfigured ? '연결 완료' : targetPanelExpanded ? '저장 위치 선택 중' : user ? '연결 필요' : 'GitHub 로그인 필요')
  const githubStatusText = providerUnavailable ? '현재 GitHub App 연결을 사용할 수 없습니다. 서버 설정이 복구된 뒤 다시 시도해 주세요.' : draftTargetConfigured ? '저장하면 선택한 GitHub 대상을 다시 확인합니다.' : 'GitHub App을 연결하고 풀이를 저장할 위치를 선택하세요.'
  const retryTarget = () => {
    if (targetErrorStep === 'repositories' && accountSettings.githubInstallationId) { void chooseInstallation(accountSettings.githubInstallationId); return }
    if (targetErrorStep === 'branches' && repositoryId) { void chooseRepository(repositoryId); return }
    if (targetErrorStep === 'directories' && accountSettings.githubBranch) { void chooseBranch(accountSettings.githubBranch, accountSettings.githubRootPath ?? ''); return }
    void beginGithubConnection()
  }
  return (
    <section className="settings-page">
      <div className="page-heading"><p className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE / {section === 'github' ? 'GITHUB' : 'SETTINGS'}</p><h1>{section === 'github' ? 'GitHub 관리' : '설정'}</h1><p>{section === 'github' ? '저장소와 자동 커밋을 관리합니다.' : '프로필, 코드 저장 및 자동 동기화를 관리합니다.'}</p></div>
      {section === 'github' && user && savedTarget && <GithubRepositoryBrowser githubId={user.githubId} target={savedTarget} lightTheme={accountSettings.lightTheme} darkTheme={accountSettings.darkTheme} codeThemeMode={codeThemeMode} onExpectedAccountChange={onExpectedAccountChange} />}
      {section === 'settings' && <DesktopSettings />}
      {section === 'settings' && <CommunitySettings user={user} ready={accountSettingsReady} duplicateVisibility={accountSettings.communityDuplicateVisibility ?? 'all'} onDuplicateChange={communityDuplicateVisibility => updateAccountSettings({ ...accountSettings, communityDuplicateVisibility })} publicByDefault={accountSettings.communityPublicByDefault ?? true} onChange={communityPublicByDefault => updateAccountSettings({ ...accountSettings, communityPublicByDefault })} onSave={onSaveSettings} saving={settingsBusy} onPublished={onCommunityPublished} onAuthInvalid={onExpectedAccountChange} />}
      <div className={`settings-layout ${section === 'github' ? 'is-github-management' : ''}`}>
        <div className="settings-column">
          {section === 'settings' && <article className="settings-card export-settings"><h2>계정 · 코드 저장</h2>{settingsError && <p role="alert">{settingsError}</p>}<div className="setting-field"><label htmlFor="profile-name">이름</label><input id="profile-name" value={accountSettings.name ?? ''} onChange={e => updateAccountSettings({ ...accountSettings, name: e.target.value || null })} /><label htmlFor="profile-nickname">닉네임</label><input id="profile-nickname" value={accountSettings.nickname ?? ''} onChange={e => updateAccountSettings({ ...accountSettings, nickname: e.target.value || null })} /></div><p>문제 정보 주석을 추가합니다. 원본 코드는 유지합니다.</p>
            <label><input type="checkbox" checked={accountSettings.copyHeader} onChange={e => updateAccountSettings({ ...accountSettings, copyHeader: e.target.checked })} /> 복사할 때 문제 정보 주석 포함</label>
            {accountSettings.copyHeader && <HeaderFieldsPicker label="복사" fields={normalizedHeaderFields(accountSettings.copyHeaderFields)} solution={previewSolution} onChange={copyHeaderFields => updateAccountSettings({ ...accountSettings, copyHeaderFields })} />}
            <label><input type="checkbox" checked={accountSettings.downloadHeader} onChange={e => updateAccountSettings({ ...accountSettings, downloadHeader: e.target.checked })} /> 다운로드할 때 문제 정보 주석 포함</label>
            {accountSettings.downloadHeader && <HeaderFieldsPicker label="다운로드" fields={normalizedHeaderFields(accountSettings.downloadHeaderFields)} solution={previewSolution} onChange={downloadHeaderFields => updateAccountSettings({ ...accountSettings, downloadHeaderFields })} />}
            <div className="setting-field"><TokenTemplateInput id="filename-template" label="다운로드 파일명" maxLength={160} tokens={FILENAME_TOKENS} value={accountSettings.downloadFilenameTemplate} onChange={downloadFilenameTemplate => updateAccountSettings({ ...accountSettings, downloadFilenameTemplate })} /><p>미리보기: <output>{downloadFilename(previewSolution, accountSettings.downloadFilenameTemplate, { name: accountSettings.name, nickname: accountSettings.nickname, id: user?.id })}</output></p></div><CodeThemePreview lightTheme={accountSettings.lightTheme} darkTheme={accountSettings.darkTheme} mode={codeThemeMode} onChange={onCodeThemeChange} />{!extensionRuntime() && <label><input type="checkbox" checked={accountSettings.autoSyncEnabled} onChange={e => { updateAccountSettings({ ...accountSettings, autoSyncEnabled: e.target.checked }); if (!e.target.checked) onAutoSyncDisabled() }} /> 자동 동기화</label>}{!gitPathHasIdentity && <p className="field-error" role="alert">GitHub 관리에서 저장 경로를 수정해야 설정을 저장할 수 있습니다.</p>}<button className="primary-button" onClick={onSaveSettings} disabled={settingsBusy || targetBusy || !gitPathHasIdentity}>{settingsBusy ? '저장 중…' : '설정 저장'}</button>
          </article>}
          {section === 'github' && <article className="settings-card export-settings"><h2>GitHub 자동 커밋</h2>{settingsError && <p role="alert">{settingsError}</p>}<p>자동 커밋할 파일의 경로, 메시지와 주석을 지정합니다.</p>
            <label><input type="checkbox" checked={accountSettings.githubHeader} onChange={e => updateAccountSettings({ ...accountSettings, githubHeader: e.target.checked })} /> GitHub 커밋 시 문제 정보 주석 포함</label>
            {accountSettings.githubHeader && <HeaderFieldsPicker label="GitHub 커밋" fields={normalizedHeaderFields(accountSettings.githubHeaderFields)} solution={previewSolution} onChange={githubHeaderFields => updateAccountSettings({ ...accountSettings, githubHeaderFields })} />}
            <div className="setting-field"><label htmlFor="git-path-template">Git 저장 경로</label><div className="git-path-token-list" aria-label="Git 경로 토큰">{GIT_PATH_TOKENS.map(token => <button type="button" key={token} onClick={() => insertGitPathToken(token)}>{token}</button>)}</div><input ref={gitPathInput} id="git-path-template" maxLength={240} aria-invalid={!gitPathHasIdentity} value={accountSettings.gitPathTemplate} onChange={e => updateAccountSettings({ ...accountSettings, gitPathTemplate: e.target.value })} />{!gitPathHasIdentity && <p className="field-error" role="alert">제출별 파일을 구분하려면 {'{capture_ID}'} 또는 {'{time}'}이 필요합니다.</p>}<p>Git 미리보기: <output>{gitPath(previewSolution, accountSettings.gitPathTemplate, { name: accountSettings.name, nickname: accountSettings.nickname, id: user?.id }) ?? '유효하지 않은 상대 경로'}</output></p><TokenTemplateInput id="github-commit-message-template" label="Git 커밋 메시지" maxLength={200} tokens={COMMIT_MESSAGE_TOKENS} value={accountSettings.githubCommitMessageTemplate} onChange={githubCommitMessageTemplate => updateAccountSettings({ ...accountSettings, githubCommitMessageTemplate })} /><p>커밋 미리보기: <output>{githubCommitMessage(previewSolution, accountSettings.githubCommitMessageTemplate, { name: accountSettings.name, nickname: accountSettings.nickname, id: user?.id })}</output></p></div><label><input type="checkbox" disabled={!draftTargetConfigured || providerUnavailable} checked={accountSettings.githubAutoCommitEnabled} onChange={e => updateAccountSettings({ ...accountSettings, githubAutoCommitEnabled: e.target.checked })} /> GitHub 자동 커밋</label><button className="primary-button" onClick={onSaveSettings} disabled={settingsBusy || targetBusy || !gitPathHasIdentity}>{settingsBusy ? '저장 중…' : '설정 저장'}</button>
          </article>}
          {section === 'github' && <article className={`settings-card github-card ${targetPanelExpanded ? 'is-expanded' : 'is-collapsed'}`} aria-busy={targetBusy}>
            <div className="github-card-heading">
              <div><span className="card-kicker">GITHUB APP</span><h2>GitHub 대상</h2><p>{providerUnavailable ? githubStatusText : savedTarget ? '저장소 연결을 변경하거나 기존 항목을 관리할 수 있습니다.' : githubStatusText}</p></div>
              <span className={`github-target-state ${targetBusy ? 'is-loading' : targetError ? 'is-error' : draftTargetConfigured ? 'is-ready' : ''}`} role="status" aria-live="polite">{targetStateText}</span>
            </div>
            {savedTarget && <button type="button" className="ghost-button github-target-advanced-toggle" aria-expanded={showTargetSetup} onClick={() => setShowTargetSetup(value => !value)}>{showTargetSetup ? '연결 변경·관리 닫기' : '연결 변경·기존 항목 관리'}</button>}
            {(!savedTarget || showTargetSetup) && (!targetPanelExpanded ? (
              <div className="github-connect-cta">
                <Icon name="github" size={24} />
                <strong>풀이를 저장할 GitHub 위치를 연결하세요</strong>
                <span>GitHub App 설치부터 저장소·브랜치·폴더 선택까지 한 번에 진행합니다.</span>
                <button type="button" className="primary-button github-connect-button" onClick={() => void beginGithubConnection()} disabled={!user || providerUnavailable}>GitHub 연결 및 저장 위치 선택 <Icon name="chevron" size={14} /></button>
              </div>
            ) : (
              <div className="github-target-panel">
                <div className="github-target-toolbar"><button type="button" className="ghost-button" onClick={() => void beginGithubConnection()} disabled={!user || targetBusy || providerUnavailable}>{draftTargetConfigured ? '저장 위치 다시 선택' : 'GitHub 연결 다시 확인'}</button></div>
                {targetError && <div className="github-target-feedback is-error" role="alert"><div><strong>재시도 필요</strong><p>{targetError}</p></div><button type="button" className="ghost-button" onClick={retryTarget} disabled={targetBusy}>이 단계 다시 시도</button></div>}
                <div className="github-target-steps">
                  <label><span><b>1</b> GitHub 설치</span><select aria-label="GitHub 설치" disabled={targetBusy} value={accountSettings.githubInstallationId ?? ''} onChange={event => void chooseInstallation(event.target.value ? Number(event.target.value) : null)}><option value="">선택하세요</option>{installations.map(value => <option key={value.id} value={value.id}>{value.accountLogin}</option>)}</select></label>
                  {accountSettings.githubInstallationId && <>
                    <label><span><b>2</b> 저장소</span><select aria-label="저장소" disabled={targetBusy} value={repositoryId ?? ''} onChange={event => void chooseRepository(event.target.value ? Number(event.target.value) : null)}><option value="">선택하세요</option>{repositories.map(value => <option key={value.id} value={value.id}>{value.fullName}</option>)}</select>{repositoriesLoaded && repositories.length === 0 && <small role="status">이 설치에서 선택할 수 있는 저장소가 없습니다. 새 저장소를 만든 경우 목록을 새로고침하고 GitHub App의 접근 권한을 확인하세요.</small>}</label>
                    <div className="github-create-guide">
                      <button type="button" className="ghost-button" disabled={targetBusy} onClick={() => setCreateGuideOpen(!createGuideOpen)} aria-expanded={createGuideOpen}>새 저장소 만들기</button>
                      {createGuideOpen && <div className="github-create-guide-body"><p>GitHub에서 이름, 공개 범위, 설명을 선택해 저장소를 만드세요. CodeArchive README를 추가하려면 GitHub의 README 초기화는 선택하지 말고, 생성 후 여기서 저장소를 선택하세요.</p><p>GitHub App을 일부 저장소에만 설치했다면 새 저장소 접근 권한도 추가해야 합니다.</p><div><a href="https://github.com/new" target="_blank" rel="noopener noreferrer" onClick={() => setAwaitingRepositoryCreation(true)}>GitHub에서 저장소 만들기</a><a href="https://github.com/settings/installations" target="_blank" rel="noopener noreferrer">App 접근 권한 확인</a><button type="button" className="ghost-button" disabled={targetBusy} onClick={() => void chooseInstallation(accountSettings.githubInstallationId)}>저장소 목록 새로고침</button></div></div>}
                    </div>
                  </>}
                  {repositoryId && <>
                    <label><span><b>3</b> 브랜치</span><select aria-label="브랜치" disabled={targetBusy} value={accountSettings.githubBranch ?? ''} onChange={event => void chooseBranch(event.target.value)}><option value="">선택하세요</option>{branches.map(value => <option key={value.name} value={value.name}>{value.name}{value.protectedBranch ? ' (보호됨)' : ''}</option>)}{emptyDefaultBranch && !includeReadme && <option value={emptyDefaultBranch}>{emptyDefaultBranch} (첫 풀이 커밋 시 생성)</option>}</select>{branchesLoaded && branches.length === 0 && <small role="status">브랜치가 없습니다. {emptyDefaultBranch ? '비어 있는 저장소입니다.' : '저장소 상태를 확인하지 못했습니다. 다시 시도해 주세요.'}</small>}</label>
                    {branchesLoaded && branches.length === 0 && emptyDefaultBranch && <div className="github-empty-repository"><strong>비어 있는 저장소 시작하기</strong><label><input type="checkbox" checked={includeReadme} onChange={event => setIncludeReadme(event.target.checked)} /> CodeArchive README 추가</label>{includeReadme ? <><pre aria-label="README 미리보기">{readmePreview}</pre><button type="button" className="primary-button" disabled={targetBusy || !readmePreview} onClick={() => void initializeEmptyRepository()}>README로 초기화</button></> : <p>첫 풀이가 성공적으로 커밋될 때 기본 브랜치가 생성됩니다. 위 브랜치를 선택하고 저장하세요.</p>}</div>}
                  </>}
                  {directory && <div className="github-directory"><span><b>4</b> 폴더</span><p>둘러보는 폴더 <strong>{directory.currentPath || '/'}</strong></p><p>선택한 저장 위치 <strong>{accountSettings.githubRootPath || '/'}</strong></p><div>{directory.currentPath && <button type="button" onClick={() => void chooseBranch(accountSettings.githubBranch!, directory.parentPath, false)} disabled={targetBusy}>상위 폴더</button>}{!tree && directory.directories.map(name => <button type="button" key={name} onClick={() => void chooseBranch(accountSettings.githubBranch!, directory.currentPath ? `${directory.currentPath}/${name}` : name, false)} disabled={targetBusy}>{name}/</button>)}</div><button type="button" className="github-select-directory" disabled={targetBusy || !!treeError || !tree || !browsedRootSavable || accountSettings.githubRootPath === (directory.currentPath || null)} onClick={() => updateAccountSettings({ ...accountSettings, githubRootPath: directory.currentPath || null, githubAutoCommitEnabled: false })}>이 폴더를 저장 위치로 선택</button>{!browsedRootSavable && <small role="status">이 폴더는 살펴볼 수 있지만 자동 커밋 위치로 저장할 수 없습니다.</small>}<small>선택한 위치를 적용하려면 아래의 설정 저장을 누르세요.</small></div>}
                  {directory && <div className="github-tree"><strong>파일·폴더 구조</strong>{treeError && <p role="alert">{treeError} <button type="button" onClick={() => void chooseBranch(accountSettings.githubBranch!, directory.currentPath, false)} disabled={targetBusy}>다시 확인</button></p>}{tree && <><ul>{tree.items.map(entry => <li key={`${entry.path}:${entry.type}`} className={entry.type === 'tree' && accountSettings.githubRootPath === entry.path ? 'is-selected' : ''}>{entry.type === 'tree' ? <button type="button" aria-current={accountSettings.githubRootPath === entry.path ? 'location' : undefined} disabled={targetBusy || !/^[A-Za-z0-9_.-]+$/.test(entry.name)} onClick={() => void chooseBranch(accountSettings.githubBranch!, entry.path, false)}>{entry.name}/</button> : <span>{entry.name}{entry.type === 'commit' ? ' (서브모듈)' : ''}</span>}</li>)}</ul>{tree.items.length === 0 && <p>이 폴더에 파일이 없습니다.</p>}{tree.hasMore && <button type="button" className="ghost-button" disabled={targetBusy} onClick={() => void loadMoreTree()}>파일 더 보기</button>}{tree.truncated && <p role="status">GitHub가 일부 항목만 반환했습니다. 더 작은 하위 폴더에서 확인해 주세요.</p>}</>}</div>}
                  {directory && tree?.headSha && <div className="github-add-file">
                    <strong>이 폴더에 새 항목 추가</strong>
                    <div className="github-add-mode" role="group" aria-label="추가할 항목"><button type="button" aria-pressed={additionMode === 'file'} onClick={() => { setAdditionMode('file'); setAdditionPreview(null); setAdditionError(null); setAdditionSuccess(null) }}>파일</button><button type="button" aria-pressed={additionMode === 'folder'} onClick={() => { setAdditionMode('folder'); setAdditionPreview(null); setAdditionError(null); setAdditionSuccess(null) }}>폴더</button></div>
                    <label>이름<input aria-label={additionMode === 'file' ? '새 파일 이름' : '새 폴더 이름'} maxLength={100} value={additionName} onChange={event => { setAdditionName(event.target.value); setAdditionPreview(null); setAdditionError(null); setAdditionSuccess(null) }} /></label>
                    {additionMode === 'file' ? <label>파일 내용<textarea aria-label="새 파일 내용" value={additionContent} onChange={event => { setAdditionContent(event.target.value); setAdditionPreview(null); setAdditionError(null); setAdditionSuccess(null) }} rows={5} /></label> : <p>Git은 빈 폴더를 저장하지 못합니다. 확인하면 새 폴더에 빈 .gitkeep 파일을 만듭니다.</p>}
                    <label>커밋 메시지<input aria-label="새 항목 커밋 메시지" maxLength={200} placeholder="비워두면 Add 경로 사용" value={additionMessage} onChange={event => { setAdditionMessage(event.target.value); setAdditionPreview(null); setAdditionError(null); setAdditionSuccess(null) }} /></label>
                    <button type="button" className="ghost-button" disabled={targetBusy || !!treeError || tree.hasMore || tree.truncated} onClick={previewAddition}>변경 미리보기</button>
                    {additionError && <p role="alert">{additionError}</p>}{additionSuccess && <p role="status">{additionSuccess}</p>}
                    {additionPreview && <div className="github-add-preview"><strong>추가될 변경 (미리보기)</strong><p>브랜치: {additionPreview.branch} · 기준 HEAD: {additionPreview.expectedHeadSha.slice(0, 7)}</p><p>새 파일: {additionPreview.path}</p><p>커밋: {additionPreview.message}</p><pre aria-label="추가 파일 diff">{additionPreview.placeholder ? '+ (빈 .gitkeep 파일)' : additionPreview.content.split('\n').map(line => `+${line}`).join('\n')}</pre><button type="button" className="primary-button" disabled={targetBusy} onClick={() => void confirmAddition()}>이 변경을 커밋</button></div>}
                  </div>}
                  {directory && tree?.headSha && <div className="github-tree-operation">
                    <strong>기존 항목 이동·삭제</strong><p>선택만으로는 변경되지 않습니다. GitHub에서 전체 변경을 다시 확인한 뒤 별도로 커밋을 확인합니다.</p>
                    <div className="github-add-mode" role="group" aria-label="기존 항목 작업"><button type="button" aria-pressed={treeOperation === 'MOVE'} onClick={() => { setTreeOperation('MOVE'); clearTreeOperationPreview() }}>이동</button><button type="button" aria-pressed={treeOperation === 'DELETE'} onClick={() => { setTreeOperation('DELETE'); clearTreeOperationPreview() }}>삭제</button></div>
                    <label>원본 경로<input aria-label="이동 또는 삭제할 원본 경로" maxLength={1024} value={treeOperationSource} onChange={event => { setTreeOperationSource(event.target.value); clearTreeOperationPreview() }} placeholder="src/Old.java" /></label>
                    {treeOperation === 'MOVE' && <label>새 경로<input aria-label="이동할 새 경로" maxLength={1024} value={treeOperationDestination} onChange={event => { setTreeOperationDestination(event.target.value); clearTreeOperationPreview() }} placeholder="archive/Old.java" /></label>}
                    <label>커밋 메시지<input aria-label="이동 또는 삭제 커밋 메시지" maxLength={200} value={treeOperationMessage} onChange={event => { setTreeOperationMessage(event.target.value); clearTreeOperationPreview() }} placeholder="비워두면 작업 경로 사용" /></label>
                    <button type="button" aria-label="기존 항목 변경 미리보기" className="ghost-button" disabled={targetBusy || !!treeError || tree.hasMore || tree.truncated} onClick={() => void previewTreeOperation()}>변경 미리보기</button>
                    {treeOperationError && <p role="alert">{treeOperationError}</p>}{treeOperationSuccess && <p role="status">{treeOperationSuccess}</p>}
                    {treeOperationPreview && <div className="github-add-preview"><strong>{treeOperationPreview.operation === 'MOVE' ? '이동' : '삭제'}될 변경 (미리보기)</strong><p>브랜치: {treeOperationPreview.branch} · 기준 HEAD: {treeOperationPreview.expectedHeadSha.slice(0, 7)}</p><p>파일 {treeOperationPreview.changes.length}개 · 원본: {treeOperationPreview.sourcePath}{treeOperationPreview.destinationPath ? ` → ${treeOperationPreview.destinationPath}` : ''}</p><pre aria-label="이동 또는 삭제 변경 경로">{treeOperationPreview.changes.map(change => `${change.fromPath}${change.toPath ? ` → ${change.toPath}` : ' 삭제'}`).join('\n')}</pre><button type="button" className="primary-button" disabled={targetBusy} onClick={() => void confirmTreeOperation()}>이 변경을 커밋</button></div>}
                  </div>}
                </div>
                {draftTargetConfigured && <div className="github-target-current"><Icon name="check" size={15} /><span><strong>현재 대상</strong>{accountSettings.githubOwner}/{accountSettings.githubRepository} · {accountSettings.githubBranch}{accountSettings.githubRootPath ? `/${accountSettings.githubRootPath}` : ''}</span></div>}
              </div>
            ))}
            {targetBusy && <div className="github-target-overlay" role="status" aria-live="assertive"><Icon name="sync" size={20} /><strong>{targetLoadingText}</strong><span>GitHub에서 안전하게 확인하고 있습니다.</span></div>}
          </article>}
        </div>
        {section === 'settings' && <aside className="settings-sidebar"><article className="account-card"><span className="card-kicker">ACCOUNT</span>{user ? <><div className="account-large"><ProfileAvatar user={user} large /><div><strong>{displayUser(user)}</strong><span>@{user.githubLogin} · CodeArchive 계정</span></div></div><button className="wide-ghost-button" onClick={onLogout}><Icon name="logout" size={14} /> 로그아웃</button></> : <><div className="account-logged-out"><div className="logged-out-icon"><Icon name="user" size={18} /></div><strong>로그인이 필요합니다</strong><span>내 풀이를 저장하고 동기화하세요.</span></div><button className="primary-button wide" onClick={onLogin}>GitHub로 로그인 <Icon name="github" size={14} /></button></>}</article><article className="privacy-card"><Icon name="check" size={16} /><div><strong>데이터를 직접 통제하세요</strong><p>로그인 후 새 정답 제출은 자동 동기화됩니다. 과거에 수집한 풀이는 일괄 동기화 탭에서 직접 전송합니다.</p></div></article></aside>}
      </div>
    </section>
  )
}

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 3800)
    return () => window.clearTimeout(timer)
  }, [onClose, toast.id])
  return <div className={`toast ${toast.kind}`} role="status"><span className="toast-icon"><Icon name={toast.kind === 'success' ? 'check' : toast.kind === 'error' ? 'close' : 'spark'} size={15} /></span><span>{toast.message}</span><button onClick={onClose} aria-label="알림 닫기"><Icon name="close" size={14} /></button></div>
}
