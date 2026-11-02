const { _electron } = require('playwright-core');
const electron = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-sigkill-recovery-'));
  const site = http.createServer((request, response) => {
    const name = decodeURIComponent(request.url.slice(1) || 'home');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>${name}</title><h1>${name}</h1>`);
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${site.address().port}`;
  let app;
  let control;

  const waitFor = async (fn, label) => {
    for (let i = 0; i < 240; i++) {
      const value = await fn();
      if (value) return value;
      await delay(50);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const start = async previousToken => {
    app = await _electron.launch({
      executablePath: electron,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const shell = await app.firstWindow();
    control = await waitFor(() => {
      try {
        const current = JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8'));
        return current.baseUrl && current.token !== previousToken ? current : false;
      } catch { return false; }
    }, 'fresh control credentials');
    return shell;
  };
  const request = async (server, token, route, method = 'GET', body) => {
    const response = await fetch(server + route, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let result;
    try { result = await response.json(); } catch { result = null; }
    return { status: response.status, result };
  };
  const call = async (route, method = 'GET', body) => {
    const response = await request(control.baseUrl, control.token, route, method, body);
    assert.equal(response.status, 200, JSON.stringify(response.result));
    return response.result;
  };
  const hardKill = async () => {
    const child = app.process();
    assert.equal(child.exitCode, null, 'Electron main process is still running before SIGKILL');
    const exited = once(child, 'exit');
    app = undefined;
    child.kill('SIGKILL');
    await exited;
  };

  try {
    let shell = await start();
    let state = await call('/rooms');
    const userRoom = state.rooms.find(room => room.ownership === 'user');
    assert.ok(userRoom, 'fresh Corvid session has a user Room');

    const firstTab = userRoom.tabs[0];
    const firstUrl = `${base}/first-tab`;
    await shell.getByLabel('地址或搜索').fill(firstUrl);
    await shell.getByLabel('地址或搜索').press('Enter');
    await waitFor(async () => {
      const current = await call('/rooms');
      return current.rooms.find(room => room.id === userRoom.id)?.tabs.find(tab => tab.id === firstTab.id)?.url === firstUrl;
    }, 'first tab navigation');

    await shell.getByRole('button', { name: '新建标签' }).click();
    const secondTab = await waitFor(async () => {
      const current = await call('/rooms');
      return current.rooms.find(room => room.id === userRoom.id)?.tabs.find(tab => tab.id !== firstTab.id) || false;
    }, 'second user tab');
    assert.ok(secondTab, 'user Room contains a second tab');
    const secondUrl = `${base}/active-tab`;
    await shell.getByLabel('地址或搜索').fill(secondUrl);
    await shell.getByLabel('地址或搜索').press('Enter');
    state = await waitFor(async () => {
      const current = await call('/rooms');
      const restoredRoom = current.rooms.find(room => room.id === userRoom.id);
      const first = restoredRoom?.tabs.find(tab => tab.id === firstTab.id);
      const second = restoredRoom?.tabs.find(tab => tab.id === secondTab.id);
      return first?.url === firstUrl && second?.url === secondUrl && second.active ? current : false;
    }, 'saved Room, URLs and active tab');
    assert.equal(state.activeRoomId, userRoom.id, 'the selected user Room is the active context');

    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
    await shell.getByRole('button', { name: '连接当前页面' }).click();
    await shell.getByRole('textbox', { name: '描述要完成的浏览任务' }).fill('[fixture:hold] 在强制退出时保留未知任务状态');
    await shell.getByRole('button', { name: '检查并预览页面上下文' }).click();
    await shell.getByLabel(/我已检查/).check();
    await shell.getByRole('button', { name: '发送' }).click();
    await shell.locator('.pi-task-state[data-status="running"]').waitFor();

    const expected = {
      roomId: userRoom.id,
      firstTabId: firstTab.id,
      secondTabId: secondTab.id,
      firstUrl,
      secondUrl,
    };
    const durableState = JSON.parse(fs.readFileSync(path.join(dataDir, 'rooms.json'), 'utf8'));
    const durableRoom = durableState.rooms.find(room => room.id === expected.roomId);
    assert.ok(durableRoom, 'Room state reached the durable file before termination');
    assert.equal(durableRoom.activeTabId, expected.secondTabId);
    assert.deepEqual(
      Object.fromEntries(durableRoom.tabs.map(tab => [tab.id, tab.url])),
      { [expected.firstTabId]: expected.firstUrl, [expected.secondTabId]: expected.secondUrl },
    );
    const oldControl = control;
    const liveTask = await waitFor(() => {
      try {
        const tasks = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-tasks.json'), 'utf8')).tasks;
        return tasks.find(task => task.status === 'running') || false;
      } catch { return false; }
    }, 'persisted running Agent task');
    assert.equal(liveTask.conversation.at(-1).status, 'running');

    await hardKill();
    shell = await start(oldControl.token);

    const oldCredential = await request(control.baseUrl, oldControl.token, '/rooms');
    assert.equal(oldCredential.status, 401, 'the pre-crash Bearer credential is rejected by the restarted server');
    state = await call('/rooms');
    const restoredRoom = state.rooms.find(room => room.id === expected.roomId);
    assert.ok(restoredRoom, 'the user Room is restored after abrupt process termination');
    assert.deepEqual(new Set(restoredRoom.tabs.map(tab => tab.id)), new Set([expected.firstTabId, expected.secondTabId]));
    assert.deepEqual(
      Object.fromEntries(restoredRoom.tabs.map(tab => [tab.id, tab.url])),
      { [expected.firstTabId]: expected.firstUrl, [expected.secondTabId]: expected.secondUrl },
    );
    assert.equal(restoredRoom.tabs.find(tab => tab.id === expected.secondTabId).active, true);
    assert.equal(state.activeRoomId, expected.roomId);

    const recoveredTasks = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-tasks.json'), 'utf8')).tasks;
    const recoveredTask = recoveredTasks.find(task => task.id === liveTask.id);
    assert.equal(recoveredTask.status, 'interrupted', 'a task in flight at SIGKILL is reported as interrupted/unknown');
    assert.equal(recoveredTask.conversation.at(-1).status, 'interrupted');
    assert.notEqual(recoveredTask.status, 'completed');
    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
    await shell.locator('.pi-task-state[data-status="interrupted"]').waitFor();
    await shell.getByText('等待检查', { exact: true }).waitFor();

    console.log('PASS SIGKILL: Room/tab IDs and URLs recover, active context persists, old control token is rejected, running Agent task remains unknown');
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => site.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
