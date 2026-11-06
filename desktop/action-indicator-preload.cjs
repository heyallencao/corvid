const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('corvidActionIndicator', {
  onState: callback => ipcRenderer.on('corvid-action-indicator', (_event, state) => callback(state)),
});
