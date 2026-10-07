import { desktopApi } from './desktop'
export function navigateSameTab(url: string) {
  const desktop = desktopApi()
  if (desktop) { void desktop.login(url).catch(() => window.dispatchEvent(new Event('codearchive-login-error'))); return }
  window.location.assign(url)
}
