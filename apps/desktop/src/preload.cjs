const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('codeArchiveDesktop', Object.freeze({
  requestBridge: message => ipcRenderer.invoke('desktop:bridge', message),
  api: request => ipcRenderer.invoke('desktop:api', request),
  login: url => ipcRenderer.invoke('desktop:login', url),
  getStatus: () => ipcRenderer.invoke('desktop:status'),
  pair: () => ipcRenderer.invoke('desktop:pair'),
  getSetup: () => ipcRenderer.invoke('desktop:setup'),
  openExtensionFolder: () => ipcRenderer.invoke('desktop:extension-folder'),
  completeSetup: () => ipcRenderer.invoke('desktop:setup-complete'),
  disconnect: () => ipcRenderer.invoke('desktop:disconnect'),
  setAutostart: value => ipcRenderer.invoke('desktop:autostart', value),
  checkUpdate: () => ipcRenderer.invoke('desktop:update-check'),
  installUpdate: () => ipcRenderer.invoke('desktop:update-install')
}));
