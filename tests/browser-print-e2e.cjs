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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-browser-print-'));
  const requests = [];
  const fixture = http.createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('Content-Type', 'text/html');
    res.end(`<title>${req.url}</title><main>Printable ${req.url}</main>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fixture.address().port}`;
  let app;

  async function until(fn, message = 'Timed out waiting for browser state') {
    for (let i = 0; i < 200; i++) {
      const value = await fn();
      if (value) return value;
      await delay(25);
    }
    throw new Error(message);
  }

  async function call(route, method = 'GET', body) {
    const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8'));
    const response = await fetch(config.baseUrl + route, {
      method,
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
    return value;
  }

  async function installPrintStub(url) {
    await app.evaluate(({ webContents }, { url }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url);
      if (!page) throw new Error(`No page WebContents found for ${url}`);
      globalThis.__corvidPrintCalls ||= [];
      globalThis.__corvidPrintResult = { success: true, failureReason: '' };
      page.print = (options, callback) => {
        globalThis.__corvidPrintCalls.push({ url: page.getURL(), options });
        callback(globalThis.__corvidPrintResult.success, globalThis.__corvidPrintResult.failureReason);
      };
    }, { url });
  }

  async function setPrintResult(success, failureReason = '') {
    await app.evaluate((_electron, result) => { globalThis.__corvidPrintResult = result; }, { success, failureReason });
  }

  async function printCalls() {
    return app.evaluate(() => globalThis.__corvidPrintCalls || []);
  }

  async function openPrintMenu(shell) {
    await shell.locator('#more-tools').click();
    await shell.getByRole('menuitem', { name: /打印网页/ }).click();
  }

  async function shortcut(key) {
    const primary = process.platform === 'darwin' ? 'meta' : 'control';
    await app.evaluate(({ BrowserWindow }, { key, primary }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: [primary] });
      contents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: [primary] });
    }, { key, primary });
  }

  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const shell = await app.firstWindow();
    await until(() => fs.existsSync(path.join(dataDir, 'control.json')));
    await shell.locator('#address').fill(`${base}/first`);
    await shell.locator('#address').press('Enter');
    await until(async () => (await call('/rooms')).rooms.some(room => room.tabs.some(tab => tab.active && tab.url === `${base}/first` && tab.ready)));
    await until(() => requests.includes('/first'));
    await installPrintStub(`${base}/first`);

    await openPrintMenu(shell);
    await until(async () => (await printCalls()).length === 1);
    let calls = await printCalls();
    assert.deepEqual(calls[0], { url: `${base}/first`, options: { silent: false, printBackground: true } }, 'menu printing uses the active page with the native print dialog and page backgrounds');
    await shell.locator('#status').getByText('打印任务已发送。').waitFor();

    await setPrintResult(false, 'Print job failed');
    await openPrintMenu(shell);
    await until(async () => (await printCalls()).length === 2);
    await shell.locator('#status').getByText('打印失败，请检查打印机设置后重试。').waitFor();

    await setPrintResult(false, 'Print job canceled');
    await openPrintMenu(shell);
    await until(async () => (await printCalls()).length === 3);
    await shell.locator('#status').getByText('已取消打印。').waitFor();
    assert.equal(await shell.locator('#status').getByText(/打印失败/).count(), 0, 'cancelling the native dialog is not presented as a failure');

    await shortcut('T');
    await until(async () => (await call('/rooms')).rooms.some(room => room.tabs.some(tab => tab.url === 'about:blank' && tab.active)));
    await shell.locator('#address').fill(`${base}/second`);
    await shell.locator('#address').press('Enter');
    await until(async () => (await call('/rooms')).rooms.some(room => room.tabs.some(tab => tab.active && tab.url === `${base}/second` && tab.ready)));
    await until(() => requests.includes('/second'));
    await installPrintStub(`${base}/second`);
    await shortcut('P');
    await until(async () => (await printCalls()).length === 4);
    calls = await printCalls();
    assert.equal(calls[3].url, `${base}/second`, 'the platform print shortcut targets the currently selected page');
    await shell.locator('#status').getByText('打印任务已发送。').waitFor();

    const roomState = await call('/rooms');
    const activeRoom = roomState.rooms.find(room => room.id === roomState.activeRoomId);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await call(`/rooms/${activeRoom.id}/claim`, 'POST');
    await openPrintMenu(shell);
    await shell.locator('#status').getByText(/请先接管此 Room，再打印页面/).waitFor();
    assert.equal((await printCalls()).length, 4, 'printing is rejected while the Agent owns the Room');

    console.log('PASS page print menu, native options, cancel/error feedback, active-tab shortcut routing and isolated Electron fixture');
  } finally {
    if (app) await app.close().catch(() => {});
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
