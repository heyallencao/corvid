const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-pi-workbench-'));
  const site = http.createServer((_request, response) => response.end('<!doctype html><title>Corvid Fixture Page</title><h1>Fixture page content</h1><p>Only this page is shared.</p>'));
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  let app;
  try {
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' } });
    const shell = await app.firstWindow();
    const control = await (async () => {
      for (let i = 0; i < 200; i++) { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); } catch { await delay(25); } }
      throw new Error('Corvid control service did not start');
    })();
    const stateResponse = await fetch(control.baseUrl + '/rooms', { headers: { authorization: `Bearer ${control.token}` } });
    const state = await stateResponse.json();
    const activeRoom = state.rooms.find(room => room.id === state.activeRoomId);
    const sourceUrl = `http://127.0.0.1:${site.address().port}/`;
    await shell.getByLabel('地址或搜索').fill(sourceUrl);
    await shell.getByLabel('地址或搜索').press('Enter');
    await (async()=>{for(let i=0;i<200;i++){const response=await fetch(control.baseUrl+'/rooms',{headers:{authorization:`Bearer ${control.token}`}});const latest=await response.json();if(latest.rooms.flatMap(room=>room.tabs).some(tab=>tab.url===sourceUrl))return;await delay(25);}throw new Error('Fixture page did not navigate');})();

    await shell.getByRole('button', { name: 'Pi Agent 工作台' }).click();
    await shell.getByRole('button', { name: '为当前页创建 Pi Room' }).click();
    await shell.getByText(/任务页面：Pi Agent 任务/).waitFor();
    await shell.getByRole('textbox', { name: '描述要完成的浏览任务' }).fill('总结当前页面内容');
    await shell.getByRole('button', { name: '检查并预览页面上下文' }).click();
    await shell.getByText(/Pi 将收到：/).waitFor();
    const consentPreview=await shell.locator('.pi-context').innerText();
    assert.match(consentPreview,/Corvid Fixture Page/);
    assert.match(consentPreview,/"items"/);
    const start = shell.getByRole('button', { name: '启动 Pi Agent' });
    assert.equal(await start.isDisabled(), true, 'page context consent is required');
    await shell.getByLabel(/我已检查以上内容/).check();
    assert.equal(await start.isDisabled(), false);
    await start.click();
    await shell.getByText('这是本地确定性 Agent fixture。此结果没有调用真实模型。').waitFor();
    await shell.getByText(/已完成 · 本地确定性 fixture（无真实模型） · Corvid Fixture Page/).waitFor();

    const savedTasks = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-tasks.json'), 'utf8'));
    assert.equal(savedTasks.length, 1);
    assert.equal(savedTasks[0].status, 'completed');
    assert.equal(savedTasks[0].page.url, sourceUrl);
    assert.equal(savedTasks[0].profileId, activeRoom.profileId);
    assert.notEqual(savedTasks[0].roomId, activeRoom.id, 'task gets its own Agent Room');
    assert.match(savedTasks[0].output, /没有调用真实模型/);
    await app.close(); app=null;
    savedTasks[0].status='running'; fs.writeFileSync(path.join(dataDir,'agent-tasks.json'),JSON.stringify(savedTasks),{mode:0o600});
    app=await _electron.launch({executablePath:electronPath,args:[project],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});
    const restoredShell=await app.firstWindow();
    await restoredShell.getByRole('button',{name:'Pi Agent 工作台'}).click();
    await restoredShell.getByText(/结果待检查/).waitFor();
    const restored=JSON.parse(fs.readFileSync(path.join(dataDir,'agent-tasks.json'),'utf8'))[0];
    assert.equal(restored.status,'interrupted');
    assert.equal(restored.roomId,savedTasks[0].roomId);
    const transcriptDir=path.join(dataDir,'agent-sessions',restored.id.replaceAll('-','_'));
    fs.mkdirSync(transcriptDir,{recursive:true});fs.writeFileSync(path.join(transcriptDir,'fixture-session.jsonl'),'fixture');
    await restoredShell.getByRole('button',{name:'移除记录'}).click();
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir,'agent-tasks.json'),'utf8')),[]);
    assert.equal(fs.existsSync(transcriptDir),false,'removing a task also deletes its private Pi transcript directory');
    console.log('PASS Pi workbench page consent, isolated Agent Room, deterministic streaming fixture, visible completion and persisted task binding');
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => site.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
