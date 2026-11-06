const path = require('node:path');

function createActionIndicator(parentWindow, BrowserWindow) {
  const window = new BrowserWindow({
    parent: parentWindow,
    title: 'Corvid page action indicator',
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'action-indicator-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let current = null;
  let clearTimer = null;
  let disposed = false;
  const syncBounds = () => {
    if (disposed || parentWindow.isDestroyed() || window.isDestroyed()) return;
    window.setBounds(parentWindow.getContentBounds());
  };
  const hide = () => {
    clearTimeout(clearTimer);
    clearTimer = null;
    current = null;
    if (disposed || window.isDestroyed()) return;
    if (window.webContents.isLoadingMainFrame()) {
      window.webContents.once('did-finish-load', () => { if (!disposed && !window.isDestroyed()) window.hide(); });
      return;
    }
    window.webContents.send('corvid-action-indicator', { visible: false });
    window.hide();
  };
  const onParentBlur = () => hide();
  const onParentMove = () => syncBounds();
  const onParentResize = () => syncBounds();
  parentWindow.on('blur', onParentBlur);
  parentWindow.on('move', onParentMove);
  parentWindow.on('resize', onParentResize);
  window.on('closed', () => { disposed = true; clearTimeout(clearTimer); });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.setIgnoreMouseEvents(true, { forward: true });

  const ready = window.loadFile(path.join(__dirname, 'action-indicator.html'));
  return {
    window,
    ready,
    show({ actionId, roomId, tabId, operation, x, y, label, ariaLabel }) {
      if (disposed || window.isDestroyed() || !['click', 'hover', 'scroll', 'fill'].includes(operation) || ![x, y].every(Number.isFinite)) return;
      syncBounds();
      current = { actionId, roomId, tabId };
      const state = { visible: true, actionId, operation, x, y, label, ariaLabel };
      if (window.webContents.isLoadingMainFrame()) {
        window.webContents.once('did-finish-load', () => {
          if (disposed || window.isDestroyed() || current?.actionId !== actionId) return;
          window.webContents.send('corvid-action-indicator', state);
          if (parentWindow.isFocused() && parentWindow.isVisible() && !parentWindow.isMinimized()) window.showInactive();
        });
        return;
      }
      window.webContents.send('corvid-action-indicator', state);
      if (parentWindow.isFocused() && parentWindow.isVisible() && !parentWindow.isMinimized()) window.showInactive();
    },
    finish(actionId) {
      if (current?.actionId !== actionId) return;
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => { if (current?.actionId === actionId) hide(); }, 520);
    },
    hide,
    hideRoom(roomId) { if (current?.roomId === roomId) hide(); },
    hideTab(tabId) { if (current?.tabId === tabId) hide(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(clearTimer);
      parentWindow.removeListener('blur', onParentBlur);
      parentWindow.removeListener('move', onParentMove);
      parentWindow.removeListener('resize', onParentResize);
      if (!window.isDestroyed()) window.destroy();
    },
  };
}

module.exports = { createActionIndicator };
