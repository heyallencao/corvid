const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SELECTION = { providerId: 'openai-codex', modelId: 'gpt-6-luna' };

function createPiModelManager({ dataDir, agentDir: configuredAgentDir = null, openExternal = async () => {}, onAuthEvent = () => {} }) {
  const file = path.join(dataDir, 'agent-model.json');
  let runtimePromise;

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
      const pi = await import('@earendil-works/pi-coding-agent');
      const agentDir = configuredAgentDir || pi.getAgentDir();
      return pi.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: path.join(agentDir, 'models.json'), refreshOnCreate: false });
    })();
    return runtimePromise;
  }

  async function list() {
    const modelRuntime = await runtime();
    const credentialProviders = new Set((await modelRuntime.listCredentials()).map(credential => credential.providerId));
    const providers = (await Promise.all(modelRuntime.getProviders().map(async provider => {
      const auth = provider.auth || {};
      const configured = credentialProviders.has(provider.id) || modelRuntime.hasConfiguredAuth(provider.id);
      return {
        id: provider.id,
        name: provider.id === 'openai-codex' ? 'ChatGPT / Codex' : provider.name,
        configured,
        authStatus: configured ? '已连接' : '未连接',
        supportsOAuth: Boolean(auth.oauth),
        supportsApiKey: Boolean(auth.apiKey?.login),
        models: modelRuntime.getModels(provider.id).filter(model => model.type === 'chat').map(model => ({ id: model.id, name: model.name })),
      };
    }))).filter(provider => provider.models.length);
    return { providers, selection: readSelection() };
  }

  async function select(selection) {
    if (!selection || typeof selection.providerId !== 'string' || typeof selection.modelId !== 'string') throw new TypeError('providerId and modelId are required');
    const modelRuntime = await runtime();
    const model = modelRuntime.getModel(selection.providerId, selection.modelId);
    if (!model || model.type !== 'chat') throw new Error('所选聊天模型不存在于 Pi 模型目录');
    const next = { providerId: model.provider, modelId: model.id };
    writeSelection(next);
    return next;
  }

  async function login(providerId) {
    const modelRuntime = await runtime();
    const provider = modelRuntime.getProvider(providerId);
    if (!provider?.auth?.oauth) throw new Error('当前 Provider 没有 Pi OAuth 登录方式');
    const controller = new AbortController();
    return modelRuntime.login(providerId, 'oauth', {
      signal: controller.signal,
      prompt: async () => { throw new Error('该 Provider 登录要求额外交互输入；请从 Pi 设置完成登录后重试'); },
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
    if (!modelRuntime.getProvider(providerId)?.auth?.apiKey?.login) throw new Error('当前 Provider 不支持 Pi API Key 登录');
    const controller = new AbortController();
    await modelRuntime.login(providerId, 'api_key', {
      signal: controller.signal,
      prompt: async prompt => {
        if (prompt.type !== 'secret') throw new Error('该 Provider 需要额外交互输入；请从 Pi 设置完成登录后重试');
        return apiKey.trim();
      },
      notify: onAuthEvent,
    }, { agentName: 'Corvid' });
  }

  async function getModel(selection = readSelection()) {
    const modelRuntime = await runtime();
    const model = modelRuntime.getModel(selection.providerId, selection.modelId);
    if (!model || model.type !== 'chat') throw new Error(`Pi 模型不存在：${selection.providerId}/${selection.modelId}`);
    if (!await modelRuntime.checkAuth(selection.providerId).catch(() => undefined) && !modelRuntime.hasConfiguredAuth(selection.providerId)) throw new Error(`请先连接 ${selection.providerId} 账号`);
    return { runtime: modelRuntime, model };
  }

  return { list, select, login, logout, loginApiKey, getModel, getSelection: readSelection };
}

module.exports = { createPiModelManager, DEFAULT_SELECTION };
