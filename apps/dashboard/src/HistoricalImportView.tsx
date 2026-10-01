import { useEffect, useRef, useState } from 'react'
import { bulkUpload, getHistoricalSubmissionIds, getMe } from './api'
import { requestBridge } from './bridge'
import type { Capture, User } from './types'
export { selectHistoricalSubmissionIds } from '../../../shared/historicalSelection'

type LocalIdsResponse = { submissionIds?: unknown; localOnly?: unknown }
type LocalCapturesResponse = { captures?: unknown; localOnly?: unknown }

function historicalIds(value: unknown): string[] | null {
  const response = value as LocalIdsResponse
  return response?.localOnly === true && Array.isArray(response.submissionIds) && response.submissionIds.every(id => typeof id === 'string' && /^\d{1,40}$/.test(id))
    ? [...new Set(response.submissionIds)] : null
}

function capturesFor(ids: string[], value: unknown): Capture[] | null {
  const response = value as LocalCapturesResponse
  if (response?.localOnly !== true || !Array.isArray(response.captures)) return null
  const captures = response.captures as Capture[]
  if (captures.length !== ids.length || new Set(captures.map(capture => capture.historicalSubmissionId)).size !== ids.length) return null
  return captures.every(capture => capture.platform === 'JUNGOL' && capture.historicalImport === true &&
    typeof capture.historicalSubmissionId === 'string' && ids.includes(capture.historicalSubmissionId)) ? captures : null
}

/** Dashboard is a deliberate upload surface. Source-site scanning lives only in history.html. */
export function HistoricalImportView({ extensionId, capability, supported = true, user, mode, onImported, onActivityChange }: {
  extensionId: string
  capability: string | null
  supported?: boolean
  user: User | null
  mode: 'local' | 'live'
  onImported: () => void
  onActivityChange?: (label: string | null) => void
}) {
  const [localIds, setLocalIds] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const run = useRef(0)
  const localLoad = useRef(0)
  const mounted = useRef(true)
  const connection = useRef({ extensionId, capability, mode, userId: user?.id, githubId: user?.githubId })
  connection.current = { extensionId, capability, mode, userId: user?.id, githubId: user?.githubId }
  const account = useRef<User | null>(user)
  account.current = user
  const current = () => !!user && account.current?.id === user.id && account.current?.githubId === user.githubId
  const loadLocal = async () => {
    if (!capability) return
    const token = ++localLoad.current
    const expected = { extensionId, capability, mode, userId: user?.id, githubId: user?.githubId }
    const activeLoad = () => mounted.current && token === localLoad.current && JSON.stringify(connection.current) === JSON.stringify(expected)
    let response: LocalIdsResponse
    try { response = await requestBridge<LocalIdsResponse>(extensionId, { type: 'GET_HISTORICAL_SUBMISSION_IDS', capability, platform: 'JUNGOL' }) }
    catch (error) { if (activeLoad()) throw error; return }
    if (!activeLoad()) return
    const ids = historicalIds(response)
    if (!ids) throw new Error('로컬 과거 풀이 목록 응답이 올바르지 않습니다.')
    setLocalIds(ids); setSelected(ids)
  }
  useEffect(() => { void loadLocal().catch(() => { if (mounted.current) setMessage('확장 프로그램의 로컬 과거 풀이를 불러올 수 없습니다.') }); }, [extensionId, capability, mode, user?.id, user?.githubId])
  useEffect(() => { mounted.current = true; setBusy(false); return () => { mounted.current = false; run.current += 1; localLoad.current += 1 } }, [extensionId, capability, user?.id, user?.githubId, mode])
  useEffect(() => { onActivityChange?.(busy ? '과거 풀이 수동 동기화 중' : null); return () => onActivityChange?.(null) }, [busy, onActivityChange])
  const openExtension = async () => {
    if (!capability) return
    try { await requestBridge(extensionId, { type: 'OPEN_HISTORY', capability }); setMessage('확장 프로그램에서 정올 과거 풀이 화면을 열었습니다.') }
    catch { setMessage('확장 프로그램 화면을 열 수 없습니다. 확장 프로그램을 업데이트한 뒤 다시 시도해 주세요.') }
  }
  const sync = async () => {
    if (!user || mode !== 'live' || !capability || !selected.length || busy) return
    const token = ++run.current; const initial = user
    const expected = { extensionId, capability, mode, userId: user.id, githubId: user.githubId }
    const active = () => mounted.current && token === run.current && JSON.stringify(connection.current) === JSON.stringify(expected) && current()
    setBusy(true); setMessage('서버에 이미 저장된 제출을 확인하고 있습니다.')
    try {
      const authenticated = await getMe()
      if (!active() || authenticated.id !== initial.id || authenticated.githubId !== initial.githubId) throw new Error('로그인 계정이 변경되었습니다.')
      const serverIds = await getHistoricalSubmissionIds(initial.githubId)
      if (!active()) throw new Error('로그인 계정이 변경되었습니다.')
      if (!Array.isArray(serverIds) || serverIds.some(id => typeof id !== 'string' || !/^\d{1,40}$/.test(id))) throw new Error('서버 제출 목록을 확인하지 못했습니다.')
      const serverKnown = new Set(serverIds)
      let acceptedCount = 0
      for (let offset = 0; offset < selected.length; offset += 50) {
        if (!active()) throw new Error('로그인 계정이 변경되었습니다.')
        const confirmed = await getMe()
        if (confirmed.id !== initial.id || confirmed.githubId !== initial.githubId || !active()) throw new Error('로그인 계정이 변경되었습니다.')
        const ids = selected.slice(offset, offset + 50)
        const local = capturesFor(ids, await requestBridge<LocalCapturesResponse>(extensionId, { type: 'GET_HISTORICAL_BY_SUBMISSION_IDS', capability, platform: 'JUNGOL', submissionIds: ids }))
        if (!active()) throw new Error('로그인 계정이 변경되었습니다.')
        if (!local) throw new Error('선택한 로컬 제출을 검증하지 못했습니다.')
        if (!active()) throw new Error('로그인 계정이 변경되었습니다.')
        const upload = local.filter(capture => !serverKnown.has(capture.historicalSubmissionId!))
        let accepted = local.filter(capture => serverKnown.has(capture.historicalSubmissionId!)).map(capture => capture.captureId)
        let partial = false
        if (upload.length) {
          const response = await bulkUpload(upload, initial.githubId)
          if (!active()) throw new Error('로그인 계정이 변경되었습니다.')
          const sent = new Set(upload.map(capture => capture.captureId))
          const uploaded = [...new Set(response.acceptedCaptureIds ?? [])]
          if (uploaded.some(id => !sent.has(id))) throw new Error('서버 수락 응답을 검증하지 못했습니다.')
          accepted = [...new Set([...accepted, ...uploaded])]
          partial = (response.failures?.length ?? 0) > 0 || uploaded.length !== upload.length
        }
        if (!active()) throw new Error('로그인 계정이 변경되었습니다.')
        const ack = await requestBridge<{ ok?: unknown }>(extensionId, { type: 'ACK', capability, captureIds: accepted })
        if (!active()) throw new Error('로그인 계정이 변경되었습니다.')
        if (ack.ok !== true) throw new Error('로컬 동기화 표시를 확인하지 못했습니다.')
        acceptedCount += accepted.length; setMessage(`수동 서버 동기화 중 ${acceptedCount}/${selected.length}건`)
        if (partial) throw new Error('일부 서버 저장 실패');
      }
      if (!active()) return
      setMessage(`서버 동기화 ${acceptedCount}건을 확인했습니다.`)
      await loadLocal(); if (active()) onImported()
    } catch (error) { if (active()) setMessage(error instanceof Error ? error.message : '수동 동기화를 완료하지 못했습니다.') }
    finally { if (mounted.current && token === run.current) setBusy(false) }
  }
  return <section className="historical-import" aria-label="과거 풀이">
    <div className="historical-import-heading"><div><p className="eyebrow">ARCHIVE / HISTORY</p><h1>과거 풀이</h1><p>정올 수집은 확장 프로그램에서 로그인 없이 로컬에 저장합니다. 이 화면에서는 저장한 기록만 선택해 서버에 직접 동기화합니다.</p></div></div>
    {!supported && <p role="status" className="historical-import-status">설치된 확장 프로그램을 업데이트하면 과거 풀이 수집을 사용할 수 있습니다.</p>}
    <div className="historical-import-actions"><button type="button" onClick={() => void openExtension()} disabled={!capability || !supported}>확장 프로그램에서 정올 과거 풀이 수집 열기</button><button type="button" onClick={() => void loadLocal().catch(() => { if (mounted.current) setMessage('로컬 기록을 새로고침하지 못했습니다.') })} disabled={!capability || busy}>로컬 기록 새로고침</button></div>
    {message && <p role="status" className="historical-import-status">{message}</p>}
    <p className="historical-import-note">원본 정올 탭은 로컬 수집이 끝난 뒤 닫아도 됩니다.</p>
    <div className="historical-import-list">{localIds.length === 0 ? <p>이 브라우저에 저장된 정올 과거 풀이가 없습니다.</p> : localIds.map(id => <label key={id}><input type="checkbox" checked={selected.includes(id)} disabled={busy} onChange={event => setSelected(items => event.target.checked ? [...items, id] : items.filter(item => item !== id))} /><span>정올 제출 #{id}</span><small>로컬 보관 기록</small></label>)}</div>
    {user && mode === 'live' ? <div className="historical-import-actions"><button className="historical-import-action" type="button" disabled={busy || selected.length === 0} onClick={() => void sync()}>선택한 {selected.length}건 수동 서버 동기화</button></div> : <p className="historical-import-note">서버 동기화는 CodeArchive 로그인 후 직접 실행할 수 있습니다.</p>}
  </section>
}
