import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import electron from 'electron';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(fn, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result; } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for condition${last ? `: ${last.message}` : ''}`);
}

// A real Electron process and Chromium-rendered fixture; never uses a user's profile.
test('rooms, browser interactions, yieldControl and shutdown through the running app', { timeout: 60000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'corvid-e2e-'));
  let started;
  const actionStarted = new Promise(resolve => { started = resolve; });
  let release;
  const actionGate = new Promise(resolve => { release = resolve; });
  let lateStarted, releaseLate;
  const lateStartedSignal = new Promise(resolve => { lateStarted = resolve; });
  const lateGate = new Promise(resolve => { releaseLate = resolve; });
  const fixture = http.createServer(async (req, res) => {
    if (req.url === '/late') { lateStarted(); await lateGate; res.writeHead(200); res.end('released'); return; }
    if (req.url === '/barrier') {
      started();
      await actionGate;
      res.writeHead(200); res.end('released'); return;
    }
    if (req.url === '/cookie') {
      res.setHeader('Set-Cookie', 'shared=fixture; Path=/; SameSite=Lax');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<title>Cookie fixture</title><h1>Cookie set</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>Interaction fixture</title><label>Name <input id="name"></label><button id="go">Submit</button><output id="result"></output><script>document.querySelector("#go").onclick=()=>document.querySelector("#result").textContent=document.querySelector("#name").value;</script>');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  const child = spawn(electron, ['.'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1', ELECTRON_RUN_AS_NODE: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    let connection;
    try {
      connection = await eventually(async () => JSON.parse(await readFile(path.join(dataDir, 'control.json'), 'utf8')));
    } catch (error) {
      throw new Error(`${error.message}; Electron exit=${child.exitCode}, signal=${child.signalCode}\n${output}`);
    }
    const startupProgress = await eventually(async () => {
      const value = JSON.parse(await readFile(path.join(dataDir, 'startup-progress.json'), 'utf8'));
      return value.stage === 'startup-complete' ? value : null;
    });
    assert.equal(startupProgress.pid, child.pid, 'startup progress belongs to the current Electron main process');
    assert.equal(Object.hasOwn(startupProgress, 'token'), false, 'startup progress must not contain credentials');
    assert.equal((await stat(path.join(dataDir, 'control.json'))).mode & 0o777, 0o600);
    const request = async (method, route, body) => {
      const response = await fetch(connection.baseUrl + route, {
        method, headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      return { status: response.status, result };
    };
    const call = async (method, route, body) => {
      const { status, result } = await request(method, route, body);
      assert.equal(status, 200, JSON.stringify(result));
      return result;
    };
    assert.equal((await fetch(connection.baseUrl + '/rooms')).status, 401);
    const original = await call('GET', '/rooms');
    const first = await call('POST', '/rooms', { name: 'test-one' });
    const second = await call('POST', '/rooms', { name: 'test-two' });
    assert.notEqual(first.id, second.id);
    const firstTab = first.tabs[0], secondTab = second.tabs[0];
    await call('POST', `/tabs/${firstTab.id}/navigate`, { url: `${origin}/cookie` });
    await call('POST', `/tabs/${secondTab.id}/navigate`, { url: `${origin}/form` });
    await eventually(async () => {
      const rooms = await call('GET', '/rooms');
      const firstLoaded = rooms.rooms.find(room => room.id === first.id)?.tabs[0]?.loadComplete;
      const secondLoaded = rooms.rooms.find(room => room.id === second.id)?.tabs[0]?.loadComplete;
      return firstLoaded && secondLoaded;
    });
    await call('POST', `/rooms/${first.id}/activate`);
    const action = async (tabId, operation, args = {}) => call('POST', `/tabs/${tabId}/action`, { operation, args });
    const cookie = await action(secondTab.id, 'evaluate', { expression: 'document.cookie' });
    assert.match(cookie.value, /shared=fixture/);
    const snapshot = await action(secondTab.id, 'snapshot');
    assert.ok(snapshot.items.some(item => item.name === 'Submit'));
    await action(secondTab.id, 'fill', { target: '#name', value: 'independent browser' });
    await action(secondTab.id, 'click', { target: '#go' });
    assert.equal((await action(secondTab.id, 'text', { target: '#result' })).value, 'independent browser');
    let state = await call('GET', '/rooms');
    assert.equal(state.activeRoomId, first.id);
    assert.equal(state.rooms.find(s => s.id === second.id).tabs[0].url, `${origin}/form`);
    const running = action(firstTab.id, 'evaluate', { expression: `(async () => { await fetch('/barrier'); document.body.dataset.completed = 'yes'; return 'completed'; })()` });
    let startTimer;
    try {
      await Promise.race([actionStarted, new Promise((_, reject) => { startTimer = setTimeout(() => reject(new Error('Page action did not reach fixture barrier')), 5000); })]);
    } finally { clearTimeout(startTimer); }
    let yieldControlDone = false;
    const yieldControl = call('POST', `/rooms/${first.id}/yieldControl`).then(value => { yieldControlDone = true; return value; });
    await delay(150);
    assert.equal(yieldControlDone, false, 'yieldControl must wait for the active action');
    release();
    assert.equal((await running).value, 'completed');
    await yieldControl;
    const blocked = await request('POST', `/tabs/${firstTab.id}/action`, { operation: 'navigate', args: { url: `${origin}/form` } });
    assert.equal(blocked.status, 400);
    assert.match(blocked.result.error, /user control/i);
    await call('POST', `/rooms/${first.id}/resumeControl`);
    await call('POST', `/tabs/${firstTab.id}/navigate`, { url: `${origin}/form` });
    const late = action(secondTab.id, 'evaluate', { expression: "(async () => { await fetch('/late'); document.body.dataset.late = 'yes'; return 'done'; })()", timeoutMs: 300 });
    let lateStartTimer;
    try { await Promise.race([lateStartedSignal, new Promise((_, reject) => { lateStartTimer = setTimeout(() => reject(new Error('Late action did not start')), 5000); })]); }
    finally { clearTimeout(lateStartTimer); }
    const timeout = await late;
    assert.equal(timeout.status, 'timed_out');
    assert.equal(timeout.executionStopped, false);
    assert.equal(timeout.mayHaveLateEffects, true);
    assert.match((await request('POST', `/tabs/${secondTab.id}/action`, { operation:'snapshot' })).result.error, /unresolved timed-out/);
    assert.ok((await action(firstTab.id, 'snapshot')).items.length);
    await call('POST', `/rooms/${second.id}/yieldControl`);
    assert.match((await request('POST', `/rooms/${second.id}/resumeControl`, {})).result.error, /unresolved timed-out/);
    releaseLate();
    const risk=await eventually(async()=>{const s=(await call('GET','/rooms')).rooms.find(x=>x.id===second.id);return s.executionRisk?.status==='late_completed' && s;});
    assert.equal(risk.ownership,'user');
    assert.equal(risk.executionRisk.operationId,timeout.operationId);
    await call('DELETE', `/rooms/${first.id}`);
    // A handed-off room remains user-owned and cannot be removed by the agent.
    state = await call('GET', '/rooms');
    assert.ok(original.rooms.every(s => state.rooms.some(current => current.id === s.id)));
    await call('POST', '/shutdown', {});
    await eventually(() => child.exitCode !== null || child.signalCode !== null);
    await assert.rejects(stat(path.join(dataDir, 'control.json')), { code: 'ENOENT' });
    await assert.rejects(fetch(connection.baseUrl + '/rooms', { headers: { authorization: `Bearer ${connection.token}` } }));
  } finally {
    release();
    releaseLate();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), delay(3000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
