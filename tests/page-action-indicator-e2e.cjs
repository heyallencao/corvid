const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-page-action-indicator-'));
  const fixture = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Action indicator fixture</title><style>body{margin:0;padding:24px}button,input{margin:24px;padding:12px}body{height:1800px}</style><button id="action-target">Click target</button><input id="fill-target" aria-label="Sensitive field"><p id="result">Ready</p><script>document.querySelector("#action-target").addEventListener("click",()=>document.querySelector("#result").textContent="Clicked");</script>');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  let app, client;
  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const shellPage = await app.firstWindow();
    await shellPage.bringToFront();
    await app.evaluate(({ app, BrowserWindow }) => {
      app.focus();
      const shell = BrowserWindow.getAllWindows().find(item => item.getTitle() === 'Corvid');
      shell?.show();
      shell?.focus();
      // Playwright-launched Electron apps do not reliably own macOS focus.
      // Stub only this test process's focus predicate so the native overlay path is deterministic.
      if (shell) shell.isFocused = () => true;
    });
    await delay(100);
    const control = await (async () => {
      for (let i = 0; i < 200; i++) {
        try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); }
        catch { await delay(25); }
      }
      throw new Error('Corvid control service did not start');
    })();
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(control.baseUrl + route, {
        method, headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      return result;
    };
    const { connect } = await import('../sdk/index.js');
    client = await connect({ dataDir, token: control.token });

    const backgroundRoom = await client.createRoom('后台动作指示隔离');
    const backgroundPage = await backgroundRoom.open(`http://127.0.0.1:${fixture.address().port}/`);
    await backgroundPage.waitForLoadState();
    await backgroundPage.click({ by: 'css', value: '#action-target' });
    let overlayCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(item => item.getTitle() === 'Corvid page action indicator').length);
    assert.equal(overlayCount, 0, 'background MCP/SDK actions do not create or show a foreground indicator');

    await call(`/rooms/${backgroundRoom.id}/activate`, 'POST', {});
    const overlayState = async () => app.evaluate(async ({ BrowserWindow }) => {
      const overlay = BrowserWindow.getAllWindows().find(item => !item.isFocusable());
      if (!overlay) return null;
      return {
        visible: overlay.isVisible(),
        focusable: overlay.isFocusable(),
        bounds: overlay.getBounds(),
        state: await overlay.webContents.executeJavaScript(`(()=>{const node=document.querySelector('#action-indicator');return {hidden:node.hidden,operation:node.dataset.operation||null,label:document.querySelector('#action-label').textContent,left:node.style.left,top:node.style.top,text:document.body.innerText}})()`),
      };
    });
    const waitForOperation = async operation => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = await overlayState();
        if (state?.visible && !state.state.hidden && state.state.operation === operation) return state;
        await delay(20);
      }
      const nativeWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(item => ({title:item.getTitle(),visible:item.isVisible(),focused:item.isFocused(),bounds:item.getBounds()})));
      throw new Error(`Native action indicator did not show ${operation}; state=${JSON.stringify(await overlayState())}; nativeWindows=${JSON.stringify(nativeWindows)}; windows=${JSON.stringify(await call('/windows'))}; rooms=${JSON.stringify((await call('/rooms')).rooms.map(item=>({id:item.id,ownership:item.ownership,windowId:item.windowId,active:item.tabs.map(tab=>({id:tab.id,active:tab.active}))})))}`);
    };

    await backgroundPage.click({ by: 'css', value: '#action-target' });
    const click = await waitForOperation('click');
    assert.equal(click.focusable, false, 'the overlay never takes keyboard focus');
    assert.match(click.state.label, /点击|Clicking/);
    assert.ok(Number.parseFloat(click.state.left) > 0 && Number.parseFloat(click.state.top) > 0, 'the overlay reports a viewport position in its transparent native window');
    assert.doesNotMatch(click.state.text, /Sensitive field|private-input-value/, 'the overlay contains no page or input text');
    assert.equal(await backgroundPage.evaluate(() => document.querySelector('#result').textContent), 'Clicked', 'page clicks still reach the site action');

    const secret = 'private-input-value';
    await backgroundPage.fill({ by: 'css', value: '#fill-target' }, secret);
    const fill = await waitForOperation('fill');
    assert.match(fill.state.label, /填写|Filling/);
    assert.doesNotMatch(fill.state.text, new RegExp(secret));

    await backgroundPage.hover({ by: 'css', value: '#action-target' });
    const hover = await waitForOperation('hover');
    assert.match(hover.state.label, /悬停|Hovering/);

    await backgroundPage.scroll(0, 180, { x: 120, y: 120 });
    const scroll = await waitForOperation('scroll');
    assert.match(scroll.state.label, /滚动|Scrolling/);

    if (process.env.CORVID_PAGE_ACTION_INDICATOR_SCREENSHOT_PATH) {
      const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
        const overlay = BrowserWindow.getAllWindows().find(item => !item.isFocusable());
        if (!overlay) throw new Error('Native page action indicator window was not created');
        return overlay.capturePage().then(image => image.toPNG().toString('base64'));
      });
      fs.mkdirSync(path.dirname(process.env.CORVID_PAGE_ACTION_INDICATOR_SCREENSHOT_PATH), { recursive: true });
      fs.writeFileSync(process.env.CORVID_PAGE_ACTION_INDICATOR_SCREENSHOT_PATH, Buffer.from(screenshot, 'base64'));
    }

    await call(`/rooms/${backgroundRoom.id}/yieldControl`, 'POST', {});
    const afterHandoff = await overlayState();
    assert.ok(!afterHandoff?.visible || afterHandoff.state.hidden, 'the indicator clears as soon as the Room is handed to the user');
    await call(`/rooms/${backgroundRoom.id}/resumeControl`, 'POST', {});
    await backgroundPage.click({ by: 'css', value: '#action-target' });
    await waitForOperation('click');
    await call(`/rooms/${backgroundRoom.id}/finish`, 'POST', { keep: 'all' });
    const afterFinish = await overlayState();
    assert.ok(!afterFinish?.visible || afterFinish.state.hidden, 'the indicator clears when the task finishes');

    await assert.rejects(backgroundPage.click({ by: 'css', value: '#missing-target' }));
    console.log('PASS Browser SDK click/hover/scroll/fill stages and positions; hidden Room isolation; no input text leakage; no focus capture; handoff and finish clear state');
  } finally {
    if (client) await client.disconnect();
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
