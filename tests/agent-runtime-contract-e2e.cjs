const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAgentWorkbench, savedConversationContext } = require('../desktop/agent-workbench.cjs');
const { TASKS_SCHEMA_VERSION } = require('../desktop/agent-task-store.cjs');
const { PI_RUNTIME_ID, PI_RUNTIME_VERSION, createPiAgentRuntime } = require('../desktop/agent-runtime.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-runtime-contract-'));
const page = { label: 'p1', url: 'https://example.test/', title: 'Fixture', snapshot: { title: 'Fixture' } };
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
    const migratedWorkbench = createAgentWorkbench({ dataDir: migratedDir, runtime: piCompatibleRuntime });
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
    const resumableWorkbench = createAgentWorkbench({ dataDir: migratedDir, runtime: compatibleRuntime });
    assert.equal(resumableWorkbench.list()[0].canContinue, true);
    await resumableWorkbench.continueTask({ taskId: 'legacy-task', message: 'continue', includePageContext: true, contextPreview });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(piCompatibleRuntime.sessions.length, 1);
    assert.deepEqual(piCompatibleRuntime.sessions[0].checkpoint, migrated.tasks[0].sessionRef);
    assert.equal(resumableWorkbench.list()[0].output, 'continued legacy conversation');

    const futureDir = path.join(root, 'future-runtime');
    fs.mkdirSync(futureDir);
    const futureTask = { id: 'future-task', profileId: 'profile-a', roomId: 'room-a', tabId: 'tab-a', status: 'completed', prompt: 'saved', output: 'saved output', selectedModel: { providerId: 'fixture-provider', modelId: 'fixture-model', name: 'Fixture Model' }, conversation: [{ role: 'user', text: '请阅读这个网页并总结。', at: '2026-01-01T00:00:00.000Z' }, { role: 'assistant', text: '页面提到三项主要信息。', status: 'completed', at: '2026-01-01T00:00:01.000Z' }], sessionRef: { runtimeId: 'future-runtime', runtimeVersion: '9.0.0', data: { handle: 'opaque-token' } } };
    fs.writeFileSync(taskFile(futureDir), JSON.stringify({ schemaVersion: TASKS_SCHEMA_VERSION, tasks: [futureTask] }), { mode: 0o600 });
    const alternateRuntime = makeRuntime('alternate-runtime', '1.0.0');
    const alternateWorkbench = createAgentWorkbench({ dataDir: futureDir, runtime: alternateRuntime });
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
    const failedTransitionWorkbench=createAgentWorkbench({dataDir:failedTransitionDir,runtime:failingRuntime});
    await assert.rejects(failedTransitionWorkbench.continueTask({taskId:failedTransitionTask.id,message:'retry after startup failure',includePageContext:true,contextPreview}),/temporary session startup failure/);
    const failedTransition=JSON.parse(fs.readFileSync(taskFile(failedTransitionDir),'utf8')).tasks[0];
    assert.deepEqual(failedTransition.sessionRef,failedTransitionTask.sessionRef,'failed runtime replacement preserves the old opaque checkpoint');
    assert.equal(failedTransition.conversation[0].text,failedTransitionTask.conversation[0].text,'failed runtime replacement preserves prior Corvid messages');
    assert.equal(failedTransitionWorkbench.list()[0].continuationMode,'saved-conversation','the task remains recoverable from its Corvid transcript');

    const unknownDir = path.join(root, 'unknown-schema');
    fs.mkdirSync(unknownDir);
    const unknownBytes = Buffer.from('{"schemaVersion":88,"tasks":[]}');
    fs.writeFileSync(taskFile(unknownDir), unknownBytes);
    assert.throws(() => createAgentWorkbench({ dataDir: unknownDir, runtime: alternateRuntime }), /schema is unsupported/);
    assert.deepEqual(fs.readFileSync(taskFile(unknownDir)), unknownBytes, 'unknown schema versions are rejected without rewriting source data');
    assert.equal(fs.existsSync(`${taskFile(unknownDir)}.tmp`), false);

    const rollbackDir = path.join(root, 'migration-rollback');
    fs.mkdirSync(rollbackDir);
    const rollbackBytes = Buffer.from(JSON.stringify([legacyTask]));
    fs.writeFileSync(taskFile(rollbackDir), rollbackBytes);
    fs.chmodSync(rollbackDir, 0o500);
    try { assert.throws(() => createAgentWorkbench({ dataDir: rollbackDir, runtime: alternateRuntime })); }
    finally { fs.chmodSync(rollbackDir, 0o700); }
    assert.deepEqual(fs.readFileSync(taskFile(rollbackDir)), rollbackBytes, 'failed migration leaves the original task file untouched');

    console.log('PASS Corvid Agent runtime contract, legacy session migration, alternate runtime, unknown-state preservation, and migration rollback');
  } finally {
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
