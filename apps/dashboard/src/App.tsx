import { useEffect, useMemo, useRef, useState } from 'react'
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
import { ApiError, bulkUpload, getAccountSettings, getMe, getSolutions, issueRelayGrant, logout, revokeRelayGrant, updateAccountSettings, getGithubInstallations, startGithubInstallation, getGithubRepositories, getGithubBranches, getGithubDirectories } from './api'
import { BridgeError, parseAckResponse, parseBridgeStatusResponse, parseConnectResponse, parsePendingResponse, parseRelayReuseResponse, relayHandoffKey, requestBridge } from './bridge'
import { requestIsCurrent, type RequestFence } from './requestFence'
import { acceptedIdsForAck } from './syncLogic'
import { DARK_THEMES, GITHUB_LOGIN_URL, LIGHT_THEMES, type AccountSettings, type BulkResponse, type Solution, type Toast, type User, type ViewName } from './types'
import { CodeBlock } from './CodeBlock'
import { EXTENSION_ID, LEGACY_EXTENSION_ID, EXTENSION_CANDIDATES } from './extensionConfig'
import { readExportSettings, EXPORT_SETTINGS_KEY, exportCode, downloadFilename, githubCommitMessage, gitPath, sourceFileExtension, DEFAULT_DOWNLOAD_FILENAME_TEMPLATE, DEFAULT_GITHUB_COMMIT_MESSAGE_TEMPLATE, DEFAULT_GIT_PATH_TEMPLATE, GIT_PATH_TOKENS, hasGitSubmissionIdentityToken, type ExportSettings } from './codeExport'
import { navigateSameTab } from './navigation'
import './styles.css'
import { canonicalLanguageDisplayName, canonicalLanguageKey } from '../../../shared/language'
import { filterAndSortSolutions, groupSolutions, type SolutionGroup, type SolutionSort } from './solutionQuery'
import { BUILD_METADATA, buildLabel, updatedLabel } from '../../../shared/buildMetadata'
import { EXTENSION_RELEASE, fetchLatestExtensionRelease, isVersionAtLeast, type ExtensionReleaseInfo } from './extensionRelease'
import { formatExecutionTime, formatMemory } from './performancePresentation'

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
  return {
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
  }
}

function formatDate(value?: string) {
  if (!value) return '기록 없음'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(date)
}

function formatObservedTime(value?: string) {
  if (!value) return '기록 없음'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}



function displayUser(user: User) {
  const name = user.name?.trim()
  return name ? `${name} (@${user.githubLogin})` : `@${user.githubLogin}`
}

const LOCAL_THEME_KEY = 'codearchive-local-code-themes'
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
const defaultAccountSettings = (): AccountSettings => ({ version: 0, name: null, nickname: null, copyHeader: false, downloadHeader: false, githubHeader: false, downloadFilenameTemplate: DEFAULT_DOWNLOAD_FILENAME_TEMPLATE, gitPathTemplate: DEFAULT_GIT_PATH_TEMPLATE, githubCommitMessageTemplate: DEFAULT_GITHUB_COMMIT_MESSAGE_TEMPLATE, ...readLocalThemes(), autoSyncEnabled: false, githubAutoCommitEnabled: false, githubTargetConfigured: false, githubStatus: 'TARGET_MISSING', githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null })
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
  const [githubInstallReturn] = useState(readGithubInstallReturn)
  const [view, setView] = useState<ViewName>(() => readGithubInstallReturn() ? 'settings' : 'solutions')
  const [mode, setMode] = useState<'local' | 'live'>('local')
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
  const [solutionSort, setSolutionSort] = useState<SolutionSort>('latest')
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
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [bridgeCapability, setBridgeCapability] = useState<string | null>(null)
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [pendingCountState, setPendingCountState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [lastSyncState, setLastSyncState] = useState<'idle' | 'success' | 'partial' | 'failed'>('idle')
  const [syncing, setSyncing] = useState(false)
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
          updateExportSettings({ copyHeader: saved.copyHeader, downloadHeader: saved.downloadHeader, filenameTemplate: saved.downloadFilenameTemplate, gitPathTemplate: saved.gitPathTemplate })
          await configureRelay(saved, account, generation)
        }
      } catch (error) {
        if (queueGeneration !== themeQueueGeneration.current || generation !== accountGeneration.current || userRef.current?.id !== account.id) return
        const message = error instanceof Error ? error.message : '코드 보기 테마를 저장하지 못했습니다.'
        setSettingsError(message)
      } finally { if (queueGeneration === themeQueueGeneration.current) themeSaving.current = false }
    })()
  }

  const showToast = (kind: Toast['kind'], message: string) => {
    toastId.current += 1
    setToast({ id: toastId.current, kind, message })
  }

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
    if (!user) { settingsLoadedRef.current = null; updateAccountSettingsDraft(defaultAccountSettings()); return }
    let active = true
    const generation = accountGeneration.current
    const loadingFor = user
    const stillCurrent = () => active && generation === accountGeneration.current && userRef.current?.id === loadingFor.id
    settingsLoadedRef.current = null
    void Promise.resolve(getAccountSettings(loadingFor.githubId)).then(serverResponse => {
      if (!stillCurrent()) return
      const server = { ...serverResponse, githubCommitMessageTemplate: serverResponse.githubCommitMessageTemplate || DEFAULT_GITHUB_COMMIT_MESSAGE_TEMPLATE }
      // One-way migration: old browser-only export choices only seed the first
      // server version, and never overwrite an existing account preference.
      const migrated = server.version === 0 && !server.copyHeader && !server.downloadHeader && server.downloadFilenameTemplate === '{platform}-{number}-{title}'
        ? { ...server, copyHeader: exportSettings.copyHeader, downloadHeader: exportSettings.downloadHeader, downloadFilenameTemplate: exportSettings.filenameTemplate, gitPathTemplate: exportSettings.gitPathTemplate ?? server.gitPathTemplate }
        : server
      relayHandoffOperation.current += 1
      accountSettingsRef.current = migrated
      setAccountSettings(migrated)
      setExportSettings({ copyHeader: migrated.copyHeader, downloadHeader: migrated.downloadHeader, filenameTemplate: migrated.downloadFilenameTemplate, gitPathTemplate: migrated.gitPathTemplate })
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
    return filterAndSortSolutions(solutions, { query, platform: platformFilter, languageKey: languageFilter, sort: solutionSort })
  }, [languageFilter, platformFilter, query, solutionSort, solutions])

  const solutionGroups = useMemo(() => groupSolutions(filteredSolutions), [filteredSolutions])

  useEffect(() => {
    if (!filteredSolutions.some((solution) => solution.captureId === selectedId)) {
      setSelectedId(solutionGroups[0]?.submissions[0]?.captureId ?? '')
    }
  }, [filteredSolutions, selectedId, solutionGroups])

  const selectedGroup = solutionGroups.find((group) => group.submissions.some((solution) => solution.captureId === selectedId)) ?? solutionGroups[0] ?? null
  const selectedSolution = selectedGroup?.submissions.find((solution) => solution.captureId === selectedId) ?? selectedGroup?.submissions[0] ?? null

  const changeView = (nextView: ViewName) => {
    setView(nextView)
    setMobileNavOpen(false)
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
        await resetBridge()
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
    // B. If A is still current, sever every authority before asking to reconnect.
    if (userRef.current?.githubId !== expectedGithubId) return true
    await resetBridge()
    if (userRef.current?.githubId !== expectedGithubId) return true
    clearAccountDraft()
    setUser(null)
    setMode('local')
    setSolutions([])
    setSelectedId('')
    setView('solutions')
    setLoadError('GitHub 계정이 변경되었습니다. 다시 연결해 주세요.')
    showToast('info', 'GitHub 계정이 변경되었습니다. 다시 연결해 주세요.')
    return true
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
          const { capability, version } = parseConnectResponse(await requestBridge(candidate, { type: 'CONNECT' }))
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
      const saved = await updateAccountSettings(savingDraft, savingFor.githubId)
      if (stillCurrent()) {
        relayHandoffOperation.current += 1
        accountSettingsRef.current = saved
        settingsLoadedRef.current = { accountId: savingFor.id, generation, version: saved.version }
        relayHandoffRef.current = null
        setAccountSettings(saved)
        updateExportSettings({ copyHeader: saved.copyHeader, downloadHeader: saved.downloadHeader, filenameTemplate: saved.downloadFilenameTemplate, gitPathTemplate: saved.gitPathTemplate })
        await configureRelay(saved, savingFor, generation)
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
      await navigator.clipboard.writeText(exportCode(selectedSolution, exportSettings.copyHeader))
      showToast('success', '코드를 클립보드에 복사했습니다.')
    } catch {
      showToast('error', '클립보드에 복사하지 못했습니다.')
    }
  }

  const downloadCode = () => {
    if (!selectedSolution) return
    const objectUrl = URL.createObjectURL(new Blob([exportCode(selectedSolution, exportSettings.downloadHeader)], { type: 'text/plain;charset=utf-8' }))
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
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => changeView('solutions')} aria-label="CodeArchive 홈">
            <span className="brand-mark">B</span>
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
            <button className={view === 'guide' ? 'nav-item active' : 'nav-item'} onClick={() => changeView('guide')}>
              연동 가이드
            </button>
            <button className={view === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => changeView('settings')}>
              설정
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
            {extensionUpdateRequired && <button className="banner-secondary update-extension" onClick={() => changeView('guide')}>확장 업데이트</button>}
            {bridgeStatus === 'disconnected' && <button className="banner-secondary" onClick={() => void connectBridge()} disabled={loading}>확장 재연결</button>}
            {mode === 'live' && user && <button className="server-refresh" onClick={() => void refreshSolutions(undefined, user.githubId)} disabled={loading} title="서버 아카이브 목록을 다시 읽습니다."><Icon name="refresh" size={14} /> 서버 목록 새로고침</button>}
          </div>
        </section>
        {loadError && (
          <section className="load-error" role="alert"><Icon name="close" size={17} /><span>{loadError}</span><button onClick={() => setLoadError(null)} aria-label="오류 닫기"><Icon name="close" size={15} /></button></section>
        )}

        {view === 'solutions' && (
          <SolutionsView
            solutions={solutions}
            filteredSolutions={filteredSolutions}
            solutionGroups={solutionGroups}
            selectedSolution={selectedSolution}
            selectedGroup={selectedGroup}
            selectedId={selectedId}
            query={query}
            platformFilter={platformFilter}
            languageFilter={languageFilter}
            languages={languages}
            solutionSort={solutionSort}
            loading={loading}
            mode={mode}
            setQuery={setQuery}
            setPlatformFilter={setPlatformFilter}
            setLanguageFilter={setLanguageFilter}
            setSolutionSort={setSolutionSort}
            setSelectedId={setSelectedId}
            onCopy={copyCode}
            onDownload={downloadCode}
            lightTheme={accountSettings.lightTheme}
            darkTheme={accountSettings.darkTheme}
            onLightThemeChange={(lightTheme) => updateCodeThemes({ lightTheme, darkTheme: accountSettingsRef.current.darkTheme })}
            onDarkThemeChange={(darkTheme) => updateCodeThemes({ lightTheme: accountSettingsRef.current.lightTheme, darkTheme })}
          />
        )}
        {view === 'guide' && (
          <GuideView onSettings={() => changeView('settings')} />
        )}
        {view === 'settings' && (
          <SettingsView key={user?.id ?? 'local'}
            user={user}
            exportSettings={exportSettings}
            updateExportSettings={updateExportSettings}
            accountSettings={accountSettings}
            updateAccountSettings={updateAccountSettingsDraft}
            settingsBusy={settingsBusy}
            settingsError={settingsError}
            onSaveSettings={() => void saveAccountSettings()}
            onAutoSyncDisabled={clearRelay}
            previewSolution={selectedSolution ?? { captureId: 'preview', platform: 'SWEA', problemNumber: '0000', title: '미리보기', problemUrl: '#', language: 'Java', sourceCode: '', result: 'ACCEPTED' }}
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
          <span className="footer-brand"><span className="footer-mark">B</span> CodeArchive</span>
          <span>풀이를 모으고, 다시 푸는 흐름을 가볍게</span>
          <span className="footer-version" title={`Updated ${BUILD_METADATA.updatedDate}`}>{buildLabel()}</span>
        </div>
      </footer>

      {toast && <ToastView toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

function SolutionsView({
  solutions,
  filteredSolutions,
  solutionGroups,
  selectedSolution,
  selectedGroup,
  selectedId,
  query,
  platformFilter,
  languageFilter,
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
  onLightThemeChange,
  onDarkThemeChange,
}: {
  solutions: Solution[]
  filteredSolutions: Solution[]
  solutionGroups: SolutionGroup[]
  selectedSolution: Solution | null
  selectedGroup: SolutionGroup | null
  selectedId: string
  query: string
  platformFilter: 'ALL' | 'SWEA' | 'PROGRAMMERS' | 'JUNGOL'
  languageFilter: string
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
  onLightThemeChange: (theme: AccountSettings['lightTheme']) => void
  onDarkThemeChange: (theme: AccountSettings['darkTheme']) => void
}) {
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
        {(query || platformFilter !== 'ALL' || languageFilter !== 'ALL') && <button className="filter-reset" onClick={() => { setQuery(''); setPlatformFilter('ALL'); setLanguageFilter('ALL') }}><Icon name="close" size={13} /> 필터 초기화</button>}
      </div>

      <div className="content-grid">
        <section className="solution-list-panel" aria-label="풀이 목록">
          <div className="panel-heading">
            <div><span className="panel-title">풀이 목록</span><span className="panel-count">{filteredSolutions.length}</span></div>
            <label className="panel-sort">정렬 <select aria-label="풀이 정렬" value={solutionSort} onChange={(event) => setSolutionSort(event.target.value as SolutionSort)}><option value="latest">최신 저장순</option><option value="oldest">오래된 저장순</option><option value="problem">문제 번호순</option><option value="title">문제 제목순</option></select></label>
          </div>
          <div className="solution-list">
            {loading && <ListSkeleton />}
            {!loading && solutionGroups.length === 0 && <EmptyList mode={mode} />}
            {!loading && solutionGroups.map((group) => (
              <SolutionGroupRow key={group.key} group={group} selected={group.key === selectedGroup?.key} onSelect={() => setSelectedId(group.submissions[0]!.captureId)} />
            ))}
          </div>
          <div className="list-footer"><span><span className="status-dot" /> {mode === 'local' ? '로컬 기록 · 업로드 전' : '서버와 연결됨'}</span><span>{filteredSolutions.length} / {solutions.length}</span></div>
        </section>
        <SolutionDetail solution={selectedSolution} group={selectedGroup} onSelectSubmission={setSelectedId} mode={mode} onCopy={onCopy} onDownload={onDownload} lightTheme={lightTheme} darkTheme={darkTheme} onLightThemeChange={onLightThemeChange} onDarkThemeChange={onDarkThemeChange} />
      </div>
    </section>
  )
}

function SolutionGroupRow({ group, selected, onSelect }: { group: SolutionGroup; selected: boolean; onSelect: () => void }) {
  const latest = group.submissions[0]!
  const languageLabels = Array.from(new Set(group.submissions.map(solution => canonicalLanguageDisplayName(solution.language)))).join(', ')
  return (
    <button className={`solution-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <span className={`platform-logo ${group.platform === 'SWEA' ? 'swea' : group.platform === 'JUNGOL' ? 'jungol' : 'programmers'}`}>{group.platform === 'SWEA' ? 'S' : group.platform === 'JUNGOL' ? 'J' : 'P'}</span>
      <span className="solution-row-main">
        <span className="solution-row-top"><span className="solution-platform">{group.platform}</span><span className="solution-result">풀이 {group.submissions.length}개</span></span>
        <span className="solution-title">{group.title}</span>
        <span className="solution-row-bottom"><span>#{group.problemNumber}</span><span className="row-divider" /><span>{languageLabels}</span><span className="row-time"><Icon name="clock" size={12} /> {formatDate(latest.solvedAt ?? latest.observedAt)}</span></span>
      </span>
      <Icon name="chevron" size={17} />
    </button>
  )
}

function SolutionDetail({ solution, group, onSelectSubmission, mode, onCopy, onDownload, lightTheme, darkTheme, onLightThemeChange, onDarkThemeChange }: { solution: Solution | null; group: SolutionGroup | null; onSelectSubmission: (captureId: string) => void; mode: 'local' | 'live'; onCopy: () => void; onDownload: () => void; lightTheme: AccountSettings['lightTheme']; darkTheme: AccountSettings['darkTheme']; onLightThemeChange: (theme: AccountSettings['lightTheme']) => void; onDarkThemeChange: (theme: AccountSettings['darkTheme']) => void }) {
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
              <div className="detail-subline"><span>{canonicalLanguageDisplayName(solution.language)}</span><span className="row-divider" /><span>풀이 시간 {formatObservedTime(solution.solvedAt ?? solution.observedAt)}</span></div>
            </div>
            <a className="problem-link" href={solution.problemUrl} target="_blank" rel="noreferrer">문제 보기 <Icon name="external" size={14} /></a>
          </div>
          <div className="metrics-row">
            <MetricCard label="실행 시간" value={formatExecutionTime(solution.executionTime)} icon="clock" />
            <MetricCard label="메모리 사용량" value={formatMemory(solution)} icon="spark" />
            <MetricCard label="풀이 시간" value={formatObservedTime(solution.solvedAt ?? solution.observedAt)} icon="check" />
          </div>
          {group && group.submissions.length > 1 && <label className="submission-picker">제출 기록<select aria-label="제출 기록" value={solution.captureId} onChange={(event) => onSelectSubmission(event.target.value)}>{group.submissions.map((submission, index) => <option key={submission.captureId} value={submission.captureId}>{index + 1}. {formatObservedTime(submission.solvedAt ?? submission.observedAt)} · {canonicalLanguageDisplayName(submission.language)}</option>)}</select></label>}
          <div className="code-toolbar"><div className="code-toolbar-title"><Icon name="code" size={16} /> 소스 코드 <span>{sourceFileExtension(solution.language)}</span></div><div className="code-actions"><button onClick={onCopy}><Icon name="copy" size={14} /> 복사</button><button onClick={onDownload}><Icon name="download" size={14} /> 다운로드</button></div></div>
          <CodeBlock code={solution.sourceCode} language={solution.language} lightTheme={lightTheme} darkTheme={darkTheme} onLightThemeChange={onLightThemeChange} onDarkThemeChange={onDarkThemeChange} />
          <div className="detail-note"><Icon name="spark" size={14} /><span>{mode === 'local' ? '이 브라우저의 로컬 기록입니다. 로그인 후 명시적으로 동기화할 수 있습니다.' : '이 기록은 연결된 확장 프로그램에서 관측한 제출 결과를 바탕으로 합니다.'}</span></div>
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

function GuideView({ onSettings }: { onSettings: () => void }) {
  const [latestRelease, setLatestRelease] = useState<ExtensionReleaseInfo | null>(null)
  const [releaseState, setReleaseState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  useEffect(() => {
    let active = true
    void fetchLatestExtensionRelease()
      .then((metadata) => { if (active) { setLatestRelease(metadata); setReleaseState('ready') } })
      .catch(() => { if (active) setReleaseState('unavailable') })
    return () => { active = false }
  }, [])
  const dashboardCompatible = latestRelease
    ? isVersionAtLeast(BUILD_METADATA.version, latestRelease.compatibility.minimumDashboardVersion)
    : false
  return (
    <section className="guide-page">
      <div className="page-heading"><p className="eyebrow"><span className="eyebrow-dot" /> GET STARTED / BRIDGE</p><h1>연동 가이드</h1><p>설치부터 첫 PASS 저장, 자동 동기화와 GitHub 커밋 확인까지 순서대로 진행합니다.</p></div>
      <div className="guide-grid">
        <article className="guide-card guide-hero"><div className="guide-hero-icon"><Icon name="link" size={25} /></div><div><span className="card-kicker">CODEARCHIVE BRIDGE</span><h2>PASS 한 번으로 저장 흐름을 확인하세요</h2><p>풀이는 먼저 브라우저에 저장됩니다. 자동 동기화를 켜면 대시보드를 닫아도 릴레이가 대기 중인 풀이를 서버로 전송하고, 설정에 따라 GitHub 커밋까지 요청합니다.</p></div><button className="primary-button" onClick={onSettings}>설정 열기 <Icon name="chevron" size={14} /></button></article>
        <article className="guide-card extension-release-card">
          <div className="release-heading"><div><span className="card-kicker">BETA DISTRIBUTION</span><h2>검증된 확장 프로그램 받기</h2></div><span className={`release-state is-${releaseState}`}>{releaseState === 'loading' ? '확인 중' : releaseState === 'ready' ? `v${latestRelease?.version}` : '릴리스 준비 중'}</span></div>
          <p>Chrome Web Store 출시 전에는 ZIP을 내려받아 개발자 모드에서 직접 로드합니다. 웹사이트가 확장을 자동 설치하거나 업데이트할 수는 없습니다.</p>
          {latestRelease && <dl className="release-meta"><div><dt>업데이트</dt><dd>{latestRelease.releasedAt}</dd></div><div><dt>Chrome</dt><dd>v{latestRelease.minimumChromeVersion}+</dd></div><div><dt>확장 ID</dt><dd>{latestRelease.extensionId}</dd></div></dl>}
          {latestRelease && <div className="release-checksum"><span>SHA-256</span><code>{latestRelease.artifact.sha256}</code></div>}
          {latestRelease && !dashboardCompatible && <p className="release-warning">이 대시보드 버전과 호환되지 않습니다. 대시보드를 먼저 업데이트해 주세요.</p>}
          <div className="release-actions">
            {releaseState === 'ready' && dashboardCompatible && latestRelease
              ? <a className="primary-button" href={latestRelease.downloadUrl}>확장 ZIP 다운로드 <Icon name="download" size={14} /></a>
              : <span className="primary-button is-disabled" aria-disabled="true">{releaseState === 'loading' ? '릴리스 확인 중…' : '다운로드 준비 중'}</span>}
            <a className="ghost-button" href={latestRelease?.releasePageUrl ?? EXTENSION_RELEASE.releaseHistoryUrl} target="_blank" rel="noreferrer">{latestRelease ? '릴리스 상세' : '모든 릴리스'} <Icon name="external" size={13} /></a>
            {latestRelease && <a className="text-button checksum-link" href={latestRelease.checksumUrl}>체크섬 파일</a>}
          </div>
        </article>
        <GuideStep number="01" title="확장 프로그램 설치" text="ZIP을 압축 해제하고 Chrome 우측 상단의 확장 프로그램 → 확장 프로그램 관리로 이동합니다. 개발자 모드를 켠 뒤 압축 해제한 폴더를 끌어다 놓으세요." action="chrome://extensions" />
        <GuideStep number="02" title="첫 PASS를 로컬에 저장" text="지원 사이트에서 정답 제출을 완료하세요. 대시보드 연결 여부와 관계없이 먼저 로컬 저장이 완료되고, 자동 다운로드를 켰다면 파일도 내려받습니다." action="확장 프로그램 열기" />
        <GuideStep number="03" title="GitHub 로그인 · 자동 연결" text="확장 프로그램에서 대시보드를 열고 GitHub로 로그인하세요. 설치된 CodeArchive가 자동으로 연결되므로 확장 ID를 복사하거나 붙여 넣지 않습니다." action="연결 상태 확인" onAction={onSettings} />
        <GuideStep number="04" title="자동 동기화 설정" text="설정에서 자동 동기화를 켜고 저장하세요. 릴레이가 연결 확인됨 상태가 되면 로컬 대기 풀이를 전송하며, 대시보드를 닫은 뒤의 새 PASS도 계속 처리합니다." action="자동화 설정" onAction={onSettings} />
        <GuideStep number="05" title="GitHub App · 저장 위치 선택" text="GitHub 연결 및 저장 위치 선택을 누르면 필요한 경우 GitHub App 설치 화면으로 이동합니다. 설치 계정, 저장소, 브랜치와 폴더를 선택한 뒤 GitHub 자동 커밋을 켜세요." action="GitHub 설정" onAction={onSettings} />
        <GuideStep number="06" title="저장 결과 확인" text="확장 프로그램의 최근 저장한 풀이에서 동기화 대기·동기화됨과 GitHub 완료·커밋 대기·커밋 중·커밋 실패·커밋 확인 필요·자동 커밋 안 함 상태를 확인하세요. 대시보드의 동기화 숫자는 아직 서버로 보내지 않은 로컬 풀이 수입니다." action="대시보드 확인" />
      </div>
      <div className="guide-update-note"><Icon name="check" size={18} /><div><strong>업데이트할 때 로컬 풀이를 유지하려면</strong><p>확장을 삭제하지 말고 기존 압축 해제 폴더의 파일을 새 ZIP 내용으로 교체한 뒤 확장 관리 화면에서 ‘새로고침’을 누르세요. 고정된 확장 ID가 유지되므로 IndexedDB 로컬 기록도 그대로 사용합니다.</p></div></div>
      <section className="guide-recovery" aria-labelledby="guide-recovery-title">
        <h2 id="guide-recovery-title" className="guide-recovery-title">연결 상태별 복구 방법</h2>
        <article className="guide-card"><span className="card-kicker">PENDING</span><h2>확인 대기</h2><p>릴레이 정보가 아직 확인되지 않았습니다. 대시보드를 열어 확장 연결을 확인하고 설정 저장이 끝날 때까지 기다리세요.</p></article>
        <article className="guide-card"><span className="card-kicker">SETUP</span><h2>릴레이 설정 필요</h2><p>GitHub 저장 대상은 있지만 자동 전송 릴레이가 없습니다. 대시보드 설정에서 자동 동기화를 켜고 설정을 다시 저장하세요.</p></article>
        <article className="guide-card"><span className="card-kicker">RELAY</span><h2>릴레이 오류 · 오프라인</h2><p>로컬 저장은 유지됩니다. 네트워크를 확인하고 확장 프로그램의 <strong>연결 재시도</strong>를 누르세요. 연결되면 자동화 ON/OFF 설정에 따라 대기 중인 풀이가 처리됩니다.</p></article>
        <article className="guide-card"><span className="card-kicker">AUTH</span><h2>인증 만료</h2><p>대시보드를 열어 GitHub에 다시 로그인하고 이 브라우저를 다시 연결하세요. 인증이 복구되기 전에는 자동 동기화와 GitHub 자동 커밋이 일시 중지됩니다.</p></article>
        <article className="guide-card"><span className="card-kicker">EXTENSION</span><h2>확장 프로그램 연결 끊김</h2><p>대시보드 상단의 <strong>확장 재연결</strong>을 누르세요. 계속 연결되지 않으면 확장이 활성화됐는지 확인하고 확장 관리 화면에서 새로고침하세요.</p></article>
        <article className="guide-card"><span className="card-kicker">GITHUB APP</span><h2>대상 필요 · 권한 미설치</h2><p>설정의 <strong>GitHub 연결 및 저장 위치 선택</strong>에서 App 설치를 완료하고 저장소·브랜치·폴더를 다시 선택하세요.</p></article>
        <article className="guide-card"><span className="card-kicker">REVOKING</span><h2>서버 폐기 대기</h2><p>자동 전송은 이미 중지된 상태입니다. 네트워크가 복구되면 서버의 릴레이 권한 폐기를 완료하므로 로컬 풀이를 삭제하거나 다시 설치하지 마세요.</p></article>
        <article className="guide-card"><span className="card-kicker">COMMIT</span><h2>커밋 실패 · 확인 필요</h2><p>최근 저장한 풀이의 상태를 확인하고 설정에서 저장 대상을 다시 검증하세요. 확인 필요 상태에서는 중복 커밋을 피하기 위해 자동 재시도하지 않습니다.</p></article>
        <article className="guide-card"><span className="card-kicker">COMMIT OFF</span><h2>자동 커밋 안 함</h2><p>해당 풀이에는 GitHub 커밋이 요청되지 않았다는 뜻이며 오류가 아닙니다. 이후 풀이부터 커밋하려면 대시보드에서 저장 대상을 선택하고 GitHub 자동 커밋을 켜세요.</p></article>
      </section>
      <div className="guide-contract"><div className="contract-icon"><Icon name="spark" size={18} /></div><div><strong>저장 순서를 기억하세요</strong><p>PASS → 로컬 저장 → 릴레이 자동 동기화 → GitHub 자동 커밋</p></div><span className="contract-badge">LOCAL FIRST</span></div>
    </section>
  )
}

function GuideStep({ number, title, text, action, onAction }: { number: string; title: string; text: string; action: string; onAction?: () => void }) {
  return <article className="guide-card guide-step"><span className="step-number">{number}</span><div className="step-copy"><h2>{title}</h2><p>{text}</p>{onAction ? <button className="text-button" onClick={onAction}>{action} <Icon name="chevron" size={13} /></button> : <code>{action}</code>}</div></article>
}

function SettingsView({
  user,
  exportSettings,
  updateExportSettings,
  accountSettings,
  updateAccountSettings,
  settingsBusy,
  settingsError,
  onSaveSettings,
  onAutoSyncDisabled,
  previewSolution,
  onLogin,
  onLogout,
  onExpectedAccountChange,
  githubInstallReturn,
  accountSettingsReady,
}: {
  user: User | null
  exportSettings: ExportSettings
  updateExportSettings: (settings: ExportSettings) => void
  accountSettings: AccountSettings
  updateAccountSettings: (settings: AccountSettings) => void
  settingsBusy: boolean
  settingsError: string | null
  onSaveSettings: () => void
  onAutoSyncDisabled: () => void
  previewSolution: Solution
  onLogin: () => void
  onLogout: () => void
  onExpectedAccountChange: (expectedGithubId: string) => void
  githubInstallReturn: GithubInstallReturn | null
  accountSettingsReady: boolean
}) {
  const [installations, setInstallations] = useState<import('./types').GithubInstallation[]>([])
  const [repositories, setRepositories] = useState<import('./types').GithubRepositoryTarget[]>([])
  const [branches, setBranches] = useState<import('./types').GithubBranchTarget[]>([])
  const [directory, setDirectory] = useState<import('./types').GithubDirectoryTarget | null>(null)
  const [targetBusy, setTargetBusy] = useState(false)
  const [targetStep, setTargetStep] = useState<'idle' | 'connecting' | 'repositories' | 'branches' | 'directories'>('idle')
  const [targetError, setTargetError] = useState<string | null>(null)
  const [targetErrorStep, setTargetErrorStep] = useState<'connecting' | 'repositories' | 'branches' | 'directories' | null>(null)
  const [repositoriesLoaded, setRepositoriesLoaded] = useState(false)
  const [branchesLoaded, setBranchesLoaded] = useState(false)
  const [repositoryId, setRepositoryId] = useState<number | null>(null)
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
    if (id === null) {
      updateAccountSettings({ ...accountSettings, githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubAutoCommitEnabled: false })
      setRepositoryId(null); setRepositories([]); setBranches([]); setDirectory(null)
      setRepositoriesLoaded(false); setBranchesLoaded(false); setTargetBusy(false); setTargetStep('idle'); clearTargetFeedback()
      return
    }
    if (!user) return
    const githubId = user.githubId
    updateAccountSettings({ ...accountSettings, githubInstallationId: id, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubAutoCommitEnabled: false })
    setRepositoryId(null); setRepositories([]); setBranches([]); setDirectory(null)
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
    if (id === null) {
      updateAccountSettings({ ...accountSettings, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null, githubAutoCommitEnabled: false })
      setRepositoryId(null); setBranches([]); setDirectory(null); setBranchesLoaded(false); setTargetBusy(false); setTargetStep('idle'); clearTargetFeedback()
      return
    }
    const repo = repositories.find(value => value.id === id)
    if (!repo || !accountSettings.githubInstallationId || !user) return
    const githubId = user.githubId
    const installation = accountSettings.githubInstallationId
    setRepositoryId(id)
    updateAccountSettings({ ...accountSettings, githubOwner: repo.owner, githubRepository: repo.name, githubBranch: null, githubRootPath: null, githubAutoCommitEnabled: false })
    setBranches([]); setDirectory(null); setBranchesLoaded(false); setTargetBusy(true); setTargetStep('branches'); clearTargetFeedback()
    try {
      const values = await loadAllPages(page => getGithubBranches(githubId, installation, id, page), branch => branch.name)
      if (operation === targetOperation.current) { setBranches(values); setBranchesLoaded(true) }
    } catch (error) {
      if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(githubId); return }
      if (operation === targetOperation.current) { setTargetError(githubTargetErrorMessage(error, '브랜치를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')); setTargetErrorStep('branches') }
    } finally { finishTargetOperation(operation) }
  }
  const chooseBranch = async (branch: string, path = '') => {
    const operation = ++targetOperation.current
    if (!branch) {
      updateAccountSettings({ ...accountSettings, githubBranch: null, githubRootPath: null, githubAutoCommitEnabled: false })
      setDirectory(null); setTargetBusy(false); setTargetStep('idle'); clearTargetFeedback()
      return
    }
    if (!accountSettings.githubInstallationId || !repositoryId || !user) return
    const githubId = user.githubId
    const installation = accountSettings.githubInstallationId
    const repository = repositoryId
    updateAccountSettings({ ...accountSettings, githubBranch: branch, githubRootPath: path || null, githubAutoCommitEnabled: false })
    setTargetBusy(true); setTargetStep('directories'); clearTargetFeedback()
    try {
      const value = await getGithubDirectories(githubId, installation, repository, branch, path)
      if (operation === targetOperation.current) setDirectory(value)
    } catch (error) {
      if (error instanceof ApiError && error.message === 'GitHub account changed; reconnect required') { onExpectedAccountChange(githubId); return }
      if (operation === targetOperation.current) { setTargetError(githubTargetErrorMessage(error, '폴더를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')); setTargetErrorStep('directories') }
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
  useEffect(() => { if(!accountSettingsReady||!user||githubInstallReturn?.result!=='success'||!githubInstallReturn.installationId)return;void loadInstallations(githubInstallReturn.installationId) }, [accountSettingsReady,user?.id,githubInstallReturn?.result,githubInstallReturn?.installationId])
  const draftTargetConfigured = Boolean(accountSettings.githubInstallationId && accountSettings.githubOwner?.trim() && accountSettings.githubRepository?.trim() && accountSettings.githubBranch?.trim())
  const providerUnavailable = accountSettings.githubStatus === 'PROVIDER_UNAVAILABLE'
  const targetPanelExpanded = draftTargetConfigured || installations.length > 0 || accountSettings.githubInstallationId !== null || targetBusy || targetError !== null
  const targetLoadingText = targetStep === 'connecting' ? '연결 중' : targetStep === 'repositories' ? '저장소 확인 중' : targetStep === 'branches' ? '브랜치 확인 중' : targetStep === 'directories' ? '폴더 확인 중' : null
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
      <div className="page-heading"><p className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE / SETTINGS</p><h1>설정</h1><p>CodeArchive가 문제 풀이를 가져오는 방법을 관리합니다.</p></div>
      <div className="settings-layout">
        <div className="settings-column">
          <article className="settings-card export-settings"><h2>계정 · 코드 저장</h2>{settingsError && <p role="alert">{settingsError}</p>}<div className="setting-field"><label htmlFor="profile-name">이름</label><input id="profile-name" value={accountSettings.name ?? ''} onChange={e => updateAccountSettings({ ...accountSettings, name: e.target.value || null })} /><label htmlFor="profile-nickname">닉네임</label><input id="profile-nickname" value={accountSettings.nickname ?? ''} onChange={e => updateAccountSettings({ ...accountSettings, nickname: e.target.value || null })} /></div><p>문제 정보 주석을 추가합니다. 원본 코드는 유지합니다.</p>
            <label><input type="checkbox" checked={accountSettings.copyHeader} onChange={e => updateAccountSettings({ ...accountSettings, copyHeader: e.target.checked })} /> 복사할 때 문제 정보 주석 포함</label><label><input type="checkbox" checked={accountSettings.downloadHeader} onChange={e => updateAccountSettings({ ...accountSettings, downloadHeader: e.target.checked })} /> 다운로드할 때 문제 정보 주석 포함</label><label><input type="checkbox" checked={accountSettings.githubHeader} onChange={e => updateAccountSettings({ ...accountSettings, githubHeader: e.target.checked })} /> GitHub 커밋 시 문제 정보 주석 포함</label>
            <div className="setting-field"><label htmlFor="filename-template">다운로드 파일명</label><input id="filename-template" maxLength={160} value={accountSettings.downloadFilenameTemplate} onChange={e => updateAccountSettings({ ...accountSettings, downloadFilenameTemplate: e.target.value })} /><p>미리보기: <output>{downloadFilename(previewSolution, accountSettings.downloadFilenameTemplate, { name: accountSettings.name, nickname: accountSettings.nickname, id: user?.id })}</output></p><label htmlFor="git-path-template">Git 저장 경로</label><div className="git-path-token-list" aria-label="Git 경로 토큰">{GIT_PATH_TOKENS.map(token => <button type="button" key={token} onClick={() => insertGitPathToken(token)}>{token}</button>)}</div><input ref={gitPathInput} id="git-path-template" maxLength={240} aria-invalid={!gitPathHasIdentity} value={accountSettings.gitPathTemplate} onChange={e => updateAccountSettings({ ...accountSettings, gitPathTemplate: e.target.value })} />{!gitPathHasIdentity && <p className="field-error" role="alert">제출별 파일을 구분하려면 {'{capture_ID}'} 또는 {'{time}'}이 필요합니다.</p>}<p>Git 미리보기: <output>{gitPath(previewSolution, accountSettings.gitPathTemplate, { name: accountSettings.name, nickname: accountSettings.nickname, id: user?.id }) ?? '유효하지 않은 상대 경로'}</output></p><label htmlFor="github-commit-message-template">Git 커밋 메시지</label><input id="github-commit-message-template" maxLength={200} value={accountSettings.githubCommitMessageTemplate} onChange={e => updateAccountSettings({ ...accountSettings, githubCommitMessageTemplate: e.target.value })} /><p>커밋 미리보기: <output>{githubCommitMessage(previewSolution, accountSettings.githubCommitMessageTemplate, { name: accountSettings.name, nickname: accountSettings.nickname, id: user?.id })}</output></p><label htmlFor="light-theme">밝은 테마</label><select id="light-theme" value={accountSettings.lightTheme} onChange={e => updateAccountSettings({ ...accountSettings, lightTheme: e.target.value as AccountSettings['lightTheme'] })}>{LIGHT_THEMES.map(x => <option key={x}>{x}</option>)}</select><label htmlFor="dark-theme">어두운 테마</label><select id="dark-theme" value={accountSettings.darkTheme} onChange={e => updateAccountSettings({ ...accountSettings, darkTheme: e.target.value as AccountSettings['darkTheme'] })}>{DARK_THEMES.map(x => <option key={x}>{x}</option>)}</select></div><label><input type="checkbox" checked={accountSettings.autoSyncEnabled} onChange={e => { updateAccountSettings({ ...accountSettings, autoSyncEnabled: e.target.checked }); if (!e.target.checked) onAutoSyncDisabled() }} /> 자동 동기화</label><label><input type="checkbox" disabled={!draftTargetConfigured || providerUnavailable} checked={accountSettings.githubAutoCommitEnabled} onChange={e => updateAccountSettings({ ...accountSettings, githubAutoCommitEnabled: e.target.checked })} /> GitHub 자동 커밋</label><button className="primary-button" onClick={onSaveSettings} disabled={settingsBusy || targetBusy || !gitPathHasIdentity}>{settingsBusy ? '저장 중…' : '설정 저장'}</button>
          </article>
          <article className={`settings-card github-card ${targetPanelExpanded ? 'is-expanded' : 'is-collapsed'}`} aria-busy={targetBusy}>
            <div className="github-card-heading">
              <div><span className="card-kicker">GITHUB APP</span><h2>GitHub 대상</h2><p>{githubStatusText}</p></div>
              <span className={`github-target-state ${targetBusy ? 'is-loading' : targetError ? 'is-error' : draftTargetConfigured ? 'is-ready' : ''}`} role="status" aria-live="polite">{targetStateText}</span>
            </div>
            {!targetPanelExpanded ? (
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
                  {accountSettings.githubInstallationId && <label><span><b>2</b> 저장소</span><select aria-label="저장소" disabled={targetBusy} value={repositoryId ?? ''} onChange={event => void chooseRepository(event.target.value ? Number(event.target.value) : null)}><option value="">선택하세요</option>{repositories.map(value => <option key={value.id} value={value.id}>{value.fullName}</option>)}</select>{repositoriesLoaded && repositories.length === 0 && <small role="status">이 설치에서 선택할 수 있는 저장소가 없습니다. GitHub App의 저장소 접근 권한을 확인하세요.</small>}</label>}
                  {repositoryId && <label><span><b>3</b> 브랜치</span><select aria-label="브랜치" disabled={targetBusy} value={accountSettings.githubBranch ?? ''} onChange={event => void chooseBranch(event.target.value)}><option value="">선택하세요</option>{branches.map(value => <option key={value.name} value={value.name}>{value.name}{value.protectedBranch ? ' (보호됨)' : ''}</option>)}</select>{branchesLoaded && branches.length === 0 && <small role="status">브랜치가 없습니다. 비어 있는 저장소 초기화는 신규 저장소 작업에서 지원할 예정입니다.</small>}</label>}
                  {directory && <div className="github-directory"><span><b>4</b> 폴더</span><p>현재 위치 <strong>{directory.currentPath || '/'}</strong></p><div>{directory.currentPath && <button type="button" onClick={() => void chooseBranch(accountSettings.githubBranch!, directory.parentPath)} disabled={targetBusy}>상위 폴더</button>}{directory.directories.map(name => <button type="button" key={name} onClick={() => void chooseBranch(accountSettings.githubBranch!, directory.currentPath ? `${directory.currentPath}/${name}` : name)} disabled={targetBusy}>{name}/</button>)}</div>{directory.directories.length === 0 && <small>하위 폴더가 없습니다. 현재 위치를 저장 경로로 사용할 수 있습니다.</small>}</div>}
                </div>
                {draftTargetConfigured && <div className="github-target-current"><Icon name="check" size={15} /><span><strong>현재 대상</strong>{accountSettings.githubOwner}/{accountSettings.githubRepository} · {accountSettings.githubBranch}{accountSettings.githubRootPath ? `/${accountSettings.githubRootPath}` : ''}</span></div>}
              </div>
            )}
            {targetBusy && <div className="github-target-overlay" role="status" aria-live="assertive"><Icon name="sync" size={20} /><strong>{targetLoadingText}</strong><span>GitHub에서 안전하게 확인하고 있습니다.</span></div>}
          </article>
        </div>
        <aside className="settings-sidebar"><article className="account-card"><span className="card-kicker">ACCOUNT</span>{user ? <><div className="account-large"><ProfileAvatar user={user} large /><div><strong>{displayUser(user)}</strong><span>@{user.githubLogin} · CodeArchive 계정</span></div></div><button className="wide-ghost-button" onClick={onLogout}><Icon name="logout" size={14} /> 로그아웃</button></> : <><div className="account-logged-out"><div className="logged-out-icon"><Icon name="user" size={18} /></div><strong>로그인이 필요합니다</strong><span>내 풀이를 저장하고 동기화하세요.</span></div><button className="primary-button wide" onClick={onLogin}>GitHub로 로그인 <Icon name="github" size={14} /></button></>}</article><article className="privacy-card"><Icon name="check" size={16} /><div><strong>데이터를 직접 통제하세요</strong><p>자동 동기화를 켜면 새 캡처가 안전한 릴레이로 전송됩니다. 끄면 수동 동기화만 사용합니다.</p></div></article></aside>
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
