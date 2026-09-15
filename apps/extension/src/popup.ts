import { mountPopup } from './popupView';
mountPopup(document, {
  load: () => chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }),
  extensionId: chrome.runtime.id,
  copy: (text) => navigator.clipboard.writeText(text)
});
