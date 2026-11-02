const fs = require('node:fs');
const path = require('node:path');
const packageInfo = require('../package.json');
const { createPiAgentSession, readPiPageContext } = require('./pi-agent.cjs');

const PI_RUNTIME_ID = 'pi';
const PI_RUNTIME_VERSION = packageInfo.dependencies['@earendil-works/pi-coding-agent'];

function normalizePiEvent(event) {
  if (event?.type === 'message_update') {
    const update = event.assistantMessageEvent;
    return update?.type === 'text_delta' && update.delta ? { type: 'assistant_delta', text: update.delta } : null;
  }
  if (event?.type === 'tool_execution_start') return { type: 'tool_start', name: event.toolName };
  if (event?.type === 'tool_execution_end') return { type: 'tool_end', name: event.toolName, failed: Boolean(event.isError) };
  if (event?.type === 'auto_retry_start') return { type: 'retry', attempt: event.attempt, maxAttempts: event.maxAttempts };
  return null;
}

function createPiRuntimeAdapter({ id, version, compatibleVersions = [], createImplementationSession, readPageContext = readPiPageContext, deleteTaskData = () => {}, modelManager = null, getModelSelection = () => null }) {
  if (typeof id !== 'string' || !id || typeof version !== 'string' || !version) throw new TypeError('Agent runtime identity is required');
  if (typeof createImplementationSession !== 'function') throw new TypeError('Agent runtime session factory is required');
  const supportedCheckpointVersions = new Set([version, ...compatibleVersions]);

  function canResume(checkpoint) {
    return Boolean(checkpoint && checkpoint.runtimeId === id && supportedCheckpointVersions.has(checkpoint.runtimeVersion) && checkpoint.data && typeof checkpoint.data.sessionFile === 'string');
  }

  async function createSession(input) {
    const checkpoint = input.checkpoint || null;
    if (checkpoint && !canResume(checkpoint)) throw new Error('This conversation belongs to an incompatible Agent runtime');
    const modelInfo = input.selectedModel && modelManager ? await modelManager.getModel(input.selectedModel) : null;
    const created = await createImplementationSession({ ...input, checkpoint: undefined, sessionFile: checkpoint?.data?.sessionFile || null, ...(modelInfo ? { model: modelInfo.model, modelRuntime: modelInfo.runtime, requiresAuth: modelInfo.requiresAuth } : {}) });
    const implementationSession = created.session;
    return {
      fixture: Boolean(created.fixture),
      subscribe(listener) {
        if (typeof implementationSession.subscribe !== 'function') return () => {};
        return implementationSession.subscribe(event => {
          const normalized = normalizePiEvent(event);
          if (normalized) listener(normalized);
        });
      },
      prompt: message => implementationSession.prompt(message),
      abort: () => implementationSession.abort?.(),
      dispose: () => implementationSession.dispose?.(),
      checkpoint() {
        const sessionFile = implementationSession.sessionFile || created.sessionFile || checkpoint?.data?.sessionFile;
        return sessionFile ? { runtimeId: id, runtimeVersion: version, data: { sessionFile } } : null;
      },
    };
  }

  function removeTaskData(taskId, checkpoint) {
    return deleteTaskData(taskId, checkpoint);
  }

  async function resolveModel(selection) {
    if (!modelManager) return { name: selection.modelId };
    const modelInfo = await modelManager.getModel(selection);
    return { name: modelInfo.model.name || selection.modelId };
  }

  return Object.freeze({ id, version, canResume, createSession, readPageContext, removeTaskData, getModelSelection, resolveModel });
}

function createPiAgentRuntime({ dataDir, createSession = createPiAgentSession, readContext = readPiPageContext, modelManager = null, getModelSelection = () => null, compatibleVersions = [] } = {}) {
  if (typeof dataDir !== 'string' || !dataDir) throw new TypeError('dataDir is required for the Agent runtime');
  const sessionsRoot = path.resolve(dataDir, 'agent-sessions');
  return createPiRuntimeAdapter({ id: PI_RUNTIME_ID, version: PI_RUNTIME_VERSION, compatibleVersions, createImplementationSession: createSession, readPageContext: readContext, modelManager, getModelSelection, deleteTaskData(taskId, checkpoint) {
    if (checkpoint && checkpoint.runtimeId !== PI_RUNTIME_ID) return;
    if (typeof taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(taskId)) throw new TypeError('taskId is invalid');
    const taskDirectory = path.resolve(sessionsRoot, taskId);
    if (!taskDirectory.startsWith(`${sessionsRoot}${path.sep}`)) throw new Error('Agent session directory escaped its data root');
    fs.rmSync(taskDirectory, { recursive: true, force: true });
  } });
}

module.exports = { PI_RUNTIME_ID, PI_RUNTIME_VERSION, createPiAgentRuntime };
