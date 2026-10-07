import { useState } from 'react'
import { desktopApi } from './desktop'
import { useDesktopStatus } from './DesktopStatus'
export function DesktopSettings() {
  const desktop = desktopApi()
  const { status, error: statusError, refresh } = useDesktopStatus()
  const [pair, setPair] = useState<{ code: string; expiresAt: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!desktop) return null
  const run = async (action: () => Promise<unknown>) => { setError(''); setBusy(true); try { await action(); await refresh() } catch (failure) { setError(failure instanceof Error ? failure.message : 'PC 앱 요청에 실패했습니다.') } finally { setBusy(false) } }
  const validPair = pair && Date.now() < pair.expiresAt
  return <section className="desktop-settings settings-card">
    <h3>PC 앱 설정</h3>
    <div className="desktop-release-settings">
      <dl><div><dt>현재 PC 앱 버전</dt><dd>v{status?.version ?? '—'}</dd></div><div><dt>업데이트 버전</dt><dd>{status?.update.version ? `v${status.update.version}` : status?.update.state === 'current' ? `v${status.version} · 최신` : '—'}</dd></div></dl>
      <p role="status">{status?.update.message ?? 'PC 앱 상태를 확인하고 있습니다.'}</p>
      <div className="desktop-actions"><button type="button" className="ghost-button" disabled={busy || status?.update.state === 'checking' || status?.update.state === 'downloading'} onClick={() => void run(() => desktop.checkUpdate())}>업데이트 확인</button><button type="button" className="primary-button" disabled={busy || !status?.packaged || !['available', 'ready'].includes(status?.update.state ?? '')} onClick={() => void run(() => desktop.installUpdate())}>업데이트 다운로드·적용</button></div>
      <label className="desktop-autostart"><input type="checkbox" checked={status?.autoUpdate ?? false} disabled={busy || !status?.packaged} onChange={event => void run(() => desktop.setAutoUpdate(event.target.checked))} /> 자동 업데이트</label>
      <p>기본값은 꺼짐입니다. 켜면 새 버전을 확인하고 앱이 트레이에 있으며 작업이 없을 때 다운로드·적용 후 다시 시작합니다. 입력한 내용이 있으면 앱을 다시 실행할 때까지 자동 적용을 보류합니다.</p>
    </div>
    <button type="button" className="ghost-button" onClick={() => window.dispatchEvent(new Event('codearchive-setup-open'))}>확장 설치 안내</button>
    <p>Chrome 확장 {status?.connected ? '연결됨' : '연결 안 됨'} · 창을 닫으면 트레이에서 계속 실행됩니다. 완전히 종료하려면 트레이 메뉴의 종료를 선택하세요.</p>
    <div className="desktop-actions"><button type="button" className="ghost-button" disabled={busy} onClick={() => void run(async () => setPair(await desktop.pair()))}>{status?.connected ? '확장 다시 연결' : '확장 연결 코드 발급'}</button><button type="button" className="ghost-button" disabled={busy || !status?.connected} onClick={() => void run(() => desktop.disconnect())}>연결 해제</button></div>
    {validPair && <p role="status">확장 팝업의 PC 앱 연결에 입력하세요: <strong className="desktop-pair-code">{pair.code}</strong> · 2분 동안 유효합니다.</p>}
    <label className="desktop-autostart"><input type="checkbox" checked={status?.autostart ?? false} disabled={busy || !status?.packaged} onChange={event => void run(() => desktop.setAutostart(event.target.checked))} /> Windows 로그인 시 자동 시작</label>
    {!status?.packaged && <p>자동 시작과 업데이트 적용은 설치한 앱에서 사용할 수 있습니다.</p>}
    {(error || statusError) && <p role="alert">{error || statusError}</p>}
  </section>
}
