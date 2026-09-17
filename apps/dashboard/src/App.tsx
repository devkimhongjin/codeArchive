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
import { ApiError, bulkUpload, getAccountSettings, getAuthProviders, getMe, getSolutions, issueRelayGrant, logout, revokeRelayGrant, updateAccountSettings, getGithubInstallations, startGithubInstallation, getGithubRepositories, getGithubBranches, getGithubDirectories } from './api'
import { BridgeError, parseAckResponse, parseConnectResponse, parsePendingResponse, parseRelayReuseResponse, relayHandoffKey, requestBridge } from './bridge'
import { requestIsCurrent, type RequestFence } from './requestFence'
import { acceptedIdsForAck } from './syncLogic'
import { DARK_THEMES, GITHUB_LOGIN_URL, LIGHT_THEMES, type AccountSettings, type AuthProviders, type BulkResponse, type Solution, type Toast, type User, type ViewName } from './types'
import { CodeBlock } from './CodeBlock'
import { EXTENSION_ID, LEGACY_EXTENSION_ID, EXTENSION_CANDIDATES } from './extensionConfig'
import { readExportSettings, EXPORT_SETTINGS_KEY, exportCode, downloadFilename, gitPath, sourceFileExtension, type ExportSettings } from './codeExport'
import { navigateSameTab } from './navigation'
import './styles.css'

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

function normalizeSolution(value: unknown, index = 0): Solution {
  const raw = (value ?? {}) as Record<string, unknown>
  const read = (...keys: string[]) => keys.map((key) => raw[key]).find((item) => item !== undefined && item !== null)
  const platform = String(read('platform') ?? 'SWEA').toUpperCase() === 'PROGRAMMERS' ? 'PROGRAMMERS' : 'SWEA'
  return {
    captureId: String(read('captureId', 'capture_id') ?? `remote-${index}`),
    platform,
    problemNumber: String(read('problemNumber', 'problem_number') ?? '—'),
    title: String(read('title', 'problemTitle', 'problem_title') ?? '이름 없는 풀이'),
    problemUrl: String(read('problemUrl', 'problem_url') ?? '#'),
    language: String(read('language') ?? 'Unknown'),
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

function formatMetric(value: number | string | undefined, suffix: string) {
  if (value === undefined || value === null || value === '') return '—'
  return `${value}${suffix}`
}

function formatMemory(solution: Solution) {
  if (solution.memoryValue !== undefined && solution.memoryUnit && solution.memoryUnit !== 'UNKNOWN') return `${solution.memoryValue} ${solution.memoryUnit}`
  if (solution.memoryUsage !== undefined) return `${solution.memoryUsage} · 단위 미확인`
  return '—'
}

function formatObservedTime(value?: string) {
  if (!value) return '기록 없음'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)
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
const defaultAccountSettings = (): AccountSettings => ({ version: 0, name: null, nickname: null, copyHeader: false, downloadHeader: false, downloadFilenameTemplate: '{platform}-{number}-{title}', gitPathTemplate: '{platform}/{number}-{title}', ...readLocalThemes(), autoSyncEnabled: false, githubAutoCommitEnabled: false, githubTargetConfigured: false, githubStatus: 'TARGET_MISSING', githubInstallationId: null, githubOwner: null, githubRepository: null, githubBranch: null, githubRootPath: null })
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
  const [platformFilter, setPlatformFilter] = useState<'ALL' | 'SWEA' | 'PROGRAMMERS'>('ALL')
  const [languageFilter, setLanguageFilter] = useState('ALL')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [githubLoginOpen, setGithubLoginOpen] = useState(false)
  const [githubProvider, setGithubProvider] = useState<AuthProviders['github'] | null>(null)
  const [githubProviderBusy, setGithubProviderBusy] = useState(false)
  const [githubProviderError, setGithubProviderError] = useState<string | null>(null)
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
  const [syncing, setSyncing] = useState(false)
  const toastId = useRef(0)
  const accountGeneration = useRef(0)
  const syncInFlight = useRef(false)
  const bridgeCapabilityRef = useRef<string | null>(null)
  const solutionOperation = useRef(0)
  const bridgeOperation = useRef(0)
  const githubProviderOperation = useRef(0)
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
    void Promise.resolve(getAccountSettings(loadingFor.githubId)).then(server => {
      if (!stillCurrent()) return
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

  useEffect(() => {
    if (!githubLoginOpen) return
    let active = true
    const operation = ++githubProviderOperation.current
    setGithubProvider(null)
    setGithubProviderError(null)
    setGithubProviderBusy(true)
    void getAuthProviders()
      .then((providers) => {
        if (!active || operation !== githubProviderOperation.current) return
        setGithubProvider(providers.github)
      })
      .catch(() => {
        if (!active || operation !== githubProviderOperation.current) return
        setGithubProvider({ enabled: false, loginUrl: GITHUB_LOGIN_URL })
        setGithubProviderError('서버에서 GitHub 로그인 설정을 확인하지 못했습니다.')
      })
      .finally(() => {
        if (active && operation === githubProviderOperation.current) setGithubProviderBusy(false)
      })
    return () => {
      active = false
    }
  }, [githubLoginOpen])

  const languages = useMemo(
    () => ['ALL', ...Array.from(new Set(solutions.map((solution) => solution.language))).sort()],
    [solutions],
  )

  const filteredSolutions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return solutions.filter((solution) => {
      const matchesPlatform = platformFilter === 'ALL' || solution.platform === platformFilter
      const matchesLanguage = languageFilter === 'ALL' || solution.language === languageFilter
      const matchesQuery =
        !normalizedQuery ||
        [solution.title, solution.problemNumber, solution.language, solution.platform].some((field) =>
          field.toLowerCase().includes(normalizedQuery),
        )
      return matchesPlatform && matchesLanguage && matchesQuery
    })
  }, [languageFilter, platformFilter, query, solutions])

  useEffect(() => {
    if (!filteredSolutions.some((solution) => solution.captureId === selectedId)) {
      setSelectedId(filteredSolutions[0]?.captureId ?? '')
    }
  }, [filteredSolutions, selectedId])

  const selectedSolution = filteredSolutions.find((solution) => solution.captureId === selectedId) ?? filteredSolutions[0] ?? null

  const changeView = (nextView: ViewName) => {
    setView(nextView)
    setMobileNavOpen(false)
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
      showToast('success', '라이브 아카이브에 연결했습니다.')
    } catch (error) {
      if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current)) return
      if (error instanceof ApiError && error.status === 401) {
        setMode('local')
        setUser(null)
        setSolutions([])
        setSelectedId('')
        showToast('info', '먼저 로그인하면 내 풀이를 불러올 수 있습니다.')
        setGithubLoginOpen(true)
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
    const oldCapability = bridgeCapabilityRef.current
    const oldId = currentExtensionId.current
    bridgeCapabilityRef.current = null
    setBridgeCapability(null)
    try {
      if (oldCapability) await requestBridge(oldId, { type: 'DISCONNECT', capability: oldCapability }).catch(() => undefined)
      for (const candidate of legacyOnly ? [LEGACY_EXTENSION_ID] : EXTENSION_CANDIDATES) {
        if (!requestIsCurrent(fence, accountGeneration.current, bridgeOperation.current)) return false
        try {
          const { capability } = parseConnectResponse(await requestBridge(candidate, { type: 'CONNECT' }))
          if (!requestIsCurrent(fence, accountGeneration.current, bridgeOperation.current)) {
            await requestBridge(candidate, { type: 'DISCONNECT', capability }).catch(() => undefined)
            return false
          }
          currentExtensionId.current = candidate
          setExtensionId(candidate)
          bridgeCapabilityRef.current = capability
          setBridgeCapability(capability)
          setBridgeStatus('connected')
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
        try { parseAckResponse(await requestBridge(EXTENSION_ID, { type: 'PING', capability })) }
        catch {
          if (active && operation === bridgeOperation.current && capability === bridgeCapabilityRef.current) {
            bridgeCapabilityRef.current = null
            setBridgeCapability(null)
            setBridgeStatus('disconnected')
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
      setGithubLoginOpen(true)
      return
    }
    let syncExtensionId = currentExtensionId.current
    syncInFlight.current = true
    setSyncing(true)
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
          setGithubLoginOpen(true)
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
      await refreshSolutions(syncGeneration, latestUser.githubId)
      const pageHint = captures.length === 50 ? ' 다음 50개는 다시 동기화해 주세요.' : ''
      showToast(
        failedCount ? 'info' : 'success',
        failedCount ? `${accepted.length}개 저장 · ${failedCount}개는 저장하지 못했습니다.${pageHint}` : `${accepted.length}개 풀이를 저장했습니다.${pageHint}`,
      )
    } catch (error) {
      if (syncContext) needsFreshCapability = true
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => changeView('solutions')} aria-label="CodeArchive 홈">
            <span className="brand-mark">B</span>
            <span className="brand-copy">
              <span className="brand-name">CodeArchive</span>
              <span className="brand-beta">BETA</span>
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
            <button className={`sync-button ${syncing ? 'is-loading' : ''}`} onClick={() => void syncPending()} disabled={syncing}>
              <Icon name="sync" size={16} />
              <span>{syncing ? '동기화 중' : '동기화'}</span>
            </button>
            {user ? (
              <div className="account-menu">
                <span className="account-avatar"><Icon name="user" size={15} /></span>
                <span className="account-identity">{displayUser(user)}</span>
                <button className="logout-button" onClick={() => void handleLogout()} aria-label="로그아웃">
                  <Icon name="logout" size={16} />
                </button>
              </div>
            ) : (
              <button className="login-button" onClick={() => setGithubLoginOpen(true)}>
                GitHub 로그인 <Icon name="github" size={14} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="page-content">
        {mode === 'local' && (
          <section className="demo-banner" role="status">
            <div className="demo-banner-icon"><Icon name="spark" size={17} /></div>
            <div className="demo-banner-copy">
              <strong>로컬 보관함</strong>
              <span>로그인하거나 서버 연결이 복구되면 내 아카이브를 불러옵니다. 로컬 기록은 자동으로 업로드되지 않습니다.</span>
            </div>
            <button className="banner-action" onClick={() => setGithubLoginOpen(true)}>GitHub로 로그인 <Icon name="github" size={14} /></button>
            <button className="banner-refresh" onClick={() => void connectLive()} disabled={loading} aria-label="라이브 연결 새로고침">
              <Icon name="refresh" size={16} />
            </button>
          </section>
        )}
        {mode === 'live' && user && (
          <section className="live-banner" role="status">
            <span className="live-dot" /> <strong>라이브 아카이브</strong><span>{displayUser(user)}</span>
            <button onClick={() => void refreshSolutions(undefined, user.githubId)} disabled={loading}><Icon name="refresh" size={14} /> 새로고침</button>
          </section>
        )}
        {loadError && (
          <section className="load-error" role="alert"><Icon name="close" size={17} /><span>{loadError}</span><button onClick={() => setLoadError(null)} aria-label="오류 닫기"><Icon name="close" size={15} /></button></section>
        )}

        {view === 'solutions' && (
          <SolutionsView
            solutions={solutions}
            filteredSolutions={filteredSolutions}
            selectedSolution={selectedSolution}
            selectedId={selectedId}
            query={query}
            platformFilter={platformFilter}
            languageFilter={languageFilter}
            languages={languages}
            loading={loading}
            mode={mode}
            setQuery={setQuery}
            setPlatformFilter={setPlatformFilter}
            setLanguageFilter={setLanguageFilter}
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
            extensionId={extensionId}
            bridgeStatus={bridgeStatus}
            onConnectLegacy={() => { setAutoConnect(true); void connectBridge(false, true) }}
            onLogin={() => setGithubLoginOpen(true)}
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
          <span className="footer-version">v0.1 beta</span>
        </div>
      </footer>

      {githubLoginOpen && (
        <GithubLoginDialog
          provider={githubProvider}
          loading={githubProviderBusy}
          error={githubProviderError}
          onLogin={() => {
            if (githubProvider?.enabled && githubProvider.loginUrl === GITHUB_LOGIN_URL) window.location.assign(GITHUB_LOGIN_URL)
          }}
          onClose={() => setGithubLoginOpen(false)}
        />
      )}
      {toast && <ToastView toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

function SolutionsView({
  solutions,
  filteredSolutions,
  selectedSolution,
  selectedId,
  query,
  platformFilter,
  languageFilter,
  languages,
  loading,
  mode,
  setQuery,
  setPlatformFilter,
  setLanguageFilter,
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
  selectedSolution: Solution | null
  selectedId: string
  query: string
  platformFilter: 'ALL' | 'SWEA' | 'PROGRAMMERS'
  languageFilter: string
  languages: string[]
  loading: boolean
  mode: 'local' | 'live'
  setQuery: (value: string) => void
  setPlatformFilter: (value: 'ALL' | 'SWEA' | 'PROGRAMMERS') => void
  setLanguageFilter: (value: string) => void
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
          {(['ALL', 'SWEA', 'PROGRAMMERS'] as const).map((filter) => (
            <button key={filter} className={platformFilter === filter ? 'filter-pill active' : 'filter-pill'} onClick={() => setPlatformFilter(filter)}>
              {filter === 'ALL' ? '전체' : filter === 'PROGRAMMERS' ? '프로그래머스' : filter}
            </button>
          ))}
        </div>
        <select value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value)} aria-label="언어 필터">
          {languages.map((language) => <option key={language} value={language}>{language === 'ALL' ? '모든 언어' : language}</option>)}
        </select>
      </div>

      <div className="content-grid">
        <section className="solution-list-panel" aria-label="풀이 목록">
          <div className="panel-heading">
            <div><span className="panel-title">풀이 목록</span><span className="panel-count">{filteredSolutions.length}</span></div>
            <span className="panel-sort">최신순 <Icon name="chevron" size={13} /></span>
          </div>
          <div className="solution-list">
            {loading && <ListSkeleton />}
            {!loading && filteredSolutions.length === 0 && <EmptyList mode={mode} />}
            {!loading && filteredSolutions.map((solution) => (
              <SolutionRow key={solution.captureId} solution={solution} selected={solution.captureId === selectedSolution?.captureId || solution.captureId === selectedId} onSelect={() => setSelectedId(solution.captureId)} />
            ))}
          </div>
          <div className="list-footer"><span><span className="status-dot" /> {mode === 'local' ? '로컬 기록 · 업로드 전' : '서버와 연결됨'}</span><span>{filteredSolutions.length} / {solutions.length}</span></div>
        </section>
        <SolutionDetail solution={selectedSolution} mode={mode} onCopy={onCopy} onDownload={onDownload} lightTheme={lightTheme} darkTheme={darkTheme} onLightThemeChange={onLightThemeChange} onDarkThemeChange={onDarkThemeChange} />
      </div>
    </section>
  )
}

function SolutionRow({ solution, selected, onSelect }: { solution: Solution; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`solution-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <span className={`platform-logo ${solution.platform === 'SWEA' ? 'swea' : 'programmers'}`}>{solution.platform === 'SWEA' ? 'S' : 'P'}</span>
      <span className="solution-row-main">
        <span className="solution-row-top"><span className="solution-platform">{solution.platform}</span><span className="solution-result"><Icon name="check" size={12} /> {solution.result === 'ACCEPTED' ? 'Accepted' : solution.result}</span></span>
        <span className="solution-title">{solution.title}</span>
        <span className="solution-row-bottom"><span>#{solution.problemNumber}</span><span className="row-divider" /><span>{solution.language}</span><span className="row-time"><Icon name="clock" size={12} /> {formatDate(solution.solvedAt ?? solution.observedAt)}</span></span>
      </span>
      <Icon name="chevron" size={17} />
    </button>
  )
}

function SolutionDetail({ solution, mode, onCopy, onDownload, lightTheme, darkTheme, onLightThemeChange, onDarkThemeChange }: { solution: Solution | null; mode: 'local' | 'live'; onCopy: () => void; onDownload: () => void; lightTheme: AccountSettings['lightTheme']; darkTheme: AccountSettings['darkTheme']; onLightThemeChange: (theme: AccountSettings['lightTheme']) => void; onDarkThemeChange: (theme: AccountSettings['darkTheme']) => void }) {
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
              <div className="detail-subline"><span className="accepted-badge"><Icon name="check" size={12} /> ACCEPTED</span><span>{solution.language}</span><span className="row-divider" /><span>풀이 기록 {formatDate(solution.solvedAt ?? solution.observedAt)}</span></div>
            </div>
            <a className="problem-link" href={solution.problemUrl} target="_blank" rel="noreferrer">문제 보기 <Icon name="external" size={14} /></a>
          </div>
          <div className="metrics-row">
            <MetricCard label="실행 시간" value={formatMetric(solution.executionTime, typeof solution.executionTime === 'number' && solution.executionTime < 10 ? ' s' : ' ms')} icon="clock" />
            <MetricCard label="메모리 사용량" value={formatMemory(solution)} icon="spark" />
            <MetricCard label="관측 시각" value={formatObservedTime(solution.observedAt ?? solution.solvedAt)} icon="check" />
          </div>
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
  return (
    <section className="guide-page">
      <div className="page-heading"><p className="eyebrow"><span className="eyebrow-dot" /> GET STARTED / BRIDGE</p><h1>연동 가이드</h1><p>Chrome 확장 프로그램에서 저장한 제출 기록을 CodeArchive로 가져옵니다.</p></div>
      <div className="guide-grid">
        <article className="guide-card guide-hero"><div className="guide-hero-icon"><Icon name="link" size={25} /></div><div><span className="card-kicker">CODEARCHIVE BRIDGE</span><h2>3분 안에 첫 풀이를 모아보세요</h2><p>자동 동기화가 꺼져 있으면 수동 동기화 때만 전송하고, 켜면 새 캡처를 안전한 릴레이로 전송합니다.</p></div><button className="primary-button" onClick={onSettings}>브리지 설정하기 <Icon name="chevron" size={14} /></button></article>
        <GuideStep number="01" title="확장 프로그램 설치" text="CodeArchive Extension을 Chrome에 설치하고, SWEA 또는 프로그래머스 문제를 한 번 제출해 주세요." action="chrome://extensions" />
        <GuideStep number="02" title="GitHub 로그인 · 자동 연결" text="로그인하면 설치된 CodeArchive에 자동 연결합니다. ID를 복사하거나 붙여 넣을 필요가 없습니다." action="연결 상태 확인" onAction={onSettings} />
        <GuideStep number="03" title="지금 동기화" text="동기화를 누르면 대기 중인 풀이를 가져옵니다. 서버가 저장한 항목만 확장 프로그램에서 확인 처리합니다." action="동기화 시작" onAction={onSettings} />
      </div>
      <div className="guide-contract"><div className="contract-icon"><Icon name="spark" size={18} /></div><div><strong>데이터 흐름을 확인하세요</strong><p>확장 프로그램 → 대기 중인 캡처 50개 → 서버의 일괄 검증 → 승인된 captureId만 ACK</p></div><span className="contract-badge">EXPLICIT SYNC</span></div>
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
  extensionId,
  bridgeStatus,
  onConnectLegacy,
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
  extensionId: string
  bridgeStatus: 'disconnected' | 'connecting' | 'connected'
  onConnectLegacy: () => void
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
  const [targetBusy, setTargetBusy] = useState(false); const [targetError, setTargetError] = useState<string | null>(null)
  const [repositoryId, setRepositoryId] = useState<number | null>(null)
  const targetOperation = useRef(0)
  const loadAllPages = async <T,>(fetchPage:(page:number)=>Promise<{items:T[];hasMore:boolean}|T[]>, key:(value:T)=>string|number) => { const values:T[]=[];const seen=new Set<string|number>();for(let page=1;page<=100;page+=1){const response=await fetchPage(page);const current=Array.isArray(response)?response:response.items;for(const value of current){const id=key(value);if(!seen.has(id)){seen.add(id);values.push(value)}}if(Array.isArray(response)?current.length<100:!response.hasMore)break}return values }
  const chooseInstallation = async (id:number | null) => { const operation=++targetOperation.current;if(id===null){updateAccountSettings({...accountSettings,githubInstallationId:null,githubOwner:null,githubRepository:null,githubBranch:null,githubRootPath:null,githubAutoCommitEnabled:false});setRepositoryId(null);setRepositories([]);setBranches([]);setDirectory(null);setTargetBusy(false);setTargetError(null);return}if(!user)return;const githubId=user.githubId;const next={...accountSettings,githubInstallationId:id,githubOwner:null,githubRepository:null,githubBranch:null,githubRootPath:null,githubAutoCommitEnabled:false};updateAccountSettings(next);setRepositoryId(null);setRepositories([]);setBranches([]);setDirectory(null);setTargetBusy(true);setTargetError(null);try{const values=await loadAllPages(page=>getGithubRepositories(githubId,id,page),repo=>repo.id);if(operation===targetOperation.current)setRepositories(values)}catch(e){if(e instanceof ApiError&&e.message==='GitHub account changed; reconnect required'){onExpectedAccountChange(githubId);return}if(operation===targetOperation.current)setTargetError(e instanceof Error?e.message:'저장소를 불러오지 못했습니다.')}finally{if(operation===targetOperation.current)setTargetBusy(false)} }
  const chooseRepository = async (id:number | null) => { const operation=++targetOperation.current;if(id===null){updateAccountSettings({...accountSettings,githubOwner:null,githubRepository:null,githubBranch:null,githubRootPath:null,githubAutoCommitEnabled:false});setRepositoryId(null);setBranches([]);setDirectory(null);setTargetBusy(false);setTargetError(null);return}const repo=repositories.find(x=>x.id===id);if(!repo||!accountSettings.githubInstallationId||!user)return;const githubId=user.githubId;const installation=accountSettings.githubInstallationId;setRepositoryId(id);updateAccountSettings({...accountSettings,githubOwner:repo.owner,githubRepository:repo.name,githubBranch:null,githubRootPath:null,githubAutoCommitEnabled:false});setBranches([]);setDirectory(null);setTargetBusy(true);setTargetError(null);try{const values=await loadAllPages(page=>getGithubBranches(githubId,installation,id,page),branch=>branch.name);if(operation===targetOperation.current)setBranches(values)}catch(e){if(e instanceof ApiError&&e.message==='GitHub account changed; reconnect required'){onExpectedAccountChange(githubId);return}if(operation===targetOperation.current)setTargetError(e instanceof Error?e.message:'브랜치를 불러오지 못했습니다.')}finally{if(operation===targetOperation.current)setTargetBusy(false)} }
  const chooseBranch = async (branch:string,path='') => { const operation=++targetOperation.current;if(!branch){updateAccountSettings({...accountSettings,githubBranch:null,githubRootPath:null,githubAutoCommitEnabled:false});setDirectory(null);setTargetBusy(false);setTargetError(null);return}if(!accountSettings.githubInstallationId||!repositoryId||!user)return;const githubId=user.githubId;const installation=accountSettings.githubInstallationId;const repository=repositoryId;updateAccountSettings({...accountSettings,githubBranch:branch,githubRootPath:path||null,githubAutoCommitEnabled:false});setTargetBusy(true);setTargetError(null);try{const value=await getGithubDirectories(githubId,installation,repository,branch,path);if(operation===targetOperation.current)setDirectory(value)}catch(e){if(e instanceof ApiError&&e.message==='GitHub account changed; reconnect required'){onExpectedAccountChange(githubId);return}if(operation===targetOperation.current)setTargetError(e instanceof Error?e.message:'폴더를 불러오지 못했습니다.')}finally{if(operation===targetOperation.current)setTargetBusy(false)} }
  const loadInstallations = async (preferredInstallationId?:number | null) => { if(!user)return; const githubId=user.githubId; const operation=++targetOperation.current;setTargetBusy(true);setTargetError(null);try{const values=await getGithubInstallations(githubId);if(operation!==targetOperation.current)return;setInstallations(values);const preferred=preferredInstallationId&&values.some(value=>value.id===preferredInstallationId)?preferredInstallationId:values.length===1?values[0].id:null;if(preferred)await chooseInstallation(preferred);else if(preferredInstallationId)setTargetError('설치한 GitHub App을 현재 계정에서 확인하지 못했습니다. 다시 연결해 주세요.')}catch(e){if(e instanceof ApiError&&e.message==='GitHub account changed; reconnect required'){onExpectedAccountChange(githubId);return}if(operation===targetOperation.current)setTargetError(e instanceof Error?e.message:'GitHub 설치를 불러오지 못했습니다.')}finally{if(operation===targetOperation.current)setTargetBusy(false)} }
  const beginGithubConnection = async () => { if(!user)return; const githubId=user.githubId; const operation=++targetOperation.current;setTargetBusy(true);setTargetError(null);try{const existing=await getGithubInstallations(githubId);if(operation!==targetOperation.current)return;const result=existing.length?{status:'AVAILABLE' as const,installations:existing,installUrl:null}:await startGithubInstallation(githubId);if(operation!==targetOperation.current)return;setInstallations(result.installations);if(result.status==='INSTALL_REQUIRED'){if(!trustedGithubInstallUrl(result.installUrl)){setTargetError('안전한 GitHub App 설치 주소를 확인하지 못했습니다.');return}navigateSameTab(result.installUrl);return}const preferred=accountSettings.githubInstallationId&&result.installations.some(value=>value.id===accountSettings.githubInstallationId)?accountSettings.githubInstallationId:result.installations.length===1?result.installations[0].id:null;if(preferred)await chooseInstallation(preferred)}catch(e){if(e instanceof ApiError&&e.message==='GitHub account changed; reconnect required'){onExpectedAccountChange(githubId);return}if(operation===targetOperation.current)setTargetError(e instanceof Error?e.message:'GitHub App 연결을 시작하지 못했습니다.')}finally{if(operation===targetOperation.current)setTargetBusy(false)} }
  useEffect(() => { if(!accountSettingsReady||!user||githubInstallReturn?.result!=='success'||!githubInstallReturn.installationId)return;void loadInstallations(githubInstallReturn.installationId) }, [accountSettingsReady,user?.id,githubInstallReturn?.result,githubInstallReturn?.installationId])
  const draftTargetConfigured = Boolean(accountSettings.githubInstallationId && accountSettings.githubOwner?.trim() && accountSettings.githubRepository?.trim() && accountSettings.githubBranch?.trim())
  const providerUnavailable = accountSettings.githubStatus === 'PROVIDER_UNAVAILABLE'
  const githubStatusText = providerUnavailable ? 'GitHub App 서버 설정이 아직 없습니다. 관리자에게 App ID와 개인 키 설정을 요청하세요.' : draftTargetConfigured ? '저장 시 GitHub 자동 커밋 대상을 확인합니다.' : 'GitHub App 설치와 저장소 대상을 지정하세요.'
  return (
    <section className="settings-page">
      <div className="page-heading"><p className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE / SETTINGS</p><h1>설정</h1><p>CodeArchive가 문제 풀이를 가져오는 방법을 관리합니다.</p></div>
      <div className="settings-layout">
        <div className="settings-column">
          <details className="settings-card"><summary>이전 개발 확장에 남은 기록</summary><p>고정 ID 버전을 설치하기 전의 기록은 별도 저장소에 남습니다. 이전 확장을 삭제하지 않은 상태에서 연결한 뒤 지금 동기화를 눌러 가져오세요.</p><button className="secondary-button" onClick={onConnectLegacy} disabled={!user || bridgeStatus === 'connecting'}>이전 개발 기록 확인</button></details><article className="settings-card export-settings"><h2>계정 · 코드 저장</h2>{settingsError && <p role="alert">{settingsError}</p>}<div className="setting-field"><label htmlFor="profile-name">이름</label><input id="profile-name" value={accountSettings.name ?? ''} onChange={e => updateAccountSettings({ ...accountSettings, name: e.target.value || null })} /><label htmlFor="profile-nickname">닉네임</label><input id="profile-nickname" value={accountSettings.nickname ?? ''} onChange={e => updateAccountSettings({ ...accountSettings, nickname: e.target.value || null })} /></div><p>문제 정보 주석을 추가합니다. 원본 코드는 유지합니다.</p>
            <label><input type="checkbox" checked={accountSettings.copyHeader} onChange={e => updateAccountSettings({ ...accountSettings, copyHeader: e.target.checked })} /> 복사할 때 문제 정보 주석 포함</label><label><input type="checkbox" checked={accountSettings.downloadHeader} onChange={e => updateAccountSettings({ ...accountSettings, downloadHeader: e.target.checked })} /> 다운로드할 때 문제 정보 주석 포함</label>
            <div className="setting-field"><label htmlFor="filename-template">다운로드 파일명</label><input id="filename-template" maxLength={160} value={accountSettings.downloadFilenameTemplate} onChange={e => updateAccountSettings({ ...accountSettings, downloadFilenameTemplate: e.target.value })} /><p>미리보기: <output>{downloadFilename(previewSolution, accountSettings.downloadFilenameTemplate, { name: accountSettings.name, nickname: accountSettings.nickname, id: user?.id })}</output></p><label htmlFor="git-path-template">Git 저장 경로</label><input id="git-path-template" value={accountSettings.gitPathTemplate} onChange={e => updateAccountSettings({ ...accountSettings, gitPathTemplate: e.target.value })} /><p>Git 미리보기: <output>{gitPath(previewSolution, accountSettings.gitPathTemplate, { name: accountSettings.name, nickname: accountSettings.nickname, id: user?.id }) ?? '유효하지 않은 상대 경로'}</output></p><label htmlFor="light-theme">밝은 테마</label><select id="light-theme" value={accountSettings.lightTheme} onChange={e => updateAccountSettings({ ...accountSettings, lightTheme: e.target.value as AccountSettings['lightTheme'] })}>{LIGHT_THEMES.map(x => <option key={x}>{x}</option>)}</select><label htmlFor="dark-theme">어두운 테마</label><select id="dark-theme" value={accountSettings.darkTheme} onChange={e => updateAccountSettings({ ...accountSettings, darkTheme: e.target.value as AccountSettings['darkTheme'] })}>{DARK_THEMES.map(x => <option key={x}>{x}</option>)}</select></div><label><input type="checkbox" checked={accountSettings.autoSyncEnabled} onChange={e => { updateAccountSettings({ ...accountSettings, autoSyncEnabled: e.target.checked }); if (!e.target.checked) onAutoSyncDisabled() }} /> 자동 동기화</label><label><input type="checkbox" disabled={!draftTargetConfigured || providerUnavailable} checked={accountSettings.githubAutoCommitEnabled} onChange={e => updateAccountSettings({ ...accountSettings, githubAutoCommitEnabled: e.target.checked })} /> GitHub 자동 커밋</label><button className="primary-button" onClick={onSaveSettings} disabled={settingsBusy}>{settingsBusy ? '저장 중…' : '설정 저장'}</button>
          </article>
          <article className="settings-card github-card"><h2>GitHub 대상</h2><p role="status">{githubStatusText}</p><button type="button" className="secondary-button" onClick={()=>void beginGithubConnection()} disabled={!user||targetBusy||providerUnavailable}>{targetBusy?'확인 중…':draftTargetConfigured?'저장 위치 다시 선택':'GitHub 연결 및 저장 위치 선택'}</button>{targetError&&<p role="alert">{targetError}</p>}<label>GitHub 설치<select aria-label="GitHub 설치" value={accountSettings.githubInstallationId??''} onChange={e=>void chooseInstallation(e.target.value ? Number(e.target.value) : null)}><option value="">선택하세요</option>{installations.map(x=><option key={x.id} value={x.id}>{x.accountLogin}</option>)}</select></label><label>저장소<select aria-label="저장소" disabled={!accountSettings.githubInstallationId||targetBusy} value={repositoryId??''} onChange={e=>void chooseRepository(e.target.value ? Number(e.target.value) : null)}><option value="">선택하세요</option>{repositories.map(x=><option key={x.id} value={x.id}>{x.fullName}</option>)}</select></label><label>브랜치<select aria-label="브랜치" disabled={!repositoryId||targetBusy} value={accountSettings.githubBranch??''} onChange={e=>void chooseBranch(e.target.value)}><option value="">선택하세요</option>{branches.map(x=><option key={x.name} value={x.name}>{x.name}{x.protectedBranch?' (보호됨)':''}</option>)}</select></label>{directory&&<div><p>폴더: <strong>{directory.currentPath||'/'}</strong></p>{directory.currentPath&&<button type="button" onClick={()=>void chooseBranch(accountSettings.githubBranch!,directory.parentPath)}>상위 폴더</button>}{directory.directories.map(name=><button type="button" key={name} onClick={()=>void chooseBranch(accountSettings.githubBranch!,directory.currentPath?`${directory.currentPath}/${name}`:name)}>{name}/</button>)}</div>}{draftTargetConfigured&&<p><strong>현재 대상:</strong> {accountSettings.githubOwner}/{accountSettings.githubRepository} · {accountSettings.githubBranch}{accountSettings.githubRootPath ? `/${accountSettings.githubRootPath}` : ''}</p>}</article>
        </div>
        <aside className="settings-sidebar"><article className="account-card"><span className="card-kicker">ACCOUNT</span>{user ? <><div className="account-large"><span className="account-avatar large"><Icon name="user" size={18} /></span><div><strong>{displayUser(user)}</strong><span>@{user.githubLogin} · CodeArchive 계정</span></div></div><button className="wide-ghost-button" onClick={onLogout}><Icon name="logout" size={14} /> 로그아웃</button></> : <><div className="account-logged-out"><div className="logged-out-icon"><Icon name="user" size={18} /></div><strong>로그인이 필요합니다</strong><span>내 풀이를 저장하고 동기화하세요.</span></div><button className="primary-button wide" onClick={onLogin}>GitHub로 로그인 <Icon name="github" size={14} /></button></>}</article><article className="privacy-card"><Icon name="check" size={16} /><div><strong>데이터를 직접 통제하세요</strong><p>자동 동기화를 켜면 새 캡처가 안전한 릴레이로 전송됩니다. 끄면 수동 동기화만 사용합니다.</p></div></article></aside>
      </div>
    </section>
  )
}

function GithubLoginDialog({ provider, loading, error, onLogin, onClose }: { provider: AuthProviders['github'] | null; loading: boolean; error: string | null; onLogin: () => void; onClose: () => void }) {
  const enabled = provider?.enabled === true && provider.loginUrl === GITHUB_LOGIN_URL
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="github-login-modal" role="dialog" aria-modal="true" aria-labelledby="github-login-title"><button className="modal-close" onClick={onClose} aria-label="닫기"><Icon name="close" size={19} /></button><div className="auth-symbol github-symbol"><Icon name="github" size={22} /></div><p className="eyebrow"><span className="eyebrow-dot" /> CODEARCHIVE ACCOUNT</p><h2 id="github-login-title">GitHub로 로그인</h2><p className="auth-description">GitHub 계정으로 안전하게 CodeArchive 아카이브를 확인하세요.</p>{loading ? <div className="github-provider-state" role="status">GitHub 로그인 설정을 확인하는 중…</div> : enabled ? <><button className="primary-button github-login-submit" onClick={onLogin}><Icon name="github" size={17} /> GitHub로 로그인 <Icon name="chevron" size={14} /></button><p className="auth-privacy"><Icon name="check" size={13} /> GitHub 인증은 서버에서 처리합니다.</p></> : <div className="github-provider-disabled" role="alert"><strong>GitHub 로그인 설정이 필요합니다</strong><p>{error ?? '서버 관리자가 GitHub OAuth 클라이언트 설정을 완료하면 로그인할 수 있습니다.'}</p><code>GITHUB_CLIENT_ID · GITHUB_CLIENT_SECRET</code></div>}</section></div>
}

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 3800)
    return () => window.clearTimeout(timer)
  }, [onClose, toast.id])
  return <div className={`toast ${toast.kind}`} role="status"><span className="toast-icon"><Icon name={toast.kind === 'success' ? 'check' : toast.kind === 'error' ? 'close' : 'spark'} size={15} /></span><span>{toast.message}</span><button onClick={onClose} aria-label="알림 닫기"><Icon name="close" size={14} /></button></div>
}
