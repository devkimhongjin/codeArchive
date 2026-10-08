import { useDesktopWork } from './DesktopActivity'
import { useEffect, useRef, useState } from 'react'
import { bulkUpload, getHistoricalSubmissionIds, getMe } from './api'
import { requestBridge } from './bridge'
import { HISTORY_PLATFORMS, historyKey, historyPlatformLabel, historyProblemCount, isHistoricalRecord } from './historicalRecords'
import type { Capture, HistoricalRecord, Platform, User } from './types'
export { selectHistoricalSubmissionIds } from '../../../shared/historicalSelection'

/** Uploads retained records; collection is a separate history-management action. */
export function HistoricalImportView({ extensionId, capability, user, mode, onImported, onActivityChange }: {
  extensionId: string; capability: string | null; supported?: boolean; user: User | null; mode: 'local' | 'live'
  onImported: () => void; onActivityChange?: (label: string | null) => void
}) {
  const [records, setRecords] = useState<HistoricalRecord[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [filter, setFilter] = useState<Platform | 'ALL'>('ALL')
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [synced, setSynced] = useState<Set<string>>(new Set())
  const [serverChecked, setServerChecked] = useState(false)
  const run = useRef(0), load = useRef(0), mounted = useRef(true), inFlight = useRef(false), cancel = useRef(false)
  const context = JSON.stringify({ extensionId, capability, mode, userId: user?.id, githubId: user?.githubId })
  const currentContext = useRef(context); currentContext.current = context
  const current = (expected: string) => mounted.current && currentContext.current === expected
  const loadLocal = async () => {
    if (!capability || inFlight.current) return
    const token = ++load.current, expected = context
    const active = () => current(expected) && load.current === token
    setLoading(true)
    setServerChecked(false)
    try {
      const response = await requestBridge<{ localOnly?: boolean; records?: unknown }>(extensionId, { type: 'GET_HISTORICAL_METADATA', capability })
      if (!active()) return
      if (response.localOnly !== true || !Array.isArray(response.records) || !response.records.every(isHistoricalRecord) ||
          new Set(response.records.map(historyKey)).size !== response.records.length || new Set(response.records.map(record => record.captureId)).size !== response.records.length) throw new Error('로컬 목록을 확인하지 못했습니다. 확장 프로그램을 업데이트해 주세요.')
      const local = response.records
      setRecords(local); setSynced(new Set()); setSelected(local.map(historyKey))
      if (user && mode === 'live') {
        const known = new Set<string>()
        for (const platform of HISTORY_PLATFORMS) {
          const ids = await getHistoricalSubmissionIds(user.githubId, platform)
          if (!active()) return
          if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('서버 제출 목록을 확인하지 못했습니다.')
          ids.forEach(id => known.add(`${platform}:${id}`))
        }
        setSynced(known); setServerChecked(true); setSelected(local.filter(record => (!known.has(historyKey(record)) || record.metadataPending === true)).map(historyKey))
      }
      if (active()) setMessage('')
    } catch (error) { if (active()) setMessage(error instanceof Error ? error.message : '로컬 기록을 불러오지 못했습니다.') }
    finally { if (active()) setLoading(false) }
  }
  useDesktopWork(busy || loading)
  useEffect(() => {
    mounted.current = true; run.current += 1; load.current += 1; cancel.current = true
    inFlight.current = false; setBusy(false); setRecords([]); setSelected([]); setSynced(new Set()); setServerChecked(false); setMessage(''); setProgress({ done: 0, total: 0 })
    void loadLocal()
    return () => { mounted.current = false; run.current += 1; load.current += 1; cancel.current = true }
  }, [context])
  useEffect(() => { onActivityChange?.(busy ? '과거 풀이 일괄 동기화 중' : null); return () => onActivityChange?.(null) }, [busy, onActivityChange])
  const sync = async () => {
    if (!user || mode !== 'live' || !capability || inFlight.current || loading) return
    const chosen = records.filter(record => (filter === 'ALL' || record.platform === filter) && selected.includes(historyKey(record)) && (!synced.has(historyKey(record)) || record.metadataPending === true))
    if (!chosen.length) return
    const token = ++run.current, expected = context, initial = user
    const active = () => current(expected) && token === run.current
    const checkAccount = async () => {
      const confirmed = await getMe()
      if (!active() || confirmed.id !== initial.id || confirmed.githubId !== initial.githubId) throw new Error('로그인 계정 또는 확장 연결이 변경되었습니다.')
    }
    inFlight.current = true; cancel.current = false; setBusy(true); setProgress({ done: 0, total: chosen.length })
    let acceptedCount = 0, failedCount = 0, done = 0
    const acknowledged = new Set<string>()
    try {
      await checkAccount()
      for (const platform of HISTORY_PLATFORMS) {
        if (!active() || cancel.current) break
        const serverIds = await getHistoricalSubmissionIds(initial.githubId, platform)
        if (!active()) return
        if (!Array.isArray(serverIds) || serverIds.some(id => typeof id !== 'string')) throw new Error('서버 제출 목록을 확인하지 못했습니다.')
        const platformRecords = chosen.filter(record => record.platform === platform)
        for (let offset = 0; offset < platformRecords.length; offset += 50) {
          if (!active() || cancel.current) break
          await checkAccount()
          if (cancel.current) break
          const batch = platformRecords.slice(offset, offset + 50), ids = batch.map(record => record.historicalSubmissionId)
          const local = await requestBridge<{ localOnly?: boolean; captures?: Capture[] }>(extensionId, { type: 'GET_HISTORICAL_BY_SUBMISSION_IDS', capability, platform, submissionIds: ids })
          if (!active()) return
          const captures = local.captures
          if (local.localOnly !== true || !Array.isArray(captures) || captures.length !== batch.length ||
              new Set(captures.map(capture => capture.historicalSubmissionId)).size !== batch.length ||
              !captures.every(capture => capture.historicalImport === true && capture.platform === platform &&
                batch.some(record => record.captureId === capture.captureId && record.historicalSubmissionId === capture.historicalSubmissionId))) throw new Error('선택한 로컬 제출을 검증하지 못했습니다.')
          if (cancel.current) break
          // Native-id membership is not proof of this complete snapshot being accepted.
          const upload = captures;
          const response = await bulkUpload(upload, initial.githubId)
          if (!active()) return
          if (!Array.isArray(response.acceptedCaptureIds) || response.acceptedCaptureIds.some(id => !upload.some(capture => capture.captureId === id))) throw new Error('서버 수락 응답을 검증하지 못했습니다.')
          const accepted = [...new Set(response.acceptedCaptureIds)]
          if (accepted.length) {
            const ack = await requestBridge<{ ok?: boolean }>(extensionId, { type: 'ACK', capability, captureIds: accepted, captureRevisions: captures.filter(capture => accepted.includes(capture.captureId)).map(capture => ({ captureId: capture.captureId, revision: capture.metadataRevision ?? 0 })) })
            if (!active()) return
            if (ack.ok !== true) throw new Error('로컬 동기화 표시를 확인하지 못했습니다. 새로고침 후 서버 기록을 다시 확인해 주세요.')
          }
          const successful = new Set(accepted)
          captures.filter(capture => successful.has(capture.captureId)).forEach(capture => acknowledged.add(historyKey(capture as HistoricalRecord)))
          acceptedCount += accepted.length; failedCount += batch.length - accepted.length; done += batch.length
          setRecords(previous => previous.map(record => acknowledged.has(historyKey(record)) ? { ...record, metadataPending: false } : record));
          setSynced(previous => new Set([...previous, ...acknowledged])); setSelected(previous => previous.filter(key => !acknowledged.has(key)))
          setProgress({ done, total: chosen.length }); setMessage(`서버 동기화 ${acceptedCount}건 · 실패 ${failedCount}건`)
        }
      }
      if (!active()) return
      setMessage(`${cancel.current ? '동기화 중단' : '동기화 완료'} · 문제 ${historyProblemCount(chosen.filter(record => acknowledged.has(historyKey(record))))}건 · 제출 ${acceptedCount}건${failedCount ? ` · 실패 ${failedCount}건 (선택을 유지했습니다)` : ''}`)
    } catch (error) { if (active()) setMessage(`동기화 ${acceptedCount}건 확인 · ${error instanceof Error ? error.message : '동기화 실패'}. 남은 기록은 다시 시도할 수 있습니다.`) }
    finally { if (active()) { inFlight.current = false; setBusy(false); if (acceptedCount) onImported() } }
  }
  const visible = records.filter(record => filter === 'ALL' || record.platform === filter)
  const chosen = records.filter(record => (filter === 'ALL' || record.platform === filter) && selected.includes(historyKey(record)) && (!synced.has(historyKey(record)) || record.metadataPending === true))
  const visiblePending = visible.filter(record => (!synced.has(historyKey(record)) || record.metadataPending === true))
  return <section className="historical-import" aria-label="과거 풀이 일괄 동기화">
    <h2>과거 풀이 일괄 동기화</h2><p>확장 프로그램에 저장한 기록을 서버로 동기화합니다. GitHub 커밋은 별도로 요청합니다.</p>
    <div className="historical-import-actions">
      <button type="button" disabled={!capability || busy || loading} onClick={() => void loadLocal()}>로컬·서버 기록 새로고침</button>
      <label>플랫폼 <select aria-label="동기화 플랫폼" value={filter} disabled={busy} onChange={event => setFilter(event.target.value as typeof filter)}><option value="ALL">전체</option>{HISTORY_PLATFORMS.map(platform => <option key={platform} value={platform}>{historyPlatformLabel[platform]}</option>)}</select></label>
    </div>
    {!capability && <p>확장 프로그램을 연결해 주세요.</p>}{loading && <p role="status">로컬·서버 기록을 확인하고 있습니다.</p>}
    <p>로컬 문제 {historyProblemCount(visible)}건 · 제출 {visible.length}건 · {user && mode === 'live' && serverChecked ? `서버 동기화 확인 ${visible.filter(record => synced.has(historyKey(record))).length}건` : '서버 기록 미확인'}</p>
    <label><input type="checkbox" disabled={busy || loading || !visiblePending.length} checked={!!visiblePending.length && visiblePending.every(record => selected.includes(historyKey(record)))} onChange={event => setSelected(previous => event.target.checked ? [...new Set([...previous, ...visiblePending.map(historyKey)])] : previous.filter(key => !visiblePending.some(record => historyKey(record) === key)))} />현재 플랫폼 전체 선택</label>
    <div className="historical-import-list">{visible.map(record => <label key={historyKey(record)}><input type="checkbox" checked={selected.includes(historyKey(record))} disabled={busy || loading || (synced.has(historyKey(record)) && !record.metadataPending)} onChange={event => setSelected(previous => event.target.checked ? [...previous, historyKey(record)] : previous.filter(key => key !== historyKey(record)))} /><span>{historyPlatformLabel[record.platform]} {record.problemNumber} · {record.title} · {record.language}</span><small>{record.metadataPending ? '보강 정보 동기화 대기' : synced.has(historyKey(record)) ? '서버 동기화 완료' : '로컬 보관'}</small></label>)}</div>
    {records.length === 0 && !loading && capability && <p>이 브라우저에 저장된 과거 풀이가 없습니다.</p>}
    {user && mode === 'live' ? <div className="historical-import-actions"><button type="button" disabled={busy || loading || !capability || !chosen.length} onClick={() => void sync()}>선택한 {chosen.length}건 일괄 동기화</button>{busy && <button type="button" onClick={() => { cancel.current = true; setMessage('진행 중인 저장 확인 후 중단합니다.') }}>동기화 중단</button>}</div> : <p>서버 동기화는 CodeArchive 로그인 후 직접 실행할 수 있습니다.</p>}
    {progress.total > 0 && <div className="history-batch-progress"><progress aria-label="서버 동기화 진행률" max={progress.total} value={progress.done} /><span>{progress.done}/{progress.total}건 처리</span></div>}
    {message && <p role="status">{message}</p>}
  </section>
}
