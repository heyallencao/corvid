const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSiteCommandsStore } = require('../desktop/site-commands.cjs');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-site-commands-'));
const filePath = path.join(dataDir, 'site-commands.json');
try {
  const store = createSiteCommandsStore(filePath);
  const candidate = store.propose({
    roomId: 'room-one', name: 'Read catalog', description: 'Read this catalog page.', origin: 'https://catalog.example',
    steps: [{ type: 'info' }, { type: 'snapshot', scope: 'viewport' }],
  });
  assert.equal(candidate.status, 'candidate');
  assert.equal(candidate.successfulTrials, 0);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  assert.equal(store.find('room-two', candidate.id), null, 'a command cannot be looked up from another Room');
  assert.throws(() => store.retain('room-one', candidate.id), /pass a trial/i, 'untried candidates cannot be retained');
  assert.throws(() => store.propose({ roomId: 'room-one', name: 'Unsafe', description: '', origin: 'https://catalog.example', steps: [{ type: 'evaluate', script: 'document.body.remove()' }] }), error => error.code === 'CORVID_INVALID_ARGUMENT');
  assert.throws(() => store.propose({ roomId: 'room-one', name: 'Unsafe origin', description: '', origin: 'https://user:password@catalog.example', steps: [{ type: 'info' }] }), error => error.code === 'CORVID_INVALID_ARGUMENT');
  assert.throws(() => store.propose({ roomId: 'room-one', name: 'Unknown key', description: '', origin: 'https://catalog.example', steps: [{ type: 'info', script: 'x' }] }), error => error.code === 'CORVID_INVALID_ARGUMENT');

  store.recordTrial('room-one', candidate.id, false);
  assert.equal(store.find('room-one', candidate.id).successfulTrials, 0, 'failed trials do not authorize retention');
  store.recordTrial('room-one', candidate.id, true);
  const retained = store.retain('room-one', candidate.id);
  assert.equal(retained.status, 'retained');
  assert.equal(store.list({ roomId: 'room-one' }).length, 1);
  assert.equal(store.list({ roomId: 'room-two' }).length, 0);

  const reopened = createSiteCommandsStore(filePath);
  assert.equal(reopened.find('room-one', candidate.id).status, 'retained', 'retained commands survive application restart');
  assert.equal(reopened.remove('room-one', candidate.id), true);
  assert.equal(reopened.find('room-one', candidate.id), null);
  assert.equal(reopened.remove('room-one', candidate.id), false);

  fs.writeFileSync(filePath, JSON.stringify({ version: 99, commands: [] }));
  assert.throws(() => reopened.list(), /format is invalid/i, 'unknown store versions are rejected without being rewritten');
  console.log('PASS read-only site command schema, Room isolation, trial gate, persistence, deletion, and unknown-version rejection');
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
