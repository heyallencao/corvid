const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = 1;
const MAX_COMMANDS = 200;
const MAX_STEPS = 8;

function createSiteCommandsStore(filePath) {
  function read() {
    try {
      const store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!store || store.version !== VERSION || !Array.isArray(store.commands) || store.commands.length > MAX_COMMANDS || store.commands.some(command => !isStoredCommand(command))) {
        throw new Error('Corvid site command file format is invalid');
      }
      return store;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: VERSION, commands: [] };
      throw error;
    }
  }

  function write(store) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(store), { mode: 0o600, flag: 'wx' });
      fs.chmodSync(tempPath, 0o600);
      fs.renameSync(tempPath, filePath);
      fs.chmodSync(filePath, 0o600);
    } finally {
      try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  function list({ roomId } = {}) {
    return read().commands.filter(command => roomId === undefined || command.roomId === roomId).map(publicCommand);
  }

  function find(roomId, commandId) {
    const command = read().commands.find(item => item.roomId === roomId && item.id === commandId);
    return command ? publicCommand(command) : null;
  }

  function propose(input) {
    const candidate = normalizeCandidate(input);
    const store = read();
    if (store.commands.length >= MAX_COMMANDS) throw invalid('Too many site commands are stored');
    store.commands.push({ ...candidate, id: crypto.randomUUID(), status: 'candidate', successfulTrials: 0, createdAt: new Date().toISOString(), lastTrialAt: null });
    write(store);
    return publicCommand(store.commands.at(-1));
  }

  function recordTrial(roomId, commandId, succeeded) {
    const store = read();
    const command = store.commands.find(item => item.roomId === roomId && item.id === commandId && item.status === 'candidate');
    if (!command) throw notFound();
    command.lastTrialAt = new Date().toISOString();
    if (succeeded) command.successfulTrials += 1;
    write(store);
    return publicCommand(command);
  }

  function retain(roomId, commandId) {
    const store = read();
    const command = store.commands.find(item => item.roomId === roomId && item.id === commandId && item.status === 'candidate');
    if (!command) throw notFound();
    if (command.successfulTrials < 1) throw invalid('A site command must pass a trial before it can be retained');
    command.status = 'retained';
    command.retainedAt = new Date().toISOString();
    write(store);
    return publicCommand(command);
  }

  function remove(roomId, commandId) {
    const store = read();
    const index = store.commands.findIndex(item => item.roomId === roomId && item.id === commandId);
    if (index < 0) return false;
    store.commands.splice(index, 1);
    write(store);
    return true;
  }

  return { list, find, propose, recordTrial, retain, remove };
}

function normalizeCandidate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['roomId', 'name', 'description', 'origin', 'steps'].includes(key))) throw invalid('Invalid site command candidate');
  const { roomId, name, description, origin, steps } = input;
  if (typeof roomId !== 'string' || !roomId || typeof name !== 'string' || !name.trim() || name.length > 80 || typeof description !== 'string' || description.length > 240 || !Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) throw invalid('Invalid site command candidate');
  let parsed;
  try { parsed = new URL(origin); } catch { throw invalid('Site command origin must be a valid HTTP or HTTPS origin'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.origin !== origin || parsed.pathname !== '/' || parsed.search || parsed.hash) throw invalid('Site command origin must contain only an HTTP or HTTPS origin');
  return { roomId, name: name.trim(), description: description.trim(), origin: parsed.origin, steps: steps.map(normalizeStep) };
}

function normalizeStep(step) {
  if (!step || typeof step !== 'object' || Array.isArray(step) || typeof step.type !== 'string') throw invalid('Invalid site command step');
  if (step.type === 'info' && Object.keys(step).length === 1) return { type: 'info' };
  if (step.type === 'snapshot' && Object.keys(step).every(key => ['type', 'scope'].includes(key)) && ['page', 'viewport'].includes(step.scope)) return { type: 'snapshot', scope: step.scope };
  throw invalid('Unsupported or invalid site command step');
}

function isStoredCommand(command) {
  if (!command || typeof command !== 'object' || typeof command.id !== 'string' || typeof command.roomId !== 'string' || !['candidate', 'retained'].includes(command.status) || !Number.isInteger(command.successfulTrials) || command.successfulTrials < 0 || typeof command.createdAt !== 'string') return false;
  try {
    const normalized = normalizeCandidate({ roomId: command.roomId, name: command.name, description: command.description, origin: command.origin, steps: command.steps });
    return JSON.stringify(normalized) === JSON.stringify({ roomId: command.roomId, name: command.name, description: command.description, origin: command.origin, steps: command.steps });
  } catch { return false; }
}

function publicCommand(command) {
  return { ...command, steps: command.steps.map(step => ({ ...step })) };
}
function invalid(message) { return Object.assign(new Error(message), { code: 'CORVID_INVALID_ARGUMENT' }); }
function notFound() { return Object.assign(new Error('Site command not found'), { code: 'CORVID_NOT_FOUND' }); }

module.exports = { createSiteCommandsStore, normalizeCandidate };
