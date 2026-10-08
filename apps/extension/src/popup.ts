import { mountPopup } from './popupView';
import { SUBMISSION_PROGRESS_KEY } from './submissionProgress';
mountPopup(document, {
  openDashboard: view => { void chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html?view=${view}`) }); },
  load: () => chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }),
  subscribeProgress: (refresh) => {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'session' && changes[SUBMISSION_PROGRESS_KEY]) refresh();
    });
    const timer = setInterval(refresh, 2000);
    window.addEventListener('unload', () => clearInterval(timer), { once: true });
  },
  copy: (text) => navigator.clipboard.writeText(text),
  copyCapture: (captureId) => chrome.runtime.sendMessage({ type: 'COPY_RECENT_CAPTURE', captureId }),
  downloadCapture: (captureId) => chrome.runtime.sendMessage({ type: 'DOWNLOAD_RECENT_CAPTURE', captureId }),
  loadGithubStatuses: (captureIds) => chrome.runtime.sendMessage({ type: 'GET_GITHUB_COMMIT_STATUSES', captureIds }),
  updateSettings: (patch) => chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', patch }),
  updateGithubAutomation: request => chrome.runtime.sendMessage({ type: 'SET_GITHUB_AUTOMATION', ...request }),
  retryRelay: () => chrome.runtime.sendMessage({ type: 'RETRY_RELAY' })
});
