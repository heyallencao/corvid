const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createAgentWorkbench, savedConversationContext } = require('../desktop/agent-workbench.cjs');
const { TASKS_SCHEMA_VERSION } = require('../desktop/agent-task-store.cjs');
const { PI_RUNTIME_ID, PI_RUNTIME_VERSION, createPiAgentRuntime } = require('../desktop/agent-runtime.cjs');
const { createAgentClientsStore } = require('../desktop/agent-clients.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-runtime-contract-'));
const page = { label: 'p1', url: 'https://example.test/', title: 'Fixture', snapshot: { title: 'Fixture' } };
function testAgentIdentity() {
  const revoked=[];
  return {
    revoked,
    issueAgentCredential: async ({taskId,roomId})=>({id:`builtin:${taskId}`,token:`secret:${taskId}:${roomId}`}),
    revokeAgentCredential: async id=>{revoked.push(id);},
  };
}
const makeRuntime = (id, version = '1.0.0') => {
  const sessions = [];
  const prompts = [];
  return {
    id, version, sessions, prompts,
    canResume(ref) { return ref?.runtimeId === id && ref.runtimeVersion?.split('.')[0] === version.split('.')[0] && ref.data && typeof ref.data.token === 'string'; },
    getModelSelection() { return null; },
    async resolveModel(selection) { return { name: selection.modelId }; },
    async readPageContext() { return page; },
    removeTaskData() {},
    async createSession(input) {
      sessions.push(input);
      const listeners = new Set();
      const checkpoint = input.checkpoint || { runtimeId: id, runtimeVersion: version, data: { token: `${id}-session-${sessions.length}` } };
      return {
        checkpoint: () => checkpoint,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async prompt(payload) { prompts.push(payload); for (const listener of listeners) listener({ type: 'assistant_delta', text: `reply from ${id}` }); },
        async abort() {}, dispose() {},
      };
    },
  };
};
const contextPreview = { label: page.label, url: page.url, title: page.title, snapshot: JSON.stringify(page.snapshot) };
const taskFile = dataDir => path.join(dataDir, 'agent-tasks.json');

(async () => {
  try {
    const oversizedTranscript=Array.from({length:45},(_,index)=>({role:index%2?'assistant':'user',text:`${index}:`+'x'.repeat(1_000)}));
    const boundedTranscript=savedConversationContext(oversizedTranscript);
    assert.ok(boundedTranscript.length<=40,'saved transcript handoff limits message count');
    assert.ok(boundedTranscript.reduce((total,turn)=>total+turn.text.length,0)<=24_000,'saved transcript handoff limits total character count');
    assert.match(boundedTranscript.at(-1).text,/44:/,'the most recent messages are preserved first');

    const internalStoreDir=path.join(root,'volatile-agent-identities');fs.mkdirSync(internalStoreDir);
    const internalStore=createAgentClientsStore(path.join(internalStoreDir,'agent-clients.json'));
    const internalCredential=internalStore.createInternal({id:'builtin:task-stable',name:'Corvid Agent',roomIds:['room-a']});
    assert.equal(internalStore.findByToken(internalCredential.token).id,'builtin:task-stable','the internal agent credential authenticates a stable task identity');
    assert.deepEqual(internalStore.findByToken(internalCredential.token).roomIds,['room-a'],'the internal identity is limited to its Task Space');
    assert.deepEqual(internalStore.list(),[],'built-in task identities are not shown as external Agent clients');
    assert.equal(fs.existsSync(path.join(internalStoreDir,'agent-clients.json')),false,'built-in credentials are not persisted to disk');
    assert.equal(internalStore.revokeInternal('builtin:task-stable'),true,'the built-in task credential is revoked at session end');
    assert.equal(internalStore.findByToken(internalCredential.token),null,'a revoked built-in token no longer authenticates');

    const adapterDataDir = path.join(root, 'adapter-compatibility');
    fs.mkdirSync(adapterDataDir);
    const currentPiAdapter = createPiAgentRuntime({ dataDir: adapterDataDir });
    const priorCheckpoint = { runtimeId: PI_RUNTIME_ID, runtimeVersion: '1.3.0', data: { sessionFile: path.join(adapterDataDir, 'agent-sessions', 'task', 'session.jsonl') } };
    assert.equal(currentPiAdapter.canResume({ runtimeId: PI_RUNTIME_ID, runtimeVersion: PI_RUNTIME_VERSION, data: priorCheckpoint.data }), true);
    assert.equal(currentPiAdapter.canResume(priorCheckpoint), false, 'same-major checkpoint versions are not assumed compatible');
    const compatibilityReviewedAdapter = createPiAgentRuntime({ dataDir: adapterDataDir, compatibleVersions: ['1.3.0'] });
    assert.equal(compatibilityReviewedAdapter.canResume(priorCheckpoint), true, 'an older checkpoint version is enabled only by an explicit compatibility entry');

    const migratedDir = path.join(root, 'migration');
    fs.mkdirSync(migratedDir);
    const legacyTranscript = path.join(migratedDir, 'agent-sessions', 'legacy-task', 'session.jsonl');
    const legacyTask = {
      id: 'legacy-task', profileId: 'profile-a', roomId: 'room-a', tabId: 'tab-a', status: 'completed',
      prompt: 'legacy prompt', output: 'kept output', runtime: 'old runtime label', piSessionFile: legacyTranscript,
      conversation: [{ role: 'user', text: 'legacy prompt' }, { role: 'assistant', text: 'kept output', status: 'completed' }],
    };
    fs.writeFileSync(taskFile(migratedDir), JSON.stringify([legacyTask]), { mode: 0o600 });
    const piCompatibleRuntime = makeRuntime('pi', '1.4.0');
    const migratedIdentity=testAgentIdentity();
    const migratedWorkbench = createAgentWorkbench({ dataDir: migratedDir, runtime: piCompatibleRuntime, ...migratedIdentity });
    const migrated = JSON.parse(fs.readFileSync(taskFile(migratedDir), 'utf8'));
    assert.equal(migrated.schemaVersion, TASKS_SCHEMA_VERSION);
    assert.equal(migrated.tasks[0].id, legacyTask.id);
    assert.equal(migrated.tasks[0].output, legacyTask.output);
    assert.deepEqual(migrated.tasks[0].conversation, legacyTask.conversation);
    assert.deepEqual(migrated.tasks[0].sessionRef, { runtimeId: 'pi', runtimeVersion: '1.4.0', data: { sessionFile: legacyTranscript } });
    assert.equal(Object.hasOwn(migrated.tasks[0], 'piSessionFile'), false);
    assert.equal(Object.hasOwn(migrated.tasks[0], 'runtime'), false);
    assert.equal(migratedWorkbench.list()[0].canContinue, true, 'Corvid transcript remains continuable even when the adapter cannot resume its checkpoint');
    assert.equal(migratedWorkbench.list()[0].continuationMode, 'saved-conversation');

    const compatibleRuntime = {
      ...piCompatibleRuntime,
      canResume: ref => ref?.runtimeId === 'pi' && ref.runtimeVersion === '1.4.0' && typeof ref.data?.sessionFile === 'string',
      async createSession(input) {
        piCompatibleRuntime.sessions.push(input);
        const listeners = new Set();
        const checkpoint = input.checkpoint;
        return {
          checkpoint: () => checkpoint,
          subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
          async prompt() { for (const listener of listeners) listener({ type: 'assistant_delta', text: 'continued legacy conversation' }); },
          async abort() {}, dispose() {},
        };
      },
    };
    const resumableIdentity=testAgentIdentity();
    const resumableWorkbench = createAgentWorkbench({ dataDir: migratedDir, runtime: compatibleRuntime, ...resumableIdentity });
    assert.equal(resumableWorkbench.list()[0].canContinue, true);
    await resumableWorkbench.continueTask({ taskId: 'legacy-task', message: 'continue', includePageContext: true, contextPreview });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(piCompatibleRuntime.sessions.length, 1);
    assert.deepEqual(piCompatibleRuntime.sessions[0].checkpoint, migrated.tasks[0].sessionRef);
    assert.deepEqual(piCompatibleRuntime.sessions[0].agentCredential,{id:'builtin:legacy-task',token:'secret:legacy-task:room-a'},'the runtime receives a task-scoped identity rather than an administrator token');
    assert.ok(resumableIdentity.revoked.includes('builtin:legacy-task'),'the task identity is revoked after the session ends');
    assert.equal(fs.readFileSync(taskFile(migratedDir),'utf8').includes('secret:legacy-task'),false,'the scoped token never enters the persisted task transcript');
    assert.equal(resumableWorkbench.list()[0].output, 'continued legacy conversation');

    const futureDir = path.join(root, 'future-runtime');
    fs.mkdirSync(futureDir);
    const futureTask = { id: 'future-task', profileId: 'profile-a', roomId: 'room-a', tabId: 'tab-a', status: 'completed', prompt: 'saved', output: 'saved output', selectedModel: { providerId: 'fixture-provider', modelId: 'fixture-model', name: 'Fixture Model' }, conversation: [{ role: 'user', text: '请阅读这个网页并总结。', at: '2026-01-01T00:00:00.000Z' }, { role: 'assistant', text: '页面提到三项主要信息。', status: 'completed', at: '2026-01-01T00:00:01.000Z' }], sessionRef: { runtimeId: 'future-runtime', runtimeVersion: '9.0.0', data: { handle: 'opaque-token' } } };
    fs.writeFileSync(taskFile(futureDir), JSON.stringify({ schemaVersion: TASKS_SCHEMA_VERSION, tasks: [futureTask] }), { mode: 0o600 });
    const alternateRuntime = makeRuntime('alternate-runtime', '1.0.0');
    const alternateIdentity=testAgentIdentity();
    const alternateWorkbench = createAgentWorkbench({ dataDir: futureDir, runtime: alternateRuntime, ...alternateIdentity });
    assert.equal(alternateWorkbench.list()[0].hasSession, true);
    assert.equal(alternateWorkbench.list()[0].continuationMode, 'saved-conversation');
    assert.equal(alternateWorkbench.list()[0].canContinue, true);
    assert.equal(Object.hasOwn(alternateWorkbench.list()[0], 'sessionRef'), false, 'private checkpoint data is not exposed to the renderer');
    assert.deepEqual(JSON.parse(fs.readFileSync(taskFile(futureDir), 'utf8')).tasks[0].sessionRef, futureTask.sessionRef, 'unknown runtime checkpoint data remains intact');
    await alternateWorkbench.continueTask({ taskId: 'future-task', message: '请补充网页中提到的来源。', includePageContext: true, contextPreview });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(alternateRuntime.sessions[0].checkpoint, null, 'incompatible runtime checkpoint must never be handed to a new runtime');
    assert.deepEqual(alternateRuntime.sessions[0].priorConversation, futureTask.conversation.map(({ role, text }) => ({ role, text })), 'the new runtime receives only Corvid-owned transcript messages');
    assert.equal(alternateRuntime.sessions[0].selectedModel.modelId, 'fixture-model', 'the task model preference is preserved');
    assert.match(alternateRuntime.prompts[0], /页面提到三项主要信息/);
    assert.match(alternateRuntime.prompts[0], /用户已重新确认当前页面上下文/);
    assert.equal(alternateWorkbench.list()[0].id, 'future-task', 'continuation keeps the original task ID');
    assert.equal(alternateWorkbench.list()[0].profileId, futureTask.profileId);
    assert.equal(alternateWorkbench.list()[0].roomId, futureTask.roomId);
    assert.equal(alternateWorkbench.list()[0].tabId, futureTask.tabId);
    assert.deepEqual(alternateWorkbench.list()[0].selectedModel, futureTask.selectedModel);
    assert.equal(alternateWorkbench.list()[0].conversation[0].text, '请阅读这个网页并总结。');
    assert.equal(alternateWorkbench.list()[0].conversation.at(-2).text, '请补充网页中提到的来源。');
    assert.equal(alternateWorkbench.list()[0].output, 'reply from alternate-runtime');
    const freshPreview = await alternateWorkbench.prepare({ profileId: 'profile-a', roomId: 'room-a', tabId: 'tab-a' });
    await alternateWorkbench.start({ profileId: 'profile-a', roomId: 'room-a', tabId: 'tab-a', prompt: 'new alternate-runtime task', includePageContext: true, contextPreview: freshPreview });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(alternateRuntime.sessions.length, 2, 'a second runtime can continue a Corvid transcript and create new tasks');
    assert.equal(JSON.parse(fs.readFileSync(taskFile(futureDir), 'utf8')).schemaVersion, TASKS_SCHEMA_VERSION);

    const failedTransitionDir=path.join(root,'failed-runtime-transition');
    fs.mkdirSync(failedTransitionDir);
    const failedTransitionTask={...futureTask,id:'failed-transition-task'};
    fs.writeFileSync(taskFile(failedTransitionDir),JSON.stringify({schemaVersion:TASKS_SCHEMA_VERSION,tasks:[failedTransitionTask]}),{mode:0o600});
    const failingRuntime=makeRuntime('failing-runtime');
    failingRuntime.createSession=async()=>{throw new Error('temporary session startup failure');};
    const failedIdentity=testAgentIdentity();
    const failedTransitionWorkbench=createAgentWorkbench({dataDir:failedTransitionDir,runtime:failingRuntime,...failedIdentity});
    await assert.rejects(failedTransitionWorkbench.continueTask({taskId:failedTransitionTask.id,message:'retry after startup failure',includePageContext:true,contextPreview}),/temporary session startup failure/);
    const failedTransition=JSON.parse(fs.readFileSync(taskFile(failedTransitionDir),'utf8')).tasks[0];
    assert.ok(failedIdentity.revoked.includes('builtin:failed-transition-task'),'credential creation is rolled back if the runtime cannot start');
    assert.deepEqual(failedTransition.sessionRef,failedTransitionTask.sessionRef,'failed runtime replacement preserves the old opaque checkpoint');
    assert.equal(failedTransition.conversation[0].text,failedTransitionTask.conversation[0].text,'failed runtime replacement preserves prior Corvid messages');
    assert.equal(failedTransitionWorkbench.list()[0].continuationMode,'saved-conversation','the task remains recoverable from its Corvid transcript');

    const failedStartupCleanupDir=path.join(root,'startup-cleanup-failure');fs.mkdirSync(failedStartupCleanupDir);
    const failedStartupRuntime=makeRuntime('failed-startup-runtime');
    failedStartupRuntime.createSession=async()=>{throw new Error('synthetic session initialization failure');};
    let startupRevokeAttempts=0;
    const startupRevoked=[];
    const failedStartupIdentity={
      issueAgentCredential:async({taskId,roomId})=>({id:`builtin:${taskId}`,token:`secret:${taskId}:${roomId}`}),
      revokeAgentCredential:async id=>{if(++startupRevokeAttempts===1)throw new Error('synthetic startup credential revoke failure');startupRevoked.push(id);},
    };
    const failedStartupWorkbench=createAgentWorkbench({dataDir:failedStartupCleanupDir,runtime:failedStartupRuntime,...failedStartupIdentity});
    await assert.rejects(
      failedStartupWorkbench.start({profileId:'profile-a',roomId:'room-startup-cleanup',tabId:'tab-startup-cleanup',prompt:'recover after startup cleanup failure',includePageContext:true,contextPreview}),
      /synthetic session initialization failure/,
      'a credential cleanup failure must not replace the original session initialization error',
    );
    const failedStartupTask=failedStartupWorkbench.list()[0];
    assert.equal(failedStartupTask.status,'failed','a failed startup with a failed credential revocation cannot remain permanently preparing');
    assert.equal(failedStartupTask.stopUnconfirmed,true,'the failed task records that credential cleanup is still unconfirmed');
    assert.equal(failedStartupTask.canContinue,false,'an unrevoked scoped credential prevents transcript continuation');
    assert.equal(failedStartupTask.conversation.at(-1).status,'failed','the pending assistant turn is marked failed');
    assert.ok(failedStartupTask.events.some(event=>event.messageKey==='agentSessionCleanupFailed'),'the cleanup failure is surfaced on the retained task');
    assert.deepEqual(await failedStartupWorkbench.clear(failedStartupTask.id),{ok:true},'the retained credential can be revoked by retrying task removal');
    assert.deepEqual(startupRevoked,[`builtin:${failedStartupTask.id}`],'task removal succeeds only after the outstanding scoped credential is revoked');
    assert.equal(failedStartupWorkbench.list().length,0,'the terminal failed task can be removed after cleanup succeeds');

    const handoffDir=path.join(root,'identity-handoff');fs.mkdirSync(handoffDir);
    const handoffRuntime=makeRuntime('handoff-runtime');
    const pendingPrompts=[];
    handoffRuntime.createSession=async input=>{
      handoffRuntime.sessions.push(input);
      let finish;
      const prompt=new Promise(resolve=>{finish=resolve;});
      pendingPrompts.push(finish);
      return {checkpoint:()=>null,subscribe:()=>()=>{},prompt:()=>prompt,abort:async()=>finish({stopReason:'aborted'}),dispose(){}};
    };
    const handoffIdentity=testAgentIdentity();
    const handoffWorkbench=createAgentWorkbench({dataDir:handoffDir,runtime:handoffRuntime,...handoffIdentity});
    const stopTask=await handoffWorkbench.start({profileId:'profile-a',roomId:'room-stop',tabId:'tab-stop',prompt:'stop this task',includePageContext:true,contextPreview});
    assert.equal(handoffWorkbench.list()[0].status,'running');
    await handoffWorkbench.stop(stopTask.id);
    assert.ok(handoffIdentity.revoked.includes(`builtin:${stopTask.id}`),'stopping a running task revokes its scoped identity before abort completes');
    const pauseTask=await handoffWorkbench.start({profileId:'profile-a',roomId:'room-pause',tabId:'tab-pause',prompt:'pause for user control',includePageContext:true,contextPreview});
    await handoffWorkbench.pauseRoom(pauseTask.roomId);
    assert.ok(handoffIdentity.revoked.includes(`builtin:${pauseTask.id}`),'user takeover revokes the scoped identity for the paused Agent');
    assert.equal(handoffWorkbench.list().find(task=>task.id===pauseTask.id).status,'waiting_for_user');
    for(const finish of pendingPrompts)finish({stopReason:'aborted'});

    const cleanupDir=path.join(root,'session-cleanup-failure');fs.mkdirSync(cleanupDir);
    const cleanupRuntime=makeRuntime('cleanup-runtime');
    cleanupRuntime.createSession=async input=>{
      cleanupRuntime.sessions.push(input);
      return {checkpoint:()=>null,subscribe:()=>()=>{},prompt:async()=>{},dispose:async()=>{throw new Error('synthetic session cleanup failure');}};
    };
    let revokeAttempts=0;
    const cleanupRevoked=[];
    const cleanupIdentity={
      issueAgentCredential:async({taskId,roomId})=>({id:`builtin:${taskId}`,token:`secret:${taskId}:${roomId}`}),
      revokeAgentCredential:async id=>{if(++revokeAttempts<=2)throw new Error('synthetic credential revoke failure');cleanupRevoked.push(id);},
    };
    const cleanupWorkbench=createAgentWorkbench({dataDir:cleanupDir,runtime:cleanupRuntime,...cleanupIdentity});
    const unhandledRejections=[];
    const captureUnhandled=error=>unhandledRejections.push(error);
    process.on('unhandledRejection',captureUnhandled);
    try{
      const cleanupTask=await cleanupWorkbench.start({profileId:'profile-a',roomId:'room-cleanup',tabId:'tab-cleanup',prompt:'preserve the completed reply',includePageContext:true,contextPreview});
      await new Promise(resolve=>setImmediate(resolve));
      const cleanupState=cleanupWorkbench.list()[0];
      assert.equal(cleanupState.status,'completed','a generated reply remains completed when only session cleanup fails');
      assert.equal(cleanupState.stopUnconfirmed,true,'the task cannot continue while session cleanup is unconfirmed');
      assert.equal(cleanupState.canContinue,false,'the incomplete cleanup must disable session/transcript continuation');
      assert.ok(cleanupState.events.some(event=>event.messageKey==='agentSessionCleanupFailed'),'cleanup failure is surfaced through the localized task event');
      assert.deepEqual(unhandledRejections,[],'rejected async disposal and credential revocation must not become unhandled process rejections');
      const failedClear=await cleanupWorkbench.clear(cleanupTask.id);
      assert.deepEqual(failedClear,{ok:false},'a failed retry is surfaced without deleting the task');
      assert.equal(cleanupWorkbench.list().length,1,'the task and credential handle remain available for another retry');
      await cleanupWorkbench.clear(cleanupTask.id);
      assert.deepEqual(cleanupRevoked,[`builtin:${cleanupTask.id}`],'removing the task retries a failed credential revocation before deleting its record');
      assert.equal(cleanupWorkbench.list().length,0,'the task is removed only after the retained credential handle is revoked');
    }finally{process.off('unhandledRejection',captureUnhandled);}

    const localeWindow={};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/locales.js'),'utf8'),{
      window:localeWindow,
      document:{documentElement:{},querySelectorAll:()=>[]},
      Intl,
    });
    for(const [locale,expected] of [['zh-CN','Agent 会话清理失败'],['en','The Agent session could not be cleaned up']]){
      localeWindow.corvidI18n.setLocale(locale);
      assert.match(localeWindow.corvidI18n.t('agentSessionCleanupFailed'),new RegExp(expected));
    }

    const preparingDir=path.join(root,'identity-preparation-handoff');fs.mkdirSync(preparingDir);
    let finishSessionCreation,preparingPromptCount=0,preparingDisposeCount=0;
    const preparingRuntime=makeRuntime('preparing-runtime');
    preparingRuntime.createSession=()=>new Promise(resolve=>{finishSessionCreation=resolve;});
    const preparingIdentity=testAgentIdentity();
    const preparingWorkbench=createAgentWorkbench({dataDir:preparingDir,runtime:preparingRuntime,...preparingIdentity});
    const preparingStart=preparingWorkbench.start({profileId:'profile-a',roomId:'room-preparing',tabId:'tab-preparing',prompt:'do not start after takeover',includePageContext:true,contextPreview});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(preparingWorkbench.list()[0].status,'preparing','the fixture keeps runtime session creation pending');
    await preparingWorkbench.pauseRoom('room-preparing');
    assert.equal(preparingWorkbench.list()[0].status,'interrupted','a handoff during preparation cancels the pending Agent turn');
    assert.ok(preparingIdentity.revoked.includes('builtin:'+preparingWorkbench.list()[0].id),'a handoff during preparation immediately revokes the issued identity');
    finishSessionCreation({checkpoint:()=>null,subscribe:()=>()=>{},prompt:()=>{preparingPromptCount++;return Promise.resolve();},dispose(){preparingDisposeCount++;}});
    await assert.rejects(preparingStart,/空间已交给用户；Agent 会话尚未就绪/,'a takeover during session preparation rejects the cancelled start attempt');
    assert.equal(preparingPromptCount,0,'a late-created runtime session never sends the task to a model after user takeover');
    assert.equal(preparingDisposeCount,1,'a late-created runtime session is disposed after user takeover');

    const unknownDir = path.join(root, 'unknown-schema');
    fs.mkdirSync(unknownDir);
    const unknownBytes = Buffer.from('{"schemaVersion":88,"tasks":[]}');
    fs.writeFileSync(taskFile(unknownDir), unknownBytes);
    assert.throws(() => createAgentWorkbench({ dataDir: unknownDir, runtime: alternateRuntime, ...testAgentIdentity() }), /schema is unsupported/);
    assert.deepEqual(fs.readFileSync(taskFile(unknownDir)), unknownBytes, 'unknown schema versions are rejected without rewriting source data');
    assert.equal(fs.existsSync(`${taskFile(unknownDir)}.tmp`), false);

    const rollbackDir = path.join(root, 'migration-rollback');
    fs.mkdirSync(rollbackDir);
    const rollbackBytes = Buffer.from(JSON.stringify([legacyTask]));
    fs.writeFileSync(taskFile(rollbackDir), rollbackBytes);
    fs.chmodSync(rollbackDir, 0o500);
    try { assert.throws(() => createAgentWorkbench({ dataDir: rollbackDir, runtime: alternateRuntime, ...testAgentIdentity() })); }
    finally { fs.chmodSync(rollbackDir, 0o700); }
    assert.deepEqual(fs.readFileSync(taskFile(rollbackDir)), rollbackBytes, 'failed migration leaves the original task file untouched');

    console.log('PASS Corvid Agent runtime contract, legacy session migration, alternate runtime, unknown-state preservation, and migration rollback');
  } finally {
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
