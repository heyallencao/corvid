const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const readSavedTasks = dataDir => {
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-tasks.json'), 'utf8'));
  return Array.isArray(saved) ? saved : saved.tasks;
};
const assertNoRuntimeBrandInVisibleAgentUi = async (page, surface) => {
  const content = await page.locator('body').evaluate(body => ({
    title: document.title,
    text: body.innerText,
    labels: [...body.querySelectorAll('[aria-label],[title]')]
      .flatMap(node => [node.getAttribute('aria-label'), node.getAttribute('title')])
      .filter(Boolean)
  }));
  assert.doesNotMatch(`${content.title}\n${content.text}\n${content.labels.join('\n')}`, /\bPi\b|pi-coding-agent/i, `${surface} must use Corvid product language`);
};

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-pi-workbench-'));
  const legacyPiDir = path.join(os.tmpdir(), `corvid-ignored-pi-dir-${process.pid}`);
  const site = http.createServer((_request, response) => response.end('<!doctype html><title>Corvid Fixture Page</title><h1>Fixture page content</h1><p>Only this page is shared.</p>'));
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  let app;
  try {
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: { ...process.env, PI_CODING_AGENT_DIR: legacyPiDir, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' } });
    const shell = await app.firstWindow();
    let control = await (async () => {
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

    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
    await assertNoRuntimeBrandInVisibleAgentUi(shell, 'Agent workbench');
    const ownedPiDir=path.join(dataDir,'pi-agent');
    assert.equal(fs.statSync(ownedPiDir).mode & 0o777,0o700,'Pi runtime configuration is stored in Corvid application data');
    assert.equal(fs.existsSync(legacyPiDir),false,'Corvid ignores a legacy Pi CLI directory environment variable');
    const modelSelect=shell.getByLabel('Corvid Agent 模型', { exact: true });
    await modelSelect.waitFor();
    await shell.getByRole('button', { name: '管理 Corvid Agent 模型', exact: true }).click();
    await shell.locator('#pi-model-settings[open]').waitFor();
    await assertNoRuntimeBrandInVisibleAgentUi(shell, 'model management dialog');
    await shell.getByRole('button', { name: '关闭模型设置' }).click();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('pi-auth-prompt', {
        id: 'corvid-auth-ui-brand-fixture',
        providerId: 'openai-codex',
        prompt: { type: 'text', message: 'Pi SDK requires an account sign in' },
      });
    });
    await shell.locator('#pi-auth-dialog[open]').waitFor();
    await assertNoRuntimeBrandInVisibleAgentUi(shell, 'model authorization dialog');
    assert.equal(await shell.locator('#pi-auth-message').innerText(), '请按步骤完成模型账号授权。', 'runtime-specific authorization instructions use Corvid guidance');
    await shell.locator('#pi-auth-cancel').click();
    await shell.locator('#pi-auth-dialog').waitFor({ state: 'hidden' });
    await assertNoRuntimeBrandInVisibleAgentUi(shell, 'cancelled model authorization flow');
    assert.ok(await modelSelect.locator('option').filter({hasText:'GPT-6 Luna'}).count());
    const codexModelValue=await modelSelect.locator('option').evaluateAll(options=>options.find(option=>option.textContent==='GPT-6 Luna'&&option.value.includes('openai-codex'))?.value);
    await modelSelect.selectOption(codexModelValue);
    await shell.waitForFunction(()=>document.querySelector('.pi-model-status')?.textContent.includes('未连接'),{timeout:5_000});
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir,'agent-model.json'),'utf8')),{providerId:'openai-codex',modelId:'gpt-6-luna'});
    await shell.getByRole('button', { name: '连接当前页面' }).click();
    await shell.getByText(/任务页面：Corvid Agent 对话/).waitFor();
    await shell.getByRole('textbox', { name: '描述要完成的浏览任务' }).fill('总结当前页面内容');
    await shell.getByRole('button', { name: '检查并预览页面上下文' }).click();
    await shell.getByText(/将分享给 Agent：/).waitFor();
    const consentPreview=await shell.locator('.pi-context').innerText();
    assert.match(consentPreview,/Corvid Fixture Page/);
    assert.match(consentPreview,/"items"/);
    const start = shell.getByRole('button', { name: '发送' });
    assert.equal(await start.isDisabled(), true, 'page context consent is required');
    await shell.getByLabel(/我已检查/).check();
    assert.equal(await start.isDisabled(), false);
    await start.click();
    await shell.getByText('这是本地确定性 Agent fixture 第 1 轮回复。没有调用真实模型。').waitFor();
    await shell.locator('.pi-task-title').getByText('总结当前页面内容').waitFor();
    assert.equal(await shell.locator('.pi-task-state').textContent(),'已完成','task state is shown separately from its target page and runtime');
    assert.match(await shell.locator('.pi-task-context').textContent(),/Corvid Agent · Corvid Fixture Page/);
    assert.doesNotMatch(await shell.locator('.pi-task-context').textContent(),/\bPi\b/i,'task context describes the Corvid product, not its runtime');

    const savedTasks = readSavedTasks(dataDir);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-tasks.json'), 'utf8')).schemaVersion, 2, 'task state is persisted in the versioned Corvid envelope');
    assert.equal(savedTasks.length, 1);
    assert.equal(savedTasks[0].status, 'completed');
    assert.equal(savedTasks[0].page.url, sourceUrl);
    assert.equal(savedTasks[0].profileId, activeRoom.profileId);
    assert.notEqual(savedTasks[0].roomId, activeRoom.id, 'task gets its own Agent Room');
    assert.match(savedTasks[0].output, /没有调用真实模型/);
    const originalTaskId=savedTasks[0].id,originalRoomId=savedTasks[0].roomId,originalTranscript=savedTasks[0].sessionRef?.data?.sessionFile;
    assert.ok(originalTranscript&&fs.existsSync(originalTranscript));
    await shell.getByRole('button',{name:'继续对话'}).click();
    await shell.getByRole('textbox',{name:'继续这项浏览任务'}).fill('请用一句话补充结论');
    await shell.getByRole('button',{name:'检查页面内容'}).click();
    await shell.getByText(/将分享给 Agent：/).waitFor();
    await shell.getByLabel(/我已检查/).check();
    await shell.getByRole('button',{name:'发送'}).click();
    await shell.getByText('这是本地确定性 Agent fixture 第 2 轮回复。没有调用真实模型。').waitFor();
    const afterFollowup=readSavedTasks(dataDir)[0];
    assert.equal(afterFollowup.id,originalTaskId);
    assert.equal(afterFollowup.roomId,originalRoomId);
    assert.equal(afterFollowup.sessionRef?.data?.sessionFile,originalTranscript);
    assert.equal(afterFollowup.conversation.length,4);
    assert.equal(afterFollowup.conversation[2].text,'请用一句话补充结论');
    for(let i=0;i<6;i++){
      await shell.getByRole('button',{name:/新建对话/}).click();
      await shell.getByRole('button',{name:'连接当前页面'}).click();
      const prompt=`历史任务 ${i+1}：提炼页面要点`;
      await shell.getByRole('textbox',{name:'描述要完成的浏览任务'}).fill(prompt);
      await shell.getByRole('button',{name:'检查并预览页面上下文'}).click();
      await shell.getByLabel(/我已检查/).check();
      await shell.getByRole('button',{name:'发送'}).click();
      await shell.locator('.pi-task-title').getByText(prompt).waitFor();
    }
    await shell.getByRole('button',{name:'对话历史'}).click();
    const history=shell.locator('#pi-chat-history');
    assert.equal(await history.locator('.pi-history-item').count(),7,'history lists each conversation once');
    const historySize=await history.evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight}));
    assert.ok(historySize.scroll>=historySize.client,'conversation history remains inside its own bounded scroll area');
    await history.evaluate(el=>{el.scrollTop=0;});
    await shell.getByRole('button',{name:'对话历史'}).click();
    const [workspaceBox,composerBox]=await Promise.all([shell.locator('#pi-workbench-content').boundingBox(),shell.locator('#pi-task-form').boundingBox()]);
    assert.ok(composerBox.y>=workspaceBox.y&&composerBox.y+composerBox.height<=workspaceBox.y+workspaceBox.height,'Pi task composer stays visible while task history scrolls');
    await shell.screenshot({path:path.join(os.tmpdir(),'corvid-pi-workbench-history.png')});
    await shell.getByRole('button',{name:/新建对话/}).click();
    await shell.getByRole('button',{name:'连接当前页面'}).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700,420));
    await delay(150);
    const narrowModelControls=await shell.locator('#pi-task-form').evaluate(form=>{
      const visible=element=>{const box=element.getBoundingClientRect(),clip=form.getBoundingClientRect();return box.height>0&&box.top>=clip.top&&box.bottom<=clip.bottom;};
      const controls=form.querySelector('.pi-model-controls'),controlsBox=controls.getBoundingClientRect(),prompt=form.querySelector('#pi-task-prompt'),promptBox=prompt.getBoundingClientRect();
      return {page:visible(form.querySelector('.pi-page-binding')),select:visible(form.querySelector('.pi-model-select')),status:visible(form.querySelector('.pi-model-status')),action:visible(form.querySelector('.pi-model-action')),prompt:visible(prompt),preview:visible(form.querySelector('.pi-secondary-action')),clearance:Math.round(promptBox.top-controlsBox.bottom),formHeight:form.clientHeight,formScrollHeight:form.scrollHeight};
    });
    assert.ok(narrowModelControls.page&&narrowModelControls.select&&narrowModelControls.status&&narrowModelControls.action&&narrowModelControls.prompt&&narrowModelControls.preview&&narrowModelControls.clearance>=1,`page source, selected model, account action, prompt and page review stay visible without overlap: ${JSON.stringify(narrowModelControls)}`);
    const apiKeyModelValue=await modelSelect.locator('option').evaluateAll(options=>options.find(option=>option.value.includes('"providerId":"anthropic"'))?.value);
    await modelSelect.selectOption(apiKeyModelValue);
    const apiKeyControlsVisible=await shell.locator('#pi-task-form').evaluate(form=>{
      const visible=element=>{const box=element.getBoundingClientRect(),clip=form.getBoundingClientRect();return box.height>0&&box.top>=clip.top&&box.bottom<=clip.bottom;};
      return {field:visible(form.querySelector('.pi-model-key')),action:Array.from(form.querySelectorAll('.pi-model-action')).some(visible)};
    });
    assert.ok(apiKeyControlsVisible.field&&apiKeyControlsVisible.action,'API Key entry and save action remain visible in the short workspace');
    await modelSelect.selectOption(codexModelValue);
    const narrowPrompt='窄窗口中启动 Pi 任务';
    await shell.getByRole('textbox',{name:'描述要完成的浏览任务'}).fill(narrowPrompt);
    await shell.getByRole('button',{name:'检查并预览页面上下文'}).click();
    await shell.getByText(/将分享给 Agent：/).waitFor();
    await shell.getByLabel(/我已检查/).check();
    await shell.getByRole('button',{name:'发送'}).click();
    await shell.locator('.pi-task-title').getByText(narrowPrompt).waitFor();
    await shell.screenshot({path:path.join(os.tmpdir(),'corvid-pi-workbench-narrow.png')});
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280,850));
    await app.close(); app=null;
    afterFollowup.status='running';afterFollowup.conversation[3].status='running';fs.writeFileSync(path.join(dataDir,'agent-tasks.json'),JSON.stringify([afterFollowup]),{mode:0o600});
    app=await _electron.launch({executablePath:electronPath,args:[project],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});
    let restoredShell=await app.firstWindow();
    control=await (async()=>{for(let i=0;i<200;i++){try{return JSON.parse(fs.readFileSync(path.join(dataDir,'control.json'),'utf8'));}catch{await delay(25);}}throw new Error('Corvid control service did not restart');})();
    await restoredShell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    await restoredShell.getByText(/等待检查/).waitFor();
    const restored=readSavedTasks(dataDir)[0];
    assert.equal(restored.status,'interrupted');
    assert.equal(restored.roomId,savedTasks[0].roomId);
    await restoredShell.getByRole('button',{name:'继续对话'}).click();
    await restoredShell.getByRole('textbox',{name:'继续这项浏览任务'}).fill('从中断处继续');
    await restoredShell.getByRole('button',{name:'检查页面内容'}).click();
    await restoredShell.getByLabel(/我已检查/).check();
    await restoredShell.getByRole('button',{name:'发送'}).click();
    await restoredShell.getByText('这是本地确定性 Agent fixture 第 3 轮回复。没有调用真实模型。').waitFor();
    assert.equal(readSavedTasks(dataDir)[0].id,originalTaskId);
    await restoredShell.getByRole('button',{name:'移除记录'}).click();
    assert.deepEqual(readSavedTasks(dataDir),[]);
    assert.equal(fs.existsSync(path.join(dataDir,'agent-sessions',restored.id.replaceAll('-','_'))),false,'removing a task also deletes its private Pi transcript directory');

    const transcriptTask={...savedTasks[0],status:'completed',prompt:'总结当前页面内容',output:'这是之前保存的摘要。',conversation:[{role:'user',text:'总结当前页面内容'},{role:'assistant',text:'这是之前保存的摘要。',status:'completed'}],sessionRef:{runtimeId:'retired-runtime',runtimeVersion:'9.0.0',data:{handle:'opaque-retired-session'}}};
    await app.close();app=null;
    fs.writeFileSync(path.join(dataDir,'agent-tasks.json'),JSON.stringify({schemaVersion:2,tasks:[transcriptTask]}),{mode:0o600});
    app=await _electron.launch({executablePath:electronPath,args:[project],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});
    const migrationShell=await app.firstWindow();
    restoredShell=migrationShell;
    control=await (async()=>{for(let i=0;i<200;i++){try{return JSON.parse(fs.readFileSync(path.join(dataDir,'control.json'),'utf8'));}catch{await delay(25);}}throw new Error('Corvid control service did not restart for transcript continuation');})();
    await migrationShell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    const transcriptCard=migrationShell.locator('.pi-task-entry').filter({hasText:'这是之前保存的摘要。'});
    await transcriptCard.waitFor({timeout:5_000}).catch(async()=>{throw new Error(`Transcript task was not rendered: ${await migrationShell.locator('#pi-task-list').innerText()} | stored: ${JSON.stringify(readSavedTasks(dataDir))}`)});
    await transcriptCard.getByRole('button',{name:'从已保存对话继续'}).click({timeout:5_000});
    await migrationShell.getByText(/最近最多 40 条对话消息（最多 24,000 个字符）/).waitFor();
    await migrationShell.getByRole('textbox',{name:'继续这项浏览任务'}).fill('请补充一句结论');
    await migrationShell.getByRole('button',{name:'检查页面内容'}).click();
    await migrationShell.getByLabel(/我已检查/).check();
    await migrationShell.getByRole('button',{name:'发送'}).click();
    await transcriptCard.getByText('这是本地确定性 Agent fixture 第 1 轮回复。没有调用真实模型。').waitFor();
    await transcriptCard.locator('.pi-task-state[data-status="completed"]').waitFor();
    const migratedConversation=readSavedTasks(dataDir)[0];
    assert.equal(migratedConversation.id,transcriptTask.id,'transcript continuation keeps the original Corvid task ID');
    assert.equal(migratedConversation.conversation[1].text,'这是之前保存的摘要。','the prior Corvid transcript remains visible');
    assert.equal(migratedConversation.conversation.at(-2).text,'请补充一句结论');
    assert.equal(migratedConversation.sessionRef.runtimeId,'pi','the new runtime creates a fresh private checkpoint');
    assert.doesNotMatch(await transcriptCard.innerText(),/retired-runtime|opaque-retired-session|\bPi\b/i,'the recovery path describes the Corvid conversation, not a runtime switch');
    await transcriptCard.getByRole('button',{name:'移除记录'}).click();
    assert.deepEqual(readSavedTasks(dataDir),[]);

    await restoredShell.getByRole('button',{name:/新建对话/}).click();
    await restoredShell.getByRole('button',{name:'连接当前页面'}).click();
    await restoredShell.getByRole('textbox',{name:'描述要完成的浏览任务'}).fill('[fixture:fail-once] 模拟 Provider 断连');
    await restoredShell.getByRole('button',{name:'检查并预览页面上下文'}).click();
    await restoredShell.getByLabel(/我已检查/).check();
    await restoredShell.getByRole('button',{name:'发送'}).click();
    const failedCard=restoredShell.locator('.pi-task-entry').filter({hasText:'[fixture:fail-once] 模拟 Provider 断连'});
    await failedCard.locator('.pi-task-state[data-status="failed"]').waitFor();
    const failedTask=readSavedTasks(dataDir)[0];
    assert.equal(failedTask.status,'failed');
    assert.ok(failedTask.sessionRef?.data?.sessionFile&&fs.existsSync(failedTask.sessionRef.data.sessionFile),'failed prompt keeps the task transcript available for an explicit recovery attempt');
    assert.equal(await failedCard.locator('[role="alert"]').count(),1,'one failure reason is announced once');
    await failedCard.getByRole('button',{name:'检查上下文并恢复'}).click();
    await restoredShell.getByRole('textbox',{name:'继续这项浏览任务'}).fill('重新确认页面后完成任务');
    await restoredShell.getByRole('button',{name:'检查页面内容'}).click();
    await restoredShell.getByText(/将分享给 Agent：/).waitFor();
    await restoredShell.getByLabel(/我已检查/).check();
    await restoredShell.getByRole('button',{name:'发送'}).click();
    await failedCard.locator('.pi-task-state[data-status="completed"]').waitFor();
    const recoveredTask=readSavedTasks(dataDir)[0];
    assert.equal(recoveredTask.id,failedTask.id);
    assert.deepEqual(recoveredTask.sessionRef,failedTask.sessionRef);
    await failedCard.getByRole('button',{name:'移除记录'}).click();
    assert.deepEqual(readSavedTasks(dataDir),[]);

    await restoredShell.getByRole('textbox',{name:'描述要完成的浏览任务'}).fill('[fixture:runtime-name-leak] 模拟运行时错误');
    await restoredShell.getByRole('button',{name:'检查并预览页面上下文'}).click();
    await restoredShell.getByLabel(/我已检查/).check();
    await restoredShell.getByRole('button',{name:'发送'}).click();
    const runtimeErrorCard=restoredShell.locator('.pi-task-entry').filter({hasText:'[fixture:runtime-name-leak] 模拟运行时错误'});
    await runtimeErrorCard.locator('.pi-task-state[data-status="failed"]').waitFor();
    assert.match(await runtimeErrorCard.locator('.pi-task-error').innerText(),/Agent 未能完成此轮对话，请检查模型连接后重试/);
    assert.doesNotMatch(await runtimeErrorCard.innerText(),/\bPi\b|pi-coding-agent/i,'runtime-specific errors are translated into Corvid product language');
    await runtimeErrorCard.getByRole('button',{name:'移除记录'}).click();
    assert.deepEqual(readSavedTasks(dataDir),[]);

    await app.close();app=null;
    app=await _electron.launch({executablePath:electronPath,args:[project],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_TEST_PI_INIT_FAILURE_ONCE:'1',CORVID_PORT:'0'}});
    restoredShell=await app.firstWindow();
    control=await (async()=>{for(let i=0;i<200;i++){try{return JSON.parse(fs.readFileSync(path.join(dataDir,'control.json'),'utf8'));}catch{await delay(25);}}throw new Error('Corvid control service did not restart for the no-transcript fixture');})();
    await restoredShell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    await restoredShell.getByRole('button',{name:'连接当前页面'}).click();
    await restoredShell.getByRole('textbox',{name:'描述要完成的浏览任务'}).fill('[fixture:init-fail] 无 transcript 的恢复说明');
    await restoredShell.getByRole('button',{name:'检查并预览页面上下文'}).click();
    await restoredShell.getByLabel(/我已检查/).check();
    await restoredShell.getByRole('button',{name:'发送'}).click();
    const noTranscriptCard=restoredShell.locator('.pi-task-entry').filter({hasText:'[fixture:init-fail] 无 transcript 的恢复说明'});
    await noTranscriptCard.locator('.pi-task-state[data-status="failed"]').waitFor();
    const noTranscriptTask=readSavedTasks(dataDir)[0];
    assert.equal(noTranscriptTask.status,'failed');
    assert.ok(!noTranscriptTask.sessionRef,'a session initialization failure has no runtime checkpoint to resume');
    await noTranscriptCard.getByText(/尚无可恢复记录/).waitFor();
    assert.equal(await noTranscriptCard.getByRole('button',{name:'检查上下文并恢复'}).count(),0,'a task without a transcript does not offer a false continuation action');
    await restoredShell.locator('#pi-task-list').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await noTranscriptCard.getByRole('button',{name:'移除记录'}).click();
    assert.deepEqual(readSavedTasks(dataDir),[]);

    await app.close();app=null;
    app=await _electron.launch({executablePath:electronPath,args:[project],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});
    restoredShell=await app.firstWindow();
    control=await (async()=>{for(let i=0;i<200;i++){try{return JSON.parse(fs.readFileSync(path.join(dataDir,'control.json'),'utf8'));}catch{await delay(25);}}throw new Error('Corvid control service did not restart before the handoff fixture');})();
    await restoredShell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    await restoredShell.getByRole('button',{name:'连接当前页面'}).click();
    await restoredShell.getByRole('textbox',{name:'描述要完成的浏览任务'}).fill('[fixture:hold] 等待用户接管后继续');
    await restoredShell.getByRole('button',{name:'检查并预览页面上下文'}).click();
    await restoredShell.getByLabel(/我已检查/).check();
    await restoredShell.getByRole('button',{name:'发送'}).click();
    await restoredShell.locator('.pi-task-state[data-status="running"]').waitFor();
    let handoffTask=readSavedTasks(dataDir)[0];
    const handoffTaskId=handoffTask.id,handoffRoomId=handoffTask.roomId,handoffTabId=handoffTask.tabId,handoffTranscript=handoffTask.sessionRef?.data?.sessionFile;
    await restoredShell.getByRole('button',{name:'打开空间'}).click();
    await restoredShell.getByRole('button',{name:'接管',exact:true}).click();
    await restoredShell.locator('.pi-task-event').getByText(/你已接管此空间；Agent 已暂停/).waitFor();
    assert.equal(await restoredShell.locator('.pi-task-state').textContent(),'等待你接管');
    assert.equal(await restoredShell.locator('.pi-task-control-state').textContent(),'用户控制中');
    handoffTask=readSavedTasks(dataDir)[0];
    assert.equal(handoffTask.status,'waiting_for_user');
    let controlledState=await (await fetch(control.baseUrl+'/rooms',{headers:{authorization:`Bearer ${control.token}`}})).json();
    assert.equal(controlledState.rooms.find(room=>room.id===handoffRoomId).ownership,'user');
    const afterHandoffUrl=`http://127.0.0.1:${site.address().port}/after-handoff`;
    await restoredShell.getByLabel('地址或搜索').fill(afterHandoffUrl);
    await restoredShell.getByLabel('地址或搜索').press('Enter');
    await (async()=>{for(let i=0;i<200;i++){controlledState=await (await fetch(control.baseUrl+'/rooms',{headers:{authorization:`Bearer ${control.token}`}})).json();if(controlledState.rooms.flatMap(room=>room.tabs).some(tab=>tab.id===handoffTabId&&tab.url===afterHandoffUrl))return;await delay(25);}throw new Error('User page navigation did not complete');})();
    await restoredShell.getByRole('button',{name:'交还 Agent',exact:true}).click();
    await (async()=>{for(let i=0;i<200;i++){controlledState=await (await fetch(control.baseUrl+'/rooms',{headers:{authorization:`Bearer ${control.token}`}})).json();if(controlledState.rooms.find(room=>room.id===handoffRoomId)?.ownership==='agent')return;await delay(25);}throw new Error('Room control was not returned to Pi');})();
    await restoredShell.getByRole('button',{name:'继续对话'}).click();
    await restoredShell.getByRole('textbox',{name:'继续这项浏览任务'}).fill('结合我刚才切换到的页面继续任务');
    await restoredShell.getByRole('button',{name:'检查页面内容'}).click();
    await restoredShell.getByText(afterHandoffUrl).waitFor();
    await restoredShell.getByLabel(/我已检查/).check();
    await restoredShell.getByRole('button',{name:'发送'}).click();
    await restoredShell.getByText('这是本地确定性 Agent fixture 第 2 轮回复。没有调用真实模型。').waitFor();
    const resumedTask=readSavedTasks(dataDir)[0];
    assert.equal(resumedTask.id,handoffTaskId);
    assert.equal(resumedTask.roomId,handoffRoomId);
    assert.equal(resumedTask.tabId,handoffTabId);
    assert.equal(resumedTask.sessionRef?.data?.sessionFile,handoffTranscript);
    console.log('PASS Pi workbench context consent, multi-turn transcript and restart recovery, user handoff and same-task continuation');
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => site.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
