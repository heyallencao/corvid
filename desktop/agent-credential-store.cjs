const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEGACY_SCHEMA_VERSION = 1;
const SCHEMA_VERSION = 2;
const DEFAULT_SAFE_STORAGE_TIMEOUT_MS = 15_000;
// Electron 45.2.1 / Chromium 156 async tags: v10 is the fixed-key POSIX fallback;
// v11 is Secret Service and v12 is the Portal provider. Re-review on Electron upgrades.
const SECURE_LINUX_ASYNC_PROVIDER_TAGS = new Set(['v11', 'v12']);
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

function validateProviderId(providerId) {
  if (!providerId || /[\u0000-\u001f]/.test(providerId)) throw new Error('Corvid Agent credential provider ID is invalid');
}

function validateLegacyState(state) {
  if (!state || state.schemaVersion !== LEGACY_SCHEMA_VERSION || !state.providers || typeof state.providers !== 'object' || Array.isArray(state.providers)) throw new Error('Corvid Agent credentials have an unsupported or invalid format');
  for (const [providerId, record] of Object.entries(state.providers)) {
    validateProviderId(providerId);
    recordToCredential(record);
  }
  return state;
}

function validateEncryptedState(state) {
  if (!state || state.schemaVersion !== SCHEMA_VERSION || !state.providers || typeof state.providers !== 'object' || Array.isArray(state.providers)) throw new Error('Corvid Agent credentials have an unsupported or invalid format');
  for (const [providerId, record] of Object.entries(state.providers)) {
    validateProviderId(providerId);
    if (!record || typeof record !== 'object' || !['api_key', 'oauth'].includes(record.kind) || typeof record.encryptedCredential !== 'string' || !record.encryptedCredential) throw new Error('Corvid Agent encrypted credential record is invalid');
    const bytes = Buffer.from(record.encryptedCredential, 'base64');
    if (!bytes.length || bytes.toString('base64') !== record.encryptedCredential) throw new Error('Corvid Agent encrypted credential data is invalid');
  }
  return state;
}

function decodeLegacy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('旧账号授权数据格式无效，原文件已保留');
  const providers = {};
  for (const [providerId, credential] of Object.entries(value)) {
    validateProviderId(providerId);
    providers[providerId] = recordToCredential(credentialToRecord(credential));
  }
  return providers;
}

function createAgentCredentialStore({ dataDir, legacyAuthPath = null, safeStorage, platform = process.platform, safeStorageTimeoutMs = DEFAULT_SAFE_STORAGE_TIMEOUT_MS }) {
  if (typeof dataDir !== 'string' || !dataDir) throw new TypeError('dataDir is required for Corvid Agent credential storage');
  if (!safeStorage || typeof safeStorage.encryptStringAsync !== 'function' || typeof safeStorage.decryptStringAsync !== 'function' || typeof safeStorage.isAsyncEncryptionAvailable !== 'function') throw new TypeError('Electron asynchronous safeStorage is required for Corvid Agent credentials');
  if (!Number.isSafeInteger(safeStorageTimeoutMs) || safeStorageTimeoutMs < 1) throw new TypeError('safeStorageTimeoutMs must be a positive safe integer');
  const file = path.join(dataDir, 'agent-credentials.json');
  const migrationBackup = `${file}.migration-backup`;
  const queues = new Map();
  let initializationPromise;

  function readStateFile() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) {
        const corrupt = new Error('[[corvid-error:credential-file-corrupt]] Corvid 凭据文件格式已损坏。原文件已保留；如果存在迁移备份，Corvid 将尝试恢复。');
        corrupt.code = 'credential-file-corrupt';
        throw corrupt;
      }
      const inaccessible = new Error('[[corvid-error:credential-file-access-failed]] 无法读取 Corvid 凭据文件。现有凭据与迁移备份均已保留。请检查数据目录权限及存储状态后重试。', { cause: error });
      inaccessible.code = 'credential-file-access-failed';
      throw inaccessible;
    }
  }

  function storageError(message, cause, code = 'secure-storage-unavailable') {
    const marker = `[[corvid-error:${code}]] `;
    const error = new Error(`${marker}${message}请检查并解锁系统钥匙串或密码管理器后重试；现有账号授权和旧文件未主动删除。`, { cause });
    error.code = code;
    return error;
  }

  async function callSafeStorage(operation, unavailableMessage) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(storageError('等待系统安全存储响应超时。', undefined, 'secure-storage-timeout')), safeStorageTimeoutMs);
        }),
      ]);
    } catch (error) {
      if (error?.code?.startsWith('secure-storage-')) throw error;
      throw storageError(unavailableMessage, error);
    } finally {
      clearTimeout(timer);
    }
  }

  function migrationBackupCleanupError(cause) {
    const code = 'credential-migration-backup-cleanup-failed';
    const marker = `[[corvid-error:${code}]] `;
    const error = new Error(`${marker}已验证新凭据，但无法删除旧迁移备份；当前密文与备份均已保留。请检查数据目录权限后重试。`, { cause });
    error.code = code;
    return error;
  }

  function unsupportedCredentialFormatError() {
    const code = 'credential-format-unsupported';
    const marker = `[[corvid-error:${code}]] `;
    const error = new Error(`${marker}当前凭据文件使用 Corvid 尚不支持的数据版本；现有文件与迁移备份均已保留。请升级到兼容版本后重试。`);
    error.code = code;
    return error;
  }

  async function ensureSecureStorage() {
    const available = await callSafeStorage(() => safeStorage.isAsyncEncryptionAvailable(), '无法访问系统安全存储。');
    if (!available) throw storageError('系统安全存储当前不可用。');
  }

  function ensureSecureLinuxCiphertext(encrypted) {
    if (platform !== 'linux') return;
    const tag = encrypted.subarray(0, 3).toString('latin1');
    if (!SECURE_LINUX_ASYNC_PROVIDER_TAGS.has(tag)) {
      throw storageError('Linux 当前无法确认系统密码管理器已保护账号授权，已拒绝保存或读取该凭据。', undefined, 'secure-storage-provider-unverified');
    }
  }

  async function encryptCredential(credential) {
    await ensureSecureStorage();
    const plainRecord = credentialToRecord(credential);
    const encrypted = await callSafeStorage(() => safeStorage.encryptStringAsync(JSON.stringify(plainRecord)), '系统安全存储无法加密账号授权。');
    if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw storageError('系统安全存储没有返回有效的加密结果。');
    ensureSecureLinuxCiphertext(encrypted);
    return { kind: plainRecord.kind, encryptedCredential: encrypted.toString('base64') };
  }

  async function decryptCredential(record) {
    await ensureSecureStorage();
    const encrypted = Buffer.from(record.encryptedCredential, 'base64');
    ensureSecureLinuxCiphertext(encrypted);
    const result = await callSafeStorage(() => safeStorage.decryptStringAsync(encrypted), '系统安全存储无法解密已保存的账号授权。');
    if (!result || typeof result.result !== 'string') {
      throw storageError('系统安全存储返回了无效响应，现有账号授权和文件已保留。', undefined, 'secure-storage-response-invalid');
    }
    let plainRecord;
    try { plainRecord = JSON.parse(result.result); }
    catch (error) { throw new Error(`Corvid Agent encrypted credential is unreadable; the original file was preserved: ${error.message}`); }
    const credential = recordToCredential(plainRecord);
    if (plainRecord.kind !== record.kind) throw new Error('Corvid Agent encrypted credential type does not match its metadata; the original file was preserved');
    return { credential, plainRecord, shouldReEncrypt: result.shouldReEncrypt === true };
  }

  function writeState(state) {
    validateEncryptedState(state);
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

  async function readEncryptedState() {
    const state = readStateFile();
    return state ? validateEncryptedState(state) : emptyState();
  }

  async function verifyState(state, expected = null) {
    validateEncryptedState(state);
    await ensureSecureStorage();
    for (const [providerId, record] of Object.entries(state.providers)) {
      const decrypted = await decryptCredential(record);
      if (expected && Object.hasOwn(expected, providerId) && JSON.stringify(credentialToRecord(decrypted.credential)) !== JSON.stringify(credentialToRecord(expected[providerId]))) {
        throw new Error(`Corvid Agent credential migration verification failed for ${providerId}; original credentials were preserved`);
      }
    }
  }

  function preserveMigrationSource() {
    if (!fs.existsSync(file)) return false;
    fs.copyFileSync(file, migrationBackup, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(migrationBackup, 0o600);
    try { const directory = fs.openSync(dataDir, 'r'); fs.fsyncSync(directory); fs.closeSync(directory); } catch {}
    return true;
  }

  async function recoverMigrationBackup() {
    if (!fs.existsSync(migrationBackup)) return;
    let current;
    try { current = readStateFile(); }
    catch (error) {
      if (error?.code === 'credential-file-corrupt') current = null;
      else throw error;
    }
    if (current?.schemaVersion === SCHEMA_VERSION) {
      let verified = false;
      try {
        await verifyState(validateEncryptedState(current));
        verified = true;
      } catch (error) {
        if (typeof error?.code === 'string' && error.code.startsWith('secure-storage-')) throw error;
      }
      if (verified) {
        try { fs.unlinkSync(migrationBackup); }
        catch (error) { throw migrationBackupCleanupError(error); }
        return;
      }
    } else if (current?.schemaVersion === LEGACY_SCHEMA_VERSION) {
      fs.unlinkSync(migrationBackup);
      return;
    } else if (current !== null) {
      throw unsupportedCredentialFormatError();
    }
    fs.renameSync(migrationBackup, file);
    try { fs.chmodSync(file, 0o600); } catch {}
  }

  async function migrateLegacyCredentials() {
    await recoverMigrationBackup();
    const current = readStateFile();
    const encryptedProviders = {};
    const plainProviders = {};
    let currentWasLegacy = false;
    if (current) {
      if (current.schemaVersion === LEGACY_SCHEMA_VERSION) {
        validateLegacyState(current);
        currentWasLegacy = true;
        for (const [providerId, record] of Object.entries(current.providers)) plainProviders[providerId] = recordToCredential(record);
      } else if (current.schemaVersion === SCHEMA_VERSION) {
        Object.assign(encryptedProviders, validateEncryptedState(current).providers);
      } else throw new Error('Corvid Agent credentials have an unsupported or invalid format; the original file was preserved');
    }

    let legacyAuthExists = false;
    if (legacyAuthPath) {
      let legacy;
      try { legacy = JSON.parse(fs.readFileSync(legacyAuthPath, 'utf8')); legacyAuthExists = true; }
      catch (error) {
        if (error.code !== 'ENOENT') throw new Error(`无法迁移旧账号授权数据，原文件已保留：${error.message}`);
      }
      if (legacyAuthExists) {
        const legacyProviders = decodeLegacy(legacy);
        for (const [providerId, credential] of Object.entries(legacyProviders)) {
          if (!Object.hasOwn(plainProviders, providerId)) plainProviders[providerId] = credential;
        }
      }
    }

    if (!currentWasLegacy && !legacyAuthExists) return;

    await ensureSecureStorage();
    const expected = {};
    for (const [providerId, record] of Object.entries(encryptedProviders)) {
      expected[providerId] = (await decryptCredential(record)).credential;
    }
    const nextProviders = { ...encryptedProviders };
    for (const [providerId, credential] of Object.entries(plainProviders)) {
      if (Object.hasOwn(encryptedProviders, providerId)) continue;
      expected[providerId] = credential;
      nextProviders[providerId] = await encryptCredential(credential);
    }
    const next = { schemaVersion: SCHEMA_VERSION, providers: nextProviders };

    let hadSource = false;
    try {
      hadSource = preserveMigrationSource();
      writeState(next);
      await verifyState(next, expected);
      if (legacyAuthExists) {
        try { fs.unlinkSync(legacyAuthPath); }
        catch (error) { if (error.code !== 'ENOENT') throw new Error(`账号授权已加密，但旧授权副本无法清理：${error.message}`); }
      }
      // The encrypted file is already committed and verified. If cleanup is
      // interrupted, startup recovery verifies it and removes the backup.
      if (hadSource) { try { fs.unlinkSync(migrationBackup); } catch {} }
    } catch (error) {
      if (hadSource && fs.existsSync(migrationBackup)) {
        try { fs.renameSync(migrationBackup, file); fs.chmodSync(file, 0o600); }
        catch (restoreError) { throw new Error(`账号授权迁移失败，旧副本仍保留于 ${migrationBackup}；恢复原文件也失败：${restoreError.message}`, { cause: error }); }
      } else if (!current && fs.existsSync(file)) {
        try { fs.unlinkSync(file); } catch {}
      }
      throw error;
    }
  }

  function serialize(operation) {
    const queueKey = '__credential_file__';
    const previous = queues.get(queueKey) || Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    const tail = result.catch(() => {});
    queues.set(queueKey, tail);
    void tail.finally(() => { if (queues.get(queueKey) === tail) queues.delete(queueKey); });
    return result;
  }

  async function reEncryptIfNeeded(providerId, oldRecord, credential) {
    await serialize(async () => {
      const state = await readEncryptedState();
      const current = state.providers[providerId];
      if (!current || current.encryptedCredential !== oldRecord.encryptedCredential) return;
      const providers = { ...state.providers, [providerId]: await encryptCredential(credential) };
      writeState({ schemaVersion: SCHEMA_VERSION, providers });
    });
  }

  async function initialize() {
    if (!initializationPromise) initializationPromise = Promise.resolve().then(migrateLegacyCredentials);
    return initializationPromise;
  }

  return Object.freeze({
    async read(providerId, options = {}) {
      await initialize();
      throwIfAborted(options.signal);
      const state = await readEncryptedState();
      const record = state.providers[providerId];
      if (!record) return undefined;
      const decoded = await decryptCredential(record);
      if (decoded.shouldReEncrypt) await reEncryptIfNeeded(providerId, record, decoded.credential);
      return decoded.credential;
    },
    async list(options = {}) {
      await initialize();
      throwIfAborted(options.signal);
      await ensureSecureStorage();
      return Object.entries((await readEncryptedState()).providers).map(([providerId, record]) => ({ providerId, type: record.kind }));
    },
    async modify(providerId, callback, options = {}) {
      if (typeof providerId !== 'string' || !providerId) throw new TypeError('providerId is required');
      if (typeof callback !== 'function') throw new TypeError('credential callback is required');
      await initialize();
      return serialize(async () => {
        throwIfAborted(options.signal);
        const state = await readEncryptedState();
        const currentRecord = state.providers[providerId];
        const current = currentRecord ? await decryptCredential(currentRecord) : null;
        const nextCredential = await callback(current?.credential);
        throwIfAborted(options.signal);
        if (nextCredential === undefined) {
          if (current?.shouldReEncrypt) {
            const providers = { ...state.providers, [providerId]: await encryptCredential(current.credential) };
            writeState({ schemaVersion: SCHEMA_VERSION, providers });
          }
          return current?.credential;
        }
        const providers = { ...state.providers, [providerId]: await encryptCredential(nextCredential) };
        writeState({ schemaVersion: SCHEMA_VERSION, providers });
        return clone(nextCredential);
      });
    },
    async delete(providerId, options = {}) {
      if (typeof providerId !== 'string' || !providerId) throw new TypeError('providerId is required');
      await initialize();
      return serialize(async () => {
        throwIfAborted(options.signal);
        const state = await readEncryptedState();
        if (!Object.hasOwn(state.providers, providerId)) return;
        const providers = { ...state.providers };
        delete providers[providerId];
        writeState({ schemaVersion: SCHEMA_VERSION, providers });
      });
    },
  });
}

module.exports = { createAgentCredentialStore };
