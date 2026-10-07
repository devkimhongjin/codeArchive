import { mountPopup } from './popupView';
import { SUBMISSION_PROGRESS_KEY } from './submissionProgress';
const desktopStatus = document.querySelector<HTMLElement>('#desktop-status');
const desktopFeedback = document.querySelector<HTMLElement>('#desktop-feedback');
const desktopCode = document.querySelector<HTMLInputElement>('#desktop-pair-code');
async function refreshDesktop() {
  const response = await chrome.runtime.sendMessage({ type: 'DESKTOP_STATUS' });
  if (desktopStatus) desktopStatus.textContent = response?.connected ? '연결됨' : '연결 안 됨';
}
void refreshDesktop();
setInterval(() => void refreshDesktop(), 2000);
document.querySelector('#desktop-pair-form')?.addEventListener('submit', event => {
  event.preventDefault();
  void chrome.runtime.sendMessage({ type: 'DESKTOP_PAIR', code: desktopCode?.value.trim() }).then(response => {
    if (desktopFeedback) desktopFeedback.textContent = response?.error ?? '연결 요청을 보냈습니다.';
    if (!response?.error && desktopCode) desktopCode.value = '';
    void refreshDesktop();
  });
});
document.querySelector('#desktop-disconnect')?.addEventListener('click', () => { void chrome.runtime.sendMessage({ type: 'DESKTOP_DISCONNECT' }).then(() => { if (desktopFeedback) desktopFeedback.textContent = 'PC 앱 연결을 해제했습니다.'; void refreshDesktop(); }); });
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
