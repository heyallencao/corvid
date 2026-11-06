const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');

const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-settings-site-'));
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>Settings site fixture</title><p>Local synthetic site.</p><script>localStorage.setItem("settings-site-marker","preserve-on-cancel")</script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  let app;
  const waitFor=async(fn,label)=>{for(let i=0;i<240;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  const capture=async(shell,locale,width,height)=>{
    if(process.env.CORVID_CAPTURE_QA_SCREENSHOTS!=='1')return;
    await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setBounds({x:100,y:100,width,height}),{width,height});
    await delay(500);
    if(width===700){
      await shell.locator('#settings-clear-site').scrollIntoViewIfNeeded();
      const visible=await shell.locator('#settings-content').evaluate(content=>{
        const viewport=content.getBoundingClientRect();
        const description=content.querySelector('#settings-site .settings-section-header p').getBoundingClientRect();
        const actions=['#settings-site-permissions','#settings-clear-site'].map(selector=>{
          const rect=content.querySelector(selector).getBoundingClientRect();
          return rect.top>=viewport.top&&rect.bottom<=viewport.bottom;
        });
        const revealDescription=Math.max(0,viewport.top-description.top);
        content.scrollTop=Math.max(0,content.scrollTop-revealDescription);
        const adjustedViewport=content.getBoundingClientRect();
        const adjustedDescription=content.querySelector('#settings-site .settings-section-header p').getBoundingClientRect();
        const adjustedActions=['#settings-site-permissions','#settings-clear-site'].map(selector=>{
          const rect=content.querySelector(selector).getBoundingClientRect();
          return rect.top>=adjustedViewport.top&&rect.bottom<=adjustedViewport.bottom;
        });
        return {actions,description:adjustedDescription.top>=adjustedViewport.top&&adjustedDescription.bottom<=adjustedViewport.bottom,adjustedActions};
      });
      assert(visible.actions.every(Boolean),'site actions are reachable by scrolling the settings content at 700px');
      assert(visible.description&&visible.adjustedActions.every(Boolean),'narrow site screenshot keeps the scope note and actions visible together');
    }
    const directory=path.join(root,'docs/qa/screenshots');fs.mkdirSync(directory,{recursive:true});
    await shell.screenshot({path:path.join(directory,`issue-165-settings-site-${locale}-${width}x${height}.png`)});
  };
  try{
    app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_PORT:'0',CORVID_TEST_MODE:'1'}});
    const shell=await app.firstWindow();
    const control=await waitFor(()=>{try{return JSON.parse(fs.readFileSync(path.join(dataDir,'control.json'),'utf8'));}catch{return null;}},'Corvid control endpoint');
    const call=async(method,route,body)=>{const response=await fetch(control.baseUrl+route,{method,headers:{authorization:`Bearer ${control.token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
    const openSettings=async()=>{await shell.locator('#library-trigger').click();await shell.locator('#library-menu:not([hidden])').waitFor();await shell.locator('#show-settings').click();await waitFor(()=>shell.locator('#settings').evaluate(dialog=>dialog.open),'settings dialog open');};
    const currentOrigin=async()=>app.evaluate(async({webContents},expected)=>{
      const contents=webContents.getAllWebContents().find(item=>item.getURL()===expected+'/');
      return contents?contents.executeJavaScript('localStorage.getItem("settings-site-marker")'):null;
    },origin);

    await openSettings();
    await shell.locator('#settings-nav-site').click();
    assert.equal(await shell.locator('#settings-current-site').textContent(),'当前没有可管理的网站。请先打开 HTTP 或 HTTPS 页面。');
    assert.equal(await shell.locator('#settings-site-permissions').isDisabled(),true);
    assert.equal(await shell.locator('#settings-clear-site').isDisabled(),true);
    await shell.locator('#cancel-settings').click();

    const room=await call('POST','/rooms',{name:'Settings site fixture'}),tab=room.tabs[0];
    await call('POST',`/tabs/${tab.id}/navigate`,{url:origin+'/'});
    await call('POST',`/rooms/${room.id}/activate`,{});
    await waitFor(()=>shell.evaluate(()=>window.browserShell.invoke('state')).then(state=>state.activeRoomId===room.id&&state.rooms.find(item=>item.id===room.id)?.tabs.some(item=>item.url===origin+'/')),'active local site room');
    await app.evaluate(({dialog})=>{globalThis.settingsSitePrompts=[];globalThis.settingsSiteDialogResponse=1;dialog.showMessageBox=async(_window,options)=>{settingsSitePrompts.push(options);return {response:settingsSiteDialogResponse};};});
    const permission=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'Notification.requestPermission()'}});
    assert.equal(permission.value,'granted','synthetic permission is granted before entering settings');
    await call('POST',`/rooms/${room.id}/resumeControl`,{});
    await app.evaluate(()=>{globalThis.settingsSiteDialogResponse=0;});
    await openSettings();
    await shell.locator('#settings-nav-site').click();
    assert.equal(await shell.locator('#settings-site .settings-section-header p').textContent(),'权限按当前来源查看；清理前会说明数据和 Cookie 范围。');
    assert.match(await shell.locator('#settings-current-site').textContent(),new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.equal(await shell.locator('#settings-site-permissions').isEnabled(),true);
    assert.equal(await shell.locator('#settings-clear-site').isEnabled(),true);
    await capture(shell,'zh-CN',1024,700);
    await capture(shell,'zh-CN',700,420);

    await app.evaluate(()=>{globalThis.settingsSiteDialogResponse=0;});
    await shell.locator('#settings-site-permissions').click();
    await waitFor(()=>shell.locator('#settings-current-site').textContent().then(text=>text.includes('未更改')),'permission review status');
    const permissionAfterCancel=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'Notification.permission'}});
    assert.equal(permissionAfterCancel.value,'granted','canceling permission review retains the origin grant');
    await shell.locator('#settings-clear-site').click();
    await waitFor(()=>shell.locator('#settings-current-site').textContent().then(text=>text.includes('已取消清理')),'site data cancellation status');
    assert.equal(await currentOrigin(),'preserve-on-cancel','canceling site-data cleanup leaves the local fixture unchanged');
    await app.evaluate(()=>{globalThis.settingsSiteDialogResponse=1;});
    await shell.locator('#settings-site-permissions').click();
    await waitFor(()=>shell.locator('#settings-current-site').textContent().then(text=>text.includes('已撤销')),'permission revocation status');
    const permissionAfterRevoke=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'Notification.permission'}});
    assert.equal(permissionAfterRevoke.value,'denied','settings permission review revokes the active origin grant');
    await shell.locator('#settings-clear-site').click();
    await waitFor(()=>shell.locator('#settings-current-site').textContent().then(text=>text.includes('已清理')),'site data cleanup status');
    assert.equal(await currentOrigin(),null,'confirming site-data cleanup clears the active origin through the settings entry');
    const permissionAfterCleanup=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'Notification.permission'}});
    assert.equal(permissionAfterCleanup.value,'denied','site-data cleanup does not restore the separately revoked permission');
    const promptAudit=await app.evaluate(()=>settingsSitePrompts.map(({buttons,defaultId,cancelId,detail})=>({buttons,defaultId,cancelId,detail})));
    assert.deepEqual(promptAudit.slice(0,5).map(item=>item.buttons),[['拒绝','允许'],['关闭','撤销这些权限'],['取消','清理站点数据'],['关闭','撤销这些权限'],['取消','清理站点数据']]);
    assert(promptAudit.every(item=>item.defaultId===0&&item.cancelId===0),'review and destructive actions default to the non-destructive choice');
    assert.match(promptAudit[2].detail,/不会清理.*浏览历史/,'site-data confirmation explains excluded browser history');

    await shell.locator('#settings-nav-general').click();
    await shell.locator('#ui-locale').selectOption('en');
    await waitFor(()=>shell.locator('html').getAttribute('lang').then(locale=>locale==='en'),'English locale');
    await shell.locator('#settings-nav-site').click();
    assert.equal(await shell.locator('#settings-site .settings-section-header p').textContent(),'Review permissions by origin; see data and cookie scope before cleanup.');
    assert.match(await shell.locator('#settings-current-site').textContent(),/Current page origin:/);
    assert.equal(await shell.locator('#settings-site-permissions').textContent(),'Manage site permissions');
    assert.equal(await shell.locator('#settings-clear-site').textContent(),'Clear this site data');
    await capture(shell,'en',1024,700);
    await capture(shell,'en',700,420);
    await app.evaluate(()=>{globalThis.settingsSiteDialogResponse=0;});
    await shell.locator('#settings-site-permissions').click();
    await waitFor(()=>shell.locator('#settings-current-site').textContent().then(text=>text.includes('No site permissions were changed')),'English permission review status');
    await shell.locator('#settings-clear-site').click();
    await waitFor(()=>shell.locator('#settings-current-site').textContent().then(text=>text.includes('was canceled')),'English site-data cancellation status');
    await shell.locator('#cancel-settings').click();
    console.log('PASS settings site category: blank-page guard, active-origin scope, safe cancellation and bilingual status');
  }finally{
    if(app)await app.close().catch(()=>{});
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
