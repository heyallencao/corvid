const fs = require('node:fs');
const path = require('node:path');
const { PI_RUNTIME_ID, PI_RUNTIME_VERSION } = require('./agent-runtime.cjs');

const TASKS_SCHEMA_VERSION = 3;
const MAX_QUEUED_MESSAGES = 20;
const MAX_QUEUED_MESSAGE_LENGTH = 8_000;

function normalizeQueue(queue) {
  if (queue === undefined) return [];
  if (!Array.isArray(queue) || queue.length > MAX_QUEUED_MESSAGES) throw new Error('Cannot read Agent task state: Agent message queue is invalid');
  const ids = new Set();
  for (const item of queue) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.text !== 'string' || !item.text.trim() || item.text.trim().length > MAX_QUEUED_MESSAGE_LENGTH || typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string' || !Number.isSafeInteger(item.revision) || item.revision < 1) throw new Error('Cannot read Agent task state: Agent message queue is invalid');
    ids.add(item.id);
  }
  return queue;
}

function migrateLegacyTask(task) {
  const migrated = { ...task };
  if (!migrated.sessionRef && typeof migrated.piSessionFile === 'string' && migrated.piSessionFile) {
    migrated.sessionRef = { runtimeId: PI_RUNTIME_ID, runtimeVersion: PI_RUNTIME_VERSION, data: { sessionFile: migrated.piSessionFile } };
  }
  delete migrated.piSessionFile;
  delete migrated.runtime;
  return migrated;
}

function createAgentTaskStore(dataDir) {
  const file = path.join(dataDir, 'agent-tasks.json');
  function load() {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw new Error(`Cannot read Agent task state: ${error.message}`); }
    let legacy = Array.isArray(saved), records;
    if (legacy) records = saved;
    else if (saved && saved.schemaVersion === TASKS_SCHEMA_VERSION && Array.isArray(saved.tasks)) records = saved.tasks;
    else if (saved && [1, 2].includes(saved.schemaVersion) && Array.isArray(saved.tasks)) { records = saved.tasks; legacy = true; }
    else throw new Error(`Cannot read Agent task state: Agent task data schema is unsupported; expected ${TASKS_SCHEMA_VERSION}`);
    if (records.some(item => !item || typeof item.id !== 'string' || typeof item.profileId !== 'string' || typeof item.roomId !== 'string' || typeof item.tabId !== 'string' || typeof item.status !== 'string')) throw new Error('Cannot read Agent task state: Agent task data structure is invalid');
    if (new Set(records.map(item => item.id)).size !== records.length) throw new Error('Cannot read Agent task state: Agent task data contains duplicate IDs');
    const migrated = legacy ? records.map(migrateLegacyTask) : records;
    for (const task of migrated) task.messageQueue = normalizeQueue(task.messageQueue);
    return migrated;
  }
  function save(tasks) {
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ schemaVersion: TASKS_SCHEMA_VERSION, tasks }), { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, file);
    try { fs.chmodSync(file, 0o600); } catch {}
  }
  return Object.freeze({ load, save });
}

module.exports = { TASKS_SCHEMA_VERSION, MAX_QUEUED_MESSAGES, MAX_QUEUED_MESSAGE_LENGTH, createAgentTaskStore };
