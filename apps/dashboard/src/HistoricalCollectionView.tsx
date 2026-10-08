import { useRef, useState } from 'react'
import { requestBridge } from './bridge'
import { extensionRuntime } from './extensionEnvironment'

export function HistoricalCollectionView({ extensionId, capability, supported }: {
  extensionId: string; capability: string | null; supported: boolean
}) {
  const [message, setMessage] = useState('')
  const [opening, setOpening] = useState(false)
  const context = `${extensionId}:${capability}`
  const current = useRef(context); current.current = context
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
      ? <iframe className="historical-collection-frame" src="history.html?embedded=1" title="과거 풀이 수집 화면" />
      : <><p>설치된 확장의 수집 화면에서 플랫폼과 같은 문제 제출 기준을 선택하세요.</p>
        <button type="button" disabled={!capability || !supported || opening} onClick={() => void openCollection()}>수집 화면 열기</button>
        {!capability && <p>확장 프로그램을 연결해 주세요.</p>}
        {message && <p role="status">{message}</p>}</>}
  </section>
}
