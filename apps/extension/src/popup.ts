import { mountPopup } from './popupView';
mountPopup(document, {
  load: () => chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }),
  copy: (text) => navigator.clipboard.writeText(text),
  copyCapture: (captureId) => chrome.runtime.sendMessage({ type: 'COPY_RECENT_CAPTURE', captureId }),
  downloadCapture: (captureId) => chrome.runtime.sendMessage({ type: 'DOWNLOAD_RECENT_CAPTURE', captureId })
});
