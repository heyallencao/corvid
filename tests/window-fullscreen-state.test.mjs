import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { clearPageFullscreen } = require('../desktop/page-fullscreen.cjs');

function createRecord(overrides = {}) {
  const calls = { setFullScreen: [], sent: [] };
  let fullScreen = overrides.fullScreen ?? true;
  const browserWindow = {
    isDestroyed: () => Boolean(overrides.destroyed),
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
    ...overrides.record,
  };
  return { record, calls };
}

const describe = record => ({ pageFullscreen: record.htmlFullscreen, tabId: record.htmlFullscreenTabId });

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
  assert.deepEqual(calls.setFullScreen, [false]);
  assert.deepEqual(calls.sent, [['shell-state', { pageFullscreen: false, tabId: null }]]);
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
