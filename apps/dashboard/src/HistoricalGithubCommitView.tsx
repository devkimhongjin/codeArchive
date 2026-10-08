import { useDesktopWork } from './DesktopActivity'
import { useEffect, useRef, useState } from 'react'
import { getAccountSettings, getHistoricalCommitCandidates, getMe, requestHistoricalCommitBatch, reconcileHistoricalCommit } from './api'
import { gitPath } from './codeExport'
import { HISTORY_PLATFORMS, historyPlatformLabel, historyProblemCount, isHistoricalRecord } from './historicalRecords'
import type { AccountSettings, HistoricalCommitCandidate, HistoricalCommitState, Platform, User } from './types'

const stateLabel: Record<HistoricalCommitState, string> = { NONE: '미요청', PENDING: '대기', RUNNING: '진행 중', SUCCEEDED: '완료', FAILED: '실패 · 재시도 가능', UNKNOWN: '결과 확인 필요' }
const selectable = (record: HistoricalCommitCandidate) => record.state === 'NONE' || record.state === 'FAILED'
const validCandidate = (value: unknown): value is HistoricalCommitCandidate => isHistoricalRecord(value) && Object.prototype.hasOwnProperty.call(stateLabel, (value as HistoricalCommitCandidate).state)
type Preview = { records: HistoricalCommitCandidate[]; settings: AccountSettings }

export function HistoricalGithubCommitView({ user, mode, revision = 0 }: { user: User | null; mode: 'local' | 'live'; revision?: number }) {
  const [records, setRecords] = useState<HistoricalCommitCandidate[]>([]), [selected, setSelected] = useState<string[]>([])
  const [filter, setFilter] = useState<Platform | 'ALL'>('ALL'), [settings, setSettings] = useState<AccountSettings | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null), [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [requested, setRequested] = useState<string[]>([])
  const [recoverable, setRecoverable] = useState<string[]>([])
  const mounted = useRef(true), load = useRef(0), run = useRef(0), inFlight = useRef(false), cancel = useRef(false)
  const context = JSON.stringify({ id: user?.id, githubId: user?.githubId, mode })
  const currentContext = useRef(context); currentContext.current = context
  const current = (expected: string) => mounted.current && currentContext.current === expected
  const refresh = async (reset = false, silent = false) => {
    if (!user || mode !== 'live') return
    const expected = context, token = ++load.current
    const active = () => current(expected) && token === load.current
    if (!silent) setLoading(true)
    try {
      const next = await getHistoricalCommitCandidates(user.githubId)
      if (!active()) return
      if (!Array.isArray(next) || !next.every(validCandidate) || new Set(next.map(record => record.captureId)).size !== next.length) throw new Error('서버 커밋 상태를 확인하지 못했습니다.')
      setRecords(next)
      setSelected(previous => reset ? next.filter(selectable).map(record => record.captureId) : previous.filter(id => next.some(record => record.captureId === id && selectable(record))))
      if (!silent) {
        const saved = await getAccountSettings(user.githubId)
        if (!active()) return
        setSettings(saved); setPreview(null)
      }
    } catch (error) { if (active()) setMessage(error instanceof Error ? error.message : '커밋 상태를 불러오지 못했습니다.') }
    finally { if (active() && !silent) setLoading(false) }
  }
  const pending = records.some(record => record.state === 'PENDING' || record.state === 'RUNNING')
  useDesktopWork(busy || loading || pending)
  useEffect(() => {
    mounted.current = true; run.current += 1; load.current += 1; inFlight.current = false; cancel.current = true
    setRecords([]); setSelected([]); setSettings(null); setPreview(null); setMessage(''); setBusy(false); setRequested([]); setRecoverable([])
    void refresh(true)
    return () => { mounted.current = false; run.current += 1; load.current += 1; cancel.current = true }
  }, [context])
  useEffect(() => { if (revision) void refresh(false) }, [revision])
  useEffect(() => {
    if (!pending || busy || loading || mode !== 'live') return
    let polling = false
    const timer = window.setInterval(() => {
      if (polling) return
      polling = true; void refresh(false, true).finally(() => { polling = false })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [pending, busy, loading, context])

  const targetReady = settings?.githubTargetConfigured === true && settings.githubInstallationId != null && !!settings.githubOwner && !!settings.githubRepository && !!settings.githubBranch
  const chosen = records.filter(record => (filter === 'ALL' || record.platform === filter) && selected.includes(record.captureId) && selectable(record))
  const pathFor = (record: HistoricalCommitCandidate, saved: AccountSettings) => {
    const path = gitPath(record, saved.gitPathTemplate, { name: saved.name, nickname: saved.nickname, id: user?.id })
    return path ? [saved.githubRootPath, path].filter(Boolean).join('/') : null
  }
  const commit = async () => {
    if (!user || mode !== 'live' || !preview || inFlight.current) return
    const initial = user, expected = context, token = ++run.current, fixed = preview
    const active = () => current(expected) && token === run.current
    inFlight.current = true; cancel.current = false; setBusy(true); setPreview(null)
    const accepted: string[] = []
    try {
      for (let offset = 0; offset < fixed.records.length; offset += 50) {
        if (!active() || cancel.current) break
        const confirmed = await getMe()
        if (!active() || confirmed.id !== initial.id || confirmed.githubId !== initial.githubId) throw new Error('로그인 계정이 변경되었습니다.')
        if (cancel.current) break
        const saved = await getAccountSettings(initial.githubId)
        if (!active()) return
        if (saved.version !== fixed.settings.version || saved.githubInstallationId !== fixed.settings.githubInstallationId ||
          saved.githubOwner !== fixed.settings.githubOwner || saved.githubRepository !== fixed.settings.githubRepository ||
          saved.githubBranch !== fixed.settings.githubBranch || !saved.githubTargetConfigured) throw new Error('GitHub 설정이 변경되었습니다. 대상을 다시 확인해 주세요.')
        if (cancel.current) break
        const ids = fixed.records.slice(offset, offset + 50).map(record => record.captureId)
        const result = await requestHistoricalCommitBatch(initial.githubId, { captureIds: ids, settingsVersion: saved.version,
          installationId: saved.githubInstallationId!, owner: saved.githubOwner!, repository: saved.githubRepository!, branch: saved.githubBranch! })
        if (!active()) return
        if (!result || Object.keys(result).length !== ids.length || ids.some(id => !Object.prototype.hasOwnProperty.call(result, id) || !Object.prototype.hasOwnProperty.call(stateLabel, result[id]))) throw new Error('커밋 요청 결과를 확인하지 못했습니다. 상태를 새로고침해 주세요.')
        accepted.push(...ids); setRequested([...accepted])
        setRecords(previous => previous.map(record => Object.prototype.hasOwnProperty.call(result, record.captureId) ? { ...record, state: result[record.captureId] } : record))
        setSelected(previous => previous.filter(id => !ids.includes(id))); setMessage(`커밋 요청 ${accepted.length}/${fixed.records.length}건 확인`)
      }
      if (active()) setMessage(`${cancel.current ? '추가 요청 중단' : '일괄 커밋 요청 완료'} · ${accepted.length}건. 제출별 완료 상태를 확인해 주세요.`)
    } catch (error) { if (active()) setMessage(`요청 ${accepted.length}건 확인 · ${error instanceof Error ? error.message : '요청 실패'}. 상태를 새로고침한 뒤 남은 제출을 다시 선택해 주세요.`) }
    finally { if (active()) { inFlight.current = false; setBusy(false); await refresh(false, true) } }
  }
  const recover = async (captureId: string, retry = false) => {
    if (!user || !settings || inFlight.current || mode !== 'live') return
    const expected = context, token = ++run.current, initial = user, generation = settings.version
    const active = () => current(expected) && token === run.current
    inFlight.current = true; setBusy(true); setPreview(null)
    try {
      const confirmed = await getMe()
      if (!active()) return
      if (confirmed.id !== initial.id || confirmed.githubId !== initial.githubId) throw new Error('로그인 계정이 변경되었습니다.')
      const result = await reconcileHistoricalCommit(initial.githubId, captureId, generation, retry)
      if (!active()) return
      const labels = { MATCH: '같은 출력 파일을 확인해 완료로 복구했습니다.', MISSING: '파일이 없습니다. 브랜치에 반영되지 않은 기록이 확인된 작업만 재시도할 수 있습니다.', CONFLICT: '대상 경로의 파일 내용이 다릅니다. 기존 파일은 변경하지 않았습니다.', UNAVAILABLE: 'GitHub 응답을 확인하지 못했습니다. 결과 확인 필요 상태를 유지합니다.', CONTEXT_UNAVAILABLE: '원래 작업의 계정·설정·출력 기록을 확인할 수 없습니다. 결과 확인 필요 상태를 유지합니다.' }
      if (result.captureId !== captureId || !Object.prototype.hasOwnProperty.call(stateLabel, result.state) || !Object.prototype.hasOwnProperty.call(labels, result.comparison) || typeof result.retryAllowed !== 'boolean') throw new Error('대조 응답을 확인하지 못했습니다.')
      setRecords(previous => previous.map(record => record.captureId === captureId ? { ...record, state: result.state } : record))
      setRecoverable(previous => [...previous.filter(id => id !== captureId), ...(result.retryAllowed && result.state === 'UNKNOWN' ? [captureId] : [])])
      setMessage(retry && result.state === 'PENDING' ? '대조 후 재시도를 요청했습니다.' : labels[result.comparison])
    } catch (error) { if (active()) setMessage(error instanceof Error ? error.message : '대조에 실패했습니다.') }
    finally { if (active()) { inFlight.current = false; setBusy(false) } }
  }
  const visible = records.filter(record => filter === 'ALL' || record.platform === filter), available = visible.filter(selectable)
  const completed = records.filter(record => requested.includes(record.captureId) && record.state === 'SUCCEEDED').length
  return <section className="historical-import" aria-label="과거 풀이 GitHub 일괄 커밋">
    <h2>GitHub 일괄 커밋</h2><p>사이트별 동기화를 마친 과거 풀이를 선택해 한 번에 커밋을 요청할 수 있습니다. 자동 커밋 설정과 관계없이 동작합니다.</p>
    {!user || mode !== 'live' ? <p>CodeArchive 로그인 후 서버 기록에서 커밋할 제출을 선택할 수 있습니다.</p> : <>
      <div className="historical-import-actions"><button type="button" disabled={busy || loading} onClick={() => void refresh(false)}>서버·커밋 상태 새로고침</button><label>플랫폼 <select aria-label="커밋 플랫폼" value={filter} disabled={busy} onChange={event => setFilter(event.target.value as typeof filter)}><option value="ALL">전체</option>{HISTORY_PLATFORMS.map(platform => <option key={platform} value={platform}>{historyPlatformLabel[platform]}</option>)}</select></label></div>
      {loading && <p role="status">서버 기록과 GitHub 설정을 확인하고 있습니다.</p>}
      <p>서버 문제 {historyProblemCount(visible)}건 · 제출 {visible.length}건 · 완료 {visible.filter(record => record.state === 'SUCCEEDED').length}건 · 대기/진행 {visible.filter(record => record.state === 'PENDING' || record.state === 'RUNNING').length}건 · 실패 {visible.filter(record => record.state === 'FAILED').length}건 · 결과 확인 필요 {visible.filter(record => record.state === 'UNKNOWN').length}건</p>
      <label><input type="checkbox" disabled={busy || loading || !available.length} checked={!!available.length && available.every(record => selected.includes(record.captureId))} onChange={event => { setPreview(null); setSelected(previous => event.target.checked ? [...new Set([...previous, ...available.map(record => record.captureId)])] : previous.filter(id => !available.some(record => record.captureId === id))) }} />현재 플랫폼 미요청·실패 제출 전체 선택</label>
      <div className="historical-import-list">{visible.map(record => <div key={record.captureId}><label><input type="checkbox" disabled={busy || loading || !selectable(record)} checked={selected.includes(record.captureId)} onChange={event => { setPreview(null); setSelected(previous => event.target.checked ? [...previous, record.captureId] : previous.filter(id => id !== record.captureId)) }} /><span>{historyPlatformLabel[record.platform]} {record.problemNumber} · {record.title} · {record.language}</span><small>{stateLabel[record.state]}</small></label>{record.state === 'UNKNOWN' && <><button type="button" disabled={busy || loading || !settings} onClick={() => void recover(record.captureId)}>GitHub 결과 대조</button>{recoverable.includes(record.captureId) && <button type="button" disabled={busy || loading} onClick={() => void recover(record.captureId, true)}>대조 후 재시도 요청</button>}</>}</div>)}</div>
      {!loading && !records.length && <p>서버에 동기화된 과거 풀이가 없습니다.</p>}
      {!loading && !targetReady && <p>GitHub 탭에서 저장소·브랜치·저장 경로를 설정하고 저장해 주세요.</p>}
      {settings && targetReady && <p>대상: {settings.githubOwner}/{settings.githubRepository} · {settings.githubBranch} · {settings.githubRootPath || '저장소 루트'}</p>}
      <div className="historical-import-actions"><button type="button" disabled={busy || loading || !targetReady || !chosen.length} onClick={() => { if (settings) setPreview({ records: chosen, settings }) }}>선택한 {chosen.length}건 커밋 대상 확인</button>{busy && <button type="button" onClick={() => { cancel.current = true; setMessage('진행 중인 요청 확인 후 추가 요청을 중단합니다. 이미 접수된 커밋은 계속 진행합니다.') }}>추가 요청 중단</button>}</div>
      {preview && <div className="history-commit-preview"><h3>커밋 요청 확인</h3><p>계정 {user.githubLogin} · {preview.settings.githubOwner}/{preview.settings.githubRepository} · 브랜치 {preview.settings.githubBranch}</p><p>문제 {historyProblemCount(preview.records)}건 · 제출 {preview.records.length}건 · 최대 {preview.records.length}개 커밋. 제출마다 별도 커밋 작업을 요청합니다.</p><ul>{preview.records.map(record => <li key={record.captureId}>{historyPlatformLabel[record.platform]} {record.problemNumber} · {pathFor(record, preview.settings) ?? '유효하지 않은 경로'}</li>)}</ul><p>이미 같은 파일이 있으면 기존 내용은 보존하며 제출별 경로가 추가될 수 있습니다. 결과 확인이 필요한 제출은 자동 재시도하지 않습니다.</p><button type="button" disabled={busy || preview.records.some(record => !pathFor(record, preview.settings))} onClick={() => void commit()}>GitHub 커밋 {preview.records.length}건 요청</button><button type="button" onClick={() => setPreview(null)}>닫기</button></div>}
      {!!requested.length && <div className="history-batch-progress"><progress aria-label="GitHub 커밋 완료 진행률" max={requested.length} value={completed} /><span>{completed}/{requested.length}건 완료</span></div>}
    </>}{message && <p role="status">{message}</p>}
  </section>
}
