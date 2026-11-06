const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
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
  const localeSource = fs.readFileSync(path.join(__dirname, '../desktop/locales.js'), 'utf8');
  for (const { language, expectedBusy, expectedStarting, expectedChanged } of [
    { language: 'zh-CN', expectedBusy: '此空间已有 Agent 任务正在启动或运行', expectedStarting: '正在启动 Agent 任务', expectedChanged: '页面已变化' },
    { language: 'en-US', expectedBusy: 'An Agent task is already starting or running in this space', expectedStarting: 'Starting Agent task', expectedChanged: 'The page changed' },
  ]) {
    const context = { navigator: { language }, window: {}, document: { documentElement: { lang: '' }, querySelectorAll() { return []; } } };
    vm.runInNewContext(localeSource, context);
    context.window.corvidI18n.setLocale(language);
    assert.ok(context.window.corvidI18n.t('agentTaskRoomBusy').startsWith(expectedBusy), `${language} translates same-Room concurrency feedback`);
    assert.ok(context.window.corvidI18n.t('startingTask').startsWith(expectedStarting), `${language} translates the pending start state`);
    assert.equal(context.window.corvidI18n.userFacingError('[[corvid-error:agent-task-room-busy]] internal details'), context.window.corvidI18n.t('agentTaskRoomBusy'));
    const changedError = context.window.corvidI18n.userFacingError('[[corvid-error:agent-page-context-changed]] 页面已变化，请重新检查并确认上下文');
    assert.ok(changedError.startsWith(expectedChanged), `${language} translates stale page-context feedback`);
    assert.equal(
      context.window.corvidI18n.userFacingError("Error invoking remote method 'shell-action': Error: [[corvid-error:agent-page-context-changed]] 页面已变化，请重新检查并确认上下文"),
      context.window.corvidI18n.t('agentPageContextChanged'),
      `${language} translates coded errors wrapped by Electron IPC`
    );
    for (const [code, key] of [
      ['agent-page-context-required','agentPageContextRequired'],
      ['agent-task-content-invalid','agentTaskContentInvalid'],
      ['agent-page-context-changed','agentPageContextChanged'],
      ['agent-task-continuation-unavailable','agentTaskContinuationUnavailable'],
      ['agent-task-stop-unconfirmed','agentTaskStopUnconfirmed'],
      ['agent-task-history-unavailable','agentTaskHistoryUnavailable'],
      ['agent-control-returned','agentControlReturned'],
      ['search-template-invalid','searchTemplateInvalid'],
      ['profile-name-required','profileNameRequired'],
    ]) {
      assert.equal(context.window.corvidI18n.userFacingError(`[[corvid-error:${code}]] internal details`), context.window.corvidI18n.t(key), `${language} maps ${code} to its resource`);
    }
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-continuation-lock-'));
  const context = { label: 'page-1', url: 'http://127.0.0.1/page', title: 'Fixture', snapshot: { role: 'main', text: 'fixture' } };
  const sessions = [];
  const issued = [], revoked = [];
  let gate = null, gateRelease = null, contextReads = 0;
  let credentialGate = null, credentialStarted = null;
  let sessionGate = null, sessionStarted = null;
  let promptCount = 0, disposeCount = 0;
  const runtime = {
    id: 'test-runtime', version: '1.0.0',
    createSession: async () => {
      if (sessionGate) {
        sessionStarted?.();
        await sessionGate;
      }
      let resolvePrompt;
      const session = {
        checkpoint: () => ({ sessionId: `session-${sessions.length}` }),
        prompt: () => { promptCount++; return new Promise(resolve => { resolvePrompt = resolve; }); },
        subscribe: () => {},
        dispose: () => { disposeCount++; },
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
    issueAgentCredential: async () => {
      if (credentialGate) {
        credentialStarted?.();
        await credentialGate;
      }
      const credential = { id: `credential-${issued.length + 1}`, token: `token-${issued.length + 1}` };
      issued.push(credential.id);
      return credential;
    },
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
    const startArgs = { profileId: 'default', roomId: 'room-one', tabId: 'tab-one', prompt: '同一空间只启动一次', includePageContext: true, contextPreview };
    const firstStart = workbench.start(startArgs);
    await until(() => contextReads === 1, 'first task context read');
    await assert.rejects(workbench.start(startArgs), /\[\[corvid-error:agent-task-room-busy\]\]/, 'a duplicate start is rejected while the first context read is pending');
    assert.equal(contextReads, 1, 'a duplicate start is rejected before reading page context');
    assert.equal(issued.length, 1, 'a duplicate start is rejected before issuing another scoped credential');
    gateRelease.release();
    const firstConcurrentTask = await firstStart;
    assert.equal(firstConcurrentTask.status, 'running');
    await assert.rejects(workbench.start(startArgs), /\[\[corvid-error:agent-task-room-busy\]\]/, 'a room cannot start another task while one is running');
    assert.equal(contextReads, 1, 'a running task blocks another start before reading page context');
    assert.equal(sessions.length, 2, 'the occupied room has only one additional runtime session');

    const parallelTask = await workbench.start({ ...startArgs, roomId: 'room-two', tabId: 'tab-two', prompt: '另一个空间并行启动' });
    assert.equal(parallelTask.status, 'running', 'a different Room remains independently startable');
    assert.equal(workbench.list().filter(item => item.status === 'running').length, 2, 'different Rooms can run tasks concurrently');
    assert.deepEqual(workbench.list().filter(item => item.status === 'running').map(item => item.roomId).sort(), ['room-one', 'room-two']);
    for (const session of sessions.slice(1)) session.resolvePrompt();
    await until(() => workbench.list().filter(item => ['running', 'preparing'].includes(item.status)).length === 0, 'parallel Room tasks completion');
    gate = null; contextReads = 0;

    const staleStartArgs = { ...startArgs, roomId: 'room-three', tabId: 'tab-three', prompt: '启动校验失败后可重试', contextPreview: { ...contextPreview, snapshot: 'stale' } };
    await assert.rejects(workbench.start(staleStartArgs), /页面已变化/, 'a stale page preview fails before creating a task');
    assert.equal(workbench.list().some(item => item.roomId === 'room-three'), false, 'a failed start does not persist a task');
    const retryTask = await workbench.start({ ...staleStartArgs, prompt: '重新确认后启动', contextPreview });
    assert.equal(retryTask.status, 'running', 'a failed start releases its claim so the user can retry');
    sessions.at(-1).resolvePrompt();
    await until(() => workbench.list().find(item => item.id === retryTask.id)?.status === 'completed', 'task start retry completion');

    gateRelease = {};
    gate = new Promise(resolve => { gateRelease.release = resolve; });
    const continuation = { taskId: task.id, message: '继续', includePageContext: true, contextPreview };
    const sessionsBeforeContinuation = sessions.length;
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
    assert.equal(sessions.length, sessionsBeforeContinuation + 1, 'one completed task should create only one continuation session');
    assert.equal(workbench.list()[0].conversation.filter(turn => turn.role === 'user').length, 2, 'the repeated submit must not duplicate the user turn');
    assert.deepEqual(revoked.sort(), issued.sort(), 'each continuation must revoke exactly its own scoped credential');

    await assert.rejects(workbench.continueTask({ taskId: task.id, message: '过期预览', includePageContext: true, contextPreview: { ...contextPreview, snapshot: 'stale' } }), /页面已变化/);
    assert.equal(workbench.list().find(item => item.id === task.id)?.status, 'completed', 'a stale preview must restore the previous task status');
    const afterStalePreview = workbench.continueTask({ taskId: task.id, message: '重新确认后继续', includePageContext: true, contextPreview });
    await until(() => sessions.length === sessionsBeforeContinuation + 2, 'continuation after stale preview');
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

    gate = null; contextReads = 0;
    const beforeCredentialHandoff = workbench.list().find(item => item.id === handedOffTask.id);
    assert.equal(beforeCredentialHandoff.status, 'interrupted');
    const contextPreviewAfterHandoff = await workbench.prepare({ profileId: 'default', roomId: 'room-one', tabId: 'tab-one' });
    const resumedForCredentialRace = workbench.continueTask({ taskId: handedOffTask.id, message: '测试凭据签发期间交接', includePageContext: true, contextPreview: contextPreviewAfterHandoff });
    let releaseCredential;
    credentialGate = new Promise(resolve => { releaseCredential = resolve; });
    let signalCredentialStarted;
    const credentialStartedSignal = new Promise(resolve => { signalCredentialStarted = resolve; });
    credentialStarted = signalCredentialStarted;
    await until(() => workbench.list().find(item => item.id === handedOffTask.id)?.status === 'preparing', 'credential issuance preparation');
    await credentialStartedSignal;
    await workbench.pauseRoom('room-one');
    const revokedBeforeCredentialRelease = revoked.length;
    releaseCredential();
    await assert.rejects(resumedForCredentialRace, /空间已交给用户/);
    credentialGate = null; credentialStarted = null;
    assert.equal(workbench.list().find(item => item.id === handedOffTask.id)?.status, 'interrupted', 'handoff during credential issuance keeps the task interrupted');
    assert.equal(sessions.length, sessionCountBeforeHandoff, 'credential completion after handoff must not create a runtime session');
    assert.equal(revoked.length, revokedBeforeCredentialRelease + 1, 'a credential returned after handoff is revoked immediately');

    const resumedForSessionRace = workbench.continueTask({ taskId: handedOffTask.id, message: '测试会话初始化期间交接', includePageContext: true, contextPreview: contextPreviewAfterHandoff });
    let releaseSession;
    sessionGate = new Promise(resolve => { releaseSession = resolve; });
    let signalSessionStarted;
    const sessionStartedSignal = new Promise(resolve => { signalSessionStarted = resolve; });
    sessionStarted = signalSessionStarted;
    const promptsBeforeSessionHandoff = promptCount;
    const disposedBeforeSessionHandoff = disposeCount;
    await sessionStartedSignal;
    await workbench.pauseRoom('room-one');
    releaseSession();
    await assert.rejects(resumedForSessionRace, /空间已交给用户/);
    sessionGate = null; sessionStarted = null;
    assert.equal(workbench.list().find(item => item.id === handedOffTask.id)?.status, 'interrupted', 'handoff during runtime initialization keeps the task interrupted');
    assert.equal(promptCount, promptsBeforeSessionHandoff, 'a runtime initialized after handoff must never receive a prompt');
    assert.equal(disposeCount, disposedBeforeSessionHandoff + 1, 'a runtime initialized after handoff is disposed');
    assert.deepEqual(revoked.sort(), issued.sort(), 'credentials are revoked after context, credential, and runtime handoff races');
    console.log('PASS Agent task continuation lock: duplicate submit rejected; Room handoff prevents a late continuation and credential');
  } finally {
    gateRelease?.release?.();
    for (const session of sessions) session.resolvePrompt();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
