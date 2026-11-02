const assert = require('node:assert/strict');
const { _electron } = require('playwright-core');
const electronPath = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createPiAgentSession } = require('../desktop/pi-agent.cjs');
const { createPiModelManager } = require('../desktop/pi-models.cjs');

if (process.env.PI_CODING_AGENT_DIR) throw new Error('Run this smoke test without PI_CODING_AGENT_DIR so it uses the existing Pi ChatGPT/Codex login.');
const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-real-pi-model-'));
  const site = http.createServer((_request, response) => { response.end('<!doctype html><title>Local Corvid model smoke</title><h1>Local page only</h1>'); });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  let app, created;
  try {
    const selected = { providerId: 'openai-codex', modelId: 'gpt-6-luna' };
    const { runtime } = await createPiModelManager({ dataDir }).getModel(selected);
    const credential = (await runtime.listCredentials()).find(item => item.providerId === 'openai-codex');
    assert.equal(credential?.type, 'oauth', 'the real smoke uses the existing ChatGPT/Codex OAuth login');
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' } });
    const control = await (async () => {
      for (let i = 0; i < 200; i++) { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); } catch { await delay(25); } }
      throw new Error('Corvid control service did not start');
    })();
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(control.baseUrl + route, { method, headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      return result;
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

    created = await createPiAgentSession({ dataDir, taskId: 'gpt-6-luna-smoke', profileId, roomId: room.id, tabId, includePageContext: true, selectedModel: selected });
    assert.equal(created.session.model?.provider, 'openai-codex');
    assert.equal(created.session.model?.id, 'gpt-6-luna');
    let responseText = '';
    created.session.subscribe(event => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') responseText += event.assistantMessageEvent.delta;
    });
    await created.session.prompt('仅回复精确文本 CORVID_LUNA_OK，不要调用浏览器工具。');
    assert.match(responseText, /CORVID_LUNA_OK/);
    console.log(JSON.stringify({ result: 'passed', provider: created.session.model.provider, model: created.session.model.id, responseMarkerReceived: true, authentication: `Pi ${credential.type} (${credential.providerId})`, page: 'local HTTP fixture' }));
  } finally {
    created?.session.dispose();
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => site.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
