const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('browserShell', {
  invoke: (method, args) => ipcRenderer.invoke('shell-action', method, args),
  onState: callback => ipcRenderer.on('shell-state', (_event, state) => callback(state))
});
