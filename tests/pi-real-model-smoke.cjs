const assert = require('node:assert/strict');
const { _electron } = require('playwright-core');
const electronPath = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const selected = { providerId: 'openai-codex', modelId: 'gpt-6-luna' };

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-real-pi-model-'));
  const agentDir = path.join(dataDir, 'pi-agent');
  const site = http.createServer((_request, response) => { response.end('<!doctype html><title>Local Corvid model smoke</title><h1>Local page only</h1>'); });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  let app;
  try {
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_TEST_PI_REAL_MODEL: '1', CORVID_PORT: '0' } });
    const shell = await app.firstWindow();
    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
    const modelSelect = shell.getByLabel('Corvid Agent 模型', { exact: true });
    await modelSelect.waitFor();
    await modelSelect.click();
    const search = shell.getByRole('combobox', { name: '搜索模型' });
    await search.fill('gpt-6-luna');
    const lunaOption = shell.locator('[role="option"][data-provider-id="openai-codex"][data-model-id="gpt-6-luna"]');
    assert.equal(await lunaOption.count(), 1, 'model catalog exposes GPT-6 Luna');
    await search.press('Enter');
    const connect = shell.getByRole('button', { name: '连接账号' });
    await connect.waitFor();
    await connect.click();
    const authDialog = shell.locator('#pi-auth-dialog');
    await authDialog.waitFor();
    await authDialog.getByRole('button', { name: '继续授权' }).click();
    const authUrl = shell.locator('#pi-auth-open-url');
    await authUrl.waitFor({ state: 'visible' });
    await authUrl.click();

    const credentialFile = path.join(dataDir, 'agent-credentials.json');
    const loginDeadline = Date.now() + 240_000;
    let credentials = [];
    while (Date.now() < loginDeadline) {
      if (fs.existsSync(credentialFile)) {
        const catalog = await shell.evaluate(() => window.browserShell.invoke('piModels'));
        if (catalog.providers.some(provider => provider.id === 'openai-codex' && provider.configured)) { credentials = [{ providerId: 'openai-codex', type: 'oauth' }]; break; }
      }
      await delay(500);
    }
    assert.ok(credentials.some(item => item.providerId === 'openai-codex' && item.type === 'oauth'), 'complete ChatGPT/Codex OAuth in the browser opened by Corvid');

    const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8'));
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(data.baseUrl + route, { method, headers: { authorization: `Bearer ${data.token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result;
    };
    const room = await call('/rooms', 'POST', { name: 'GPT-6 Luna local smoke' });
    const tabId = room.tabs[0].id;
    const url = `http://127.0.0.1:${site.address().port}/`;
    await call(`/tabs/${tabId}/navigate`, 'POST', { url });
    await (async () => {
      for (let i = 0; i < 200; i++) {
        const rooms = await call('/rooms');
        if (rooms.rooms.flatMap(item => item.tabs).some(tab => tab.id === tabId && tab.url === url && tab.title === 'Local Corvid model smoke')) return;
        await delay(50);
      }
      throw new Error('Local fixture page did not finish loading');
    })();

    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
    await shell.getByRole('button', { name: '连接当前页面' }).click();
    await shell.getByRole('textbox', { name: '描述要完成的浏览任务' }).fill('仅回复精确文本 CORVID_LUNA_OK，不要调用浏览器工具。');
    await shell.getByRole('button', { name: '发送' }).click();
    await shell.waitForFunction(() => [...document.querySelectorAll('.pi-task-state')].some(node => node.dataset.status === 'completed'), { timeout: 90_000 });
    const task = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-tasks.json'), 'utf8')).tasks[0];
    assert.equal(task.selectedModel.providerId, 'openai-codex');
    assert.equal(task.selectedModel.modelId, 'gpt-6-luna');
    assert.match(task.output, /CORVID_LUNA_OK/);
    assert.ok(fs.existsSync(credentialFile), 'Corvid stores ChatGPT/Codex OAuth in its credential store');
    assert.equal(fs.statSync(credentialFile).mode & 0o777, 0o600, 'Corvid credentials are owner-only');
    assert.equal(fs.statSync(agentDir).mode & 0o777, 0o700, 'Corvid Agent configuration directory is owner-only');
    console.log(JSON.stringify({ result: 'passed', provider: 'openai-codex', model: 'gpt-6-luna', responseMarkerReceived: true, authentication: 'Corvid ChatGPT OAuth', agentConfig: 'inside isolated CORVID_DATA_DIR', page: 'local HTTP fixture' }));
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => site.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
