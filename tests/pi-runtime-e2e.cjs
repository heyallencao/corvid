const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPiAgentSession } = require('../desktop/pi-agent.cjs');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-pi-runtime-'));
  let app, createdSession, reopenedSession;
  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const control = await (async () => {
      for (let i = 0; i < 200; i++) {
        try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); }
        catch { await delay(25); }
      }
      throw new Error('Corvid control service did not start');
    })();
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(control.baseUrl + route, {
        method, headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) { const error = new Error(result.error || `HTTP ${response.status}`); error.code = result.code; throw error; }
      return result;
    };

    const profileId = (await call('/profiles')).profiles[0].id;
    const room = await call('/rooms', 'POST', { name: 'Pi runtime fixture' });
    const tabId = room.tabs[0].id;
    await assert.rejects(
      createPiAgentSession({ dataDir, taskId: 'unconfirmed', profileId, roomId: room.id, tabId, includePageContext: false }),
      /explicitly confirm sharing this page context/,
    );
    await assert.rejects(
      createPiAgentSession({ dataDir, taskId: 'wrong-profile', profileId: 'missing-profile', roomId: room.id, tabId, includePageContext: true }),
      error => error.code === 'CORVID_NOT_FOUND',
    );

    const userRoom = (await call('/rooms')).rooms.find(item => item.ownership === 'user');
    await assert.rejects(
      createPiAgentSession({ dataDir, taskId: 'user-room', profileId, roomId: userRoom.id, tabId: userRoom.tabs[0].id, includePageContext: true }),
      error => error.code === 'CORVID_CONTROL_LOST',
    );

    createdSession = await createPiAgentSession({ dataDir, taskId: 'isolated-task-1', profileId, roomId: room.id, tabId, includePageContext: true });
    assert.deepEqual(createdSession.tools, ['corvid_navigate', 'corvid_page_snapshot']);
    assert.deepEqual(createdSession.session.getActiveToolNames().slice().sort(), ['corvid_navigate', 'corvid_page_snapshot']);
    assert.equal(createdSession.context.roomId, room.id);
    assert.equal(createdSession.context.profileId, profileId);
    assert.equal(createdSession.context.tabId, tabId);
    assert.equal(createdSession.context.url, 'about:blank');
    assert.ok(createdSession.sessionFile.startsWith(path.join(dataDir, 'agent-sessions', 'isolated-task-1')));
    assert.equal(fs.statSync(path.dirname(createdSession.sessionFile)).mode & 0o777, 0o700);
    assert.equal(fs.existsSync(createdSession.sessionFile), false, 'Pi creates its transcript file when the first message is appended');
    assert.match(createdSession.session.systemPrompt, /You are Corvid/);
    fs.writeFileSync(createdSession.sessionFile, `${JSON.stringify({type:'session',version:3,id:crypto.randomUUID(),timestamp:new Date().toISOString(),cwd:dataDir})}\n`, {mode:0o600});
    reopenedSession = await createPiAgentSession({ dataDir, taskId: 'isolated-task-1', profileId, roomId: room.id, tabId, includePageContext: true, sessionFile: createdSession.sessionFile });
    assert.equal(reopenedSession.sessionFile, createdSession.sessionFile);
    assert.deepEqual(reopenedSession.tools, ['corvid_navigate', 'corvid_page_snapshot']);
    const outsideTranscript = path.join(dataDir, 'outside-transcript.jsonl');
    fs.writeFileSync(outsideTranscript, '{}\n');
    fs.symlinkSync(outsideTranscript, path.join(path.dirname(createdSession.sessionFile), 'linked-transcript.jsonl'));
    await assert.rejects(
      createPiAgentSession({ dataDir, taskId: 'isolated-task-1', profileId, roomId: room.id, tabId, includePageContext: true, sessionFile: path.join(path.dirname(createdSession.sessionFile), 'linked-transcript.jsonl') }),
      /Pi transcript must remain inside this task directory/,
    );
    await assert.rejects(
      createPiAgentSession({ dataDir, taskId: 'isolated-task-1', profileId, roomId: room.id, tabId, includePageContext: true, sessionFile: path.join(dataDir, 'outside-task.jsonl') }),
      /Pi transcript must remain inside this task directory/,
    );

    console.log('PASS Pi SDK session, task-isolated transcript path, explicit page consent, Room/Profile binding, and browser-only tool allowlist');
  } finally {
    createdSession?.session.dispose();
    reopenedSession?.session.dispose();
    if (app) await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
