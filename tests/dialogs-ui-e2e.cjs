const {_electron}=require('playwright-core');const electron=require('electron');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-dialog-ui-'));const fixture=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<title>Dialog UI</title><button onclick="window.answer=prompt(\'Your name?\',\'initial\')">Ask</button>');});await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));let app;
try{app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dir,CORVID_TEST_MODE:'1'}});const shell=await app.firstWindow();let config;for(let i=0;i<200;i++){try{config=JSON.parse(fs.readFileSync(path.join(dir,'control.json')));break;}catch{await delay(25);}}assert.ok(config);
const call=async(method,route,body)=>{const response=await fetch(config.baseUrl+route,{method,headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
const room=await call('POST','/rooms',{name:'UI Dialog'});const tab=room.tabs[0];await call('POST',`/tabs/${tab.id}/navigate`,{url:`http://127.0.0.1:${fixture.address().port}/`});await call('POST',`/rooms/${room.id}/activate`,{});
for(let i=0;i<200;i++){const state=await call('GET','/rooms'),active=state.rooms.find(item=>item.id===room.id)?.tabs.find(item=>item.id===tab.id);if(active?.active&&active.loadComplete)break;if(i===199)throw new Error(`Page did not finish loading before the prompt action: ${JSON.stringify(active)}`);await delay(25);}
const click=call('POST',`/tabs/${tab.id}/action`,{operation:'click',args:{target:'button'}});
await shell.getByRole('button',{name:/网页对话框/}).click();assert.equal(await shell.locator('#page-dialog-message').textContent(),'Your name?');assert.equal(await shell.locator('#page-dialog-prompt').inputValue(),'initial');await shell.locator('#page-dialog-prompt').fill('human');await shell.locator('#page-dialog-form').getByRole('button',{name:'确定'}).click();await click;
const answer=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'window.answer'}});assert.equal(answer.value,'human');assert.equal((await call('GET','/rooms')).rooms.find(s=>s.id===room.id).ownership,'agent');
// Issue #218：page-dialog 标题头 + × 等价取消（prompt 收到 null）。
const qaDir=process.env.CORVID_DIALOG_UI_QA_DIR;
const assertDialogHeader=async(id,title)=>{const dialog=shell.locator(`#${id}`);assert.equal(await dialog.getAttribute('aria-labelledby'),`${id}-title`,`${id} points at its title`);assert.equal(await shell.getByRole('dialog',{name:title}).count()>0,true,`${id} exposes accessible name "${title}"`);assert.equal(await shell.locator(`#${id}-close`).getAttribute('aria-label'),'关闭对话框',`${id} close button is labelled`);};
const click2=call('POST',`/tabs/${tab.id}/action`,{operation:'click',args:{target:'button'}});
await shell.getByRole('button',{name:/网页对话框/}).click();
await shell.locator('#page-dialog[open]').waitFor();
await assertDialogHeader('page-dialog','页面请求');
if(qaDir){fs.mkdirSync(qaDir,{recursive:true});await shell.screenshot({path:path.join(qaDir,'issue-218-page-dialog-header.png')});}
await shell.locator('#page-dialog-close').click();await click2;
const cancelled=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'window.answer'}});assert.equal(cancelled.value,null,'× dismisses the page prompt like cancel');
const clickCancel=call('POST',`/tabs/${tab.id}/action`,{operation:'click',args:{target:'button'}});
await shell.getByRole('button',{name:/网页对话框/}).click();await shell.locator('#page-dialog[open]').waitFor();
await shell.locator('#page-dialog-dismiss').click();await clickCancel;
const buttonCancelled=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'window.answer'}});assert.equal(buttonCancelled.value,null,'cancel button returns null to the page prompt');
const clickEscape=call('POST',`/tabs/${tab.id}/action`,{operation:'click',args:{target:'button'}});
await shell.getByRole('button',{name:/网页对话框/}).click();await shell.locator('#page-dialog[open]').waitFor();
await shell.keyboard.press('Escape');await shell.locator('#page-dialog[open]').waitFor({state:'detached'});await clickEscape;
const escapeCancelled=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'window.answer'}});assert.equal(escapeCancelled.value,null,'Escape returns null to the page prompt without leaving it pending');
await call('DELETE',`/rooms/${room.id}`);
// Issue #218：统一对话框标题头——aria-labelledby 可访问名称与 × 关闭钮。
// 新建空间：标题头 + × 关闭。
await shell.locator('#create-room-trigger').click();
await shell.locator('#new-room[open]').waitFor();
await assertDialogHeader('new-room','新建空间');
await shell.locator('#new-room-close').click();
await shell.locator('#new-room').waitFor({state:'hidden'});
// 新建/重命名浏览身份：经浏览身份菜单打开。
await shell.locator('#profile-menu-trigger').click();
await shell.locator('#profile-menu button',{hasText:'新建浏览身份'}).first().click();
await shell.locator('#new-profile[open]').waitFor();
await assertDialogHeader('new-profile','新建浏览身份');
await shell.locator('#new-profile-close').click();
await shell.locator('#new-profile').waitFor({state:'hidden'});
await shell.locator('#profile-menu-trigger').click();
await shell.locator('#profile-menu button',{hasText:'重命名当前浏览身份'}).first().click();
await shell.locator('#rename-profile[open]').waitFor();
await assertDialogHeader('rename-profile','重命名当前浏览身份');
await shell.locator('#rename-profile-close').click();
await shell.locator('#rename-profile').waitFor({state:'hidden'});
console.log('PASS page prompt UI response, ownership and unified dialog headers');
}finally{if(app)await app.close().catch(()=>{});await new Promise(resolve=>fixture.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
