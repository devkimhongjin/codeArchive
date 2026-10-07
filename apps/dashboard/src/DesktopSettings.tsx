import { useEffect, useState } from 'react'
import { desktopApi } from './desktop'
export function DesktopSettings() {
  const desktop = desktopApi()
  const [status, setStatus] = useState<Awaited<ReturnType<NonNullable<typeof desktop>['getStatus']>> | null>(null)
  const [pair, setPair] = useState<{ code: string; expiresAt: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!desktop) return
    let active = true
    const refresh = () => { void desktop.getStatus().then(value => { if (active) setStatus(value) }).catch(() => { if (active) setError('PC 앱 상태를 가져오지 못했습니다.') }) }
    refresh(); const timer = window.setInterval(refresh, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [desktop])
  if (!desktop) return null
  const run = async (action: () => Promise<unknown>) => { setError(''); setBusy(true); try { await action(); setStatus(await desktop.getStatus()) } catch (failure) { setError(failure instanceof Error ? failure.message : 'PC 앱 요청에 실패했습니다.') } finally { setBusy(false) } }
  const validPair = pair && Date.now() < pair.expiresAt
  return <section className="desktop-settings settings-card">
    <h3>PC 앱 설정 <small>v{status?.version ?? '—'}</small></h3>
    <p>Chrome 확장 {status?.connected ? '연결됨' : '연결 안 됨'} · 창을 닫으면 트레이에서 계속 실행됩니다. 완전히 종료하려면 트레이 메뉴의 종료를 선택하세요.</p>
    <div className="desktop-actions"><button type="button" className="ghost-button" disabled={busy} onClick={() => void run(async () => setPair(await desktop.pair()))}>{status?.connected ? '확장 다시 연결' : '확장 연결 코드 발급'}</button><button type="button" className="ghost-button" disabled={busy || !status?.connected} onClick={() => void run(() => desktop.disconnect())}>연결 해제</button></div>
    {validPair && <p role="status">확장 팝업의 PC 앱 연결에 입력하세요: <strong className="desktop-pair-code">{pair.code}</strong> · 2분 동안 유효합니다.</p>}
    <label className="desktop-autostart"><input type="checkbox" checked={status?.autostart ?? false} disabled={busy || !status?.packaged} onChange={event => void run(() => desktop.setAutostart(event.target.checked))} /> Windows 로그인 시 자동 시작</label>
    {!status?.packaged && <p>자동 시작과 업데이트 적용은 설치한 앱에서 사용할 수 있습니다.</p>}
    <p role="status">{status?.update.message}</p>
    <div className="desktop-actions"><button type="button" className="ghost-button" disabled={busy} onClick={() => void run(() => desktop.checkUpdate())}>업데이트 확인</button><button type="button" className="primary-button" disabled={busy || !status?.packaged || status?.update.state !== 'available'} onClick={() => void run(() => desktop.installUpdate())}>업데이트 다운로드·적용</button></div>
    {error && <p role="alert">{error}</p>}
  </section>
}
