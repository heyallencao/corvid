const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createPiModelManager } = require('../desktop/pi-models.cjs');
const { createAgentWorkbench } = require('../desktop/agent-workbench.cjs');
const { createAgentCredentialStore } = require('../desktop/agent-credential-store.cjs');
const { createFakeSafeStorage } = require('./fake-safe-storage.cjs');
const safeStorage=createFakeSafeStorage();

(async () => {
  const localeSource=fs.readFileSync(path.join(__dirname,'../desktop/locales.js'),'utf8');
  const rendererSource=fs.readFileSync(path.join(__dirname,'../desktop/renderer.js'),'utf8');
  const rendererErrorStart=rendererSource.indexOf('function userFacingAgentError');
  const rendererErrorEnd=rendererSource.indexOf('\nlet state',rendererErrorStart);
  assert.ok(rendererErrorStart>=0&&rendererErrorEnd>rendererErrorStart,'renderer error formatter is present for locale contract coverage');
  for(const {language,marker,expected} of [
    {language:'zh-CN',marker:'secure-storage-unavailable',expected:'系统安全存储当前不可用'},
    {language:'en-US',marker:'secure-storage-unavailable',expected:'Secure system storage is unavailable'},
    {language:'zh-CN',marker:'secure-storage-provider-unverified',expected:'Linux 当前无法确认系统密码管理器已保护账号授权'},
    {language:'en-US',marker:'secure-storage-provider-unverified',expected:'Linux could not confirm that the system password manager protects this credential'},
  ]){
    const context={navigator:{language},window:{},document:{documentElement:{lang:''},querySelectorAll(){return[];}}};
    vm.runInNewContext(localeSource,context);
    context.window.corvidI18n.setLocale(language);
    context.extensionMessages=context.window.corvidI18n;
    vm.runInNewContext(rendererSource.slice(rendererErrorStart,rendererErrorEnd),context);
    assert.ok(context.userFacingAgentError({message:`[[corvid-error:${marker}]] provider tag rejected`}).startsWith(expected),`${language} localizes ${marker} before it reaches the UI`);
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-pi-models-'));
  const dataDir = path.join(root, 'corvid');
  const agentDir = path.join(root, 'pi-agent');
  fs.mkdirSync(agentDir, { recursive: true });
  const manager = createPiModelManager({ dataDir, agentDir, safeStorage });
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
  assert.equal(credentialDocument.schemaVersion, 2);
  assert.equal(credentialDocument.providers.anthropic.kind, 'api_key');
  assert.equal(typeof credentialDocument.providers.anthropic.encryptedCredential, 'string');
  assert.equal(JSON.stringify(credentialDocument).includes('sk-test-corvid-persistent-key'), false, 'API key is not stored in a readable file');
  const restartedManager = createPiModelManager({ dataDir, agentDir, safeStorage });
  const restartedCatalog = await restartedManager.list();
  assert.equal(restartedCatalog.providers.find(provider => provider.id === 'anthropic')?.configured, true, 'API key login persists through Corvid credential storage');
  const restartedRuntime = (await restartedManager.getModel({ providerId: 'anthropic', modelId: restartedCatalog.providers.find(provider => provider.id === 'anthropic').models[0].id })).runtime;
  assert.deepEqual((await restartedRuntime.listCredentials()).find(item => item.providerId === 'anthropic'), { providerId: 'anthropic', type: 'api_key' }, 'credential enumeration exposes metadata without the secret');
  await restartedManager.logout('anthropic');
  assert.equal(JSON.parse(fs.readFileSync(credentialPath, 'utf8')).providers.anthropic, undefined, 'logout removes the Provider credential from Corvid storage');
  await manager.select({ providerId: 'openai-codex', modelId: 'gpt-6-sol' });
  assert.deepEqual(createPiModelManager({ dataDir, agentDir, safeStorage }).getSelection(), { providerId: 'openai-codex', modelId: 'gpt-6-sol' });
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
  const migratedManager = createPiModelManager({ dataDir: legacyDataDir, agentDir: legacyAgentDir, safeStorage });
  const migratedCatalog = await migratedManager.list();
  assert.equal(migratedCatalog.providers.find(provider => provider.id === 'anthropic')?.configured, true);
  assert.equal(migratedCatalog.providers.find(provider => provider.id === 'openai-codex')?.configured, true);
  const migratedCredentials = JSON.parse(fs.readFileSync(path.join(legacyDataDir, 'agent-credentials.json'), 'utf8'));
  const migratedStore=createAgentCredentialStore({dataDir:legacyDataDir,legacyAuthPath,safeStorage});
  assert.equal(migratedCredentials.schemaVersion, 2);
  for (const secret of ['sk-test-legacy-anthropic', 'access-fixture', 'refresh-fixture', legacyEndpointSecret]) assert.equal(JSON.stringify(migratedCredentials).includes(secret), false, `${secret} is absent from the migrated credential file`);
  for (const provider of Object.values(migratedCredentials.providers)) assert.equal(typeof provider.encryptedCredential, 'string');
  assert.equal(fs.statSync(path.join(legacyDataDir, 'agent-credentials.json')).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(legacyAuthPath), false, 'legacy credentials are removed only after Corvid has committed the migrated records');
  assert.deepEqual(await migratedStore.read('openai-codex'), { accountId: 'account-fixture', type: 'oauth', access: 'access-fixture', refresh: 'refresh-fixture', expires: 1_900_000_000_000 });
  assert.ok((await migratedManager.getModel({ providerId: 'openai-codex', modelId: 'gpt-6-luna' })).runtime);
  const legacyEndpoint = JSON.parse(fs.readFileSync(path.join(legacyDataDir, 'pi-models.json'), 'utf8')).providers['corvid-legacy-endpoint'];
  assert.notEqual(legacyEndpoint.apiKey, legacyEndpointSecret, 'legacy endpoint secrets are removed from runtime model configuration');
  assert.equal(legacyEndpoint.apiKey, '$CORVID_AGENT_ENDPOINT_CREDENTIAL');
  assert.equal((await migratedStore.read('corvid-legacy-endpoint')).key, legacyEndpointSecret);

  const corruptDataDir = path.join(root, 'corrupt-legacy-data');
  const corruptAgentDir = path.join(corruptDataDir, 'pi-agent');
  fs.mkdirSync(corruptAgentDir, { recursive: true });
  const corruptLegacyPath = path.join(corruptAgentDir, 'auth.json');
  const corruptLegacyBytes = Buffer.from('{invalid legacy credential JSON');
  fs.writeFileSync(corruptLegacyPath, corruptLegacyBytes, { mode: 0o600 });
  const corruptManager = createPiModelManager({ dataDir: corruptDataDir, agentDir: corruptAgentDir, safeStorage });
  await assert.rejects(corruptManager.list(), /无法迁移旧账号授权数据，原文件已保留/);
  assert.deepEqual(fs.readFileSync(corruptLegacyPath), corruptLegacyBytes, 'invalid legacy credentials remain byte-for-byte intact');

  const plaintextDataDir=path.join(root,'plaintext-current-data');fs.mkdirSync(plaintextDataDir,{recursive:true});
  const plaintextCredentialPath=path.join(plaintextDataDir,'agent-credentials.json');
  const plaintextCredentialBytes=Buffer.from(JSON.stringify({schemaVersion:1,providers:{anthropic:{kind:'api_key',secret:'sk-test-existing-plaintext'}}}));
  fs.writeFileSync(plaintextCredentialPath,plaintextCredentialBytes,{mode:0o600});
  const unavailableStorage=createFakeSafeStorage({available:false});
  const unavailableManager=createPiModelManager({dataDir:plaintextDataDir,safeStorage:unavailableStorage});
  await assert.rejects(unavailableManager.list(),/系统安全存储当前不可用/);
  assert.deepEqual(fs.readFileSync(plaintextCredentialPath),plaintextCredentialBytes,'unavailable secure storage leaves the old plaintext file byte-for-byte intact');
  assert.equal(fs.existsSync(`${plaintextCredentialPath}.migration-backup`),false,'failed preflight creates no backup or partial migration file');

  const successfulMigrationDir=path.join(root,'successful-current-migration');fs.mkdirSync(successfulMigrationDir,{recursive:true});
  const successfulMigrationPath=path.join(successfulMigrationDir,'agent-credentials.json');
  fs.writeFileSync(successfulMigrationPath,JSON.stringify({schemaVersion:1,providers:{anthropic:{kind:'api_key',secret:'sk-test-existing-plaintext-success'}}}),{mode:0o600});
  const successfulMigrationManager=createPiModelManager({dataDir:successfulMigrationDir,safeStorage});
  assert.equal((await successfulMigrationManager.list()).providers.find(provider=>provider.id==='anthropic')?.configured,true);
  const successfulMigrationDocument=JSON.parse(fs.readFileSync(successfulMigrationPath,'utf8'));
  assert.equal(successfulMigrationDocument.schemaVersion,2);
  assert.equal(JSON.stringify(successfulMigrationDocument).includes('sk-test-existing-plaintext-success'),false);
  assert.equal(fs.existsSync(`${successfulMigrationPath}.migration-backup`),false);
  assert.deepEqual(await createAgentCredentialStore({dataDir:successfulMigrationDir,safeStorage}).read('anthropic'),{type:'api_key',key:'sk-test-existing-plaintext-success'});

  const failedMigrationDir=path.join(root,'failed-migration-data');fs.mkdirSync(failedMigrationDir,{recursive:true});
  const failedMigrationPath=path.join(failedMigrationDir,'agent-credentials.json');
  const failedMigrationBytes=Buffer.from(JSON.stringify({schemaVersion:1,providers:{anthropic:{kind:'api_key',secret:'sk-test-encryption-failure'}}}));
  fs.writeFileSync(failedMigrationPath,failedMigrationBytes,{mode:0o600});
  const failedMigrationManager=createPiModelManager({dataDir:failedMigrationDir,safeStorage:createFakeSafeStorage({encryptError:new Error('fixture encryption failure')})});
  await assert.rejects(failedMigrationManager.list(),error=>{assert.match(error.message,/系统安全存储无法加密账号授权/);assert.match(error.cause?.message||'',/fixture encryption failure/);return true;});
  assert.deepEqual(fs.readFileSync(failedMigrationPath),failedMigrationBytes,'encryption failure preserves the original credentials');
  assert.equal(fs.existsSync(`${failedMigrationPath}.migration-backup`),false,'failed encryption leaves no plaintext migration backup');

  const failedVerificationDir=path.join(root,'failed-verification-data');fs.mkdirSync(failedVerificationDir,{recursive:true});
  const failedVerificationPath=path.join(failedVerificationDir,'agent-credentials.json');
  const failedVerificationBytes=Buffer.from(JSON.stringify({schemaVersion:1,providers:{anthropic:{kind:'api_key',secret:'sk-test-verification-failure'}}}));
  fs.writeFileSync(failedVerificationPath,failedVerificationBytes,{mode:0o600});
  const failedVerificationManager=createPiModelManager({dataDir:failedVerificationDir,safeStorage:createFakeSafeStorage({decryptError:new Error('fixture verification failure')})});
  await assert.rejects(failedVerificationManager.list(),error=>{assert.match(error.message,/系统安全存储无法解密已保存的账号授权/);assert.match(error.cause?.message||'',/fixture verification failure/);return true;});
  assert.deepEqual(fs.readFileSync(failedVerificationPath),failedVerificationBytes,'read-back verification failure restores the original file byte-for-byte');
  assert.equal(fs.existsSync(`${failedVerificationPath}.migration-backup`),false,'failed verification restores the original and consumes its backup');

  const interruptedSecureRecoveryDir=path.join(root,'interrupted-secure-recovery');fs.mkdirSync(interruptedSecureRecoveryDir,{recursive:true});
  const interruptedSecureRecoveryPath=path.join(interruptedSecureRecoveryDir,'agent-credentials.json');
  const interruptedSecureBackupPath=`${interruptedSecureRecoveryPath}.migration-backup`;
  const oldPlaintextBackupBytes=Buffer.from(JSON.stringify({schemaVersion:1,providers:{anthropic:{kind:'api_key',secret:'sk-older-plaintext-backup'}}}));
  fs.writeFileSync(interruptedSecureRecoveryPath,JSON.stringify({schemaVersion:1,providers:{anthropic:{kind:'api_key',secret:'sk-current-plaintext'}}}),{mode:0o600});
  const interruptedMigrationSeed=createAgentCredentialStore({dataDir:interruptedSecureRecoveryDir,safeStorage:createFakeSafeStorage({providerTag:'v10'}),platform:'darwin'});
  await interruptedMigrationSeed.list();
  const currentEncryptedCredentialBytes=fs.readFileSync(interruptedSecureRecoveryPath);
  fs.writeFileSync(interruptedSecureBackupPath,oldPlaintextBackupBytes,{mode:0o600});
  const unsupportedRecoveryStore=createAgentCredentialStore({dataDir:interruptedSecureRecoveryDir,safeStorage:createFakeSafeStorage({backend:'gnome_libsecret',providerTag:'v10'}),platform:'linux'});
  await assert.rejects(unsupportedRecoveryStore.list(),error=>{
    assert.equal(error.code,'secure-storage-provider-unverified');
    assert.match(error.message,/\[\[corvid-error:secure-storage-provider-unverified\]\]/);
    return true;
  });
  assert.deepEqual(fs.readFileSync(interruptedSecureRecoveryPath),currentEncryptedCredentialBytes,'provider rejection preserves current schema 2 credentials byte-for-byte');
  assert.deepEqual(fs.readFileSync(interruptedSecureBackupPath),oldPlaintextBackupBytes,'provider rejection preserves the migration backup byte-for-byte');
  assert.equal(JSON.parse(fs.readFileSync(interruptedSecureRecoveryPath,'utf8')).schemaVersion,2,'provider rejection does not downgrade the current schema');

  const corruptRecoveryDir=path.join(root,'corrupt-data-recovery');fs.mkdirSync(corruptRecoveryDir,{recursive:true});
  const corruptRecoveryPath=path.join(corruptRecoveryDir,'agent-credentials.json');
  const corruptRecoveryBackupPath=`${corruptRecoveryPath}.migration-backup`;
  const corruptCurrentBytes=Buffer.from(JSON.stringify({schemaVersion:2,providers:{anthropic:{kind:'api_key',encryptedCredential:'not-base64!'}}}));
  const recoverableLegacyBytes=Buffer.from(JSON.stringify({schemaVersion:1,providers:{anthropic:{kind:'api_key',secret:'sk-recoverable-legacy-backup'}}}));
  fs.writeFileSync(corruptRecoveryPath,corruptCurrentBytes,{mode:0o600});
  fs.writeFileSync(corruptRecoveryBackupPath,recoverableLegacyBytes,{mode:0o600});
  const corruptRecoveryStore=createAgentCredentialStore({dataDir:corruptRecoveryDir,safeStorage});
  assert.deepEqual(await corruptRecoveryStore.read('anthropic'),{type:'api_key',key:'sk-recoverable-legacy-backup'},'non-security schema corruption still recovers the legacy backup');
  const recoveredCredentialBytes=fs.readFileSync(corruptRecoveryPath);
  assert.equal(JSON.parse(recoveredCredentialBytes.toString('utf8')).schemaVersion,2,'recovered legacy credentials are migrated back to schema 2');
  assert.equal(recoveredCredentialBytes.toString('utf8').includes('sk-recoverable-legacy-backup'),false,'recovered credentials are encrypted before the migration backup is removed');
  assert.equal(fs.existsSync(corruptRecoveryBackupPath),false,'a verified recovered migration consumes its backup');

  const rotatedDir=path.join(root,'rotated-data');
  const rotatingStore=createAgentCredentialStore({dataDir:rotatedDir,safeStorage});
  await rotatingStore.modify('rotating',()=>({type:'api_key',key:'rotation-fixture'}));
  const rotatingPath=path.join(rotatedDir,'agent-credentials.json');
  const beforeRotation=JSON.parse(fs.readFileSync(rotatingPath,'utf8')).providers.rotating.encryptedCredential;
  const rotationStore=createAgentCredentialStore({dataDir:rotatedDir,safeStorage:createFakeSafeStorage({shouldReEncryptCount:1})});
  assert.equal((await rotationStore.read('rotating')).key,'rotation-fixture');
  const afterRotation=JSON.parse(fs.readFileSync(rotatingPath,'utf8')).providers.rotating.encryptedCredential;
  assert.notEqual(afterRotation,beforeRotation,'rotated key material rewrites the encrypted credential record');

  for(const providerTag of ['v11','v12']){
    const legacyBackend=providerTag==='v12'?'basic_text':'gnome_libsecret';
    const linuxDir=path.join(root,`linux-async-${providerTag}`);
    const linuxStorage=createFakeSafeStorage({backend:legacyBackend,providerTag});
    const linuxStore=createAgentCredentialStore({dataDir:linuxDir,safeStorage:linuxStorage,platform:'linux'});
    await linuxStore.modify('fixture-provider',()=>({type:'api_key',key:`secret-${providerTag}`}));
    const linuxCredentialBytes=fs.readFileSync(path.join(linuxDir,'agent-credentials.json'),'utf8');
    assert.equal(linuxCredentialBytes.includes(`secret-${providerTag}`),false,`${providerTag} persists only encrypted credential data`);
    assert.equal((await linuxStore.read('fixture-provider')).key,`secret-${providerTag}`,`${providerTag} can encrypt and decrypt a credential`);
  }

  for(const {backend,providerTag} of [
    {backend:'gnome_libsecret',providerTag:'v10'},
    {backend:'basic_text',providerTag:'v10'},
    {backend:'gnome_libsecret',providerTag:'v13'},
    {backend:'gnome_libsecret',providerTag:Buffer.from([0xf6,0xb1,0xb2])},
  ]){
    const providerLabel=Buffer.isBuffer(providerTag)?'high-bit-v12':providerTag;
    const rejectedWriteDir=path.join(root,`linux-new-rejected-${backend}-${providerLabel}`);
    const rejectedWriteStore=createAgentCredentialStore({dataDir:rejectedWriteDir,safeStorage:createFakeSafeStorage({backend,providerTag}),platform:'linux'});
    await assert.rejects(rejectedWriteStore.modify('fixture-provider',()=>({type:'api_key',key:'rejected-fallback-fixture'})),error=>{assert.match(error.message,/无法确认系统密码管理器已保护/);assert.match(error.message,/\[\[corvid-error:secure-storage-provider-unverified\]\]/);return true;});
    assert.equal(fs.existsSync(path.join(rejectedWriteDir,'agent-credentials.json')),false,`${backend}/${providerTag} does not create a credential file`);

    const linuxDir=path.join(root,`linux-rejected-${backend}-${providerLabel}`);
    const seedStore=createAgentCredentialStore({dataDir:linuxDir,safeStorage:createFakeSafeStorage({providerTag}),platform:'darwin'});
    await seedStore.modify('fixture-provider',()=>({type:'api_key',key:'existing-encrypted-fixture'}));
    const credentialPath=path.join(linuxDir,'agent-credentials.json');
    const originalBytes=fs.readFileSync(credentialPath);
    const unsupportedStore=createAgentCredentialStore({dataDir:linuxDir,safeStorage:createFakeSafeStorage({backend,providerTag}),platform:'linux'});
    await assert.rejects(unsupportedStore.read('fixture-provider'),/无法确认系统密码管理器已保护/);
    await assert.rejects(unsupportedStore.modify('fixture-provider',()=>({type:'api_key',key:'replacement-fixture'})),/无法确认系统密码管理器已保护/);
    assert.deepEqual(fs.readFileSync(credentialPath),originalBytes,`${backend}/${providerTag} leaves existing encrypted credentials byte-for-byte intact`);
  }

  const concurrentCredentialStore = createAgentCredentialStore({ dataDir: path.join(root, 'concurrent-credentials'), safeStorage });
  await Promise.all([
    concurrentCredentialStore.modify('provider-a', async () => { await new Promise(resolve => setTimeout(resolve, 10)); return { type: 'api_key', key: 'fixture-key-a' }; }),
    concurrentCredentialStore.modify('provider-b', async () => ({ type: 'api_key', key: 'fixture-key-b' })),
  ]);
  assert.deepEqual(await concurrentCredentialStore.list(), [{ providerId: 'provider-a', type: 'api_key' }, { providerId: 'provider-b', type: 'api_key' }], 'concurrent provider writes do not overwrite each other');

  let selection = { providerId: 'provider-a', modelId: 'model-a' };
  const selectedModels = [];
  const page = { label: 'p1', url: 'https://example.test/', title: 'Fixture', snapshot: { title: 'Fixture' } };
  const revokedAgentCredentials=[];
  const workbench = createAgentWorkbench({
    dataDir,
    issueAgentCredential: async ({taskId,roomId})=>({id:`builtin:${taskId}`,token:`secret:${taskId}:${roomId}`}),
    revokeAgentCredential: async id=>{revokedAgentCredentials.push(id);},
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
  assert.ok(revokedAgentCredentials.includes(`builtin:${task.id}`),'built-in Agent scoped credentials are revoked when a model turn completes');
  fs.rmSync(root, { recursive: true, force: true });
  console.log('Corvid model preferences, provider credential storage and transcript model continuity passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

function modelEntry(id) {
  return { id, name: id, input: ['text'], contextWindow: 128_000, maxTokens: 16_384, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}
