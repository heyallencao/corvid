const { _electron }=require('playwright-core');
const electronPath=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');

const project=path.resolve(__dirname,'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-profile-delete-'));
  const dataDir=path.join(root,'data'),downloadDir=path.join(root,'downloads');
  fs.mkdirSync(downloadDir);
  const server=http.createServer((req,res)=>{
    if(req.url==='/download'){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename=kept-file.txt'});res.end('keep after profile deletion');return;}
    res.setHeader('Content-Type','text/html');
    if(req.url==='/profile'){res.setHeader('Set-Cookie','deletionFixture=present; Max-Age=3600; Path=/; SameSite=Lax');res.end('<title>Profile deletion fixture</title><script>localStorage.setItem("deletionFixture","present")</script>');return;}
    res.end('<title>Profile deletion fixture check</title>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const fixtureUrl=`http://127.0.0.1:${server.address().port}/profile`;
  let app;
  async function start(){
    app=await _electron.launch({executablePath:electronPath,args:[project],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_PORT:'0',CORVID_TEST_MODE:'1',CORVID_TEST_DOWNLOAD_DIR:downloadDir,CORVID_TEST_PROFILE_DELETE_STORAGE_FAIL_ONCE:'1'}});
    const shell=await app.firstWindow();let config;
    for(let i=0;i<200;i++){try{config=JSON.parse(fs.readFileSync(path.join(dataDir,'control.json')));break;}catch{await delay(50);}}
    assert.ok(config,'isolated Corvid control endpoint starts');
    const call=async(route,method='GET',body)=>{const response=await fetch(config.baseUrl+route,{method,headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error),{code:result.code});return result;};
    return {shell,call};
  }
  async function stop(){await app.close();app=undefined;}
  try{
    let {shell,call}=await start();
    await shell.getByRole('button',{name:'浏览身份选项'}).click();
    await shell.getByRole('menuitem',{name:'新建浏览身份'}).click();
    await shell.locator('#profile-name').fill('删除验收');
    await shell.getByRole('button',{name:'新建浏览身份'}).click();
    await shell.locator('#profile-select').selectOption({label:'删除验收'});
    const profile=(await call('/profiles')).profiles.find(item=>item.name==='删除验收');
    assert.ok(profile&&profile.id!=='default');
    const room=await call('/rooms','POST',{name:'待删除空间',profileId:profile.id});
    await call(`/tabs/${room.tabs[0].id}/action`,'POST',{operation:'navigate',args:{url:fixtureUrl}});
    for(let i=0;i<100;i++){const tab=(await call('/rooms')).rooms.find(item=>item.id===room.id)?.tabs[0];if(tab?.title==='Profile deletion fixture')break;await delay(50);}
    const tab=(await call('/rooms')).rooms.find(item=>item.id===room.id).tabs[0];
    assert.match((await call(`/tabs/${tab.id}/action`,'POST',{operation:'evaluate',args:{expression:'document.cookie'}})).value,/deletionFixture=present/);
    assert.equal((await call(`/tabs/${tab.id}/action`,'POST',{operation:'evaluate',args:{expression:'localStorage.getItem("deletionFixture")'}})).value,'present');
    await call('/bookmarks','POST',{url:fixtureUrl,title:'fixture bookmark'});
    for(let i=0;i<100;i++){const history=(await call('/history')).history;if(history.some(item=>item.profileId===profile.id))break;await delay(50);}
    assert.ok((await call('/history')).history.some(item=>item.profileId===profile.id),'fixture navigation is recorded under the profile');
    await call(`/tabs/${tab.id}/action`,'POST',{operation:'navigate',args:{url:`${new URL(fixtureUrl).origin}/download`}}).catch(()=>{});
    let downloads=[];for(let i=0;i<100;i++){downloads=(await call('/downloads')).downloads;if(downloads.some(item=>item.status==='completed'))break;await delay(50);}
    const downloaded=downloads.find(item=>item.status==='completed');assert.ok(downloaded,'fixture download completes before profile deletion');
    const downloadedPath=path.join(downloadDir,downloaded.filename);
    assert.equal(fs.readFileSync(downloadedPath,'utf8'),'keep after profile deletion');
    await shell.getByRole('button',{name:'浏览身份选项'}).click();
    await shell.getByRole('menuitem',{name:'删除浏览身份'}).click();
    assert.equal(await shell.locator('#profile-deletion-select option[value="default"]').count(),0,'default profile is never offered for deletion');
    await shell.locator('#profile-deletion-select').selectOption(profile.id);
    await shell.waitForTimeout(600);
    const previewText=await shell.locator('#profile-deletion-impact').innerText();
    if(!previewText.includes('待删除空间'))throw new Error(`Profile deletion preview did not include room blocker: ${previewText}`);
    if(process.env.CORVID_PROFILE_DELETE_QA_DIR){fs.mkdirSync(process.env.CORVID_PROFILE_DELETE_QA_DIR,{recursive:true});await shell.screenshot({path:path.join(process.env.CORVID_PROFILE_DELETE_QA_DIR,'profile-deletion-blocked-zh-CN.png')});}
    assert.equal((await call('/profiles')).profiles.some(item=>item.id===profile.id),true,'a blocked preview leaves the profile intact');
    await shell.locator('#cancel-profile-deletion').click();
    await shell.locator('#profile-select').selectOption('default');
    await call(`/rooms/${room.id}`,'DELETE');
    await shell.getByRole('button',{name:'浏览身份选项'}).click();
    await shell.getByRole('menuitem',{name:'删除浏览身份'}).click();
    await shell.locator('#profile-deletion-select').selectOption(profile.id);
    await shell.getByRole('button',{name:'删除浏览身份',exact:true}).click();
    try{await shell.waitForFunction(()=>document.querySelector('#profile-deletion-form')?.getAttribute('aria-busy')==='true'&&document.querySelector('#confirm-profile-deletion')?.textContent==='正在清理…',null,{timeout:1500});}
    catch{const state=await shell.evaluate(()=>({busy:document.querySelector('#profile-deletion-form')?.getAttribute('aria-busy'),button:document.querySelector('#confirm-profile-deletion')?.textContent,disabled:document.querySelector('#confirm-profile-deletion')?.disabled,cancelDisabled:document.querySelector('#cancel-profile-deletion')?.disabled,error:document.querySelector('#profile-deletion-error')?.textContent,impact:document.querySelector('#profile-deletion-impact')?.textContent}));throw new Error(`Cleanup did not expose its in-flight state: ${JSON.stringify(state)}`);}
    assert.equal(await shell.locator('#confirm-profile-deletion').innerText(),'正在清理…','the destructive action communicates ongoing cleanup');
    assert.equal(await shell.locator('#cancel-profile-deletion').isDisabled(),true,'cancellation is unavailable after destructive cleanup begins');
    await shell.keyboard.press('Escape');
    assert.equal(await shell.locator('#profile-deletion').evaluate(dialog=>dialog.open),true,'Escape cannot hide an in-flight cleanup');
    await shell.locator('#profile-deletion-error').getByText('清理未完成', {exact:false}).waitFor();
    assert.equal((await call('/profiles')).profiles.find(item=>item.id===profile.id).deletionPending,true,'failed cleanup retains a retryable profile record');
    assert.equal(await shell.locator('#confirm-profile-deletion').innerText(),'重试清理','the UI offers an explicit retry');
    await shell.locator('#confirm-profile-deletion').click();
    await shell.locator('#profile-deletion').waitFor({state:'hidden'});
    assert.equal((await call('/profiles')).profiles.some(item=>item.id===profile.id),false,'successful deletion removes the profile record');
    const library=JSON.parse(fs.readFileSync(path.join(dataDir,'library.json'),'utf8'));
    assert.equal(library.bookmarks.some(item=>item.profileId===profile.id),false,'profile bookmarks are removed');
    assert.equal(library.history.some(item=>item.profileId===profile.id),false,'profile history is removed');
    assert.equal(fs.existsSync(downloadedPath),true,'downloaded files stay on disk after profile deletion');
    assert.equal(library.downloads.some(item=>item.profileId===profile.id),false,'profile download records are removed');
    assert.equal((await call('/rooms')).rooms.some(item=>item.profileId===profile.id),false,'closed profile rooms do not return');
    await stop();
    ({shell,call}=await start());
    assert.equal((await call('/profiles')).profiles.some(item=>item.id===profile.id),false,'deleted profile does not return after restart');
    await shell.getByRole('button',{name:'浏览身份选项'}).click();
    await shell.getByRole('menuitem',{name:'新建浏览身份'}).click();
    await shell.locator('#profile-name').fill('删除验收');
    await shell.getByRole('button',{name:'新建浏览身份'}).click();
    const replacementProfile=(await call('/profiles')).profiles.find(item=>item.name==='删除验收');
    assert.ok(replacementProfile&&replacementProfile.id!==profile.id,'a same-name profile receives a fresh ID');
    const replacement=await call('/rooms','POST',{name:'同名身份空白检查',profileId:replacementProfile.id});
    const checkUrl=`${new URL(fixtureUrl).origin}/check`;
    await call(`/tabs/${replacement.tabs[0].id}/action`,'POST',{operation:'navigate',args:{url:checkUrl}});
    for(let i=0;i<100;i++){const tabs=(await call('/rooms')).rooms.find(item=>item.id===replacement.id)?.tabs;if(tabs?.[0]?.title==='Profile deletion fixture check')break;await delay(50);}
    const replacementTab=(await call('/rooms')).rooms.find(item=>item.id===replacement.id).tabs[0];
    assert.equal((await call(`/tabs/${replacementTab.id}/action`,'POST',{operation:'evaluate',args:{expression:'document.cookie'}})).value,'','a same-name profile does not reuse deleted Cookie data');
    assert.equal((await call(`/tabs/${replacementTab.id}/action`,'POST',{operation:'evaluate',args:{expression:'localStorage.getItem("deletionFixture")'}})).value,null,'a same-name profile does not reuse deleted site storage');
    await shell.locator('#show-settings').click();
    await shell.locator('#ui-locale').selectOption('en');
    await shell.locator('#profile-menu-trigger').waitFor();
    await shell.locator('#cancel-settings').click();
    await shell.locator('#profile-menu-trigger').click();
    await shell.getByRole('menuitem',{name:'Delete a browsing profile…'}).click();
    await shell.locator('#profile-deletion-title').getByText('Delete browsing profile').waitFor();
    assert.match(await shell.locator('#profile-deletion-impact').innerText(),/A window is using this profile/,'English deletion state is rendered in the real app');
    await shell.setViewportSize({width:700,height:420});
    if(process.env.CORVID_PROFILE_DELETE_QA_DIR)await shell.screenshot({path:path.join(process.env.CORVID_PROFILE_DELETE_QA_DIR,'profile-deletion-blocked-en-700x420.png')});
    const compactDialog=await shell.locator('#profile-deletion').boundingBox();
    if(compactDialog)assert(compactDialog.y>=0&&compactDialog.y+compactDialog.height<=420,'the deletion dialog stays within a compact window');
    const compactActions=await shell.locator('#confirm-profile-deletion').evaluate(button=>{const rect=button.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom};});
    assert(compactActions.top>=0&&compactActions.bottom<=420,'the primary deletion action remains visible in a compact window');
    assert.equal(await shell.locator('#confirm-profile-deletion').evaluate(button=>getComputedStyle(button).opacity),'1','the disabled state keeps its label readable');
    const preservationNote=await shell.locator('.profile-deletion-preserved').evaluate(node=>{const rect=node.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom};});
    assert(preservationNote.top>=0&&preservationNote.bottom<=compactActions.top,'the retained-data notice remains fully visible above the actions');
    await stop();
    console.log('PASS profile deletion UI preview/blocker, cancellation, data removal, and restart persistence');
  }finally{if(app)await app.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
