const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAgentWorkbench } = require('../desktop/agent-workbench.cjs');
const { TASKS_SCHEMA_VERSION } = require('../desktop/agent-task-store.cjs');
const { PI_RUNTIME_ID, PI_RUNTIME_VERSION, createPiAgentRuntime } = require('../desktop/agent-runtime.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-runtime-contract-'));
const page = { label: 'p1', url: 'https://example.test/', title: 'Fixture', snapshot: { title: 'Fixture' } };
const makeRuntime = (id, version = '1.0.0') => {
  const sessions = [];
  return {
    id, version, sessions,
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
        async prompt() { for (const listener of listeners) listener({ type: 'assistant_delta', text: `reply from ${id}` }); },
        async abort() {}, dispose() {},
      };
    },
  };
};
const contextPreview = { label: page.label, url: page.url, title: page.title, snapshot: JSON.stringify(page.snapshot) };
const taskFile = dataDir => path.join(dataDir, 'agent-tasks.json');

(async () => {
  try {
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
    assert.equal(migratedWorkbench.list()[0].canContinue, false, 'the adapter safely declines a checkpoint it cannot resume');

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
    const futureTask = { id: 'future-task', profileId: 'profile-a', roomId: 'room-a', tabId: 'tab-a', status: 'completed', prompt: 'saved', output: 'saved output', sessionRef: { runtimeId: 'future-runtime', runtimeVersion: '9.0.0', data: { handle: 'opaque-token' } } };
    fs.writeFileSync(taskFile(futureDir), JSON.stringify({ schemaVersion: TASKS_SCHEMA_VERSION, tasks: [futureTask] }), { mode: 0o600 });
    const alternateRuntime = makeRuntime('alternate-runtime', '1.0.0');
    const alternateWorkbench = createAgentWorkbench({ dataDir: futureDir, runtime: alternateRuntime });
    assert.equal(alternateWorkbench.list()[0].canContinue, false);
    assert.equal(alternateWorkbench.list()[0].hasSession, true);
    assert.equal(Object.hasOwn(alternateWorkbench.list()[0], 'sessionRef'), false, 'private checkpoint data is not exposed to the renderer');
    assert.deepEqual(JSON.parse(fs.readFileSync(taskFile(futureDir), 'utf8')).tasks[0].sessionRef, futureTask.sessionRef, 'unknown runtime checkpoint data remains intact');
    await assert.rejects(alternateWorkbench.continueTask({ taskId: 'future-task', message: 'continue', includePageContext: true, contextPreview }), /记录已保留/);
    const freshPreview = await alternateWorkbench.prepare({ profileId: 'profile-a', roomId: 'room-a', tabId: 'tab-a' });
    await alternateWorkbench.start({ profileId: 'profile-a', roomId: 'room-a', tabId: 'tab-a', prompt: 'new alternate-runtime task', includePageContext: true, contextPreview: freshPreview });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(alternateRuntime.sessions.length, 1, 'a second runtime can run the same Corvid workbench contract');
    assert.equal(JSON.parse(fs.readFileSync(taskFile(futureDir), 'utf8')).schemaVersion, TASKS_SCHEMA_VERSION);

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
