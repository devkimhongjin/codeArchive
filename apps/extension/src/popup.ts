import { mountPopup } from './popupView';
import { SUBMISSION_PROGRESS_KEY } from './submissionProgress';
mountPopup(document, {
  load: () => chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }),
  loadExtensionUpdate: (force) => chrome.runtime.sendMessage({ type: 'CHECK_EXTENSION_UPDATE', force }),
  subscribeProgress: (refresh) => chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'session' && changes[SUBMISSION_PROGRESS_KEY]) refresh();
  }),
  copy: (text) => navigator.clipboard.writeText(text),
  copyCapture: (captureId) => chrome.runtime.sendMessage({ type: 'COPY_RECENT_CAPTURE', captureId }),
  downloadCapture: (captureId) => chrome.runtime.sendMessage({ type: 'DOWNLOAD_RECENT_CAPTURE', captureId }),
  loadGithubStatuses: (captureIds) => chrome.runtime.sendMessage({ type: 'GET_GITHUB_COMMIT_STATUSES', captureIds }),
  updateSettings: (patch) => chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', patch }),
  retryRelay: () => chrome.runtime.sendMessage({ type: 'RETRY_RELAY' })
});
