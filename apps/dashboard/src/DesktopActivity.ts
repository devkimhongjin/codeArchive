import { useEffect, useRef } from 'react'
import { desktopApi } from './desktop'
const work = new Set<string>()
let draft = false
const report = () => { void desktopApi()?.reportActivity({ busy: work.size > 0, draft }).catch(() => {}) }
export function markDesktopDraft() { draft = true; report() }
export function useDesktopWork(busy: boolean) {
  const id = useRef(crypto.randomUUID())
  useEffect(() => {
    if (busy) work.add(id.current); else work.delete(id.current)
    report()
    return () => { work.delete(id.current); report() }
  }, [busy])
}
export function monitorDesktopActivity() {
  if (!desktopApi()) return () => {}
  // Keep automatic restarts conservative: edited fields block them until this app session reloads.
  const input = (event: Event) => {
    const target = event.target
    if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(target.type))) { markDesktopDraft() }
  }
  document.addEventListener('input', input)
  report(); const timer = window.setInterval(report, 2000)
  return () => { document.removeEventListener('input', input); window.clearInterval(timer) }
}
