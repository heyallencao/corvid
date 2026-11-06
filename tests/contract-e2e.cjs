const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { _electron } = require('playwright-core');
const electron = require('electron');
const { focusElectronWindow } = require('./electron-test-startup.cjs');

const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 6000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(25);
  }
  throw new Error(`Timed out${last ? `: ${last.message}` : ''}`);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-contract-'));
  const main = `<!doctype html><title>Contract fixture</title><input id="text"><input id="other"><button id="dbl">dbl</button><a id="popup" href="/popup" target="_blank">popup</a><script>window.marker=null;window.dbl=0;document.querySelector('#dbl').addEventListener('dblclick',()=>{window.dbl++;});</script>`;
  const fixture = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    if (req.url === '/two') { res.end('<title>Second</title><button id="second">second</button>'); return; }
    if (req.url === '/popup') { res.end('<title>Popup</title><p>popup page</p>'); return; }
    res.end(main);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fixture.address().port}`;

  const env = { ...process.env, CORVID_DATA_DIR: dir, CORVID_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app, client;
  try {
    app = await _electron.launch({ executablePath: electron, args: [root], env });
    const shell = await app.firstWindow();
    await focusElectronWindow(app, shell, { label: 'contract-e2e' });
    await until(() => fs.existsSync(path.join(dir, 'control.json')));
    client = await (await import('../sdk/index.js')).connect({ dataDir: dir });
    const room = await client.openRoom('Contract room');
    const page = room.page('p1');
    await page.goto(base + '/');
    await page.waitForLoadState('load');

    // keyboard: type, press, modifier hold, insertText and native paste.
    await page.fill('#text', '');
    await page.focus('#text');
    await page.keyboard.type('hello');
    await page.keyboard.press('a');
    await page.keyboard.down('Shift');
    await page.keyboard.press('b');
    await page.keyboard.up('Shift');
    await page.keyboard.insertText('!');
    assert.equal(await page.evaluate(() => document.querySelector('#text').value), 'helloaB!');
    await page.keyboard.paste('PASTED');
    assert.equal(await page.evaluate(() => document.querySelector('#text').value), 'helloaB!PASTED');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'text');

    // focus() moves focus between elements.
    await page.focus('#other');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'other');

    // dblclick() dispatches a trusted double click.
    const dblReceipt = await page.dblclick('#dbl');
    assert.equal(await page.evaluate(() => window.dbl), 1);
    assert.ok(dblReceipt.receipt && Array.isArray(dblReceipt.receipt.popups));
    assert.equal(dblReceipt.receipt.dialog, null);

    // reload() reloads the committed document.
    await page.evaluate(() => { window.marker = 42; return true; });
    await page.reload();
    await until(async () => (await page.evaluate(() => window.marker)) === null, 5000);
    await page.waitForLoadState('load');
    assert.equal(await page.title(), 'Contract fixture');

    // info() exposes stable page identity and load state.
    const info = await page.info();
    const tabId = await page.resolveId();
    assert.equal(info.label, 'p1');
    assert.equal(info.targetId, tabId);
    assert.equal(info.roomId, room.id);
    assert.equal(info.url, base + '/');
    assert.equal(info.title, 'Contract fixture');
    assert.equal(info.openedBy, 'agent');
    assert.equal(info.loadComplete, true);
    assert.equal(info.dialog, null);

    // events() drains popup events; click receipt reports the immediate popup.
    assert.deepEqual(await page.events(), []);
    const popupClick = await page.click('#popup');
    assert.equal(popupClick.ok, true);
    assert.ok(Array.isArray(popupClick.receipt.popups));
    assert.equal(popupClick.receipt.popups.length, 1);
    assert.ok(popupClick.receipt.popups[0].tabId);
    const popupEvents = await until(async () => { const list = await page.events(); return list.length ? list : null; });
    assert.ok(['initializing', 'ready'].includes(popupEvents[0].status));

    // cdp() is the raw escape hatch and returns the CDP response.
    const evaluated = await page.cdp('Runtime.evaluate', { expression: '1+1', returnByValue: true });
    assert.equal(evaluated.result.value, 2);
    const metrics = await page.cdp('Page.getLayoutMetrics');
    assert.ok(metrics.cssContentSize.width > 0);

    // Error codes: timeout, control loss, not found, stale reference.
    await assert.rejects(() => page.waitForURL('**/never', { timeout: 250 }), error => error.code === 'CORVID_TIMEOUT');
    await assert.rejects(() => client.room('missing-room'), error => error.code === 'CORVID_NOT_FOUND');
    await assert.rejects(() => client.api('/nope'), error => error.code === 'CORVID_NOT_FOUND');
    const snapshot = await page.snapshot();
    await page.goto(base + '/two');
    await page.waitForLoadState('load');
    await assert.rejects(() => page.click(snapshot.items[0].ref), error => error.code === 'CORVID_STALE_REFERENCE');
    await room.yieldControl();
    await assert.rejects(() => page.url(), error => error.code === 'CORVID_CONTROL_LOST');
    await room.resumeControl();
    await room.waitForControl({ interval: 50, timeout: 5000 });

    await room.finish({ keep: [] });
    await client.disconnect();
    client = undefined;
    console.log('PASS keyboard, focus, dblclick, reload, info, events, receipts, cdp and error codes');
  } finally {
    if (client) await client.disconnect().catch(() => {});
    if (app) await app.close().catch(() => {});
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
