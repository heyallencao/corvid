const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-rooms-'));
  const site=http.createServer((_request,response)=>response.end('<!doctype html><title>Room task fixture</title><h1>Fixture</h1>'));
  await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
  let app;

  async function until(fn) {
    for (let i = 0; i < 200; i++) {
      const value = await fn();
      if (value) return value;
      await delay(25);
    }
    throw new Error('Timed out waiting for Agent Room panel state');
  }

  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const shell = await app.firstWindow();
    const control = await until(() => {
      try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); }
      catch { return null; }
    });
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(control.baseUrl + route, {
        method,
        headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      return result;
    };
    const startTask=async(room,prompt,expectedStatus='running')=>{
      const url=`http://127.0.0.1:${site.address().port}/`;
      await call(`/rooms/${room.id}/activate`,'POST',{});
      await shell.waitForFunction(name=>[...document.querySelectorAll('#room-strip button')].some(item=>item.textContent===name&&item.classList.contains('selected')),room.name);
      await call(`/tabs/${room.tabs[0].id}/navigate`,'POST',{url});
      await shell.waitForFunction(expected=>document.querySelector('#address')?.value===expected,url);
      if(await shell.locator('#library[data-kind="pi-workbench"]').count()===0)await shell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
      else await shell.getByRole('button',{name:/新建对话/}).click();
      if(await shell.getByRole('button',{name:'连接当前页面'}).count())await shell.getByRole('button',{name:'连接当前页面'}).click();
      await shell.getByRole('textbox',{name:'描述要完成的浏览任务'}).fill(prompt);
      await shell.getByRole('button',{name:'检查并预览页面上下文'}).click();
      await shell.getByLabel(/我已检查/).check();
      await shell.getByRole('button',{name:'发送'}).click();
      await shell.locator(`.pi-task-state[data-status="${expectedStatus}"]`).waitFor();
      const taskId=await shell.locator('.pi-task-entry').getAttribute('data-task-id');
      const saved=JSON.parse(fs.readFileSync(path.join(dataDir,'agent-tasks.json'),'utf8'));
      const task=(Array.isArray(saved)?saved:saved.tasks).find(item=>item.id===taskId);
      return {taskId,roomId:task?.roomId};
    };

    const bookmarksTrigger=shell.locator('#show-bookmarks');
    await bookmarksTrigger.click();
    await shell.locator('#library[data-kind="bookmarks"]').waitFor();
    await shell.locator('#close-library').focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.evaluate(() => document.activeElement.id),'show-bookmarks','closing Bookmarks restores focus to the sidebar control that opened it');

    for(const [kind,triggerId] of [['history','show-history'],['downloads','show-downloads']]){
      await shell.locator(`#${triggerId}`).click();
      await shell.locator(`#library[data-kind="${kind}"]`).waitFor();
      await shell.locator('#close-library').focus();
      await shell.keyboard.press('Enter');
      await shell.locator('#library').waitFor({ state: 'hidden' });
      assert.equal(await shell.evaluate(() => document.activeElement.id),triggerId,`closing ${kind} restores focus to its sidebar control`);
    }

    const agentRoomsTrigger=shell.getByRole('button', { name: 'Agent 工作区' });
    await agentRoomsTrigger.click();
    await shell.getByText('当前 Profile 还没有 Agent Room。打开 Corvid Agent 后，可从当前网页创建工作区；发送页面内容前需要先检查并确认。').waitFor();
    await shell.getByRole('button', { name: '打开 Corvid Agent', exact: true }).click();
    await shell.locator('#library[data-kind="pi-workbench"]').waitFor();
    await shell.getByText('请先打开一个 HTTP(S) 页面，再连接 Corvid Agent').waitFor();
    assert.equal(await shell.evaluate(() => document.activeElement.getAttribute('aria-label')), '描述要完成的浏览任务', 'empty-state CTA moves focus into the Corvid Agent composer');
    await shell.getByRole('button', { name: '关闭面板' }).click();
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.evaluate(() => document.activeElement.id), 'show-pi-workbench', 'closing the CTA-opened workbench restores focus to its sidebar entry');
    await agentRoomsTrigger.click();
    await shell.locator('#library[data-kind="agent-rooms"]').waitFor();
    assert.equal(await shell.locator('#library-search').isVisible(), false);
    await shell.locator('#close-library').focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.getByRole('button', { name: 'Agent 工作区' }).getAttribute('aria-expanded'), 'false');
    assert.equal(await shell.evaluate(() => document.activeElement.id),'show-agent-rooms','closing Agent Rooms restores focus to its sidebar control');
    await shell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    await shell.locator('#library[data-kind="pi-workbench"]').waitFor();
    await agentRoomsTrigger.click();
    await shell.locator('#library[data-kind="agent-rooms"]').waitFor();
    await shell.locator('#close-library').focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.evaluate(() => document.activeElement.id),'show-agent-rooms','switching panels updates the focus restoration target');
    await shell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    await shell.locator('#library[data-kind="pi-workbench"]').waitFor();
    await shell.locator('#close-library').focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.evaluate(() => document.activeElement.id),'show-pi-workbench','closing Pi workbench restores focus to its sidebar control');
    await agentRoomsTrigger.click();
    await shell.getByText('当前 Profile 还没有 Agent Room。打开 Corvid Agent 后，可从当前网页创建工作区；发送页面内容前需要先检查并确认。').waitFor();

    const defaultRoom = await call('/rooms', 'POST', { name: 'Default agent room' });
    await shell.getByRole('button', { name: '查看 Default agent room' }).waitFor();
    assert.equal(await shell.getByText('Agent 控制中 · 1 个标签').isVisible(), true);
    await call('/rooms', 'POST', { name: 'Parallel agent room' });
    await shell.getByRole('button', { name: '查看 Parallel agent room' }).waitFor();

    const firstTaskRoom=await startTask(defaultRoom,'[fixture:hold] first parallel room task');
    assert.ok(firstTaskRoom?.roomId&&firstTaskRoom.taskId,'first deterministic task is bound to its own Agent Room');
    const parallelRoom=(await call('/rooms')).rooms.find(room=>room.name==='Parallel agent room');
    const secondTaskRoom=await startTask(parallelRoom,'[fixture:hold] second parallel room task');
    assert.ok(secondTaskRoom?.roomId&&secondTaskRoom.roomId!==firstTaskRoom.roomId,'parallel deterministic tasks belong to distinct Agent Rooms');
    await agentRoomsTrigger.click();
    await shell.getByRole('button',{name:/查看 Corvid Agent 对话：.*· 正在回复/}).first().waitFor();
    const visibleRoomSurface=await shell.locator('#library').evaluate(panel=>({text:panel.innerText,labels:[...panel.querySelectorAll('[aria-label],[title]')].flatMap(node=>[node.getAttribute('aria-label'),node.getAttribute('title')]).filter(Boolean)}));
    assert.doesNotMatch(`${visibleRoomSurface.text}\n${visibleRoomSurface.labels.join('\n')}`,/\bPi\b|pi-coding-agent/i,'Agent Room task statuses and accessible labels use Corvid product semantics');
    assert.equal(await shell.locator('.agent-room-task-state[data-status="running"]').count(),2,'parallel Agent Rooms expose their independent running task states');
    assert.equal(await shell.getByText('Agent 控制中 · 1 个标签').count(),2,'Room control state remains independently visible beside task state');
    assert.equal(await shell.getByText('[fixture:hold] first parallel room task',{exact:true}).count(),0,'task prompt text is not exposed in the Agent Room list');
    const firstOpen=shell.getByRole('button',{name:/查看 Corvid Agent 对话：.*· 正在回复/}).first();
    await firstOpen.click();
    await shell.locator('#library[data-kind="pi-workbench"]').waitFor();
    await shell.locator('.pi-task-entry').waitFor();
    assert.equal(await shell.locator('.pi-task-entry').getAttribute('data-task-id'),firstTaskRoom.taskId,'opening a Room task selects its existing conversation and task ID');
    await shell.getByRole('button',{name:'停止任务'}).click();
    await shell.locator('.pi-task-state[data-status="interrupted"]').waitFor();
    await agentRoomsTrigger.click();
    await shell.locator('.agent-room-task-state[data-status="interrupted"]').waitFor();
    await shell.getByRole('button',{name:'接管 Parallel agent room'}).click();
    await shell.locator('.agent-room-task-state[data-status="waiting_for_user"]').waitFor();
    await shell.getByRole('button',{name:'交还 Agent：Parallel agent room'}).click();
    await until(async()=>(await call('/rooms')).rooms.find(room=>room.id===parallelRoom.id)?.ownership==='agent');
    await shell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    const completedTask=await startTask(defaultRoom,'summarize fixture page','completed');
    assert.ok(completedTask.taskId);
    const failedTask=await startTask(parallelRoom,'[fixture:fail-once] simulated provider issue','failed');
    assert.ok(failedTask.taskId);
    await agentRoomsTrigger.click();
    await shell.locator('.agent-room-task-state[data-status="completed"]').waitFor();
    await shell.locator('.agent-room-task-state[data-status="failed"]').waitFor();

    const otherProfile = await call('/profiles', 'POST', { name: 'Work profile' });
    const otherRoom = await call('/rooms', 'POST', { name: 'Work agent room', profileId: otherProfile.id });
    await shell.getByRole('button', { name: '查看 Default agent room' }).waitFor();
    assert.equal(await shell.getByText('Work agent room', { exact: true }).count(), 0);

    await shell.getByLabel('Profile', { exact: true }).selectOption(otherProfile.id);
    await shell.getByRole('button', { name: '查看 Work agent room' }).waitFor();
    assert.equal(await shell.getByText('Default agent room', { exact: true }).count(), 0);
    assert.equal(await shell.getByText('Parallel agent room', { exact: true }).count(), 0);
    assert.equal(await shell.locator('.agent-room-task-state').count(),0,'other Profile cannot see the active Profile task state');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow().setSize(640, 600));
    await shell.waitForFunction(() => window.innerWidth <= 700);
    const panelLayout = await shell.locator('#library').evaluate(panel => {
      const row = panel.querySelector('.agent-room-entry');
      return { width: panel.clientWidth, scrollWidth: row.scrollWidth, rowWidth: row.clientWidth };
    });
    assert.ok(panelLayout.width > 0);
    assert.ok(panelLayout.scrollWidth <= panelLayout.rowWidth, JSON.stringify(panelLayout));

    const view = shell.getByRole('button', { name: '查看 Work agent room' });
    await view.focus();
    await shell.keyboard.press('Tab');
    assert.equal(await shell.evaluate(() => document.activeElement.getAttribute('aria-label')), '接管 Work agent room');
    await shell.keyboard.press('Enter');
    await until(async () => (await call('/rooms')).rooms.find(room => room.id === otherRoom.id)?.ownership === 'user');
    await shell.getByRole('button', { name: '交还 Agent：Work agent room' }).focus();
    await shell.keyboard.press('Enter');
    await until(async () => (await call('/rooms')).rooms.find(room => room.id === otherRoom.id)?.ownership === 'agent');

    const risky = await call('/tabs/' + otherRoom.tabs[0].id + '/action', 'POST', {
      operation: 'evaluate',
      args: { expression: 'new Promise(() => {})', timeoutMs: 100 },
    });
    assert.equal(risky.status, 'timed_out');
    await shell.getByRole('button', { name: '复核 Work agent room 的执行状态' }).waitFor();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
    await shell.getByRole('button', { name: '复核 Work agent room 的执行状态' }).click();
    const reviewed = (await call('/rooms')).rooms.find(room => room.id === otherRoom.id);
    assert.equal(reviewed.ownership, 'user');
    assert.ok(reviewed.executionRisk);
    await shell.getByText('页面执行状态未知 · 1 个标签').waitFor();

    await shell.getByRole('button', { name: '查看 Work agent room' }).click();
    await shell.locator('#library').waitFor({ state: 'hidden' });
    const active = await call('/rooms');
    assert.equal(active.activeRoomId, otherRoom.id);
    assert.equal(await shell.getByRole('button', { name: 'Work agent room' }).getAttribute('class').then(value => value.includes('selected')), true);

    console.log('PASS Agent Room panel empty state, parallel task status, exact conversation return, Profile filtering, narrow layout, keyboard handoff and Room activation');
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve=>site.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
