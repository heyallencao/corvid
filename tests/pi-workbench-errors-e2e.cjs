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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-localized-errors-'));
  const fixture = http.createServer((request, response) => {
    const title = request.url === '/changed' ? 'Changed fixture page' : 'Original fixture page';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>${title}</title><h1>${title}</h1><p>Local-only page context fixture.</p>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const pageUrl = `http://127.0.0.1:${fixture.address().port}/`;
  let app;
  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const shell = await app.firstWindow();
    let control;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { control = JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); break; }
      catch { await delay(25); }
    }
    assert.ok(control, 'Corvid starts its isolated local control service');
    const getRooms = async () => {
      const response = await fetch(`${control.baseUrl}/rooms`, { headers: { authorization: `Bearer ${control.token}` } });
      assert.equal(response.status, 200);
      return (await response.json()).rooms;
    };
    const waitFor = async (predicate, label) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await predicate();
        if (result) return result;
        await delay(25);
      }
      throw new Error(`Timed out waiting for ${label}`);
    };

    await shell.getByLabel('地址或搜索').fill(pageUrl);
    await shell.getByLabel('地址或搜索').press('Enter');
    await waitFor(async () => (await getRooms()).some(room => room.tabs.some(tab => tab.url === pageUrl)), 'the original local fixture page');
    await shell.evaluate(() => window.browserShell.invoke('setUiLocale', { locale: 'en' }));
    await waitFor(() => shell.locator('html').getAttribute('lang').then(locale => locale === 'en'), 'English UI locale');

    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
    const roomsBeforeConnection = new Set((await getRooms()).map(room => room.id));
    await shell.getByRole('button', { name: 'Connect current page', exact: true }).click();
    const agentRoom = await waitFor(async () => (await getRooms()).find(room => !roomsBeforeConnection.has(room.id) && room.tabs.some(tab => tab.url === pageUrl)), 'the Agent-bound local fixture page');
    await shell.getByLabel('Describe the browsing task').fill('Summarize the reviewed page');

    // 托管即授权：页面变化不再拦发送，派发时读取当前页面；但用户收回空间后必须失败关闭。
    const yieldResponse = await fetch(`${control.baseUrl}/rooms/${agentRoom.id}/yieldControl`, {
      method: 'POST',
      headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
    });
    assert.equal(yieldResponse.status, 200, 'the user takes control of the bound Agent space');
    await waitFor(async () => (await getRooms()).find(room => room.id === agentRoom.id)?.ownership === 'user', 'the bound space to return to user control');

    await shell.getByRole('button', { name: 'Send', exact: true }).click();
    const composerError = await waitFor(async () => {
      const text = await shell.locator('.pi-composer-error').textContent().catch(() => '');
      return text?.trim() || null;
    }, 'the localized lost-control send error');
    assert.equal(composerError, 'Message not sent: This space, profile, or page has changed. Return control or review the page again before retrying.');
    assert.equal(await shell.locator('.pi-task-entry').count(), 0, 'a space the user took back fails before a task or model request is created');
    console.log('PASS Agent workbench lost-space send error is localized in the English UI');
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
