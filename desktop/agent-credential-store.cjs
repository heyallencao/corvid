const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const emptyState = () => ({ schemaVersion: SCHEMA_VERSION, providers: {} });
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const throwIfAborted = signal => signal?.throwIfAborted?.();

function credentialToRecord(credential) {
  if (!credential || typeof credential !== 'object') throw new TypeError('Provider credential must be an object');
  if (credential.type === 'api_key') {
    if (credential.key !== undefined && typeof credential.key !== 'string') throw new TypeError('Provider API Key must be text');
    const record = { kind: 'api_key' };
    if (credential.key !== undefined) record.secret = credential.key;
    if (credential.env !== undefined) record.environment = clone(credential.env);
    return record;
  }
  if (credential.type === 'oauth') {
    if (typeof credential.access !== 'string' || typeof credential.refresh !== 'string' || !Number.isFinite(credential.expires)) throw new TypeError('Provider OAuth credentials are incomplete');
    const { type, access, refresh, expires, ...providerData } = credential;
    return {
      kind: 'oauth', accessToken: access, refreshToken: refresh, expiresAt: expires,
      ...(Object.keys(providerData).length ? { providerData: clone(providerData) } : {}),
    };
  }
  throw new TypeError('Unsupported provider credential type');
}

function recordToCredential(record) {
  if (!record || typeof record !== 'object') throw new Error('Agent credential record is invalid');
  if (record.kind === 'api_key') {
    if (record.secret !== undefined && typeof record.secret !== 'string') throw new Error('Agent API Key record is invalid');
    if (record.environment !== undefined && (!record.environment || typeof record.environment !== 'object' || Array.isArray(record.environment))) throw new Error('Agent credential environment is invalid');
    return { type: 'api_key', ...(record.secret === undefined ? {} : { key: record.secret }), ...(record.environment === undefined ? {} : { env: clone(record.environment) }) };
  }
  if (record.kind === 'oauth') {
    if (typeof record.accessToken !== 'string' || typeof record.refreshToken !== 'string' || !Number.isFinite(record.expiresAt)) throw new Error('Agent OAuth credential record is invalid');
    const providerData = record.providerData ?? {};
    if (!providerData || typeof providerData !== 'object' || Array.isArray(providerData) || ['type', 'access', 'refresh', 'expires'].some(key => Object.hasOwn(providerData, key))) throw new Error('Agent OAuth provider data is invalid');
    return { ...clone(providerData), type: 'oauth', access: record.accessToken, refresh: record.refreshToken, expires: record.expiresAt };
  }
  throw new Error('Agent credential record has an unsupported type');
}

function validateState(state) {
  if (!state || state.schemaVersion !== SCHEMA_VERSION || !state.providers || typeof state.providers !== 'object' || Array.isArray(state.providers)) throw new Error('Corvid Agent credentials have an unsupported or invalid format');
  for (const [providerId, record] of Object.entries(state.providers)) {
    if (!providerId || /[\u0000-\u001f]/.test(providerId)) throw new Error('Corvid Agent credential provider ID is invalid');
    recordToCredential(record);
  }
  return state;
}

function decodeLegacy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('旧账号授权数据格式无效，原文件已保留');
  const providers = {};
  for (const [providerId, credential] of Object.entries(value)) {
    if (!providerId || /[\u0000-\u001f]/.test(providerId)) throw new Error('旧账号授权数据包含无效 Provider，原文件已保留');
    providers[providerId] = credentialToRecord(credential);
  }
  return providers;
}

function createAgentCredentialStore({ dataDir, legacyAuthPath = null }) {
  if (typeof dataDir !== 'string' || !dataDir) throw new TypeError('dataDir is required for Corvid Agent credential storage');
  const file = path.join(dataDir, 'agent-credentials.json');
  const queues = new Map();
  let initializationPromise;

  function readState() {
    try { return validateState(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return emptyState(); if (error instanceof SyntaxError) throw new Error(`Corvid Agent credentials are unreadable; the original file was preserved: ${error.message}`); throw error; }
  }

  function writeState(state) {
    validateState(state);
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dataDir, 0o700);
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(state));
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor); descriptor = undefined;
      fs.renameSync(temporary, file);
      fs.chmodSync(file, 0o600);
      try { const directory = fs.openSync(dataDir, 'r'); fs.fsyncSync(directory); fs.closeSync(directory); } catch {}
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try { fs.unlinkSync(temporary); } catch {}
    }
  }

  function migrateLegacyCredentials() {
    if (!legacyAuthPath) return;
    let legacy;
    try { legacy = JSON.parse(fs.readFileSync(legacyAuthPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw new Error(`无法迁移旧账号授权数据，原文件已保留：${error.message}`); }
    const oldProviders = decodeLegacy(legacy);
    const state = readState();
    const merged = { ...oldProviders, ...state.providers };
    if (JSON.stringify(merged) !== JSON.stringify(state.providers)) {
      const next = { schemaVersion: SCHEMA_VERSION, providers: merged };
      writeState(next);
      const verified = readState();
      if (JSON.stringify(verified.providers) !== JSON.stringify(next.providers)) throw new Error('Corvid Agent 账号授权迁移未通过校验，旧文件已保留');
    }
    try { fs.unlinkSync(legacyAuthPath); } catch (error) { if (error.code !== 'ENOENT') throw new Error(`账号授权已迁移，但旧授权副本无法清理：${error.message}`); }
  }

  function initialize() {
    if (!initializationPromise) initializationPromise = Promise.resolve().then(migrateLegacyCredentials);
    return initializationPromise;
  }

  function serialize(_providerId, operation) {
    // Each mutation replaces one whole JSON file, so serialize across providers too.
    const queueKey = '__credential_file__';
    const previous = queues.get(queueKey) || Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    const tail = result.catch(() => {});
    queues.set(queueKey, tail);
    void tail.finally(() => { if (queues.get(queueKey) === tail) queues.delete(queueKey); });
    return result;
  }

  return Object.freeze({
    async read(providerId, options = {}) {
      await initialize();
      throwIfAborted(options.signal);
      const record = readState().providers[providerId];
      return record ? recordToCredential(record) : undefined;
    },
    async list(options = {}) {
      await initialize();
      throwIfAborted(options.signal);
      return Object.entries(readState().providers).map(([providerId, record]) => ({ providerId, type: record.kind }));
    },
    async modify(providerId, callback, options = {}) {
      if (typeof providerId !== 'string' || !providerId) throw new TypeError('providerId is required');
      if (typeof callback !== 'function') throw new TypeError('credential callback is required');
      await initialize();
      return serialize(providerId, async () => {
        throwIfAborted(options.signal);
        const state = readState();
        const currentRecord = state.providers[providerId];
        const nextCredential = await callback(currentRecord ? recordToCredential(currentRecord) : undefined);
        throwIfAborted(options.signal);
        if (nextCredential === undefined) return currentRecord ? recordToCredential(currentRecord) : undefined;
        const providers = { ...state.providers, [providerId]: credentialToRecord(nextCredential) };
        writeState({ schemaVersion: SCHEMA_VERSION, providers });
        return clone(nextCredential);
      });
    },
    async delete(providerId, options = {}) {
      if (typeof providerId !== 'string' || !providerId) throw new TypeError('providerId is required');
      await initialize();
      return serialize(providerId, async () => {
        throwIfAborted(options.signal);
        const state = readState();
        if (!Object.hasOwn(state.providers, providerId)) return;
        const providers = { ...state.providers };
        delete providers[providerId];
        writeState({ schemaVersion: SCHEMA_VERSION, providers });
      });
    },
  });
}

module.exports = { createAgentCredentialStore };
