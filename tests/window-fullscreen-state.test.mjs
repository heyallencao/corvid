import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { clearPageFullscreen, markPageFullscreen, snapshotFullscreenRestoreState } = require('../desktop/page-fullscreen.cjs');

function createRecord(overrides = {}) {
  const calls = { setFullScreen: [], sent: [] };
  let fullScreen = overrides.fullScreen ?? true;
  const normalBounds = overrides.bounds ?? { x: 100, y: 80, width: 1024, height: 684 };
  const browserWindow = {
    isDestroyed: () => Boolean(overrides.destroyed),
    isMaximized: () => Boolean(overrides.maximized),
    getNormalBounds: () => ({ ...normalBounds }),
    isFullScreen: () => fullScreen,
    setFullScreen(value) { calls.setFullScreen.push(value); fullScreen = value; },
    webContents: { send: (...args) => calls.sent.push(args) },
  };
  const record = {
    browserWindow,
    appFullscreen: false,
    htmlFullscreen: true,
    htmlFullscreenTabId: 'tab-a',
    fullscreenTransitionTarget: null,
    fullscreenRestoreMaximized: null,
    fullscreenRestoreBounds: null,
    lastKnownMaximized: false,
    ...overrides.record,
  };
  return { record, calls };
}

const describe = record => ({ pageFullscreen: record.htmlFullscreen, tabId: record.htmlFullscreenTabId });

test('snapshots exact normal bounds once before a fullscreen transition', () => {
  const bounds = { x: 11, y: 22, width: 1024, height: 684 };
  const { record } = createRecord({ bounds, maximized: true });
  snapshotFullscreenRestoreState(record);
  bounds.height = 682;
  snapshotFullscreenRestoreState(record);
  assert.equal(record.fullscreenRestoreMaximized, true);
  assert.deepEqual(record.fullscreenRestoreBounds, { x: 11, y: 22, width: 1024, height: 684 });
});

test('records the exact page tab that entered HTML fullscreen', () => {
  const { record, calls } = createRecord({ record: { htmlFullscreen: false, htmlFullscreenTabId: null } });
  assert.equal(markPageFullscreen(record, 'tab-a', describe), true);
  assert.equal(record.htmlFullscreen, true);
  assert.equal(record.htmlFullscreenTabId, 'tab-a');
  assert.deepEqual(record.fullscreenRestoreBounds, { x: 100, y: 80, width: 1024, height: 684 });
  assert.deepEqual(calls.sent, [['shell-state', { pageFullscreen: true, tabId: 'tab-a' }]]);
});

test('a late exit from an older tab cannot clear the newer fullscreen owner', () => {
  const { record, calls } = createRecord({ record: { htmlFullscreen: false, htmlFullscreenTabId: null } });
  assert.equal(markPageFullscreen(record, 'tab-a', describe), true);
  assert.equal(markPageFullscreen(record, 'tab-b', describe), true);
  assert.equal(clearPageFullscreen(record, 'tab-a', describe), false);
  assert.equal(record.htmlFullscreen, true);
  assert.equal(record.htmlFullscreenTabId, 'tab-b');
  assert.deepEqual(calls.setFullScreen, []);
  assert.equal(calls.sent.length, 2);
});

test('does not clear page fullscreen when another tab closes', () => {
  const { record, calls } = createRecord();
  assert.equal(clearPageFullscreen(record, 'tab-b', describe), false);
  assert.equal(record.htmlFullscreen, true);
  assert.equal(record.htmlFullscreenTabId, 'tab-a');
  assert.deepEqual(calls.setFullScreen, []);
  assert.deepEqual(calls.sent, []);
});

test('clears the owning page and exits native fullscreen after its tab closes', () => {
  const { record, calls } = createRecord();
  assert.equal(clearPageFullscreen(record, 'tab-a', describe), true);
  assert.equal(record.htmlFullscreen, false);
  assert.equal(record.htmlFullscreenTabId, null);
  assert.equal(record.fullscreenTransitionTarget, false);
  assert.equal(record.fullscreenRestoreMaximized, null);
  assert.equal(record.lastKnownMaximized, false);
  assert.deepEqual(calls.setFullScreen, [false]);
  assert.deepEqual(calls.sent, [['shell-state', { pageFullscreen: false, tabId: null }]]);
});

test('restores the maximized snapshot when page fullscreen did not change native window state', () => {
  const { record } = createRecord({
    fullScreen: false,
    maximized: true,
    record: { fullscreenRestoreMaximized: true },
  });
  assert.equal(clearPageFullscreen(record, 'tab-a', describe), true);
  assert.equal(record.lastKnownMaximized, true);
  assert.equal(record.fullscreenRestoreMaximized, null);
});

test('preserves application fullscreen while clearing an HTML fullscreen page', () => {
  const { record, calls } = createRecord({ record: { appFullscreen: true } });
  assert.equal(clearPageFullscreen(record, 'tab-a', describe), true);
  assert.equal(record.htmlFullscreen, false);
  assert.deepEqual(calls.setFullScreen, []);
  assert.equal(calls.sent.length, 1);
});

test('is safe to repeat after state has already been cleared', () => {
  const { record, calls } = createRecord();
  assert.equal(clearPageFullscreen(record, 'tab-a', describe), true);
  assert.equal(clearPageFullscreen(record, 'tab-a', describe), false);
  assert.deepEqual(calls.setFullScreen, [false]);
  assert.equal(calls.sent.length, 1);
});

test('clears page state safely when teardown has no shell serializer', () => {
  const { record, calls } = createRecord();
  assert.equal(clearPageFullscreen(record, 'tab-a'), true);
  assert.equal(record.htmlFullscreen, false);
  assert.equal(record.htmlFullscreenTabId, null);
  assert.deepEqual(calls.setFullScreen, [false]);
  assert.deepEqual(calls.sent, []);
});

test('clears state without calling a destroyed BrowserWindow', () => {
  const { record, calls } = createRecord({ destroyed: true });
  assert.equal(clearPageFullscreen(record, 'tab-a', describe), true);
  assert.equal(record.htmlFullscreen, false);
  assert.equal(record.htmlFullscreenTabId, null);
  assert.deepEqual(calls.setFullScreen, []);
  assert.deepEqual(calls.sent, []);
});

test('clears state without starting another fullscreen transition while closing', () => {
  const { record, calls } = createRecord({ record: { closing: true } });
  assert.equal(clearPageFullscreen(record, 'tab-a', describe), true);
  assert.equal(record.htmlFullscreen, false);
  assert.equal(record.htmlFullscreenTabId, null);
  assert.deepEqual(calls.setFullScreen, []);
  assert.deepEqual(calls.sent, []);
});
