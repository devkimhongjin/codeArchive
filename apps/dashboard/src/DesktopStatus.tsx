import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { monitorDesktopActivity } from './DesktopActivity'
import { desktopApi, type DesktopStatus } from './desktop'

const DesktopStatusContext = createContext({ status: null as DesktopStatus | null, error: '', refresh: async () => {} })

export function DesktopStatusProvider({ children }: { children: ReactNode }) {
  const desktop = desktopApi()
  const [status, setStatus] = useState<DesktopStatus | null>(null)
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const refresh = useCallback(async () => {
    if (!desktop || inFlight.current) return
    inFlight.current = true
    try {
      const value = await desktop.getStatus()
      if (mounted.current) { setStatus(value); setError('') }
    } catch {
      if (mounted.current) setError('PC 앱 상태를 가져오지 못했습니다.')
    } finally { inFlight.current = false }
  }, [desktop])
  useEffect(() => {
    mounted.current = true
    if (!desktop) return () => { mounted.current = false }
    const stopActivity = monitorDesktopActivity()
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => { mounted.current = false; stopActivity(); window.clearInterval(timer) }
  }, [desktop, refresh])
  return <DesktopStatusContext.Provider value={{ status, error, refresh }}>{children}</DesktopStatusContext.Provider>
}

export function useDesktopStatus() { return useContext(DesktopStatusContext) }

export function DesktopVersion() {
  const { status } = useDesktopStatus()
  return desktopApi() ? <div className="desktop-version">PC 앱 v{status?.version ?? '—'}</div> : null
}

export function DesktopUpdateNotice() {
  const { status, refresh } = useDesktopStatus()
  const dialog = useRef<HTMLDialogElement>(null)
  const announced = useRef(new Set<string>())
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [shownVersion, setShownVersion] = useState('')
  const version = status?.update.version
  useEffect(() => {
    if (version && status?.update.state === 'available' && !announced.current.has(version) && !document.querySelector('dialog[open]:not(.desktop-update-dialog)')) { dialog.current?.showModal(); announced.current.add(version); setShownVersion(version) }
    else if (!busy && ['current', 'idle', 'checking'].includes(status?.update.state ?? 'idle')) dialog.current?.close()
  }, [status, version, busy])
  const dismiss = () => { if (shownVersion) announced.current.add(shownVersion); dialog.current?.close(); setError('') }
  const apply = async () => {
    setBusy(true); setError('')
    try { await desktopApi()!.installUpdate() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '업데이트를 적용하지 못했습니다.') }
    finally { await refresh(); setBusy(false) }
  }
  if (!desktopApi()) return null
  return <dialog ref={dialog} className="desktop-setup desktop-update-dialog" aria-labelledby="desktop-update-title" onCancel={event => { if (busy) event.preventDefault(); else dismiss() }}>
    <h2 id="desktop-update-title">새 PC 앱 버전이 있습니다</h2>
    <p>현재 v{status?.version} → v{shownVersion}</p>
    <p>업데이트 후 앱을 다시 시작합니다. 포함된 Chrome 확장은 새로고침해 주세요.</p>
    {busy && <p role="status">업데이트 다운로드·적용 중…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="desktop-actions"><button className="ghost-button" disabled={busy} onClick={dismiss}>나중에</button><button className="primary-button" disabled={busy || !status?.packaged} onClick={() => void apply()}>업데이트 다운로드·적용</button></div>
  </dialog>
}
