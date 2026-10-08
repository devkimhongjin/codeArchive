import { desktopApi } from './desktop'
import { extensionRuntime, openExtensionExternal } from './extensionEnvironment'
export function navigateSameTab(url: string) {
  if (extensionRuntime()) {
    window.dispatchEvent(new CustomEvent('codearchive-login-start', { detail: url.startsWith('https://github.com/apps/') ? 'install' : 'login' }))
    void openExtensionExternal(url).catch(error => window.dispatchEvent(new CustomEvent('codearchive-login-error', { detail: error instanceof Error ? error.message : null })))
    return
  }
  const desktop = desktopApi()
  if (desktop) {
    window.dispatchEvent(new CustomEvent('codearchive-login-start', { detail: url.startsWith('https://github.com/apps/') ? 'install' : 'login' }))
    void desktop.login(url).catch(error => window.dispatchEvent(new CustomEvent('codearchive-login-error', {
      detail: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : null
    })))
    return
  }
  window.location.assign(url)
}
