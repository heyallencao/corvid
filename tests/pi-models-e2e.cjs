const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPiModelManager } = require('../desktop/pi-models.cjs');
const { createAgentWorkbench } = require('../desktop/agent-workbench.cjs');
const { createAgentCredentialStore } = require('../desktop/agent-credential-store.cjs');

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
  await assert.rejects(manager.select({ providerId: 'openai-codex', modelId: 'corvid-missing-model' }), error => {
    assert.match(error.message, /Corvid 模型目录/);
    assert.doesNotMatch(error.message, /\bPi\b|pi-coding-agent/i);
    return true;
  });
  await assert.rejects(manager.login('corvid-unknown-provider'), error => {
    assert.match(error.message, /Provider 不支持 OAuth 登录/);
    assert.doesNotMatch(error.message, /\bPi\b|pi-coding-agent/i);
    return true;
  });
  await assert.rejects(manager.loginApiKey('openai-codex', 'sk-test-corvid-invalid-login'), error => {
    assert.match(error.message, /Provider 不支持 API Key 登录/);
    assert.doesNotMatch(error.message, /\bPi\b|pi-coding-agent/i);
    return true;
  });
  await manager.loginApiKey('anthropic', 'sk-test-corvid-persistent-key');
  const credentialPath = path.join(dataDir, 'agent-credentials.json');
  assert.ok(fs.existsSync(credentialPath), 'Agent credentials are stored using Corvid persistence');
  assert.equal(fs.statSync(credentialPath).mode & 0o777, 0o600, 'Corvid credential file is owner-only');
  assert.equal(fs.existsSync(path.join(agentDir, 'auth.json')), false, 'the runtime does not own a parallel credential file');
  const credentialDocument = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
  assert.equal(credentialDocument.schemaVersion, 1);
  assert.deepEqual(credentialDocument.providers.anthropic, { kind: 'api_key', secret: 'sk-test-corvid-persistent-key' });
  const restartedManager = createPiModelManager({ dataDir, agentDir });
  const restartedCatalog = await restartedManager.list();
  assert.equal(restartedCatalog.providers.find(provider => provider.id === 'anthropic')?.configured, true, 'API key login persists through Corvid credential storage');
  const restartedRuntime = (await restartedManager.getModel({ providerId: 'anthropic', modelId: restartedCatalog.providers.find(provider => provider.id === 'anthropic').models[0].id })).runtime;
  assert.deepEqual((await restartedRuntime.listCredentials()).find(item => item.providerId === 'anthropic'), { providerId: 'anthropic', type: 'api_key' }, 'credential enumeration exposes metadata without the secret');
  await restartedManager.logout('anthropic');
  assert.equal(JSON.parse(fs.readFileSync(credentialPath, 'utf8')).providers.anthropic, undefined, 'logout removes the Provider credential from Corvid storage');
  await manager.select({ providerId: 'openai-codex', modelId: 'gpt-6-sol' });
  assert.deepEqual(createPiModelManager({ dataDir, agentDir }).getSelection(), { providerId: 'openai-codex', modelId: 'gpt-6-sol' });
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-model.json'), 'utf8'));
  assert.deepEqual(saved, { providerId: 'openai-codex', modelId: 'gpt-6-sol' });
  assert.equal(fs.statSync(path.join(dataDir, 'agent-model.json')).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(saved).includes('token'), false, 'model preference contains no credential fields');

  const legacyDataDir = path.join(root, 'legacy-data');
  const legacyAgentDir = path.join(legacyDataDir, 'pi-agent');
  fs.mkdirSync(legacyAgentDir, { recursive: true });
  const legacyAuthPath = path.join(legacyAgentDir, 'auth.json');
  fs.writeFileSync(legacyAuthPath, JSON.stringify({
    anthropic: { type: 'api_key', key: 'sk-test-legacy-anthropic' },
    'openai-codex': { type: 'oauth', access: 'access-fixture', refresh: 'refresh-fixture', expires: 1_900_000_000_000, accountId: 'account-fixture' },
  }), { mode: 0o600 });
  const legacyEndpointSecret = 'sk-test-legacy-endpoint-secret';
  fs.writeFileSync(path.join(legacyDataDir, 'pi-models.json'), JSON.stringify({ providers: {
    'corvid-legacy-endpoint': { apiKey: legacyEndpointSecret, name: 'Legacy Endpoint', baseUrl: 'http://127.0.0.1:11434/v1', api: 'openai-completions', models: [modelEntry('legacy-model')] },
  } }), { mode: 0o600 });
  const migratedManager = createPiModelManager({ dataDir: legacyDataDir, agentDir: legacyAgentDir });
  const migratedCatalog = await migratedManager.list();
  assert.equal(migratedCatalog.providers.find(provider => provider.id === 'anthropic')?.configured, true);
  assert.equal(migratedCatalog.providers.find(provider => provider.id === 'openai-codex')?.configured, true);
  const migratedCredentials = JSON.parse(fs.readFileSync(path.join(legacyDataDir, 'agent-credentials.json'), 'utf8'));
  assert.deepEqual(migratedCredentials, { schemaVersion: 1, providers: {
    anthropic: { kind: 'api_key', secret: 'sk-test-legacy-anthropic' },
    'openai-codex': { kind: 'oauth', accessToken: 'access-fixture', refreshToken: 'refresh-fixture', expiresAt: 1_900_000_000_000, providerData: { accountId: 'account-fixture' } },
    'corvid-legacy-endpoint': { kind: 'api_key', secret: legacyEndpointSecret },
  } });
  assert.equal(fs.statSync(path.join(legacyDataDir, 'agent-credentials.json')).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(legacyAuthPath), false, 'legacy credentials are removed only after Corvid has committed the migrated records');
  assert.ok((await migratedManager.getModel({ providerId: 'openai-codex', modelId: 'gpt-6-luna' })).runtime);
  const legacyEndpoint = JSON.parse(fs.readFileSync(path.join(legacyDataDir, 'pi-models.json'), 'utf8')).providers['corvid-legacy-endpoint'];
  assert.notEqual(legacyEndpoint.apiKey, legacyEndpointSecret, 'legacy endpoint secrets are removed from runtime model configuration');
  assert.equal(legacyEndpoint.apiKey, '$CORVID_AGENT_ENDPOINT_CREDENTIAL');
  assert.equal(JSON.parse(fs.readFileSync(path.join(legacyDataDir, 'agent-credentials.json'), 'utf8')).providers['corvid-legacy-endpoint'].secret, legacyEndpointSecret);

  const corruptDataDir = path.join(root, 'corrupt-legacy-data');
  const corruptAgentDir = path.join(corruptDataDir, 'pi-agent');
  fs.mkdirSync(corruptAgentDir, { recursive: true });
  const corruptLegacyPath = path.join(corruptAgentDir, 'auth.json');
  const corruptLegacyBytes = Buffer.from('{invalid legacy credential JSON');
  fs.writeFileSync(corruptLegacyPath, corruptLegacyBytes, { mode: 0o600 });
  const corruptManager = createPiModelManager({ dataDir: corruptDataDir, agentDir: corruptAgentDir });
  await assert.rejects(corruptManager.list(), /无法迁移旧账号授权数据，原文件已保留/);
  assert.deepEqual(fs.readFileSync(corruptLegacyPath), corruptLegacyBytes, 'invalid legacy credentials remain byte-for-byte intact');

  const concurrentCredentialStore = createAgentCredentialStore({ dataDir: path.join(root, 'concurrent-credentials') });
  await Promise.all([
    concurrentCredentialStore.modify('provider-a', async () => { await new Promise(resolve => setTimeout(resolve, 10)); return { type: 'api_key', key: 'fixture-key-a' }; }),
    concurrentCredentialStore.modify('provider-b', async () => ({ type: 'api_key', key: 'fixture-key-b' })),
  ]);
  assert.deepEqual(await concurrentCredentialStore.list(), [{ providerId: 'provider-a', type: 'api_key' }, { providerId: 'provider-b', type: 'api_key' }], 'concurrent provider writes do not overwrite each other');

  let selection = { providerId: 'provider-a', modelId: 'model-a' };
  const selectedModels = [];
  const page = { label: 'p1', url: 'https://example.test/', title: 'Fixture', snapshot: { title: 'Fixture' } };
  const workbench = createAgentWorkbench({
    dataDir,
    runtime: {
      id: 'fixture-runtime', version: '1.0.0',
      canResume: ref => ref?.runtimeId === 'fixture-runtime' && ref.runtimeVersion === '1.0.0',
      getModelSelection: () => selection,
      resolveModel: async value => ({ name: value.modelId }),
      readPageContext: async () => page,
      removeTaskData: () => {},
      async createSession(options) {
      selectedModels.push({ ...options.selectedModel });
        const sessionFile = path.join(dataDir, 'agent-sessions', options.taskId, 'test.jsonl');
        return { async prompt() {}, dispose() {}, checkpoint: () => ({ runtimeId: 'fixture-runtime', runtimeVersion: '1.0.0', data: { sessionFile } }) };
      },
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
  console.log('Corvid model preferences, provider credential storage and transcript model continuity passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

function modelEntry(id) {
  return { id, name: id, input: ['text'], contextWindow: 128_000, maxTokens: 16_384, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}
