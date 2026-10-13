import { useEffect, useRef } from 'react'
import { Check, CircleAlert, LoaderCircle, Server, X } from 'lucide-react'

export type ServerConnectionState =
  | { phase: 'checking' | 'loading' | 'ready' | 'signed-out' }
  | { phase: 'error'; authenticated: boolean }

export function serverConnectionLabel(state: ServerConnectionState) {
  switch (state.phase) {
    case 'checking': return '로그인 상태 확인 중'
    case 'loading': return '로그인 확인 완료 · 내 풀이 불러오는 중'
    case 'signed-out': return 'GitHub 로그아웃 상태'
    case 'error': return state.authenticated ? '로그인 확인 완료 · 풀이 목록 연결 실패' : '서버 연결 실패 · 로그인 상태 확인 불가'
    case 'ready': return '서버 연결 완료'
  }
}

export function ServerConnectionDialog({ state, visible, onDismiss, onRetry, onLogin }: {
  state: ServerConnectionState; visible: boolean; onDismiss: () => void; onRetry: () => void; onLogin: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const open = visible && state.phase !== 'ready'
  const busy = state.phase === 'checking' || state.phase === 'loading'
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) {
      if (typeof element.showModal === 'function') element.showModal()
      else element.setAttribute('open', '')
    } else if (!open && element.open) {
      if (typeof element.close === 'function') element.close()
      else element.removeAttribute('open')
    }
  }, [open])
  const description = state.phase === 'checking' ? '서버에서 로그인 상태를 확인하고 있습니다. 잠시 기다려 주세요.'
    : state.phase === 'loading' ? '로그인이 확인되었습니다. 저장된 전체 풀이를 불러오고 있습니다.'
      : state.phase === 'signed-out' ? '현재 로그아웃 상태입니다. GitHub로 로그인하면 저장된 풀이를 볼 수 있습니다.'
        : state.phase === 'error' && state.authenticated ? '로그인 확인은 성공했지만 풀이 목록을 불러오지 못했습니다. 서버 연결을 다시 확인해 주세요.'
          : '서버 응답을 확인하지 못해 로그인 여부를 알 수 없습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
  return <dialog ref={dialog} className="server-connection-dialog" aria-labelledby="server-connection-title" aria-describedby="server-connection-description" onCancel={onDismiss}>
    {open && <>
    <div className="server-connection-heading"><Server size={20} aria-hidden="true" /><h2 id="server-connection-title">서버 연결</h2><button type="button" className="server-connection-close" aria-label="서버 연결 안내 닫기" onClick={onDismiss} autoFocus><X size={18} /></button></div>
    <div className={`server-connection-state ${state.phase === 'error' ? 'is-error' : ''}`} role="status" aria-live="polite" aria-atomic="true">
      {busy ? <LoaderCircle className="server-connection-spinner" size={23} aria-hidden="true" /> : <CircleAlert size={23} aria-hidden="true" />}
      <strong>{serverConnectionLabel(state)}</strong>
    </div>
    <p id="server-connection-description">{description}</p>
    {busy && <ol className="server-connection-steps" aria-label="연결 단계">
      <li className={state.phase === 'loading' ? 'is-complete' : 'is-current'}>{state.phase === 'loading' ? <Check size={16} aria-hidden="true" /> : <LoaderCircle className="server-connection-spinner" size={16} aria-hidden="true" />}로그인 상태 확인</li>
      <li className={state.phase === 'loading' ? 'is-current' : ''}>{state.phase === 'loading' ? <LoaderCircle className="server-connection-spinner" size={16} aria-hidden="true" /> : <span className="server-connection-step-dot" aria-hidden="true" />}내 풀이 불러오기</li>
    </ol>}
    <div className="server-connection-footer">
      {busy ? <p>처음 연결에는 시간이 걸릴 수 있습니다. 창을 닫아도 연결 확인은 계속됩니다.</p> : <div className="server-connection-buttons">
        <button type="button" className="server-connection-secondary" onClick={onDismiss}>닫기</button>
        {state.phase === 'signed-out' ? <button type="button" className="primary-button" onClick={onLogin}>GitHub 로그인하기</button> : <button type="button" className="primary-button" onClick={onRetry}>다시 연결</button>}
      </div>}
    </div>
    </>}
  </dialog>
}
