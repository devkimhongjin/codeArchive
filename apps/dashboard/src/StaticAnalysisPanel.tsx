import { useEffect, useRef, useState } from 'react'
import { runStaticAnalysis, clearStaticAnalysisCache } from './staticAnalysisClient'
import { analysisLanguage, type AnalysisResult } from './staticAnalysisContract'

export function StaticAnalysisPanel({ captureId, language, source }: { captureId: string; language: string; source: string }) {
  const [result, setResult] = useState<AnalysisResult | null>(null), [running, setRunning] = useState(false), [cached, setCached] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => { controller.current?.abort(); controller.current = null; setResult(null); setRunning(false); setCached(false); return () => controller.current?.abort() }, [captureId, language, source])
  const start = async () => {
    controller.current?.abort()
    const current = new AbortController(); controller.current = current; setRunning(true); setResult(null)
    try {
      const response = await runStaticAnalysis(language, source, { signal: current.signal })
      if (!current.signal.aborted && controller.current === current) { setResult(response.result); setCached(response.cached) }
    } catch { /* A cancelled selection must not receive a stale result. */ }
    finally { if (!current.signal.aborted && controller.current === current) setRunning(false) }
  }
  const status = { success: '기본 검사 완료', syntax_error: '문법 확인 필요', unsupported: '지원하지 않는 언어', limit: '분석 크기·복잡도 제한 초과', timeout: '분석 시간 초과', failed: '분석을 시작하지 못했습니다' }
  return <section className="static-analysis-panel" aria-label="로컬 정적 분석">
    <h3>로컬 정적 분석</h3>
    <p>Java·JavaScript/TypeScript·Python의 문법과 기본 규칙을 검사합니다. 코드를 실행하거나 외부로 전송하지 않습니다. 컴파일·실행 결과와 종합 품질 검사를 대체하지 않습니다.</p>
    <button type="button" disabled={running || !analysisLanguage(language)} onClick={() => void start()}>기본 정적 검사</button>
    <button type="button" disabled={running} onClick={() => { clearStaticAnalysisCache(); setResult(null); setCached(false) }}>분석 캐시 지우기</button>
    {running && <><span role="status">분석 중</span><button type="button" onClick={() => { controller.current?.abort(); setRunning(false) }}>중단</button></>}
    {!analysisLanguage(language) && <p>이 언어는 지원하지 않습니다.</p>}
    {result && <><p role="status">{status[result.status]}{cached ? ' · 저장된 분석 결과' : ''}</p><small>분석기 {result.version}</small>{result.status === 'success' && !result.diagnostics.length && <p>지원하는 기본 규칙에서 발견된 항목이 없습니다.</p>}<ul>{result.diagnostics.map((item, index) => <li key={index}>{item.line}행 {item.column}열 · {item.severity === 'error' ? '오류' : '검토'} · {item.message} <small>{item.rule}</small></li>)}</ul></>}
  </section>
}
