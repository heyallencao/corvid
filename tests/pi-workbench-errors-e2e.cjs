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
  const changedUrl = `${pageUrl}changed`;
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
    await shell.getByRole('button', { name: 'Review and preview page context', exact: true }).click();
    await shell.locator('.pi-context').getByText('Original fixture page').waitFor();
    await shell.getByLabel('Describe the browsing task').fill('Summarize the reviewed page');
    await shell.getByLabel(/I reviewed and agree/).check();

    const boundTab = agentRoom.tabs.find(tab => tab.url === pageUrl);
    const navigation = await fetch(`${control.baseUrl}/tabs/${boundTab.id}/navigate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url: changedUrl }),
    });
    assert.equal(navigation.status, 200, 'the bound Agent page navigates through the local control API');
    await waitFor(async () => (await getRooms()).some(room => room.tabs.some(tab => tab.url === changedUrl)), 'the changed fixture page');

    await shell.getByRole('button', { name: 'Send', exact: true }).click();
    await waitFor(async () => (await shell.locator('.pi-page-binding').textContent())?.startsWith('Message not sent:'), 'the localized stale-page validation error');
    assert.equal((await shell.locator('.pi-page-binding').textContent()).trim(), 'Message not sent: The page changed. Review and confirm its content again.');
    assert.equal(await shell.locator('.pi-task-entry').count(), 0, 'a stale page preview fails before a task or model request is created');
    console.log('PASS Agent workbench stale page-context error is localized in the English UI');
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
