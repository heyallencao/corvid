const { contextBridge, ipcRenderer } = require('electron');

// Electron does not implement window.prompt. Keep its synchronous return
// contract while the browser main process awaits a user or agent response.
contextBridge.exposeInMainWorld('__corvidPrompt', (message, defaultValue) => ipcRenderer.sendSync('page-prompt', message, defaultValue));
if (location.href === 'about:blank') {
  contextBridge.exposeInMainWorld('browserHome', {
    onState: callback => ipcRenderer.on('browser-home-state', (_event, state) => callback(state)),
    // Shell 对话框关闭后 modalOpen 的清场是跨窗口异步消息，紧跟着的起始页动作可能瞬时未就绪；按错误语义短重试。
    action: async (action, value) => {
      for (let attempt = 0; ; attempt++) {
        try { return await ipcRenderer.invoke('browser-home-action', action, value); }
        catch (error) {
          if (attempt >= 9 || !/尚未准备好|当前不可用/.test(String(error?.message || error))) throw error;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  });
}
contextBridge.executeInMainWorld({func:()=>{
  const request=globalThis.__corvidPrompt;
  Object.defineProperty(globalThis,'prompt',{configurable:true,writable:true,value:(message='',defaultValue='')=>request(String(message),String(defaultValue))});
}});
