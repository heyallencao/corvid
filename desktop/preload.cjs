const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('browserShell', {
  invoke: (method, args) => ipcRenderer.invoke('shell-action', method, args),
  onState: callback => ipcRenderer.on('shell-state', (_event, state) => callback(state)),
  onFindOpen: callback => ipcRenderer.on('shell-find-open', () => callback()),
  onFindNext: callback => ipcRenderer.on('shell-find-next', (_event, options) => callback(options || {})),
  onFindResult: callback => ipcRenderer.on('shell-find-result', (_event, result) => callback(result)),
  onFindReset: callback => ipcRenderer.on('shell-find-reset', (_event, result) => callback(result))
});
