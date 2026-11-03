function clearPageFullscreen(record, tabId, describe) {
  if (!record?.htmlFullscreen || record.htmlFullscreenTabId !== tabId) return false;
  record.htmlFullscreen = false;
  record.htmlFullscreenTabId = null;

  const browserWindow = record.browserWindow;
  if (!record.appFullscreen && !browserWindow.isDestroyed() && browserWindow.isFullScreen()) {
    record.fullscreenTransitionTarget = false;
    browserWindow.setFullScreen(false);
  }
  if (!browserWindow.isDestroyed()) browserWindow.webContents.send('shell-state', describe(record, true));
  return true;
}

module.exports = { clearPageFullscreen };
