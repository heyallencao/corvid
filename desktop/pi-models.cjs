const fs = require('node:fs');
const path = require('node:path');
const { createAgentCredentialStore } = require('./agent-credential-store.cjs');

const DEFAULT_SELECTION = { providerId: 'openai-codex', modelId: 'gpt-6-luna' };
const NO_AUTH_API_KEY = 'corvid-no-auth';
const ENDPOINT_CREDENTIAL_REFERENCE = '$CORVID_AGENT_ENDPOINT_CREDENTIAL';

function createPiModelManager({ dataDir, agentDir: configuredAgentDir = null, openExternal = async () => {}, onAuthEvent = () => {}, promptAuth = async (_providerId, prompt) => { throw new Error(`Corvid cannot complete this ${prompt.type} authentication prompt yet`); } }) {
  const file = path.join(dataDir, 'agent-model.json');
  const endpointsFile = path.join(dataDir, 'pi-models.json');
  const agentDir = configuredAgentDir || path.join(dataDir, 'pi-agent');
  const credentialStore = createAgentCredentialStore({ dataDir, legacyAuthPath: path.join(agentDir, 'auth.json') });
  let runtimePromise;
  let endpointMigrationPromise;

  function readEndpoints() {
    try {
      const value = JSON.parse(fs.readFileSync(endpointsFile, 'utf8'));
      return value && typeof value.providers === 'object' && value.providers ? value.providers : {};
    } catch (error) { if (error.code === 'ENOENT') return {}; throw new Error(`无法读取自定义模型设置：${error.message}`); }
  }

  function writeEndpoints(providers) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const temp = `${endpointsFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ '$schema': 'https://pi.dev/schemas/models.schema.json', providers }, null, 2), { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, endpointsFile);
    try { fs.chmodSync(endpointsFile, 0o600); } catch {}
  }

  function validateEndpoint(input) {
    if (!input || typeof input !== 'object') throw new TypeError('请填写端点信息');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const baseUrlText = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : '';
    const modelIds = [...new Set((Array.isArray(input.modelIds) ? input.modelIds : String(input.modelIds || '').split(/[\n,]/)).map(item => String(item).trim()).filter(Boolean))];
    if (!name || name.length > 80) throw new Error('名称需为 1 到 80 个字符');
    let baseUrl;
    try { baseUrl = new URL(baseUrlText); } catch { throw new Error('请输入有效的 HTTP 或 HTTPS Base URL'); }
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error('Base URL 只支持不含账号、密码、查询参数或片段的 HTTP(S) 地址');
    if (!modelIds.length || modelIds.length > 64 || modelIds.some(id => id.length > 200 || /[\u0000-\u001f]/.test(id))) throw new Error('请填写 1 到 64 个有效模型 ID');
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (apiKey.length > 8_000 || /[\r\n]/.test(apiKey)) throw new Error('API Key 无效');
    return { name, baseUrl: baseUrlText.replace(/\/+$/, ''), modelIds, apiKey };
  }

  function providerIdFor(name, providers, existingId) {
    if (existingId && providers[existingId]) return existingId;
    const slug = name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 38) || 'endpoint';
    let id = `corvid-${slug}`, suffix = 2;
    while (providers[id]) id = `corvid-${slug}-${suffix++}`;
    return id;
  }

  function modelEntry(id) {
    return { id, name: id, input: ['text'], contextWindow: 128_000, maxTokens: 16_384, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  }

  function describeEndpoint(id, provider, hasCredential = false) {
    return { id, name: provider.name || id, baseUrl: provider.baseUrl, modelIds: (provider.models || []).map(model => model.id), configuredKey: hasCredential, customEndpoint: true };
  }

  async function migrateLegacyEndpointCredentials() {
    if (!endpointMigrationPromise) endpointMigrationPromise = (async () => {
      const providers = readEndpoints();
      let changed = false;
      for (const [providerId, provider] of Object.entries(providers)) {
        const key = provider.apiKey;
        if (typeof key !== 'string' || !key || key === NO_AUTH_API_KEY || key === ENDPOINT_CREDENTIAL_REFERENCE) continue;
        const storedCredential = await credentialStore.modify(providerId, current => current?.type === 'api_key' ? current : { type: 'api_key', key });
        const verifiedCredential = await credentialStore.read(providerId);
        if (verifiedCredential?.type !== 'api_key' || verifiedCredential.key !== storedCredential?.key) throw new Error(`自定义端点“${provider.name || providerId}”的 API Key 迁移未通过校验；原模型设置已保留`);
        provider.apiKey = ENDPOINT_CREDENTIAL_REFERENCE;
        changed = true;
      }
      if (changed) writeEndpoints(providers);
      return providers;
    })();
    return endpointMigrationPromise;
  }

  async function applyEndpointChange(providers) {
    writeEndpoints(providers);
    runtimePromise = null;
    await runtime();
  }

  function readSelection() {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof value.providerId === 'string' && typeof value.modelId === 'string') return { providerId: value.providerId, modelId: value.modelId };
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    return { ...DEFAULT_SELECTION };
  }

  function writeSelection(selection) {
    const temp = `${file}.tmp`;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(selection), { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, file);
  }

  async function runtime() {
    if (!runtimePromise) runtimePromise = (async () => {
      await migrateLegacyEndpointCredentials();
      const pi = await import('@earendil-works/pi-coding-agent');
      fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
      fs.chmodSync(agentDir, 0o700);
      return pi.ModelRuntime.create({ credentials: credentialStore, modelsPath: endpointsFile, refreshOnCreate: false });
    })();
    return runtimePromise;
  }

  async function list() {
    const modelRuntime = await runtime();
    const credentialProviders = new Set((await modelRuntime.listCredentials()).map(credential => credential.providerId));
    const customEndpoints = readEndpoints();
    const providers = (await Promise.all(modelRuntime.getProviders().map(async provider => {
      const auth = provider.auth || {};
      const customEndpoint = customEndpoints[provider.id];
      const noKeyRequired = Boolean(customEndpoint && (!customEndpoint.apiKey || customEndpoint.apiKey === NO_AUTH_API_KEY));
      const configured = customEndpoint ? noKeyRequired || credentialProviders.has(provider.id) : credentialProviders.has(provider.id) || modelRuntime.hasConfiguredAuth(provider.id);
      return {
        id: provider.id,
        name: provider.id === 'openai-codex' ? 'ChatGPT / Codex' : provider.name,
        configured: configured || noKeyRequired,
        authStatus: noKeyRequired ? '无需密钥' : configured ? '已连接' : '未连接',
        supportsOAuth: Boolean(auth.oauth),
        supportsApiKey: Boolean(auth.apiKey?.login),
        customEndpoint: Boolean(customEndpoint),
        models: modelRuntime.getModels(provider.id).filter(model => !model.type || model.type === 'chat').map(model => ({ id: model.id, name: model.name })),
      };
    }))).filter(provider => provider.models.length);
    return { providers, selection: readSelection(), endpoints: Object.entries(customEndpoints).map(([id, provider]) => describeEndpoint(id, provider, credentialProviders.has(id))) };
  }

  async function discoverEndpointModels({ baseUrl, apiKey = '' }) {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Base URL 只支持不含账号、密码、查询参数或片段的 HTTP(S) 地址');
    const url = new URL(`${parsed.toString().replace(/\/+$/, '')}/models`);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal: controller.signal });
      if (!response.ok) throw new Error(`模型目录请求失败（HTTP ${response.status}）`);
      const payload = await response.json();
      const models = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
      const ids = [...new Set(models.map(model => model?.id).filter(id => typeof id === 'string' && id.trim() && id.length <= 200).map(id => id.trim()))].slice(0, 64);
      if (!ids.length) throw new Error('端点没有返回可用模型 ID');
      return ids;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('读取模型目录超时（10 秒）');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function saveEndpoint(input) {
    await runtime();
    const value = validateEndpoint(input), providers = readEndpoints();
    const existingId = typeof input.id === 'string' && providers[input.id] ? input.id : null;
    const id = providerIdFor(value.name, providers, existingId);
    const currentCredential = await credentialStore.read(id);
    if (input.clearApiKey) await credentialStore.delete(id);
    else if (value.apiKey) await credentialStore.modify(id, () => ({ type: 'api_key', key: value.apiKey }));
    const hasApiKey = !input.clearApiKey && (Boolean(value.apiKey) || currentCredential?.type === 'api_key' && Boolean(currentCredential.key));
    providers[id] = { apiKey: hasApiKey ? ENDPOINT_CREDENTIAL_REFERENCE : NO_AUTH_API_KEY, name: value.name, baseUrl: value.baseUrl, api: 'openai-completions', models: value.modelIds.map(modelEntry) };
    await applyEndpointChange(providers);
    return { id, endpoint: describeEndpoint(id, providers[id], hasApiKey), catalog: await list() };
  }

  async function removeEndpoint(id) {
    await runtime();
    const providers = readEndpoints();
    if (!providers[id]) throw new Error('自定义端点不存在');
    delete providers[id];
    await applyEndpointChange(providers);
    await credentialStore.delete(id);
    if (readSelection().providerId === id) writeSelection(DEFAULT_SELECTION);
    return list();
  }

  async function select(selection) {
    if (!selection || typeof selection.providerId !== 'string' || typeof selection.modelId !== 'string') throw new TypeError('providerId and modelId are required');
    const modelRuntime = await runtime();
    const model = modelRuntime.getModel(selection.providerId, selection.modelId);
    if (!model || (model.type && model.type !== 'chat')) throw new Error('所选聊天模型不存在于 Corvid 模型目录');
    const next = { providerId: model.provider, modelId: model.id };
    writeSelection(next);
    return next;
  }

  async function login(providerId) {
    const modelRuntime = await runtime();
    const provider = modelRuntime.getProvider(providerId);
    if (!provider?.auth?.oauth) throw new Error('当前 Provider 不支持 OAuth 登录');
    const controller = new AbortController();
    return modelRuntime.login(providerId, 'oauth', {
      signal: controller.signal,
      prompt: prompt => promptAuth(providerId, prompt),
      notify: event => {
        onAuthEvent(event);
        if (event.type === 'auth_url') void Promise.resolve(openExternal(event.url)).catch(error => controller.abort(error));
        if (event.type === 'device_code') void Promise.resolve(openExternal(event.verificationUri)).catch(error => controller.abort(error));
      },
    }, { agentName: 'Corvid' });
  }

  async function logout(providerId) {
    const modelRuntime = await runtime();
    await modelRuntime.logout(providerId);
  }

  async function loginApiKey(providerId, apiKey) {
    if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.length > 8_000) throw new Error('API Key 长度无效');
    const modelRuntime = await runtime();
    if (!modelRuntime.getProvider(providerId)?.auth?.apiKey?.login) throw new Error('当前 Provider 不支持 API Key 登录');
    const controller = new AbortController();
    await modelRuntime.login(providerId, 'api_key', {
      signal: controller.signal,
      prompt: async prompt => {
        if (prompt.type !== 'secret') throw new Error('该 Provider 需要额外交互输入；请重新检查 Corvid 中的账号授权步骤');
        return apiKey.trim();
      },
      notify: onAuthEvent,
    }, { agentName: 'Corvid' });
  }

  async function getModel(selection = readSelection()) {
    const modelRuntime = await runtime();
    const model = modelRuntime.getModel(selection.providerId, selection.modelId);
    if (!model || (model.type && model.type !== 'chat')) throw new Error(`模型不存在于 Corvid 目录：${selection.providerId}/${selection.modelId}`);
    const customEndpoint = readEndpoints()[selection.providerId];
    const noKeyRequired = Boolean(customEndpoint && (!customEndpoint.apiKey || customEndpoint.apiKey === NO_AUTH_API_KEY));
    if (!noKeyRequired && !await modelRuntime.checkAuth(selection.providerId).catch(() => undefined) && (customEndpoint || !modelRuntime.hasConfiguredAuth(selection.providerId))) throw new Error(`请先连接 ${selection.providerId} 账号`);
    return { runtime: modelRuntime, model, requiresAuth: customEndpoint ? Boolean(customEndpoint.apiKey && customEndpoint.apiKey !== NO_AUTH_API_KEY) : true };
  }

  return { list, select, login, logout, loginApiKey, discoverEndpointModels, saveEndpoint, removeEndpoint, getModel, getSelection: readSelection };
}

module.exports = { createPiModelManager, DEFAULT_SELECTION };
