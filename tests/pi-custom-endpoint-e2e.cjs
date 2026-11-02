const assert = require('node:assert/strict');
const { _electron } = require('playwright-core');
const electronPath = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-custom-endpoint-'));
  const dataDir = path.join(root, 'corvid');
  let modelId, modelPath, discoveryAuthorization, requestAuthorization, app;
  const endpointApiKey = 'sk-test-corvid-endpoint-secret';
  const models = http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      discoveryAuthorization = request.headers.authorization;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }));
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      requestAuthorization = request.headers.authorization;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      modelId = body.model;
      modelPath = request.url;
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'CUSTOM_ENDPOINT_OK' }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
      return;
    }
    response.writeHead(404); response.end();
  });
  const site = http.createServer((_request, response) => response.end('<!doctype html><title>Custom endpoint fixture page</title><h1>Local page</h1>'));
  await Promise.all([new Promise(resolve => models.listen(0, '127.0.0.1', resolve)), new Promise(resolve => site.listen(0, '127.0.0.1', resolve))]);
  try {
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_TEST_PI_REAL_MODEL: '1', CORVID_PORT: '0' } });
    const shell = await app.firstWindow();
    const control = await (async () => {
      for (let i = 0; i < 200; i++) { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); } catch { await delay(25); } }
      throw new Error('Corvid control service did not start');
    })();
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(control.baseUrl + route, { method, headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result;
    };
    const pageUrl = `http://127.0.0.1:${site.address().port}/`;
    await shell.getByLabel('地址或搜索').fill(pageUrl); await shell.getByLabel('地址或搜索').press('Enter');
    await (async () => { for (let i = 0; i < 200; i++) { const result = await call('/rooms'); if (result.rooms.flatMap(room => room.tabs).some(tab => tab.url === pageUrl && tab.title === 'Custom endpoint fixture page')) return; await delay(25); } throw new Error('Local page did not finish loading'); })();

    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
    await shell.getByRole('button', { name: '管理 Corvid Agent 模型' }).click();
    await shell.locator('#pi-endpoint-name').fill('Fixture Endpoint');
    await shell.locator('#pi-endpoint-url').fill(`http://127.0.0.1:${models.address().port}/v1`);
    await shell.locator('#pi-endpoint-key').fill(endpointApiKey);
    await shell.getByRole('button', { name: '从端点读取模型列表' }).click();
    await shell.locator('#pi-endpoint-model-ids').waitFor();
    await shell.waitForFunction(() => document.querySelector('#pi-endpoint-model-ids').value === 'fixture-model');
    await shell.getByRole('button', { name: '保存端点' }).click();
    await shell.getByText(/端点已保存/).waitFor();
    const selection = shell.getByLabel('Corvid Agent 模型', { exact: true });
    await shell.waitForTimeout(500);
    const latestCatalog = await shell.evaluate(() => window.browserShell.invoke('piModels'));
    const customOption = await selection.locator('option').evaluateAll(options => options.filter(option => option.value.includes('corvid-fixture-endpoint')).map(option => ({ value: option.value, text: option.textContent })));
    assert.equal(customOption.length, 1, `custom model missing from selector; status=${await shell.locator('.pi-model-status').textContent()}`);
    assert.ok(latestCatalog.providers.some(provider => provider.id === 'corvid-fixture-endpoint'), 'custom provider appears in the model catalog');
    await selection.selectOption(customOption[0].value);
    await shell.getByText('已连接').waitFor();
    await shell.getByRole('button', { name: '关闭模型设置' }).click();

    await shell.getByRole('button', { name: '连接当前页面' }).click();
    await shell.getByText(/任务页面：Corvid Agent 对话/).waitFor();
    await shell.getByRole('textbox', { name: '描述要完成的浏览任务' }).fill('使用当前配置的模型回复');
    await shell.getByRole('button', { name: '检查并预览页面上下文' }).click();
    await shell.getByText(/将分享给 Agent：/).waitFor();
    await shell.getByLabel(/我已检查/).check();
    await shell.getByRole('button', { name: '发送' }).click();
    await shell.waitForFunction(() => [...document.querySelectorAll('.pi-task-state')].some(node => ['completed', 'failed'].includes(node.dataset.status)), { timeout: 15_000 });
    const tasksAfterRequest = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-tasks.json'), 'utf8')).tasks;
    assert.equal(tasksAfterRequest[0].status, 'completed', JSON.stringify({ task: tasksAfterRequest[0], modelId, modelPath }));
    assert.match(tasksAfterRequest[0].output, /CUSTOM_ENDPOINT_OK/);
    assert.equal(modelId, 'fixture-model', 'Pi sends the selected configured model ID');
    assert.equal(modelPath, '/v1/chat/completions', 'Pi uses the OpenAI Chat Completions endpoint');
    assert.equal(discoveryAuthorization, `Bearer ${endpointApiKey}`, 'endpoint discovery uses the key provided by the user');
    assert.equal(requestAuthorization, `Bearer ${endpointApiKey}`, 'model calls resolve the key from Corvid credential storage');
    const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'pi-models.json'), 'utf8'));
    assert.equal(config.providers['corvid-fixture-endpoint'].models[0].id, 'fixture-model');
    assert.equal(config.providers['corvid-fixture-endpoint'].apiKey, '$CORVID_AGENT_ENDPOINT_CREDENTIAL');
    assert.equal(JSON.stringify(config).includes(endpointApiKey), false, 'runtime model configuration contains no endpoint credential');
    const credentials = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-credentials.json'), 'utf8'));
    assert.deepEqual(credentials.providers['corvid-fixture-endpoint'], { kind: 'api_key', secret: endpointApiKey });
    assert.equal(fs.statSync(path.join(dataDir, 'pi-models.json')).mode & 0o777, 0o600, 'custom model config uses owner-only permissions');
    assert.equal(fs.statSync(path.join(dataDir, 'pi-agent')).mode & 0o777, 0o700, 'Pi runtime uses a Corvid-owned private config directory');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-model.json'), 'utf8')).modelId, 'fixture-model');
    console.log('PASS custom endpoint discovery, Corvid credential persistence, model selection, and local Agent request');
  } finally {
    if (app) await app.close().catch(() => {});
    await Promise.all([new Promise(resolve => models.close(resolve)), new Promise(resolve => site.close(resolve))]);
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
