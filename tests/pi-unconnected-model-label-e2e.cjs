const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const electronPath = require('electron');
const project = path.resolve(__dirname, '..');
const evidenceDirectory = process.env.CORVID_UI_EVIDENCE_DIR;

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-unconnected-model-'));
  fs.writeFileSync(path.join(dataDir, 'ui-preferences.json'), JSON.stringify({ schemaVersion: 1, uiLocale: 'en' }), { mode: 0o600 });
  const fixture = http.createServer((_request, response) => response.end('<!doctype html><title>Corvid Fixture</title><h1>Synthetic page</h1>'));
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const screenshotsDirectory = evidenceDirectory || dataDir;
  fs.mkdirSync(screenshotsDirectory, { recursive: true });
  let app;
  try {
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' } });
    const shell = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 850));
    const control = await (async () => {
      for (let attempt = 0; attempt < 200; attempt++) {
        try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); }
        catch { await new Promise(resolve => setTimeout(resolve, 25)); }
      }
      throw new Error('Corvid control service did not start');
    })();
    const pageUrl = `http://127.0.0.1:${fixture.address().port}/`;
    await shell.getByLabel(/Address or search|地址或搜索/).fill(pageUrl);
    await shell.getByLabel(/Address or search|地址或搜索/).press('Enter');
    await (async () => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const response = await fetch(`${control.baseUrl}/rooms`, { headers: { authorization: `Bearer ${control.token}` } });
        const latest = await response.json();
        if (latest.rooms.flatMap(room => room.tabs).some(tab => tab.url === pageUrl)) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Synthetic page did not finish navigation');
    })();
    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
    await shell.getByRole('button', { name: /Connect current page|连接当前页面/ }).click();
    await shell.evaluate(async () => window.browserShell.invoke('setUiLocale', { locale: 'en' }));
    await shell.waitForFunction(() => document.querySelector('.pi-model-select')?.textContent === 'Current selection is not connected');

    const modelSelect = shell.locator('.pi-model-select:visible').first();
    await modelSelect.waitFor({ timeout: 5_000 }).catch(async error => {
      const diagnostic = await shell.evaluate(() => ({ panelKind: document.querySelector('#library')?.dataset.kind, panelHidden: document.querySelector('#library')?.hidden, workbench: document.querySelector('#pi-workbench-content')?.innerText, taskForm: document.querySelector('#pi-task-form')?.innerText, address: document.querySelector('#address')?.value }));
      throw new Error(`${error.message}; UI state: ${JSON.stringify(diagnostic)}`);
    });
    await shell.evaluate(() => window.browserShell.invoke('selectPiModel', { providerId: 'openai-codex', modelId: 'gpt-6-luna' }));
    await shell.waitForFunction(() => document.querySelector('.pi-model-select')?.textContent === 'Current selection is not connected');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-model.json'), 'utf8')),
      { providerId: 'openai-codex', modelId: 'gpt-6-luna' }, 'the default model remains stored while its name is hidden');
    await shell.waitForFunction(() => document.querySelector('.pi-model-controls')?.dataset.connected === 'false');
    assert.equal(await modelSelect.innerText(), 'Current selection is not connected');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-model.json'), 'utf8')).modelId, 'gpt-6-luna', 'the visible label change does not replace the persisted model choice');
    await shell.waitForFunction(() => document.querySelector('.pi-model-status')?.textContent === 'Not connected');
    await shell.screenshot({ path: path.join(screenshotsDirectory, 'issue-200-unconnected-model-en-1280x850.png') });
    await shell.evaluate(async () => window.browserShell.invoke('setUiLocale', { locale: 'zh-CN' }));
    await shell.waitForFunction(() => document.querySelector('.pi-model-select')?.textContent === '当前选择尚未连接');
    await shell.waitForFunction(() => document.querySelector('.pi-model-status')?.textContent === '未连接');
    await shell.screenshot({ path: path.join(screenshotsDirectory, 'issue-200-unconnected-model-zh-CN-1280x850.png') });
    await shell.evaluate(async () => window.browserShell.invoke('setUiLocale', { locale: 'en' }));
    await shell.waitForFunction(() => document.querySelector('.pi-model-select')?.textContent === 'Current selection is not connected');
    assert.equal(await modelSelect.innerText(), 'Current selection is not connected');
    await shell.waitForFunction(() => document.querySelector('.pi-model-status')?.textContent === 'Not connected');
    await modelSelect.focus();
    await shell.keyboard.press('Enter');
    await shell.locator('.pi-model-search:visible').waitFor({ timeout: 5_000 });
    assert.equal(await shell.evaluate(() => document.activeElement.getAttribute('role')), 'combobox', 'the neutral label still opens the model search from the keyboard');
    await shell.keyboard.press('Escape');
    assert.equal(await shell.evaluate(() => document.activeElement.className), 'pi-model-select', 'Escape returns focus to the neutral label');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(704, 420));
    await modelSelect.scrollIntoViewIfNeeded();
    const narrowSelector = await modelSelect.evaluate(select => {
      const rect = select.getBoundingClientRect();
      const form = select.closest('#pi-task-form').getBoundingClientRect();
      return { width: rect.width, height: rect.height, insideForm: rect.top >= form.top && rect.bottom <= form.bottom };
    });
    assert.ok(narrowSelector.width > 0 && narrowSelector.height > 0 && narrowSelector.insideForm, `the neutral model label remains reachable in a 704×420 window: ${JSON.stringify(narrowSelector)}`);
    // 连接状态与入口在模型弹出层里：窄窗下展开后仍必须完整落在视口内。
    await modelSelect.click();
    await shell.locator('.pi-model-status').waitFor({ state: 'visible', timeout: 5_000 });
    await shell.getByRole('button', { name: 'Connect account', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
    const popoverInsideViewport = await shell.locator('.pi-model-picker-panel').evaluate(panel => {
      const bounds = panel.getBoundingClientRect();
      return bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth;
    });
    assert.ok(popoverInsideViewport, 'the unconnected status and connection entry stay inside the 704×420 viewport');
    await shell.screenshot({ path: path.join(screenshotsDirectory, 'issue-200-unconnected-model-en-704x420.png') });
    console.log(JSON.stringify({ result: 'PASS', locale: 'zh-CN/en', selectionPreserved: true, connected: false, screenshots: ['unconnected-model-zh-CN.png', 'unconnected-model-en.png'], evidence: 'isolated synthetic page; no provider, OAuth, API key, or credential storage calls' }));
  } finally {
    if (app) await app.close();
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
