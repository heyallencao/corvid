function snapshotFullscreenRestoreState(record) {
  if (!record || record.browserWindow.isDestroyed()) return;
  if (record.fullscreenRestoreMaximized == null) {
    record.fullscreenRestoreMaximized = record.browserWindow.isMaximized() || record.lastKnownMaximized;
  }
  if (record.fullscreenRestoreBounds == null && typeof record.browserWindow.getNormalBounds === 'function') {
    record.fullscreenRestoreBounds = { ...(record.normalBounds || record.browserWindow.getNormalBounds()) };
  }
}

function markPageFullscreen(record, tabId, describe) {
  if (!record || record.closing || record.browserWindow.isDestroyed()) return false;
  snapshotFullscreenRestoreState(record);
  record.htmlFullscreen = true;
  record.htmlFullscreenTabId = tabId;
  record.browserWindow.webContents.send('shell-state', describe(record, true));
  return true;
}

function clearPageFullscreen(record, tabId, describe) {
  if (!record?.htmlFullscreen || record.htmlFullscreenTabId !== tabId) return false;
  record.htmlFullscreen = false;
  record.htmlFullscreenTabId = null;

  const browserWindow = record.browserWindow;
  if (!record.closing && !record.appFullscreen && !browserWindow.isDestroyed() && browserWindow.isFullScreen()) {
    record.fullscreenTransitionTarget = false;
    browserWindow.setFullScreen(false);
  }
  if (!record.appFullscreen && !browserWindow.isDestroyed() && !browserWindow.isFullScreen()) {
    record.lastKnownMaximized = Boolean(browserWindow.isMaximized() || record.fullscreenRestoreMaximized);
    record.fullscreenRestoreMaximized = null;
  }
  if (!record.closing && !browserWindow.isDestroyed() && typeof describe === 'function') {
    browserWindow.webContents.send('shell-state', describe(record, true));
  }
  return true;
}

module.exports = { clearPageFullscreen, markPageFullscreen, snapshotFullscreenRestoreState };
