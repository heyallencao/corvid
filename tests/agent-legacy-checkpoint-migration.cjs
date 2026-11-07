const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAgentWorkbench } = require('../desktop/agent-workbench.cjs');
const { TASKS_SCHEMA_VERSION, createAgentTaskStore } = require('../desktop/agent-task-store.cjs');
const { PI_RUNTIME_ID, PI_RUNTIME_VERSION, createPiAgentRuntime } = require('../desktop/agent-runtime.cjs');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-legacy-checkpoint-'));
const taskId = 'legacy-task';
const legacySessionFile = path.join(dataDir, 'agent-sessions', taskId, 'session.jsonl');
const replacementSessionFile = path.join(dataDir, 'agent-sessions', 'legacy_task', 'replacement.jsonl');
const page = { label: 'tab-one', url: 'http://127.0.0.1/fixture', title: '本地页面', snapshot: { title: '本地页面' } };
const previousConversation = [
  { role: 'user', text: '保留的旧问题', at: '2026-11-04T00:00:00.000Z' },
  { role: 'assistant', text: '保留的旧回答', status: 'completed', at: '2026-11-04T00:00:01.000Z' },
];
const model = { providerId: 'openai-codex', modelId: 'gpt-6-luna', name: 'GPT-6 Luna' };

async function main() {
  try {
    fs.writeFileSync(path.join(dataDir, 'agent-tasks.json'), JSON.stringify([{
      id: taskId, profileId: 'profile-a', roomId: 'room-a', tabId: 'tab-one', status: 'completed',
      prompt: previousConversation[0].text, output: previousConversation[1].text, conversation: previousConversation,
      selectedModel: model, piSessionFile: legacySessionFile,
    }]), { mode: 0o600 });

    const store = createAgentTaskStore(dataDir);
    const migrated = store.load()[0];
    assert.equal(migrated.sessionRef.runtimeId, PI_RUNTIME_ID);
    assert.equal(migrated.sessionRef.runtimeVersion, 'unknown', 'a legacy session without version provenance is never labeled as the installed runtime');
    assert.equal(migrated.sessionRef.data.sessionFile, legacySessionFile, 'migration retains the old opaque path for safe preservation');
    assert.equal(Object.hasOwn(migrated, 'piSessionFile'), false);

    const implementationInputs = [], prompts = [];
    const runtime = createPiAgentRuntime({
      dataDir,
      createSession: async input => {
        implementationInputs.push(input);
        const listeners = new Set();
        const session = {
          sessionFile: replacementSessionFile,
          subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
          async prompt(payload) {
            prompts.push(payload);
            for (const listener of listeners) listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '新会话继续完成' } });
          },
          dispose() {},
        };
        return { session };
      },
      readContext: async () => page,
    });
    const workbench = createAgentWorkbench({
      dataDir,
      runtime,
      issueAgentCredential: async () => ({ id: 'credential-legacy-task', token: 'test-token-legacy-task' }),
      revokeAgentCredential: async () => {},
    });

    const visibleTask = workbench.list()[0];
    assert.equal(visibleTask.id, taskId);
    assert.equal(visibleTask.continuationMode, 'saved-conversation');
    assert.equal(visibleTask.canContinue, true);
    assert.doesNotMatch(JSON.stringify(visibleTask), /pi|runtimeVersion|sessionFile/i, 'runtime checkpoint details stay internal');

    await workbench.continueTask({
      taskId, message: '请接着之前的回答继续'
    });
    for (let attempt = 0; attempt < 100 && workbench.list()[0].status !== 'completed'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(workbench.list()[0].status, 'completed');
    assert.equal(implementationInputs.length, 1);
    const input = implementationInputs[0];
    assert.equal(input.sessionFile, null, 'the unverified legacy checkpoint never reaches the current runtime');
    assert.equal(input.checkpoint, undefined);
    assert.deepEqual(input.priorConversation, previousConversation.map(({ role, text }) => ({ role, text })), 'the Corvid transcript is passed as bounded fallback context');
    assert.equal(input.taskId, 'legacy_task');
    assert.equal(input.profileId, 'profile-a');
    assert.equal(input.roomId, 'room-a');
    assert.equal(input.tabId, 'tab-one');
    assert.deepEqual(input.selectedModel, model);
    assert.match(prompts[0], /保留的旧回答/);
    assert.match(prompts[0], /请接着之前的回答继续/);

    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-tasks.json'), 'utf8'));
    assert.equal(saved.schemaVersion, TASKS_SCHEMA_VERSION);
    assert.equal(saved.tasks[0].id, taskId);
    assert.deepEqual(saved.tasks[0].conversation.slice(0, 2), previousConversation);
    assert.deepEqual(saved.tasks[0].sessionRef, {
      runtimeId: PI_RUNTIME_ID,
      runtimeVersion: PI_RUNTIME_VERSION,
      data: { sessionFile: replacementSessionFile },
    }, 'the replacement checkpoint is committed after its first successful turn');
    console.log('legacy checkpoint provenance and transcript fallback passed');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
