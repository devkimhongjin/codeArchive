import { useEffect, useRef, useState } from 'react'
import { desktopApi } from './desktop'

export function DesktopSetup() {
  const desktop = desktopApi()
  const dialog = useRef<HTMLDialogElement>(null)
  const [setup, setSetup] = useState<Awaited<ReturnType<NonNullable<typeof desktop>['getSetup']>> | null>(null)
  const [visible, setVisible] = useState(false)
  const [connected, setConnected] = useState(false)
  const [pair, setPair] = useState<{ code: string; expiresAt: number } | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!desktop) return
    let active = true
    const load = (force = false) => { void desktop.getSetup().then(value => { if (active) { setSetup(value); if (force || !value.completed) setVisible(true) } }).catch(() => { if (active) { setError('설치 안내를 불러오지 못했습니다. 앱을 다시 실행해 주세요.'); setVisible(true) } }) }
    const reopen = () => load(true)
    load(); window.addEventListener('codearchive-setup-open', reopen)
    return () => { active = false; window.removeEventListener('codearchive-setup-open', reopen) }
  }, [desktop])
  useEffect(() => {
    if (visible) dialog.current?.showModal()
    else dialog.current?.close()
    if (!desktop || !visible) return
    let active = true
    const refresh = () => { void desktop.getStatus().then(status => { if (active) setConnected(status.connected) }).catch(() => { if (active) setConnected(false) }) }
    refresh(); const timer = window.setInterval(refresh, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [desktop, visible])
  if (!desktop) return null
  const run = async (action: () => Promise<unknown>) => { setError(''); setBusy(true); try { await action() } catch (failure) { setError(failure instanceof Error ? failure.message : '설정 요청에 실패했습니다.') } finally { setBusy(false) } }
  const copy = (value: string) => run(async () => { await navigator.clipboard.writeText(value); setMessage('복사했습니다.') })
  return <dialog ref={dialog} className="desktop-setup" aria-labelledby="desktop-setup-title" onCancel={() => setVisible(false)}>
    <h2 id="desktop-setup-title">Chrome 확장 설치·연결</h2>
    <p>함께 설치된 CodeArchive 확장을 Chrome에 등록하고 연결해 주세요.</p>
    <ol className="desktop-setup-steps">
      <li><h3>확장 폴더 확인</h3><p>Chrome에서 아래 폴더를 선택합니다. {setup?.extensionVersion && `포함된 확장 v${setup.extensionVersion}`}</p>
        <input aria-label="포함된 확장 폴더 경로" value={setup?.extensionPath ?? ''} readOnly onFocus={event => event.target.select()} />
        <div className="desktop-actions"><button className="ghost-button" disabled={busy || !setup?.available} onClick={() => void copy(setup!.extensionPath)}>경로 복사</button><button className="ghost-button" disabled={busy || !setup?.available} onClick={() => void run(() => desktop.openExtensionFolder())}>확장 폴더 열기</button></div>
        {setup && !setup.available && <p role="alert">포함된 확장 파일을 찾을 수 없습니다. 앱을 다시 설치해 주세요.</p>}
      </li>
      <li><h3>Chrome에 확장 등록</h3><p>Chrome 주소창에 <code>chrome://extensions</code>를 입력한 뒤, 우측 상단 <strong>개발자 모드</strong>를 켜고 <strong>압축해제된 확장 프로그램을 로드합니다</strong>를 눌러 위 폴더를 선택하세요.</p>
        <button className="ghost-button" disabled={busy} onClick={() => void copy('chrome://extensions')}>확장 관리 주소 복사</button>
        <p>기존 확장은 삭제하거나 중복 등록하지 말고 바로 연결하세요. 앱 업데이트 후에는 Chrome 확장도 새로고침해 주세요.</p>
      </li>
      <li><h3>PC 앱과 연결</h3><p>최초 한 번 연결 코드로 로컬 풀이 접근을 승인하면 다음 실행부터 자동으로 연결됩니다.</p>
        <p role="status">{connected ? '확장 연결 완료' : '확장 연결 대기 중'}</p>
        {!connected && <button className="primary-button" disabled={busy} onClick={() => void run(async () => setPair(await desktop.pair()))}>연결 코드 발급</button>}
        {!connected && pair && Date.now() < pair.expiresAt && <p>Chrome 툴바의 CodeArchive 팝업 → <strong>PC 앱 연결</strong>에 입력하세요: <strong className="desktop-pair-code">{pair.code}</strong> · 2분 동안 유효합니다.</p>}
      </li>
    </ol>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <div className="desktop-actions"><button className="ghost-button" disabled={busy} onClick={() => setVisible(false)}>나중에</button><button className="primary-button" disabled={busy || !connected} onClick={() => void run(async () => { await desktop.completeSetup(); setVisible(false) })}>설정 완료</button></div>
    <p>설정 → PC 앱 설정 → 확장 설치 안내에서 다시 열 수 있습니다.</p>
  </dialog>
}
