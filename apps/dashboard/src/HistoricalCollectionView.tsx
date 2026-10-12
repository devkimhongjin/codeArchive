import { useEffect, useRef, useState } from 'react'
import { requestBridge } from './bridge'
import { extensionRuntime } from './extensionEnvironment'
import { HISTORICAL_COLLECTION_REQUEST, isHistoricalCollectionNotice, type HistoricalCollectionScope } from '../../../shared/historicalCollectionScope'
import { isHistoryServerRequest } from '../../../shared/historyServerProtocol'
import { handleHistoryServerRequest, historyAccountKey, type HistoryServerContext } from './historyServerRegistration'

export function HistoricalCollectionView({ extensionId, capability, supported, disabled = false, onSelectionChange, serverContext, onBusyChange }: {
  extensionId: string; capability: string | null; supported: boolean
  disabled?: boolean; onSelectionChange?: (scope: HistoricalCollectionScope | null) => void
  serverContext?: HistoryServerContext; onBusyChange?: (busy: boolean) => void
}) {
  const [message, setMessage] = useState('')
  const [opening, setOpening] = useState(false)
  const [height, setHeight] = useState(760)
  const context = `${extensionId}:${capability}`
  const current = useRef(context); current.current = context
  const frame = useRef<HTMLIFrameElement>(null)
  const liveContext = useRef(serverContext); liveContext.current = serverContext
  const pending = useRef(false)
  const receiptEpoch = useRef(0)
  const account = serverContext?.user ? historyAccountKey(serverContext.user) : 'signed-out'
  const requestSnapshot = () => {
    if (extensionRuntime()) frame.current?.contentWindow?.postMessage({ type: HISTORICAL_COLLECTION_REQUEST }, window.location.origin)
  }
  useEffect(() => { receiptEpoch.current++; onSelectionChange?.(null) }, [extensionId, account, onSelectionChange])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!extensionRuntime() || !frame.current?.contentWindow || event.source !== frame.current.contentWindow || event.origin !== window.location.origin) return
      if (event.data?.type === 'CODEARCHIVE_HISTORY_HEIGHT' && Number.isInteger(event.data.height) && event.data.height >= 200 && event.data.height <= 2000) { setHeight(event.data.height); return }
      if (isHistoryServerRequest(event.data) && liveContext.current) {
        const target = frame.current.contentWindow, request = event.data
        if (pending.current) { target.postMessage({ type: 'CODEARCHIVE_HISTORY_SERVER_RESPONSE', requestId: request.requestId, error: '진행 중인 서버 요청이 있습니다. 잠시 후 다시 시도해 주세요.' }, window.location.origin); return }
        pending.current = true; onBusyChange?.(true)
        void handleHistoryServerRequest(request, () => liveContext.current!).then(result => {
          if (frame.current?.contentWindow !== target) return
          target.postMessage({ type: 'CODEARCHIVE_HISTORY_SERVER_RESPONSE', requestId: request.requestId, result }, window.location.origin)
        }).catch(error => {
          if (frame.current?.contentWindow === target) target.postMessage({ type: 'CODEARCHIVE_HISTORY_SERVER_RESPONSE', requestId: request.requestId,
            error: error instanceof Error ? error.message : '서버 등록을 완료하지 못했습니다. 다시 시도해 주세요.' }, window.location.origin)
        }).finally(() => { pending.current = false; onBusyChange?.(false) })
        return
      }
      if (!isHistoricalCollectionNotice(event.data)) return
      const scope = event.data.scope
      const epoch = ++receiptEpoch.current
      if (scope && liveContext.current) {
        const target = frame.current.contentWindow
        void handleHistoryServerRequest({ type: 'CODEARCHIVE_HISTORY_SERVER_REQUEST', requestId: 'receipt', operation: 'IDS', platform: scope.platform }, () => liveContext.current!).then(result => {
          if (epoch === receiptEpoch.current && frame.current?.contentWindow === target && scope.submissionIds.every(id => result.submissionIds.includes(id))) onSelectionChange?.(scope)
        }).catch(() => { if (epoch === receiptEpoch.current) { onSelectionChange?.(null); setMessage('서버 등록 기록을 확인하지 못했습니다. 로그인 상태를 확인해 주세요.') } })
        return
      }
      onSelectionChange?.(scope)
    }
    window.addEventListener('message', receive)
    requestSnapshot()
    return () => window.removeEventListener('message', receive)
  }, [extensionId, onSelectionChange, onBusyChange])
  const openCollection = async () => {
    if (opening || !capability || !supported) return
    const expected = context
    setOpening(true)
    try {
      await requestBridge(extensionId, { type: 'OPEN_HISTORY', capability })
      if (current.current === expected) setMessage('과거 풀이 수집 화면을 열었습니다.')
    } catch { if (current.current === expected) setMessage('수집 화면을 열지 못했습니다. 확장 연결을 확인해 주세요.') }
    finally { setOpening(false) }
  }
  return <section className="historical-collection" aria-label="과거 풀이 수집">
    <h2>과거 풀이 수집</h2>
    {extensionRuntime()
      ? <><iframe key={account} ref={frame} onLoad={requestSnapshot} inert={disabled} style={{ height }} className="historical-collection-frame" src={`history.html?embedded=1${serverContext ? '&server=1' : ''}`} title="과거 풀이 수집 화면" />
        {message && <p role="status">{message}</p>}
        {disabled && <p role="status">커밋 요청을 마친 뒤 새 수집을 시작할 수 있습니다.</p>}</>
      : <><p>설치된 확장의 수집 화면에서 플랫폼과 같은 문제 제출 기준을 선택하세요.</p>
        <button type="button" disabled={!capability || !supported || opening} onClick={() => void openCollection()}>수집 화면 열기</button>
        {!capability && <p>확장 프로그램을 연결해 주세요.</p>}
        {message && <p role="status">{message}</p>}</>}
  </section>
}
