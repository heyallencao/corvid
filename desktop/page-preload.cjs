const { contextBridge, ipcRenderer } = require('electron');

// Electron does not implement window.prompt. Keep its synchronous return
// contract while the browser main process awaits a user or agent response.
contextBridge.exposeInMainWorld('__corvidPrompt', (message, defaultValue) => ipcRenderer.sendSync('page-prompt', message, defaultValue));
contextBridge.executeInMainWorld({func:()=>{
  const request=globalThis.__corvidPrompt;
  Object.defineProperty(globalThis,'prompt',{configurable:true,writable:true,value:(message='',defaultValue='')=>request(String(message),String(defaultValue))});
}});
