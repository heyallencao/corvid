const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('browserShell', {
  invoke: (method, args) => ipcRenderer.invoke('shell-action', method, args),
  reportBrowserChromeHeight: height => ipcRenderer.send('shell-browser-chrome-height', height),
  reportDockStripHeight: height => ipcRenderer.send('shell-dock-strip-height', height),
  onState: callback => ipcRenderer.on('shell-state', (_event, state) => callback(state)),
  onPiTasks: callback => ipcRenderer.on('pi-task-state', (_event, tasks) => callback(tasks)),
  onAgentTaskSummaries: callback => ipcRenderer.on('agent-task-summary-state', (_event, payload) => callback(payload)),
  onPiAuthEvent: callback => ipcRenderer.on('pi-auth-event', (_event, event) => callback(event)),
  onPiAuthPrompt: callback => ipcRenderer.on('pi-auth-prompt', (_event, prompt) => callback(prompt)),
  onAgentApprovalEvent: callback => ipcRenderer.on('agent-approval-event', (_event, event) => callback(event)),
  onFindOpen: callback => ipcRenderer.on('shell-find-open', () => callback()),
  onFindNext: callback => ipcRenderer.on('shell-find-next', (_event, options) => callback(options || {})),
  onPrintPage: callback => ipcRenderer.on('shell-print-page', (_event, request) => callback(request || {})),
  onFindResult: callback => ipcRenderer.on('shell-find-result', (_event, result) => callback(result)),
  onFindReset: callback => ipcRenderer.on('shell-find-reset', (_event, result) => callback(result)),
  onBrowserHomeAction: callback => ipcRenderer.on('shell-home-action', (_event, action) => callback(action)),
  onExtensionPopupState: callback => ipcRenderer.on('shell-extension-popup-state', (_event, state) => callback(state))
});
