const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const runAction = require('../desktop/actions.cjs');

(async () => {
  const calls = [];
  let attached = false;
  const debuggerSession = new EventEmitter();
  debuggerSession.isAttached = () => attached;
  debuggerSession.attach = () => { attached = true; };
  debuggerSession.detach = () => { attached = false; };
  debuggerSession.sendCommand = async (method, params) => {
    calls.push({ method, params });
    if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 800, clientHeight: 600 } };
    if (method === 'Page.captureScreenshot') return { data: 'cG5n' };
    return {};
  };
  const contents = {
    debugger: debuggerSession,
    getURL: () => 'http://127.0.0.1/',
    capturePage: async () => { throw new Error('UnknownVizError'); },
    executeJavaScriptInIsolatedWorld: async () => ({ ok: true, result: { width: 800, height: 600, devicePixelRatio: 2 } }),
  };
  const result = await runAction(contents, 'screenshot');
  assert.deepEqual(result, { base64: 'cG5n' });
  assert.deepEqual(calls.find(call => call.method === 'Page.captureScreenshot').params, {
    format: 'png',
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 800, height: 600, scale: 0.5 },
  });
  assert.ok(attached, 'CDP capture owns a debugger session for follow-up page operations');
  console.log('PASS viewport screenshot falls back to CDP when Electron Viz capture is unavailable');
})().catch(error => { console.error(error); process.exitCode = 1; });
