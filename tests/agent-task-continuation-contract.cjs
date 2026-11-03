const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAgentWorkbench } = require('../desktop/agent-workbench.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = predicate();
    if (value) return value;
    await delay(5);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-continuation-lock-'));
  const context = { label: 'page-1', url: 'http://127.0.0.1/page', title: 'Fixture', snapshot: { role: 'main', text: 'fixture' } };
  const sessions = [];
  const issued = [], revoked = [];
  let gate = null, gateRelease = null, contextReads = 0;
  const runtime = {
    id: 'test-runtime', version: '1.0.0',
    createSession: async () => {
      let resolvePrompt;
      const session = {
        checkpoint: () => ({ sessionId: `session-${sessions.length}` }),
        prompt: () => new Promise(resolve => { resolvePrompt = resolve; }),
        subscribe: () => {},
        dispose: () => {},
        resolvePrompt: () => resolvePrompt?.()
      };
      sessions.push(session);
      return session;
    },
    canResume: () => true,
    readPageContext: async () => {
      if (gate) {
        contextReads++;
        await gate;
      }
      return context;
    },
    removeTaskData: () => {},
    getModelSelection: () => null,
    resolveModel: async () => null
  };
  const workbench = createAgentWorkbench({
    dataDir,
    runtime,
    issueAgentCredential: async () => { const credential = { id: `credential-${issued.length + 1}`, token: `token-${issued.length + 1}` }; issued.push(credential.id); return credential; },
    revokeAgentCredential: async id => { revoked.push(id); }
  });
  try {
    const contextPreview = await workbench.prepare({ profileId: 'default', roomId: 'room-one', tabId: 'tab-one' });
    const task = await workbench.start({ profileId: 'default', roomId: 'room-one', tabId: 'tab-one', prompt: '开始', includePageContext: true, contextPreview });
    assert.equal(task.status, 'running');
    sessions[0].resolvePrompt();
    await until(() => workbench.list()[0]?.status === 'completed', 'initial task completion');

    gateRelease = {};
    gate = new Promise(resolve => { gateRelease.release = resolve; });
    const continuation = { taskId: task.id, message: '继续', includePageContext: true, contextPreview };
    const first = workbench.continueTask(continuation);
    await until(() => contextReads === 1, 'first continuation context read');
    const second = workbench.continueTask(continuation);
    const secondOutcome = await Promise.race([
      second.then(() => ({ status: 'resolved' }), error => ({ status: 'rejected', error: error.message, code: error.code })),
      delay(100).then(() => ({ status: 'pending' }))
    ]);
    gateRelease.release();
    await Promise.allSettled([first, second]);
    for (const session of sessions.slice(1)) session.resolvePrompt();
    await until(() => workbench.list()[0]?.status === 'completed', 'continuation completion');

    assert.equal(secondOutcome.status, 'rejected', 'a second continuation must be rejected before reading context');
    assert.equal(contextReads, 1, 'a rejected duplicate must not read page context');
    assert.equal(sessions.length, 2, 'one completed task should create only one continuation session');
    assert.equal(workbench.list()[0].conversation.filter(turn => turn.role === 'user').length, 2, 'the repeated submit must not duplicate the user turn');
    assert.deepEqual(revoked.sort(), issued.sort(), 'each continuation must revoke exactly its own scoped credential');

    await assert.rejects(workbench.continueTask({ taskId: task.id, message: '过期预览', includePageContext: true, contextPreview: { ...contextPreview, snapshot: 'stale' } }), /页面已变化/);
    assert.equal(workbench.list().find(item => item.id === task.id)?.status, 'completed', 'a stale preview must restore the previous task status');
    const afterStalePreview = workbench.continueTask({ taskId: task.id, message: '重新确认后继续', includePageContext: true, contextPreview });
    await until(() => sessions.length === 3, 'continuation after stale preview');
    sessions.at(-1).resolvePrompt();
    await afterStalePreview;
    await until(() => workbench.list().find(item => item.id === task.id)?.status === 'completed', 'completion after stale preview');

    gate = null; contextReads = 0;
    const handedOffTask = await workbench.start({ profileId: 'default', roomId: 'room-one', tabId: 'tab-one', prompt: '第二项任务', includePageContext: true, contextPreview });
    const handoffStartSession = sessions.at(-1);
    handoffStartSession.resolvePrompt();
    await until(() => workbench.list().find(item => item.id === handedOffTask.id)?.status === 'completed', 'second task completion');
    const handoffGate = new Promise(resolve => { gateRelease = { release: resolve }; });
    gate = handoffGate;
    const sessionCountBeforeHandoff = sessions.length;
    const credentialCountBeforeHandoff = issued.length;
    const lateContinuation = workbench.continueTask({ taskId: handedOffTask.id, message: '接管期间提交', includePageContext: true, contextPreview });
    await until(() => contextReads === 1, 'handoff continuation context read');
    await workbench.pauseRoom('room-one');
    gateRelease.release();
    const lateResult = await Promise.allSettled([lateContinuation]);
    assert.equal(lateResult[0].status, 'rejected', 'a continuation waiting for page context must not start after Room handoff');
    assert.equal(workbench.list().find(item => item.id === handedOffTask.id)?.status, 'interrupted');
    assert.equal(sessions.length, sessionCountBeforeHandoff, 'handoff must prevent creation of a late runtime session');
    assert.equal(issued.length, credentialCountBeforeHandoff, 'handoff must prevent issuing a late scoped credential');
    console.log('PASS Agent task continuation lock: duplicate submit rejected; Room handoff prevents a late continuation and credential');
  } finally {
    gateRelease?.release?.();
    for (const session of sessions) session.resolvePrompt();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
