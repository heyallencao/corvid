const assert = require('node:assert/strict');
const { _electron } = require('playwright-core');
const electronPath = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createPiAgentSession } = require('../desktop/pi-agent.cjs');
const { createPiModelManager } = require('../desktop/pi-models.cjs');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const selected = { providerId: 'openai-codex', modelId: 'gpt-6-luna' };

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-real-pi-model-'));
  const agentDir = path.join(dataDir, 'pi-agent');
  const site = http.createServer((_request, response) => { response.end('<!doctype html><title>Local Corvid model smoke</title><h1>Local page only</h1>'); });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  let app, created;
  try {
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_TEST_PI_REAL_MODEL: '1', CORVID_PORT: '0' } });
    const shell = await app.firstWindow();
    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
    const modelSelect = shell.getByLabel('Corvid Agent 模型', { exact: true });
    await modelSelect.waitFor();
    const lunaValue = await modelSelect.locator('option').evaluateAll(options => options.find(option => option.value.includes('"providerId":"openai-codex"') && option.value.includes('"modelId":"gpt-6-luna"'))?.value);
    assert.ok(lunaValue, 'Pi catalog exposes GPT-6 Luna');
    await modelSelect.selectOption(lunaValue);
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
        const manager = createPiModelManager({ dataDir, agentDir });
        const modelRuntime = (await manager.getModel(selected).catch(() => null))?.runtime;
        if (modelRuntime) {
          credentials = await modelRuntime.listCredentials();
          if (credentials.some(item => item.providerId === 'openai-codex' && item.type === 'oauth')) break;
        }
      }
      await delay(500);
    }
    assert.ok(credentials.some(item => item.providerId === 'openai-codex' && item.type === 'oauth'), 'complete ChatGPT/Codex OAuth in the browser opened by Corvid');

    const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8'));
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(data.baseUrl + route, { method, headers: { authorization: `Bearer ${data.token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result;
    };
    const profileId = (await call('/profiles')).profiles[0].id;
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

    const manager = createPiModelManager({ dataDir, agentDir });
    const modelInfo = await manager.getModel(selected);
    assert.equal(modelInfo.runtime.getModel(selected.providerId, selected.modelId)?.id, 'gpt-6-luna');
    created = await createPiAgentSession({ dataDir, taskId: 'gpt-6-luna-smoke', profileId, roomId: room.id, tabId, includePageContext: true, selectedModel: selected, model: modelInfo.model, modelRuntime: modelInfo.runtime, requiresAuth: modelInfo.requiresAuth });
    assert.equal(created.session.model?.provider, 'openai-codex');
    assert.equal(created.session.model?.id, 'gpt-6-luna');
    let responseText = '';
    created.session.subscribe(event => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') responseText += event.assistantMessageEvent.delta;
    });
    await created.session.prompt('仅回复精确文本 CORVID_LUNA_OK，不要调用浏览器工具。');
    assert.match(responseText, /CORVID_LUNA_OK/);
    assert.ok(fs.existsSync(credentialFile), 'Corvid stores ChatGPT/Codex OAuth in its credential store');
    assert.equal(fs.statSync(credentialFile).mode & 0o777, 0o600, 'Corvid credentials are owner-only');
    assert.equal(fs.statSync(agentDir).mode & 0o777, 0o700, 'Corvid Agent configuration directory is owner-only');
    console.log(JSON.stringify({ result: 'passed', provider: created.session.model.provider, model: created.session.model.id, responseMarkerReceived: true, authentication: 'Corvid-owned Pi OAuth (openai-codex)', agentConfig: 'inside isolated CORVID_DATA_DIR', page: 'local HTTP fixture' }));
  } finally {
    created?.session.dispose();
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => site.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
