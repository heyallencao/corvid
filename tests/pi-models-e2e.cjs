const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPiModelManager } = require('../desktop/pi-models.cjs');
const { createPiWorkbench } = require('../desktop/pi-workbench.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-pi-models-'));
  const dataDir = path.join(root, 'corvid');
  const agentDir = path.join(root, 'pi-agent');
  fs.mkdirSync(agentDir, { recursive: true });
  const manager = createPiModelManager({ dataDir, agentDir });
  const catalog = await manager.list();
  const codex = catalog.providers.find(provider => provider.id === 'openai-codex');
  assert.ok(codex?.models.some(model => model.id === 'gpt-6-luna'), 'Pi catalog exposes GPT-6 Luna as a chat model');
  assert.equal(catalog.selection.providerId, 'openai-codex');
  assert.equal(catalog.selection.modelId, 'gpt-6-luna');
  assert.equal(codex.configured, false, 'temporary Pi directory has no credentials');
  await assert.rejects(manager.getModel(catalog.selection), /请先连接 openai-codex 账号/);
  await manager.loginApiKey('anthropic', 'sk-test-corvid-persistent-key');
  const restartedManager = createPiModelManager({ dataDir, agentDir });
  const restartedCatalog = await restartedManager.list();
  assert.equal(restartedCatalog.providers.find(provider => provider.id === 'anthropic')?.configured, true, 'API key login persists through Pi credential storage');
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  const restartedRuntime = await ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: path.join(agentDir, 'models.json'), refreshOnCreate: false });
  assert.ok((await restartedRuntime.listCredentials()).some(item => item.providerId === 'anthropic' && item.type === 'api_key'));
  await manager.select({ providerId: 'openai-codex', modelId: 'gpt-6-sol' });
  assert.deepEqual(createPiModelManager({ dataDir, agentDir }).getSelection(), { providerId: 'openai-codex', modelId: 'gpt-6-sol' });
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-model.json'), 'utf8'));
  assert.deepEqual(saved, { providerId: 'openai-codex', modelId: 'gpt-6-sol' });
  assert.equal(fs.statSync(path.join(dataDir, 'agent-model.json')).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(saved).includes('token'), false, 'model preference contains no credential fields');

  let selection = { providerId: 'provider-a', modelId: 'model-a' };
  const selectedModels = [];
  const page = { label: 'p1', url: 'https://example.test/', title: 'Fixture', snapshot: { title: 'Fixture' } };
  const workbench = createPiWorkbench({
    dataDir,
    getModelSelection: () => selection,
    resolveModel: async value => ({ model: { name: value.modelId }, runtime: {} }),
    readContext: async () => page,
    createSession: async options => {
      selectedModels.push({ ...options.selectedModel });
      return { sessionFile: path.join(dataDir, 'agent-sessions', options.taskId, 'test.jsonl'), session: { async prompt() {}, dispose() {} } };
    },
  });
  const preview = await workbench.prepare({ profileId: 'profile-a', roomId: 'room-a', tabId: 'tab-a' });
  const task = await workbench.start({ profileId: 'profile-a', roomId: 'room-a', tabId: 'tab-a', prompt: 'first', includePageContext: true, contextPreview: preview });
  await new Promise(resolve => setImmediate(resolve));
  selection = { providerId: 'provider-b', modelId: 'model-b' };
  await workbench.continueTask({ taskId: task.id, message: 'follow-up', includePageContext: true, contextPreview: preview });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(selectedModels, [
    { providerId: 'provider-a', modelId: 'model-a', name: 'model-a' },
    { providerId: 'provider-a', modelId: 'model-a', name: 'model-a' },
  ], 'transcript continuation keeps the model selected when the task was created');
  fs.rmSync(root, { recursive: true, force: true });
  console.log('Pi model configuration and transcript model continuity passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
