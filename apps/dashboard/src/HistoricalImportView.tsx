import { useEffect, useRef, useState } from 'react'
import { requestBridge } from './bridge'
import { bulkUpload, getAccountSettings, getHistoricalGithubStatus, getHistoricalSubmissionIds, getMe, requestHistoricalGithubCommits } from './api'
import type { AccountSettings, Capture, User } from './types'

type Platform = 'JUNGOL' | 'SWEA' | 'PROGRAMMERS'
type Candidate = { submissionId?: string; problemNumber: string; title: string; language?: string; executionTime?: number; memoryValue?: number; solvedAt?: string }
type SelectionMode = 'all' | 'latest' | 'fastest' | 'lowest-memory'
type Preview = { status: string; candidates?: Candidate[]; skipped?: number; truncated?: boolean; scanProtocol?: number; paginationClicks?: number; remainingGroups?: number }
type ImportResult = { status: string; saved?: number; duplicate?: number; skipped?: number }
type ImportProgress = { completed: number; total: number; saved: number; duplicate: number; skipped: number; active: boolean; phase: 'local' | 'sync' | 'github' }
type CaptureSummary = { saved: number; problems: number; previouslySaved: number; historicalSaved: number; synced: number; syncedProblems: number }
type HistorySummary = Record<Platform, CaptureSummary>
const PLATFORMS: Platform[] = ['JUNGOL', 'SWEA', 'PROGRAMMERS']
const PLATFORM_LABEL: Record<Platform, string> = { JUNGOL: '정올', SWEA: 'SWEA', PROGRAMMERS: '프로그래머스' }

const HISTORY_URL: Record<Platform, string> = {
  JUNGOL: 'https://jungol.co.kr/',
  SWEA: 'https://swexpertacademy.com/main/userpage/code/userSubmitProblem.do',
  PROGRAMMERS: 'https://school.programmers.co.kr/learn/challenges?order=recent&statuses=solved%2Csolved_with_unlock&page=1',
}

function readHistory(response: unknown): Preview | null {
  if (!response || typeof response !== 'object' || !('history' in response)) return null
  const history = response.history
  if (!history || typeof history !== 'object' || !('status' in history) || typeof history.status !== 'string') return null
  return history as Preview
}

export function selectHistoricalSubmissionIds(candidates: Candidate[], mode: SelectionMode): string[] {
  if (mode === 'all') return candidates.flatMap(candidate => candidate.submissionId ? [candidate.submissionId] : [])
  const winners = new Map<string, Candidate>()
  const metric = (candidate: Candidate, key: 'executionTime' | 'memoryValue') => {
    const value = candidate[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY
  }
  for (const candidate of candidates) {
    if (!candidate.submissionId || !candidate.problemNumber) continue
    const previous = winners.get(candidate.problemNumber)
    if (!previous) { winners.set(candidate.problemNumber, candidate); continue }
    if (mode === 'latest') continue // Jungol's submission list is newest first.
    const primary = mode === 'fastest' ? 'executionTime' : 'memoryValue'
    const secondary = mode === 'fastest' ? 'memoryValue' : 'executionTime'
    if (metric(candidate, primary) < metric(previous, primary) ||
        (metric(candidate, primary) === metric(previous, primary) &&
         metric(candidate, secondary) < metric(previous, secondary))) winners.set(candidate.problemNumber, candidate)
  }
  const selected = new Set([...winners.values()].map(candidate => candidate.submissionId))
  return candidates.flatMap(candidate => candidate.submissionId && selected.has(candidate.submissionId) ? [candidate.submissionId] : [])
}

export function HistoricalImportView({ extensionId, capability, supported = true, user, mode, onImported }: {
  extensionId: string
  capability: string | null
  supported?: boolean
  user: User | null
  mode: 'local' | 'live'
  onImported: () => void
}) {
  const [platform, setPlatform] = useState<Platform>('JUNGOL')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [knownServerIds, setKnownServerIds] = useState<string[]>([])
  const [knownLocalIds, setKnownLocalIds] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [selectedSaved, setSelectedSaved] = useState<string[]>([])
  const [selectionModes, setSelectionModes] = useState<Record<Platform, SelectionMode>>({ JUNGOL: 'all', SWEA: 'all', PROGRAMMERS: 'all' })
  const selectionMode = selectionModes[platform]
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [summary, setSummary] = useState<HistorySummary | null>(null)
  const [githubTarget, setGithubTarget] = useState<AccountSettings | null>(null)
  const [serverCount, setServerCount] = useState<number | null>(null)
  const [githubStatuses, setGithubStatuses] = useState<Record<string, string> | null>(null)
  const activeRun = useRef<{ extensionId: string; accountId: number; capability: string } | null>(null)
  const currentConnection = useRef({ extensionId, capability })
  currentConnection.current = { extensionId, capability: activeRun.current?.capability ?? capability }
  const currentAccount = useRef({ id: user?.id, githubId: user?.githubId, mode })
  currentAccount.current = { id: user?.id, githubId: user?.githubId, mode }
  const accountIsCurrent = (id: number, githubId: string) =>
    currentAccount.current.id === id && currentAccount.current.githubId === githubId && currentAccount.current.mode === 'live'

  useEffect(() => {
    const running = activeRun.current
    if (running && running.extensionId === extensionId && running.accountId === user?.id && mode === 'live') return
    activeRun.current = null
    setPreview(null); setKnownServerIds([]); setKnownLocalIds([]); setSelected([]); setSelectedSaved([])
    setMessage(''); setImportProgress(null); setGithubTarget(null); setServerCount(null); setGithubStatuses(null)
  }, [extensionId, capability, user?.id, mode])

  const connectRun = async (accountId: number, githubId: string) => {
    const response = await requestBridge<{ capability?: string; features?: string[] }>(extensionId, { type: 'CONNECT' })
    if (!accountIsCurrent(accountId, githubId) || currentConnection.current.extensionId !== extensionId ||
        typeof response.capability !== 'string' || !response.capability ||
        !Array.isArray(response.features) || !response.features.includes('history-v1')) throw new Error('확장 연결 변경')
    activeRun.current = { extensionId, accountId, capability: response.capability }
    currentConnection.current = { extensionId, capability: response.capability }
    return response.capability
  }

  const runRequest = async <T extends object,>(accountId: number, githubId: string,
    message: Record<string, unknown>, timeoutMs?: number): Promise<T> => {
    const run = activeRun.current
    if (!run || run.extensionId !== extensionId || run.accountId !== accountId || !accountIsCurrent(accountId, githubId))
      throw new Error('로그인 계정 또는 확장 연결 변경')
    try {
      return await requestBridge<T>(extensionId, { ...message, capability: run.capability }, { timeoutMs })
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'UNAUTHORIZED') throw error
      await connectRun(accountId, githubId)
      if (!accountIsCurrent(accountId, githubId)) throw new Error('로그인 계정 변경')
      return requestBridge<T>(extensionId, { ...message, capability: activeRun.current!.capability }, { timeoutMs })
    }
  }

  const acknowledgeRunCaptures = async (accountId: number, githubId: string, captures: Capture[], accepted: string[]) => {
    if (accepted.length === 0) return
    const run = activeRun.current
    if (!run || run.extensionId !== extensionId || run.accountId !== accountId || !accountIsCurrent(accountId, githubId))
      throw new Error('계정 또는 확장 연결 변경')
    try {
      const ack = await requestBridge<{ ok?: boolean }>(extensionId,
        { type: 'ACK', capability: run.capability, captureIds: accepted })
      if (ack.ok !== true) throw new Error('로컬 동기화 표시 실패')
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'UNAUTHORIZED') throw error
      await connectRun(accountId, githubId)
      const requested = captures.filter(capture => accepted.includes(capture.captureId))
      const reissued = await runRequest<{ captures?: Capture[]; localOnly?: boolean }>(accountId, githubId,
        { type: 'GET_HISTORICAL_BY_SUBMISSION_IDS', platform: 'JUNGOL',
          submissionIds: requested.map(capture => capture.historicalSubmissionId) })
      if (reissued.localOnly !== true || !Array.isArray(reissued.captures) ||
          reissued.captures.length !== requested.length ||
          reissued.captures.some(capture => !requested.some(original =>
            original.captureId === capture.captureId && original.historicalSubmissionId === capture.historicalSubmissionId)))
        throw new Error('새 연결의 로컬 제출 응답 불일치')
      const ack = await requestBridge<{ ok?: boolean }>(extensionId,
        { type: 'ACK', capability: activeRun.current!.capability, captureIds: accepted })
      if (ack.ok !== true) throw new Error('로컬 동기화 표시 실패')
    }
  }

  useEffect(() => {
    if (!capability) { setSummary(null); return }
    let active = true
    void requestBridge<{ localOnly?: boolean; summary?: HistorySummary }>(extensionId,
      { type: 'GET_HISTORICAL_SUMMARY', capability })
      .then(response => {
        if (active && response.localOnly === true && response.summary) setSummary(response.summary)
      }).catch(() => { if (active) setSummary(null) })
    return () => { active = false }
  }, [extensionId, capability])

  const refreshLocalHistory = async () => {
    const localCapability = activeRun.current?.capability ?? capability
    if (!localCapability) return
    const [response, ids] = await Promise.all([
      requestBridge<{ localOnly?: boolean; summary?: HistorySummary }>(extensionId,
        { type: 'GET_HISTORICAL_SUMMARY', capability: localCapability }),
      requestBridge<{ localOnly?: boolean; submissionIds?: string[] }>(extensionId,
        { type: 'GET_HISTORICAL_SUBMISSION_IDS', capability: localCapability, platform: 'JUNGOL' }),
    ])
    if (currentConnection.current.extensionId === extensionId && currentConnection.current.capability === localCapability &&
        response.localOnly === true && response.summary) setSummary(response.summary)
    if (currentConnection.current.extensionId === extensionId && currentConnection.current.capability === localCapability &&
        ids.localOnly === true && Array.isArray(ids.submissionIds) &&
        ids.submissionIds.every(id => typeof id === 'string' && /^\d{1,40}$/.test(id))) setKnownLocalIds(ids.submissionIds)
  }

  const inspect = async () => {
    if (!user || mode !== 'live') { setMessage('CodeArchive에 로그인한 뒤 후보를 확인해 주세요.'); return }
    if (!capability || !supported) { setMessage('과거 풀이 기능이 포함된 확장 프로그램으로 업데이트해 주세요.'); return }
    const accountId = user.id, githubId = user.githubId
    setBusy(true)
    setPreview(null)
    setKnownServerIds([])
    setKnownLocalIds([])
    setGithubTarget(null)
    setSelected([])
    setSelectedSaved([])
    setImportProgress(null)
    setMessage(platform === 'JUNGOL' ? '이전 제출과 접힌 제출을 모두 확인 중입니다. 목록 크기에 따라 최대 2분 정도 걸릴 수 있습니다…' : '후보 목록을 확인 중입니다…')
    try {
      const authenticated = await getMe()
      if (!accountIsCurrent(accountId, githubId) || authenticated.id !== accountId || authenticated.githubId !== githubId) throw new Error('로그인 계정 변경')
      const response = await requestBridge(extensionId, { type: 'HISTORY_PREVIEW', capability, platform }, { timeoutMs: 150_000 })
      if (currentConnection.current.extensionId !== extensionId || currentConnection.current.capability !== capability || !accountIsCurrent(accountId, githubId)) return
      const result = readHistory(response)
      if (!result) throw new Error('후보 응답을 읽을 수 없습니다.')
      if (platform === 'JUNGOL' && result.status === 'READY' &&
          (result.scanProtocol !== 3 || typeof result.truncated !== 'boolean' ||
            !Number.isSafeInteger(result.paginationClicks) || result.paginationClicks! < 0 ||
            (result.truncated === false && result.paginationClicks === 0))) {
        setMessage('정올 제출 탭에서 이전 버전의 수집 코드가 응답했습니다. Chrome 확장 프로그램을 새로고침하고 정올 제출 탭도 새로고침한 뒤 다시 확인해 주세요.')
        return
      }
      if (result.status === 'READY') {
        const candidates = Array.isArray(result.candidates) ? result.candidates : []
        let available = candidates
        if (platform === 'JUNGOL') {
          const serverIds = await getHistoricalSubmissionIds(githubId)
          if (currentConnection.current.extensionId !== extensionId || currentConnection.current.capability !== capability || !accountIsCurrent(accountId, githubId)) return
          if (!Array.isArray(serverIds) || serverIds.some(id => typeof id !== 'string' || !/^\d{1,40}$/.test(id))) throw new Error('서버 중복 확인 실패')
          setKnownServerIds(serverIds)
          setServerCount(serverIds.length)
          const local = await requestBridge<{ localOnly?: boolean; submissionIds?: string[] }>(extensionId,
            { type: 'GET_HISTORICAL_SUBMISSION_IDS', capability, platform: 'JUNGOL' })
          if (currentConnection.current.extensionId !== extensionId || currentConnection.current.capability !== capability || !accountIsCurrent(accountId, githubId)) return
          if (local.localOnly !== true || !Array.isArray(local.submissionIds) ||
              local.submissionIds.some(id => typeof id !== 'string' || !/^\d{1,40}$/.test(id))) throw new Error('로컬 제출 확인 실패')
          setKnownLocalIds(local.submissionIds)
          const statuses = await getHistoricalGithubStatus(githubId).catch(() => null)
          if (!accountIsCurrent(accountId, githubId)) return
          setGithubStatuses(statuses)
          const settings = await getAccountSettings(githubId).catch(() => null)
          if (!accountIsCurrent(accountId, githubId)) return
          setGithubTarget(settings?.githubTargetConfigured ? settings : null)
          const savedSet = new Set(serverIds)
          available = candidates.filter(candidate => !candidate.submissionId || !savedSet.has(candidate.submissionId))
        }
        setPreview(result)
        setSelected(platform === 'JUNGOL' ? selectHistoricalSubmissionIds(available, selectionMode) : [])
        setMessage(platform === 'JUNGOL'
          ? `${result.truncated ? '현재 확인된 가져올 정답 제출 후보' : '가져올 정답 제출 후보'} ${available.length}건. ${result.truncated ? `목록 탐색이 끝나지 않아 가져올 수 없습니다.${result.remainingGroups ? ` 접힌 그룹 ${result.remainingGroups}개가 남았습니다.` : ''} 후보 확인을 다시 누르면 열린 목록에서 이어서 확인합니다.` : '목록 탐색 완료.'}`
          : `해결 문제 후보 ${candidates.length}건 · 제외 ${result.skipped ?? 0}건. 이 목록은 제출별 내역이 아니므로 선택 기준은 아직 적용되지 않습니다.`)
      } else if (result.status === 'TAB_NOT_FOUND') setMessage('해당 사이트의 제출 내역 탭을 하나 열어 주세요.')
      else if (result.status === 'MULTIPLE_TABS') setMessage('같은 사이트의 제출 내역 탭이 여러 개입니다. 하나만 남겨 주세요.')
      else if (result.status === 'ACCESS_DENIED') setMessage('제출 내역 접근 권한이 없습니다. 해당 계정으로 로그인해 주세요.')
      else setMessage('로그인 상태와 본인 제출 목록인지 확인해 주세요.')
    } catch { setMessage('로그인 상태 또는 서버 중복 기록을 확인할 수 없습니다. CodeArchive 로그인과 API 연결을 확인해 주세요.') }
    finally { setBusy(false) }
  }

  const importSelected = async (action: 'sync' | 'github') => {
    if (!user || mode !== 'live') { setMessage('CodeArchive에 로그인한 뒤 다시 확인해 주세요.'); return }
    if (!capability || platform !== 'JUNGOL' || selected.length === 0 ||
        preview?.status !== 'READY' || preview.truncated !== false ||
        preview.scanProtocol !== 3 || !preview.paginationClicks) return
    const accountId = user.id, githubId = user.githubId
    const expectedTarget = githubTarget
    if (action === 'github' && (!expectedTarget?.githubTargetConfigured || !expectedTarget.githubInstallationId ||
        !expectedTarget.githubOwner || !expectedTarget.githubRepository || !expectedTarget.githubBranch)) {
      setMessage('GitHub 저장소 대상을 먼저 설정해 주세요.'); return
    }
    setBusy(true)
    setMessage(`본인 제출·정답·원본 코드·제출 시각을 확인하며 로컬에 저장 중입니다… 0/${selected.length}`)
    setImportProgress({ completed: 0, total: selected.length, saved: 0, duplicate: 0, skipped: 0, active: true, phase: 'local' })
    let completed = 0
    let synced = 0
    let requestedCommits = 0
    let stage: 'local' | 'sync' | 'github' = 'local'
    try {
      const authenticated = await getMe()
      if (!accountIsCurrent(accountId, githubId) || authenticated.id !== accountId || authenticated.githubId !== githubId) throw new Error('로그인 계정 변경')
      const latestServerIds = await getHistoricalSubmissionIds(githubId)
      if (!Array.isArray(latestServerIds) || latestServerIds.some(id => typeof id !== 'string' || !/^\d{1,40}$/.test(id))) throw new Error('서버 중복 확인 실패')
      if (!accountIsCurrent(accountId, githubId)) return
      if (action === 'github' && expectedTarget) {
        const currentTarget = await getAccountSettings(githubId)
        if (!accountIsCurrent(accountId, githubId) || currentTarget.version !== expectedTarget.version ||
            currentTarget.githubInstallationId !== expectedTarget.githubInstallationId ||
            currentTarget.githubOwner !== expectedTarget.githubOwner ||
            currentTarget.githubRepository !== expectedTarget.githubRepository ||
            currentTarget.githubBranch !== expectedTarget.githubBranch) throw new Error('GitHub 대상 변경')
      }
      await connectRun(accountId, githubId)
      const freshSelected = selected.filter(id => !latestServerIds.includes(id))
      if (freshSelected.length !== selected.length) {
        setKnownServerIds(latestServerIds)
        setServerCount(latestServerIds.length)
        setSelected(freshSelected)
        setMessage('서버 기록이 변경되어 중복 후보를 제외했습니다. 선택 내용을 확인한 뒤 다시 시작해 주세요.')
        setImportProgress(null)
        return
      }
      let saved = 0, duplicate = 0, skipped = 0
      const verifiedSubmissionIds: string[] = []
      for (const submissionId of selected) {
        if (!accountIsCurrent(accountId, githubId)) throw new Error('로그인 계정 변경')
        const response = await runRequest<{ history?: ImportResult }>(accountId, githubId,
          { type: 'HISTORY_IMPORT', platform, submissionIds: [submissionId] }, 240_000)
        if (currentConnection.current.extensionId !== extensionId || !activeRun.current || !accountIsCurrent(accountId, githubId)) return
        const result = response.history
        if (result?.status !== 'DONE') {
          setMessage(`가져오기 중단 · ${completed}/${selected.length}건 처리. 로컬 보관함을 확인한 뒤 다시 시도해 주세요.`)
          setImportProgress({ completed, total: selected.length, saved, duplicate, skipped, active: false, phase: 'local' })
          await refreshLocalHistory().catch(() => undefined)
          onImported()
          return
        }
        saved += result.saved ?? 0; duplicate += result.duplicate ?? 0; skipped += result.skipped ?? 0
        if ((result.saved ?? 0) + (result.duplicate ?? 0) === 1 && (result.skipped ?? 0) === 0) verifiedSubmissionIds.push(submissionId)
        completed += 1
        setImportProgress({ completed, total: selected.length, saved, duplicate, skipped, active: true, phase: 'local' })
        setMessage(`로컬 저장 중 ${completed}/${selected.length}건 · 신규 ${saved} · 중복 ${duplicate} · 제외 ${skipped}`)
      }
      setMessage(`로컬 저장 ${saved}건 · 중복 ${duplicate}건 · 제외 ${skipped}건. 서버 동기화를 확인 중입니다…`)
      stage = 'sync'
      setImportProgress({ completed: 0, total: verifiedSubmissionIds.length || 1, saved, duplicate, skipped, active: verifiedSubmissionIds.length > 0, phase: 'sync' })
      await refreshLocalHistory().catch(() => undefined)
      const syncedSubmissionIds: string[] = []
      for (let offset = 0; offset < verifiedSubmissionIds.length; offset += 50) {
        if (!accountIsCurrent(accountId, githubId)) throw new Error('로그인 계정 변경')
        const authenticated = await getMe()
        if (authenticated.id !== accountId || authenticated.githubId !== githubId || !accountIsCurrent(accountId, githubId)) throw new Error('로그인 계정 변경')
        const requested = verifiedSubmissionIds.slice(offset, offset + 50)
        const archive = await runRequest<{ captures?: Capture[]; localOnly?: boolean }>(accountId, githubId,
          { type: 'GET_HISTORICAL_BY_SUBMISSION_IDS', platform, submissionIds: requested })
        if (archive.localOnly !== true || !Array.isArray(archive.captures) ||
            archive.captures.some(capture => capture.platform !== 'JUNGOL' || capture.historicalImport !== true ||
              !capture.historicalSubmissionId || !requested.includes(capture.historicalSubmissionId))) throw new Error('로컬 제출 응답 불일치')
        if (archive.captures.length !== requested.length ||
            new Set(archive.captures.map(capture => capture.historicalSubmissionId)).size !== requested.length)
          throw new Error('검증된 로컬 제출을 찾지 못함')
        const response = await bulkUpload(archive.captures, githubId)
        const sent = new Set(archive.captures.map(capture => capture.captureId))
        const accepted = [...new Set(response.acceptedCaptureIds ?? [])]
        if (accepted.some(id => !sent.has(id))) throw new Error('서버 수락 응답 불일치')
        await acknowledgeRunCaptures(accountId, githubId, archive.captures, accepted)
        synced += accepted.length
        syncedSubmissionIds.push(...archive.captures.filter(capture => accepted.includes(capture.captureId)).map(capture => capture.historicalSubmissionId!))
        setImportProgress({ completed: Math.min(offset + 50, verifiedSubmissionIds.length), total: verifiedSubmissionIds.length, saved, duplicate, skipped, active: true, phase: 'sync' })
        setMessage(`서버 동기화 중 ${Math.min(offset + 50, verifiedSubmissionIds.length)}/${verifiedSubmissionIds.length}건 확인 · 서버 저장 ${synced}건`)
        if ((response.failures?.length ?? 0) > 0 || accepted.length !== archive.captures.length) throw new Error('일부 서버 저장 실패')
      }
      if (action === 'github' && expectedTarget && expectedTarget.githubInstallationId && expectedTarget.githubOwner && expectedTarget.githubRepository && expectedTarget.githubBranch) {
        stage = 'github'
        setImportProgress({ completed: 0, total: syncedSubmissionIds.length || 1, saved, duplicate, skipped, active: syncedSubmissionIds.length > 0, phase: 'github' })
        for (let offset = 0; offset < syncedSubmissionIds.length; offset += 50) {
          if (!accountIsCurrent(accountId, githubId)) throw new Error('로그인 계정 변경')
          const authenticated = await getMe()
          if (authenticated.id !== accountId || authenticated.githubId !== githubId) throw new Error('로그인 계정 변경')
          const batch = syncedSubmissionIds.slice(offset, offset + 50)
          const states = await requestHistoricalGithubCommits(githubId, { submissionIds: batch,
            settingsVersion: expectedTarget.version, installationId: expectedTarget.githubInstallationId,
            owner: expectedTarget.githubOwner, repository: expectedTarget.githubRepository, branch: expectedTarget.githubBranch })
          if (Object.keys(states).length !== batch.length || batch.some(id => !states[id])) throw new Error('GitHub 작업 응답 불일치')
          requestedCommits += batch.length
          setGithubStatuses(current => ({ ...current, ...states }))
          setImportProgress({ completed: requestedCommits, total: syncedSubmissionIds.length, saved, duplicate, skipped, active: true, phase: 'github' })
          setMessage(`GitHub 커밋 요청 ${requestedCommits}/${syncedSubmissionIds.length}건 접수 · 완료 여부는 GitHub 작업 상태에서 확인해 주세요.`)
        }
        setMessage(`로컬 신규 ${saved}건 · 서버 동기화 ${synced}건 · GitHub 커밋 요청 ${requestedCommits}건 접수. 커밋 완료 여부는 별도로 확인해 주세요.`)
      } else setMessage(`로컬 신규 ${saved}건 · 서버 동기화 ${synced}건 · 중복 ${duplicate}건 · 제외 ${skipped}건. GitHub 커밋은 실행되지 않았습니다.`)
      const refreshedIds = await getHistoricalSubmissionIds(githubId).catch(() => null)
      if (refreshedIds && accountIsCurrent(accountId, githubId)) { setKnownServerIds(refreshedIds); setServerCount(refreshedIds.length) }
      const refreshedStatuses = await getHistoricalGithubStatus(githubId).catch(() => null)
      if (refreshedStatuses && accountIsCurrent(accountId, githubId)) setGithubStatuses(refreshedStatuses)
      setImportProgress(current => current ? { ...current, active: false } : null)
      await refreshLocalHistory().catch(() => undefined)
      if (currentConnection.current.extensionId === extensionId && accountIsCurrent(accountId, githubId)) onImported()
    } catch {
      if (!accountIsCurrent(accountId, githubId)) return
      setMessage(stage === 'github'
        ? `서버 동기화 ${synced}건 완료 · GitHub 커밋 요청 ${requestedCommits}건 접수 후 중단되었습니다. GitHub 상태를 확인해 주세요.`
        : stage === 'sync'
          ? `로컬 ${completed}/${selected.length}건 검증 후 서버 동기화 ${synced}건까지 확인했습니다. 서버 기록을 확인한 뒤 다시 시도해 주세요.`
          : `가져오기를 마치지 못했습니다. 로컬 ${completed}/${selected.length}건까지 응답을 받았습니다. 다시 시도해 주세요.`)
      setImportProgress(current => current ? { ...current, active: false } : null)
      await refreshLocalHistory().catch(() => undefined)
      onImported()
    }
    finally { activeRun.current = null; setBusy(false) }
  }

  const recoverSaved = async (action: 'sync' | 'github') => {
    if (!user || mode !== 'live' || !capability || selectedSaved.length === 0 || platform !== 'JUNGOL') return
    const accountId = user.id, githubId = user.githubId
    const requestedIds = [...selectedSaved]
    const expectedTarget = githubTarget
    if (action === 'github' && (!expectedTarget?.githubTargetConfigured || !expectedTarget.githubInstallationId ||
        !expectedTarget.githubOwner || !expectedTarget.githubRepository || !expectedTarget.githubBranch)) {
      setMessage('GitHub 저장소 대상을 먼저 설정해 주세요.'); return
    }
    setBusy(true)
    setImportProgress({ completed: 0, total: requestedIds.length, saved: 0, duplicate: 0, skipped: 0, active: true, phase: 'sync' })
    let acknowledged = 0, requestedCommits = 0
    let stage: 'sync' | 'github' = 'sync'
    try {
      const authenticated = await getMe()
      if (!accountIsCurrent(accountId, githubId) || authenticated.id !== accountId || authenticated.githubId !== githubId) throw new Error('로그인 계정 변경')
      const serverIds = await getHistoricalSubmissionIds(githubId)
      if (!Array.isArray(serverIds) || requestedIds.some(id => !serverIds.includes(id))) throw new Error('서버 저장 기록 변경')
      if (action === 'github' && expectedTarget) {
        const currentTarget = await getAccountSettings(githubId)
        if (!accountIsCurrent(accountId, githubId) || currentTarget.version !== expectedTarget.version ||
            currentTarget.githubInstallationId !== expectedTarget.githubInstallationId ||
            currentTarget.githubOwner !== expectedTarget.githubOwner ||
            currentTarget.githubRepository !== expectedTarget.githubRepository ||
            currentTarget.githubBranch !== expectedTarget.githubBranch) throw new Error('GitHub 대상 변경')
      }
      await connectRun(accountId, githubId)
      for (let offset = 0; offset < requestedIds.length; offset += 50) {
        if (!accountIsCurrent(accountId, githubId)) throw new Error('로그인 계정 변경')
        const batch = requestedIds.slice(offset, offset + 50)
        const archive = await runRequest<{ captures?: Capture[]; localOnly?: boolean }>(accountId, githubId,
          { type: 'GET_HISTORICAL_BY_SUBMISSION_IDS', platform, submissionIds: batch })
        if (archive.localOnly !== true || !Array.isArray(archive.captures) || archive.captures.length !== batch.length ||
            new Set(archive.captures.map(capture => capture.historicalSubmissionId)).size !== batch.length ||
            archive.captures.some(capture => capture.platform !== 'JUNGOL' || capture.historicalImport !== true ||
              !capture.historicalSubmissionId || !batch.includes(capture.historicalSubmissionId))) throw new Error('로컬 제출 응답 불일치')
        const checked = await getMe()
        if (!accountIsCurrent(accountId, githubId) || checked.id !== accountId || checked.githubId !== githubId) throw new Error('로그인 계정 변경')
        const response = await bulkUpload(archive.captures, githubId)
        const sent = new Set(archive.captures.map(capture => capture.captureId))
        const accepted = [...new Set(response.acceptedCaptureIds ?? [])]
        if (accepted.some(id => !sent.has(id))) throw new Error('서버 수락 응답 불일치')
        await acknowledgeRunCaptures(accountId, githubId, archive.captures, accepted)
        acknowledged += accepted.length
        setImportProgress({ completed: Math.min(offset + 50, requestedIds.length), total: requestedIds.length,
          saved: 0, duplicate: 0, skipped: 0, active: true, phase: 'sync' })
        setMessage(`서버 저장 기록을 다시 확인하고 로컬 동기화 표시 복구 중 ${acknowledged}/${requestedIds.length}건`)
        if ((response.failures?.length ?? 0) > 0 || accepted.length !== archive.captures.length) throw new Error('일부 서버 저장 실패')
      }
      if (action === 'github' && expectedTarget?.githubInstallationId && expectedTarget.githubOwner &&
          expectedTarget.githubRepository && expectedTarget.githubBranch) {
        stage = 'github'
        setImportProgress({ completed: 0, total: requestedIds.length, saved: 0, duplicate: 0, skipped: 0, active: true, phase: 'github' })
        for (let offset = 0; offset < requestedIds.length; offset += 50) {
          const checked = await getMe()
          if (!accountIsCurrent(accountId, githubId) || checked.id !== accountId || checked.githubId !== githubId) throw new Error('로그인 계정 변경')
          const batch = requestedIds.slice(offset, offset + 50)
          const states = await requestHistoricalGithubCommits(githubId, { submissionIds: batch,
            settingsVersion: expectedTarget.version, installationId: expectedTarget.githubInstallationId,
            owner: expectedTarget.githubOwner, repository: expectedTarget.githubRepository, branch: expectedTarget.githubBranch })
          if (Object.keys(states).length !== batch.length || batch.some(id => !states[id])) throw new Error('GitHub 작업 응답 불일치')
          requestedCommits += batch.length
          setGithubStatuses(current => ({ ...current, ...states }))
          setImportProgress({ completed: requestedCommits, total: requestedIds.length,
            saved: 0, duplicate: 0, skipped: 0, active: true, phase: 'github' })
        }
      }
      setMessage(action === 'github'
        ? `서버 저장 ${acknowledged}건 재확인 · GitHub 커밋 요청 ${requestedCommits}건 접수. 커밋 완료 여부는 상태에서 확인해 주세요.`
        : `서버 저장 ${acknowledged}건을 재확인하고 로컬 동기화 표시를 복구했습니다.`)
      setSelectedSaved([])
      setImportProgress(current => current ? { ...current, active: false } : null)
      await refreshLocalHistory().catch(() => undefined)
      const statuses = await getHistoricalGithubStatus(githubId).catch(() => null)
      if (statuses && accountIsCurrent(accountId, githubId)) setGithubStatuses(statuses)
      if (accountIsCurrent(accountId, githubId)) onImported()
    } catch {
      if (!accountIsCurrent(accountId, githubId)) return
      setMessage(stage === 'github'
        ? `서버 기록 ${acknowledged}건 재확인 후 GitHub 요청 ${requestedCommits}건까지 접수했습니다. 상태를 확인한 뒤 다시 시도해 주세요.`
        : `서버 기록 ${acknowledged}/${requestedIds.length}건을 재확인했습니다. 남은 제출은 다시 시도할 수 있습니다.`)
      setImportProgress(current => current ? { ...current, active: false } : null)
      await refreshLocalHistory().catch(() => undefined)
      onImported()
    } finally { activeRun.current = null; setBusy(false) }
  }

  const savedIds = new Set(knownServerIds)
  const localIds = new Set(knownLocalIds)
  const candidates = preview?.status === 'READY' && Array.isArray(preview.candidates)
    ? preview.candidates.filter(candidate => !candidate.submissionId || !savedIds.has(candidate.submissionId)) : []
  const savedCandidates = platform === 'JUNGOL' && preview?.status === 'READY' && Array.isArray(preview.candidates)
    ? preview.candidates.filter(candidate => candidate.submissionId && savedIds.has(candidate.submissionId) && localIds.has(candidate.submissionId)) : []
  return <section className="historical-import" aria-label="과거 풀이 가져오기">
    <div className="historical-import-heading"><div><p className="eyebrow">ARCHIVE / IMPORT</p><h1>과거 풀이 가져오기</h1><p>이미 제출한 풀이를 확인하고 선택해서 가져옵니다. 과거 풀이의 자동 커밋은 하지 않습니다.</p></div></div>
    <div className="historical-import-controls">
      <label>사이트 <select aria-label="가져올 사이트" value={platform} disabled={busy} onChange={event => { setPlatform(event.target.value as Platform); setPreview(null); setSelected([]); setMessage('') }}><option value="JUNGOL">정올</option><option value="SWEA">SWEA</option><option value="PROGRAMMERS">프로그래머스</option></select></label>
      <label>동일 문제 제출 선택 <select aria-label="동일 문제 제출 선택" value={selectionMode} disabled={busy} onChange={event => {
        const mode = event.target.value as SelectionMode
        setSelectionModes(current => ({ ...current, [platform]: mode }))
        if (platform === 'JUNGOL' && preview?.status === 'READY') setSelected(selectHistoricalSubmissionIds(candidates, mode))
      }}><option value="all">정답 제출 전체</option><option value="latest">문제별 최신 제출</option><option value="fastest">문제별 실행시간 최소</option><option value="lowest-memory">문제별 메모리 최소</option></select></label>
      <a href={HISTORY_URL[platform]} target="_blank" rel="noreferrer">제출 내역 열기 ↗</a>
      <button type="button" onClick={() => void inspect()} disabled={busy || !capability || !supported || !user || mode !== 'live'}>열린 탭에서 후보 확인</button>
    </div>
    <p className="historical-import-note">{platform === 'JUNGOL' ? '정올 내 정보 → 제출 현황에서 본인 목록을 열어 주세요. ' : '제출 내역 페이지에서 로그인 후 본인 목록을 열어 주세요. '}확장 프로그램이 그 탭의 내용을 확인하며, 대시보드는 원본 코드를 목록에 노출하지 않습니다.</p>
    {platform === 'JUNGOL' && <p className="historical-import-note">최신 제출은 정올 목록의 표시 순서를 따릅니다. 실행시간·메모리가 같으면 다른 수치가 낮은 제출, 그래도 같으면 최신 제출을 선택합니다. 아래 체크박스로 개별 조정할 수 있습니다.</p>}
    {platform !== 'JUNGOL' && <p className="historical-import-note">{PLATFORM_LABEL[platform]}는 현재 문제별 후보만 확인할 수 있습니다. 위 기준은 이 화면에서 선택할 수 있지만 제출별 원본·시간·메모리 검증이 구현된 뒤 적용됩니다. 지금은 여러 제출 중 하나를 선택하거나 가져올 수 없습니다.</p>}
    {capability && !supported && <p role="status" className="historical-import-status">현재 설치된 확장 프로그램에는 과거 풀이 기능이 없습니다. 새 확장 프로그램을 설치한 뒤 새로고침해 주세요.</p>}
    {(!user || mode !== 'live') && <p role="status" className="historical-import-status">CodeArchive 로그인과 서버 연결을 확인한 뒤 과거 풀이를 시작할 수 있습니다.</p>}
    {message && <p role="status" className="historical-import-status">{message}</p>}
    {importProgress && <div className={`historical-import-progress${importProgress.active ? ' is-active' : ''}`}>
      <progress aria-label="과거 풀이 가져오기 진행률" value={importProgress.completed} max={importProgress.total} />
      <span>{importProgress.phase === 'local' ? '로컬 검증' : importProgress.phase === 'sync' ? '서버 동기화' : 'GitHub 커밋 요청'} {importProgress.completed}/{importProgress.total}건 처리{importProgress.active && importProgress.completed < importProgress.total && importProgress.phase === 'local' ? ` · ${importProgress.completed + 1}번째 제출 확인 중` : ''}</span>
    </div>}
    {candidates.length > 0 && <div className="historical-import-list">
      {platform === 'JUNGOL' && <div className="historical-import-selection"><button type="button" disabled={busy} onClick={() => setSelected(selectHistoricalSubmissionIds(candidates, 'all'))}>전체 선택</button><button type="button" disabled={busy} onClick={() => setSelected([])}>선택 해제</button></div>}
      {candidates.map((candidate, index) => <label key={candidate.submissionId ?? `${candidate.problemNumber}-${index}`}>
        {platform === 'JUNGOL' && candidate.submissionId && <input type="checkbox" checked={selected.includes(candidate.submissionId)} disabled={busy} onChange={event => setSelected(current => event.target.checked ? [...current, candidate.submissionId!] : current.filter(id => id !== candidate.submissionId))} />}
        <span>#{candidate.problemNumber} · {candidate.title}</span><small>{candidate.submissionId ? `제출 #${candidate.submissionId} · ` : ''}{candidate.language ?? ''}{candidate.executionTime !== undefined ? ` · ${candidate.executionTime}ms` : ''}{candidate.memoryValue !== undefined ? ` · ${candidate.memoryValue}MB` : ''}{candidate.solvedAt ? ` · ${candidate.solvedAt}` : ''}</small>
      </label>)}
    </div>}
    {savedCandidates.length > 0 && <div className="historical-import-list">
      <h2>이미 서버에 저장된 이 브라우저의 제출</h2>
      <p>새 가져오기 후보에서는 제외했습니다. 로컬 동기화 표시를 복구하거나, 선택한 제출의 GitHub 커밋을 나중에 요청할 수 있습니다.</p>
      {savedCandidates.map(candidate => <label key={`saved-${candidate.submissionId}`}>
        <input type="checkbox" checked={selectedSaved.includes(candidate.submissionId!)} disabled={busy}
          onChange={event => setSelectedSaved(current => event.target.checked ? [...current, candidate.submissionId!] : current.filter(id => id !== candidate.submissionId))} />
        <span>#{candidate.problemNumber} · {candidate.title}</span><small>제출 #{candidate.submissionId}</small>
      </label>)}
      {preview?.truncated === false && <div className="historical-import-actions">
        <button type="button" disabled={busy || selectedSaved.length === 0} onClick={() => void recoverSaved('sync')}>선택한 {selectedSaved.length}건 동기화 확인</button>
        <button type="button" disabled={busy || selectedSaved.length === 0 || !githubTarget?.githubTargetConfigured}
          onClick={() => void recoverSaved('github')}>선택한 저장 제출 GitHub 커밋까지 진행</button>
      </div>}
    </div>}
    {preview?.status === 'READY' && preview.truncated && <p className="historical-import-note">제출 목록이 아직 로딩 중이거나 일부 그룹을 확인하지 못했습니다. 정올 탭을 유지한 채 후보 확인을 다시 누르면 이어서 확인합니다.</p>}
    {platform === 'JUNGOL' && candidates.length > 0 && preview?.truncated === false && preview.scanProtocol === 3 && !!preview.paginationClicks && <div className="historical-import-actions">
      <p>선택 {selected.length}건을 검증해 로컬에 저장하고, 검증된 제출만 최대 {selected.length}건 서버에 동기화합니다. GitHub 커밋을 선택하면 최대 {selected.length}건의 작업을 요청합니다.{githubTarget?.githubTargetConfigured ? ` 대상: ${githubTarget.githubOwner}/${githubTarget.githubRepository} · ${githubTarget.githubBranch}${githubTarget.githubRootPath ? ` · ${githubTarget.githubRootPath}` : ''}` : ' GitHub 대상이 설정되지 않아 커밋 선택은 사용할 수 없습니다.'}</p>
      <button className="historical-import-action" type="button" onClick={() => void importSelected('sync')} disabled={busy || selected.length === 0 || !user || mode !== 'live'}>선택한 {selected.length}건 동기화</button>
      <button className="historical-import-action" type="button" onClick={() => void importSelected('github')} disabled={busy || selected.length === 0 || !user || mode !== 'live' || !githubTarget?.githubTargetConfigured}>GitHub 커밋까지 진행</button>
    </div>}
    {platform !== 'JUNGOL' && preview?.status === 'READY' && <p className="historical-import-note">{platform === 'SWEA' ? 'SWEA는 각 문제의 My제출·Pass·원본 코드가 확인돼야 저장할 수 있습니다.' : '프로그래머스 해결 목록에는 제출 원본 코드가 없어 저장할 수 없습니다.'} 현재는 후보 미리보기만 지원합니다.</p>}
    <div className="historical-import-saved"><h2>사이트별 저장 현황</h2><button type="button" disabled={!capability || busy} onClick={() => void refreshLocalHistory().catch(() => setSummary(null))}>현황 새로고침</button>
      {!summary ? <p>확장 프로그램의 로컬 저장 현황을 확인할 수 없습니다.</p> : <ul>{PLATFORMS.map(site => {
        const row = summary[site]
        const inspected = site === platform && preview?.status === 'READY' && preview.truncated !== true
        const candidateCount = inspected ? candidates.length : null
        const siteProblems = inspected ? new Set(candidates.map(candidate => candidate.problemNumber)).size : null
        const jobStates = site === 'JUNGOL' && githubStatuses ? Object.values(githubStatuses) : null
        return <li key={site}><strong>{PLATFORM_LABEL[site]}</strong><span>정답 후보 {candidateCount === null ? '미확인' : `${candidateCount}건`} · 고유 문제 {siteProblems === null ? '미확인' : `${siteProblems}개`}</span><span>이 브라우저: 기존 저장 {row.previouslySaved}건 + 과거 가져오기 {row.historicalSaved}건 · 고유 문제 {row.problems}개 · 로컬 동기화 표시 {row.synced}건 ({row.syncedProblems}문제)</span>{site === 'JUNGOL' && <span>서버 저장 {serverCount === null ? '미확인' : `${serverCount}건`} · GitHub 커밋 완료 {jobStates === null ? '미확인' : `${jobStates.filter(state => state === 'SUCCEEDED').length}건`} · 대기 {jobStates === null ? '미확인' : `${jobStates.filter(state => state === 'PENDING' || state === 'RUNNING').length}건`} · 실패·확인 필요 {jobStates === null ? '미확인' : `${jobStates.filter(state => state === 'FAILED' || state === 'UNKNOWN').length}건`}</span>}</li>
      })}</ul>}
      <p>정답 후보는 열린 목록에서 확인한 범위입니다. 로컬 수치는 이 브라우저 전체 기록이며, 서버·GitHub 수치는 로그인한 CodeArchive 계정을 기준으로 합니다.</p>
    </div>
  </section>
}
