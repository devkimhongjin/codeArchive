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
import { ApiError, bulkUpload, getAuthProviders, getMe, getSolutions, logout } from './api'
import { BridgeError, parseAckResponse, parseConnectResponse, parsePendingResponse, requestBridge } from './bridge'
import { demoSolutions } from './demoData'
import { requestIsCurrent, type RequestFence } from './requestFence'
import { acceptedIdsForAck } from './syncLogic'
import { GITHUB_LOGIN_URL, type AuthProviders, type BulkResponse, type Solution, type Toast, type User, type ViewName } from './types'
import { CodeBlock } from './CodeBlock'
import { EXTENSION_ID, LEGACY_EXTENSION_ID, EXTENSION_CANDIDATES } from './extensionConfig'
import { readExportSettings, EXPORT_SETTINGS_KEY, exportCode, downloadFilename, sourceFileExtension, type ExportSettings } from './codeExport'
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

export default function App() {
  const [view, setView] = useState<ViewName>('solutions')
  const [mode, setMode] = useState<'demo' | 'live'>('demo')
  const [user, setUser] = useState<User | null>(null)
  const [solutions, setSolutions] = useState<Solution[]>(demoSolutions)
  const [selectedId, setSelectedId] = useState(demoSolutions[0]?.captureId ?? '')
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
        setUser(nextUser)
        setMode('live')
        setSolutions([])
        setSelectedId('')
        try {
          const remote = (await getSolutions(nextUser.githubId)).map(normalizeSolution)
          if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current, active)) return
          setSolutions(remote)
          setSelectedId(remote[0]?.captureId ?? '')
        } catch {
          if (requestIsCurrent(fence, accountGeneration.current, solutionOperation.current, active)) setLoadError('라이브 풀이 목록을 불러오지 못했습니다.')
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('authError') !== 'github') return

    // The callback only exposes a fixed, safe error state. Never render an
    // arbitrary query value supplied by a failed OAuth provider.
    showToast('error', 'GitHub 로그인에 실패했습니다. 다시 시도해 주세요.')
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.delete('authError')
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
    const fence: RequestFence = { generation: accountGeneration.current, operation: ++solutionOperation.current }
    setLoading(true)
    setLoadError(null)
    try {
      const nextUser = await getMe()
      if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current)) return
      setUser(nextUser)
      setMode('live')
      setSolutions([])
      setSelectedId('')
      const remote = (await getSolutions(nextUser.githubId)).map(normalizeSolution)
      if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current)) return
      setSolutions(remote)
      setSelectedId(remote[0]?.captureId ?? '')
      showToast('success', '라이브 아카이브에 연결했습니다.')
    } catch (error) {
      if (!requestIsCurrent(fence, accountGeneration.current, solutionOperation.current)) return
      if (error instanceof ApiError && error.status === 401) {
        setMode('live')
        setUser(null)
        setSolutions([])
        setSelectedId('')
        showToast('info', '먼저 로그인하면 내 풀이를 불러올 수 있습니다.')
        setGithubLoginOpen(true)
      } else {
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
    const resetOperation = ++bridgeOperation.current
    setLoading(false)
    const capability = bridgeCapabilityRef.current
    const disconnectExtensionId = currentExtensionId.current
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
      setUser(null)
      setMode('demo')
      setSolutions(demoSolutions)
      setSelectedId(demoSolutions[0]?.captureId ?? '')
      setView('solutions')
      showToast('info', '로그아웃했습니다. 데모 모드로 돌아갑니다.')
    } finally {
      if (authMutationInFlight.current === operation) authMutationInFlight.current = null
    }
  }

  const connectBridge = async (silent = false, legacyOnly = false) => {
    if (authMutationInFlight.current !== null || !user || mode !== 'live' || connectInFlight.current) return false
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
    if (!user || mode !== 'live' || !autoConnect) return
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
  }, [user?.githubId, mode, autoConnect])

  const updateExportSettings = (next: ExportSettings) => {
    setExportSettings(next)
    try { localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify(next)) }
    catch { showToast('info', '설정은 현재 화면에 적용됐지만 브라우저에 저장하지 못했습니다.') }
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
          setMode('live')
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
        setUser(latestUser)
        setMode('live')
        setSolutions([])
        setSelectedId('')
        try {
          await refreshSolutions(accountGeneration.current, latestUser.githubId)
        } catch {
          // The cleared list is safer than retaining records from the previous account.
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
    anchor.download = downloadFilename(selectedSolution, exportSettings.filenameTemplate)
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
              전체 풀이 <span className="nav-count">{mode === 'demo' ? '샘플' : solutions.length}</span>
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
        {mode === 'demo' && (
          <section className="demo-banner" role="status">
            <div className="demo-banner-icon"><Icon name="spark" size={17} /></div>
            <div className="demo-banner-copy">
              <strong>데모 모드 · 예시 데이터</strong>
              <span>현재 화면은 CodeArchive의 샘플 풀이를 보여주고 있습니다. 로그인하면 내 아카이브로 전환됩니다.</span>
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
          />
        )}
        {view === 'guide' && (
          <GuideView onSettings={() => changeView('settings')} />
        )}
        {view === 'settings' && (
          <SettingsView
            user={user}
            exportSettings={exportSettings}
            updateExportSettings={updateExportSettings}
            previewSolution={selectedSolution ?? demoSolutions[0]}
            extensionId={extensionId}
            bridgeStatus={bridgeStatus}
            onConnect={() => { setAutoConnect(true); void connectBridge() }}
            onConnectLegacy={() => { setAutoConnect(true); void connectBridge(false, true) }}
            onDisconnect={() => { setAutoConnect(false); void resetBridge() }}
            onSync={() => void syncPending()}
            onLogin={() => setGithubLoginOpen(true)}
            onLogout={() => void handleLogout()}
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
  mode: 'demo' | 'live'
  setQuery: (value: string) => void
  setPlatformFilter: (value: 'ALL' | 'SWEA' | 'PROGRAMMERS') => void
  setLanguageFilter: (value: string) => void
  setSelectedId: (value: string) => void
  onCopy: () => void
  onDownload: () => void
}) {
  return (
    <section className="solutions-layout" aria-label="풀이 아카이브">
      <div className="solutions-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-dot" /> ARCHIVE / SOLUTIONS</p>
          <h1>전체 풀이 <span>{mode === 'demo' ? '샘플' : solutions.length}</span></h1>
          <p className="heading-subtitle">여러 플랫폼에 흩어진 풀이를 한 곳에서 살펴보세요.</p>
        </div>
        <div className="heading-meta"><span className="heading-meta-label">LAST SYNC</span><strong>{mode === 'demo' ? '샘플 데이터' : '방금 전'}</strong></div>
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
          <div className="list-footer"><span><span className="status-dot" /> {mode === 'demo' ? '예시 데이터' : '서버와 연결됨'}</span><span>{filteredSolutions.length} / {solutions.length}</span></div>
        </section>
        <SolutionDetail solution={selectedSolution} mode={mode} onCopy={onCopy} onDownload={onDownload} />
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

function SolutionDetail({ solution, mode, onCopy, onDownload }: { solution: Solution | null; mode: 'demo' | 'live'; onCopy: () => void; onDownload: () => void }) {
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
            <MetricCard label="메모리 사용량" value={formatMetric(solution.memoryUsage, ' MB')} icon="spark" />
            <MetricCard label="관측 시각" value={formatObservedTime(solution.observedAt ?? solution.solvedAt)} icon="check" />
          </div>
          <div className="code-toolbar"><div className="code-toolbar-title"><Icon name="code" size={16} /> 소스 코드 <span>{sourceFileExtension(solution.language)}</span></div><div className="code-actions"><button onClick={onCopy}><Icon name="copy" size={14} /> 복사</button><button onClick={onDownload}><Icon name="download" size={14} /> 다운로드</button></div></div>
          <CodeBlock code={solution.sourceCode} language={solution.language} />
          <div className="detail-note"><Icon name="spark" size={14} /><span>{mode === 'demo' ? '데모 예시 데이터입니다. 로그인하면 실제 확장 프로그램 기록으로 바뀝니다.' : '이 기록은 연결된 확장 프로그램에서 관측한 제출 결과를 바탕으로 합니다.'}</span></div>
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

function EmptyList({ mode }: { mode: 'demo' | 'live' }) {
  return <div className="empty-list"><div className="empty-list-icon"><Icon name="search" size={20} /></div><strong>{mode === 'live' ? '아직 저장된 풀이가 없습니다.' : '검색 결과가 없습니다.'}</strong><span>{mode === 'live' ? '확장 프로그램을 연결해 첫 풀이를 가져와 보세요.' : '검색어나 필터를 바꿔 다시 찾아보세요.'}</span></div>
}

function GuideView({ onSettings }: { onSettings: () => void }) {
  return (
    <section className="guide-page">
      <div className="page-heading"><p className="eyebrow"><span className="eyebrow-dot" /> GET STARTED / BRIDGE</p><h1>연동 가이드</h1><p>Chrome 확장 프로그램에서 저장한 제출 기록을 CodeArchive로 가져옵니다.</p></div>
      <div className="guide-grid">
        <article className="guide-card guide-hero"><div className="guide-hero-icon"><Icon name="link" size={25} /></div><div><span className="card-kicker">CODEARCHIVE BRIDGE</span><h2>3분 안에 첫 풀이를 모아보세요</h2><p>확장 프로그램이 문제 페이지의 제출 코드를 관측하고, 동기화할 때만 서버로 전송합니다.</p></div><button className="primary-button" onClick={onSettings}>브리지 설정하기 <Icon name="chevron" size={14} /></button></article>
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
  previewSolution,
  extensionId,
  bridgeStatus,
  onConnect,
  onConnectLegacy,
  onDisconnect,
  onSync,
  onLogin,
  onLogout,
}: {
  user: User | null
  exportSettings: ExportSettings
  updateExportSettings: (settings: ExportSettings) => void
  previewSolution: Solution
  extensionId: string
  bridgeStatus: 'disconnected' | 'connecting' | 'connected'
  onConnect: () => void
  onConnectLegacy: () => void
  onDisconnect: () => void
  onSync: () => void
  onLogin: () => void
  onLogout: () => void
}) {
  return (
    <section className="settings-page">
      <div className="page-heading"><p className="eyebrow"><span className="eyebrow-dot" /> WORKSPACE / SETTINGS</p><h1>설정</h1><p>CodeArchive가 문제 풀이를 가져오는 방법을 관리합니다.</p></div>
      <div className="settings-layout">
        <div className="settings-column">
          <article className="settings-card"><div className="settings-card-heading"><div className="settings-card-icon purple"><Icon name="link" size={18} /></div><div><h2>Chrome 확장 프로그램</h2><p>SWEA·프로그래머스 캡처 브리지</p></div><span className={`connection-state ${bridgeStatus}`}><i /> {bridgeStatus === 'connected' ? '연결됨' : bridgeStatus === 'connecting' ? '연결 중' : '연결 안 됨'}</span></div><div className="setting-field"><p>로그인하면 설치된 CodeArchive에 자동 연결합니다. 풀이 전송은 지금 동기화를 누를 때만 시작합니다.</p>{extensionId === LEGACY_EXTENSION_ID && <p role="status">이전 개발 확장에 연결됐습니다. 대기 풀이를 동기화한 뒤 고정 ID 버전으로 전환하세요. 기존 확장은 먼저 삭제하지 마세요.</p>}</div><div className="settings-actions"><button className="primary-button" onClick={onConnect} disabled={!user || bridgeStatus === 'connecting'}><Icon name="link" size={14} /> {bridgeStatus === 'connected' ? '다시 연결' : '연결 재시도'}</button>{bridgeStatus === 'connected' && <button className="ghost-button" onClick={onDisconnect}>연결 해제</button>}<button className="ghost-button" onClick={onSync} disabled={bridgeStatus !== 'connected'}><Icon name="sync" size={14} /> 지금 동기화</button></div></article>
          <details className="settings-card"><summary>이전 개발 확장에 남은 기록</summary><p>고정 ID 버전을 설치하기 전의 기록은 별도 저장소에 남습니다. 이전 확장을 삭제하지 않은 상태에서 연결한 뒤 지금 동기화를 눌러 가져오세요.</p><button className="secondary-button" onClick={onConnectLegacy} disabled={!user || bridgeStatus === 'connecting'}>이전 개발 기록 확인</button></details><article className="settings-card export-settings"><h2>코드 복사 · 다운로드</h2><p>문제 정보 주석을 추가합니다. 원본 코드의 주석은 유지합니다.</p>
            <label><input type="checkbox" checked={exportSettings.copyHeader} onChange={event => updateExportSettings({ ...exportSettings, copyHeader: event.target.checked })} /> 복사할 때 문제 정보 주석 포함</label>
            <label><input type="checkbox" checked={exportSettings.downloadHeader} onChange={event => updateExportSettings({ ...exportSettings, downloadHeader: event.target.checked })} /> 다운로드할 때 문제 정보 주석 포함</label>
            <div className="setting-field"><label htmlFor="filename-template">다운로드 파일명</label><input id="filename-template" maxLength={160} value={exportSettings.filenameTemplate} onChange={event => updateExportSettings({ ...exportSettings, filenameTemplate: event.target.value })} /><span className="field-help">{'{platform} · {number} · {title} · {language} 사용 가능. 확장자는 자동으로 붙습니다.'}</span><p>미리보기: <output>{downloadFilename(previewSolution, exportSettings.filenameTemplate)}</output></p></div>
          </article>
          <article className="settings-card github-card"><div className="settings-card-heading"><div className="settings-card-icon dark"><Icon name="github" size={19} /></div><div><h2>GitHub 연동</h2><p>풀이 파일과 README 자동 커밋</p></div><span className="coming-soon">UPCOMING</span></div><div className="disabled-integration"><span>저장소 선택과 커밋 범위 설정을 준비 중입니다.</span><button disabled>연동 시작</button></div></article>
        </div>
        <aside className="settings-sidebar"><article className="account-card"><span className="card-kicker">ACCOUNT</span>{user ? <><div className="account-large"><span className="account-avatar large"><Icon name="user" size={18} /></span><div><strong>{displayUser(user)}</strong><span>@{user.githubLogin} · CodeArchive 계정</span></div></div><button className="wide-ghost-button" onClick={onLogout}><Icon name="logout" size={14} /> 로그아웃</button></> : <><div className="account-logged-out"><div className="logged-out-icon"><Icon name="user" size={18} /></div><strong>로그인이 필요합니다</strong><span>내 풀이를 저장하고 동기화하세요.</span></div><button className="primary-button wide" onClick={onLogin}>GitHub로 로그인 <Icon name="github" size={14} /></button></>}</article><article className="privacy-card"><Icon name="check" size={16} /><div><strong>데이터를 직접 통제하세요</strong><p>자동 전송하지 않습니다. 동기화를 누른 순간에만 대기 중인 캡처를 확인합니다.</p></div></article></aside>
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
