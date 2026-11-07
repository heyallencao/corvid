const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAgentWorkbench } = require('../desktop/agent-workbench.cjs');
const { TASKS_SCHEMA_VERSION, createAgentTaskStore } = require('../desktop/agent-task-store.cjs');

const waitFor = async predicate => {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Timed out waiting for the Agent task transition');
};
function fixtureRuntime() {
  const sessions = [];
  let contextReads = 0, prompts = 0;
  return {
    sessions,
    get contextReads() { return contextReads; },
    get prompts() { return prompts; },
    id: 'fixture-runtime', version: '1',
    canResume: () => true,
    readPageContext: async () => { contextReads++; return { label: 'page-1', url: 'http://127.0.0.1/page', title: 'Fixture', snapshot: { text: 'safe fixture' } }; },
    createSession: async () => {
      let resolvePrompt;
      const session = {
        checkpoint: () => ({ sessionId: `session-${sessions.length}` }),
        prompt: () => { prompts++; return new Promise(resolve => { resolvePrompt = resolve; }); },
        resolvePrompt: () => resolvePrompt?.(),
        subscribe: () => {}, abort: async () => {}, dispose: () => {},
      };
      sessions.push(session); return session;
    },
    removeTaskData: () => {},
    getModelSelection: () => null,
    resolveModel: async () => null,
  };
}
function identity() { return { issueAgentCredential: async () => ({ id: 'fixture-credential', token: 'fixture-token' }), revokeAgentCredential: async () => {} }; }

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-message-queue-'));
  const runtime = fixtureRuntime();
  let pageAllowed = true;
  const workbench = createAgentWorkbench({ dataDir, runtime, canReadPageContext: () => pageAllowed, ...identity() });
  try {
    const binding = { profileId: 'default', roomId: 'queue-room', tabId: 'queue-tab' };
    const task = await workbench.start({ ...binding, prompt: 'Initial task' });
    assert.equal(task.status, 'running');
    const readsAfterStart = runtime.contextReads, promptsAfterStart = runtime.prompts;
    const first = workbench.queueMessage({ taskId: task.id, text: 'First follow-up' }).messageQueue[0];
    const second = workbench.queueMessage({ taskId: task.id, text: 'Second follow-up' }).messageQueue[1];
    const third = workbench.queueMessage({ taskId: task.id, text: 'Third follow-up' }).messageQueue[2];
    assert.equal(runtime.contextReads, readsAfterStart, 'queue writes must not read page context');
    assert.equal(runtime.prompts, promptsAfterStart, 'queue writes must not start or prompt the runtime');
    let current = workbench.list()[0];
    assert.deepEqual(current.messageQueue.map(item => item.text), ['First follow-up', 'Second follow-up', 'Third follow-up']);
    workbench.moveQueuedMessage({ taskId: task.id, itemId: third.id, offset: -1 });
    workbench.moveQueuedMessage({ taskId: task.id, itemId: third.id, offset: -1 });
    workbench.updateQueuedMessage({ taskId: task.id, itemId: third.id, text: 'Updated next step' });
    workbench.removeQueuedMessage({ taskId: task.id, itemId: first.id });
    current = workbench.list()[0];
    assert.deepEqual(current.messageQueue.map(item => item.text), ['Updated next step', 'Second follow-up']);

    // 托管模型：本轮自然完成后，队列按序自动发送，每条都读取新的页面快照。
    runtime.sessions[0].resolvePrompt();
    await waitFor(() => workbench.list()[0].conversation.filter(turn => turn.role === 'user').at(-1)?.text === 'Updated next step');
    assert.equal(workbench.list()[0].status, 'running', 'the completed turn auto-dispatches the queue head');
    assert.equal(runtime.contextReads, readsAfterStart + 1, 'the auto-dispatched head reads a fresh page snapshot');
    assert.deepEqual(workbench.list()[0].messageQueue.map(item => item.text), ['Second follow-up'], 'only the committed queue head is consumed');
    runtime.sessions[1].resolvePrompt();
    await waitFor(() => workbench.list()[0].conversation.filter(turn => turn.role === 'user').at(-1)?.text === 'Second follow-up');
    runtime.sessions[2].resolvePrompt();
    await waitFor(() => workbench.list()[0].status === 'completed' && workbench.list()[0].messageQueue.length === 0);
    assert.equal(runtime.prompts, promptsAfterStart + 2, 'each queued message produces exactly one runtime prompt');

    // 用户接管/停止会冻结自动发送；显式发送队首时读取新的页面快照。
    const secondTask = await workbench.start({ ...binding, prompt: 'Second task' });
    workbench.queueMessage({ taskId: secondTask.id, text: 'Held follow-up' });
    await workbench.stop(secondTask.id);
    assert.equal(workbench.list().find(item => item.id === secondTask.id).status, 'interrupted');
    const stoppedTurn = workbench.list().find(item => item.id === secondTask.id).conversation.at(-1);
    assert.ok(Date.parse(stoppedTurn.finishedAt) >= Date.parse(stoppedTurn.at), 'a user-stopped turn freezes its duration');
    assert.deepEqual(workbench.list().find(item => item.id === secondTask.id).messageQueue.map(item => item.text), ['Held follow-up'], 'stop freezes dispatch and preserves the queue');
    const readsBeforeBypass = runtime.contextReads;
    await assert.rejects(workbench.continueTask({ taskId: secondTask.id, message: 'Bypass queue' }), /后续消息顺序或内容已变化/);
    assert.equal(runtime.contextReads, readsBeforeBypass, 'bypassing a non-empty queue must be rejected before reading the page');
    const heldItem = workbench.list().find(item => item.id === secondTask.id).messageQueue[0];
    await assert.rejects(workbench.continueTask({ taskId: secondTask.id, queueItemId: heldItem.id, queueItemRevision: heldItem.revision - 1 }), /顺序或内容已变化/);
    const readsBeforeSend = runtime.contextReads;
    const resumed = await workbench.continueTask({ taskId: secondTask.id, queueItemId: heldItem.id, queueItemRevision: heldItem.revision, message: 'must be ignored' });
    assert.equal(resumed.status, 'running');
    assert.equal(runtime.contextReads, readsBeforeSend + 1, 'sending a queued item reads a fresh page snapshot');
    assert.equal(workbench.list().find(item => item.id === secondTask.id).conversation.filter(turn => turn.role === 'user').at(-1).text, 'Held follow-up', 'the saved queued text is the only dispatched text');
    assert.deepEqual(workbench.list().find(item => item.id === secondTask.id).messageQueue, [], 'only the committed queue head is consumed');
    runtime.sessions.at(-1).resolvePrompt();

    const restarted = createAgentWorkbench({ dataDir, runtime: fixtureRuntime(), ...identity() });
    assert.deepEqual(restarted.list().find(item => item.id === secondTask.id)?.messageQueue, [], 'restart preserves the drained queue');
    assert.equal(restarted.list().find(item => item.id === secondTask.id)?.status, 'interrupted');

    pageAllowed = false;
    const readsBeforeDeniedPreview = runtime.contextReads;
    await assert.rejects(workbench.prepare(binding), /agent-control-unavailable/);
    assert.equal(runtime.contextReads, readsBeforeDeniedPreview, 'page ownership is checked before reading any page data');
  } finally {
    runtime.sessions.forEach(session => session.resolvePrompt());
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-queue-migration-'));
  try {
    fs.writeFileSync(path.join(migrationDir, 'agent-tasks.json'), JSON.stringify({ schemaVersion: 2, tasks: [{ id: 'old-task', profileId: 'default', roomId: 'old-room', tabId: 'old-tab', status: 'completed', prompt: 'old prompt', conversation: [] }] }));
    const store = createAgentTaskStore(migrationDir), migrated = store.load();
    assert.equal(TASKS_SCHEMA_VERSION, 3);
    assert.deepEqual(migrated[0].messageQueue, [], 'v2 tasks migrate with an empty queue');
    store.save(migrated);
    assert.equal(JSON.parse(fs.readFileSync(path.join(migrationDir, 'agent-tasks.json'), 'utf8')).schemaVersion, 3);
  } finally { fs.rmSync(migrationDir, { recursive: true, force: true }); }

  console.log('PASS Agent follow-up queue contract: write-only enqueue, ordered edits, auto-dispatch on completion with fresh context, freeze/restart preservation, and v2 migration');
})().catch(error => { console.error(error); process.exitCode = 1; });
