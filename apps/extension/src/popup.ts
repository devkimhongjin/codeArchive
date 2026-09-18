import { mountPopup } from './popupView';
mountPopup(document, {
  load: () => chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }),
  copy: (text) => navigator.clipboard.writeText(text),
  copyCapture: (captureId) => chrome.runtime.sendMessage({ type: 'COPY_RECENT_CAPTURE', captureId }),
  downloadCapture: (captureId) => chrome.runtime.sendMessage({ type: 'DOWNLOAD_RECENT_CAPTURE', captureId }),
  loadGithubStatuses: (captureIds) => chrome.runtime.sendMessage({ type: 'GET_GITHUB_COMMIT_STATUSES', captureIds }),
  updateSettings: (patch) => chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', patch }),
  retryRelay: () => chrome.runtime.sendMessage({ type: 'RETRY_RELAY' })
});
