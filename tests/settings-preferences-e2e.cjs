const {_electron}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');

const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const executablePath=process.env.CORVID_PACKAGED_APP_PATH?path.resolve(process.env.CORVID_PACKAGED_APP_PATH):require('electron');
(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-settings-preferences-'));
  const dataDir=path.join(temp,'data'),downloadDir=path.join(temp,'downloads');
  fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(downloadDir);
  fs.writeFileSync(path.join(dataDir,'browser-preferences.json'),JSON.stringify({schemaVersion:1,theme:'dark'}),{mode:0o600});
  const server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://fixture');
    if(url.pathname==='/page'){response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>设置偏好恢复夹具</title><p>local fixture</p>');return;}
    const filename=url.pathname.slice(1)+'.txt';response.writeHead(200,{'content-type':'text/plain','content-disposition':`attachment; filename="${filename}"`});response.end(`contents:${filename}`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let app;
  const waitFor=async(fn,label)=>{for(let i=0;i<240;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  async function start(){
    app=await _electron.launch({executablePath,args:process.env.CORVID_PACKAGED_APP_PATH?[]:[root],timeout:process.env.CORVID_PACKAGED_APP_PATH?45_000:undefined,env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_PORT:'0',CORVID_TEST_MODE:'1',CORVID_TEST_DOWNLOAD_DIR:downloadDir,CORVID_TEST_DOWNLOAD_DIALOG_RESULT:'cancel',CORVID_TEST_BROWSER_PREFERENCES_FAIL_ONCE:process.env.CORVID_TEST_BROWSER_PREFERENCES_FAIL_ONCE||'0'}});if(process.env.CORVID_PACKAGED_APP_PATH)assert.equal(await app.evaluate(({app})=>app.isPackaged),true,'settings E2E launches the packaged app');
    const shell=await app.firstWindow();
    const config=await waitFor(()=>{try{return JSON.parse(fs.readFileSync(path.join(dataDir,'control.json'),'utf8'));}catch{return null;}},'Corvid control endpoint');
    const request=async route=>{const response=await fetch(config.baseUrl+route,{headers:{Authorization:`Bearer ${config.token}`}});assert.ok(response.ok);return response.json();};
    return {shell,request};
  }
  const stop=async()=>{await app.close();app=undefined;};
  const state=async shell=>shell.evaluate(()=>window.browserShell.invoke('state'));
  const activeRoom=async shell=>{const snapshot=await state(shell);return snapshot.rooms.find(room=>room.id===snapshot.activeRoomId);};
  const navigate=async(shell,url)=>{await shell.locator('#address').fill(url);await shell.locator('#address').press('Enter');};
  const openSettings=async shell=>{await shell.locator('#show-settings').click();await waitFor(()=>shell.locator('#settings').evaluate(dialog=>dialog.open),'settings dialog open');};
  const saveSettings=async shell=>{await shell.locator('#settings-form button[type="submit"]').click();await waitFor(async()=>!(await shell.locator('#settings').evaluate(dialog=>dialog.open)),'settings dialog close');};
  const savePreferences=async(shell,{startup='new-tab',newTab='blank',ask=true}={})=>{
    await openSettings(shell);
    await shell.locator('#startup-behavior').selectOption(startup);
    await shell.locator('#new-tab-behavior').selectOption(newTab);
    await shell.locator('#settings-nav-downloads').click();
    const askControl=shell.locator('#ask-where-to-save');
    if(ask)await askControl.check();else await askControl.uncheck();
    await saveSettings(shell);
  };
  const screenshot=async(shell,locale,width,height)=>{
    if(process.env.CORVID_CAPTURE_QA_SCREENSHOTS!=='1')return;
    await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setBounds({x:100,y:100,width,height}),{width,height});
    await delay(550);
    if(width===700){
      const navigation=await shell.locator('.settings-nav').evaluate(node=>{const rect=node.getBoundingClientRect();return {scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,buttons:[...node.querySelectorAll('button')].map(button=>{const item=button.getBoundingClientRect();return {left:item.left,right:item.right,top:item.top,bottom:item.bottom};}),left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};});
      assert(navigation.scrollWidth<=navigation.clientWidth+1,'narrow-window category navigation fits without horizontal clipping');
      assert(navigation.buttons.every(button=>button.left>=navigation.left&&button.right<=navigation.right&&button.top>=navigation.top&&button.bottom<=navigation.bottom),'all category buttons remain visible at narrow width');
      const firstControl=await shell.evaluate(()=>{const content=document.querySelector('#settings-content'),outer=content.getBoundingClientRect(),selectors=['#download-directory','#choose-download-directory','#reset-download-directory'];return {scrollTop:content.scrollTop,contentTop:outer.top,contentBottom:outer.bottom,controls:selectors.map(selector=>{const rect=document.querySelector(selector).getBoundingClientRect();return {selector,top:rect.top,bottom:rect.bottom,visible:rect.top>=outer.top&&rect.bottom<=outer.bottom};})};});
      assert.equal(firstControl.scrollTop,0,'narrow settings opens at the top of its content');
      assert(firstControl.controls.every(control=>control.visible),`download folder and actions are visible without scrolling: ${JSON.stringify(firstControl)}`);
    }
    const name=`issue-165-settings-preferences-${locale}-${width}x${height}.png`;
    fs.mkdirSync(path.join(root,'docs/qa/screenshots'),{recursive:true});
    await shell.screenshot({path:path.join(root,'docs/qa/screenshots',name)});
  };
  try{
    let {shell,request}=await start();
    assert.equal(await app.evaluate(({nativeTheme})=>nativeTheme.themeSource),'dark','schemaVersion 1 theme is retained');
    await openSettings(shell);
    assert.equal(await shell.locator('#startup-behavior').inputValue(),'restore');
    assert.equal(await shell.locator('#new-tab-behavior').inputValue(),'home');
    assert.equal(await shell.locator('#ask-where-to-save').isChecked(),true);
    await shell.locator('#startup-behavior').selectOption('new-tab');
    await shell.locator('#new-tab-behavior').selectOption('blank');
    await shell.locator('#settings-nav-downloads').click();
    await shell.locator('#choose-download-directory').click();
    await waitFor(()=>shell.locator('#download-directory').inputValue().then(value=>value===downloadDir),'chosen download directory');
    await saveSettings(shell);
    const saved=JSON.parse(fs.readFileSync(path.join(dataDir,'browser-preferences.json'),'utf8'));
    assert.deepEqual(saved,{schemaVersion:2,theme:'dark',startupBehavior:'new-tab',newTabBehavior:'blank',downloadDirectory:downloadDir,askWhereToSave:true});
    if(process.platform!=='win32')assert.equal(fs.statSync(path.join(dataDir,'browser-preferences.json')).mode&0o777,0o600);
    const invalidFolderPath=path.join(temp,'folder-does-not-exist');
    const invalidFolder=await shell.evaluate(async folder=>{try{await window.browserShell.invoke('setBrowserPreferences',{startupBehavior:'new-tab',newTabBehavior:'blank',downloadDirectory:folder,askWhereToSave:true});return null;}catch(error){return {code:error.code,message:error.message};}},invalidFolderPath);
    assert.match(invalidFolder.message,/无法访问所选下载文件夹/);

    await shell.locator('#show-downloads').click();
    await navigate(shell,base+'/cancel-download');
    await waitFor(async()=>{const result=await request('/downloads');return result.downloads.find(item=>item.filename==='cancel-download.txt'&&item.status==='cancelled');},'cancelled download state');
    assert.equal(fs.existsSync(path.join(downloadDir,'cancel-download.txt')),false,'canceling the save dialog writes no file');
    await savePreferences(shell,{startup:'new-tab',newTab:'blank',ask:false});
    await navigate(shell,base+'/automatic-download');
    const completed=await waitFor(async()=>{const result=await request('/downloads');return result.downloads.find(item=>item.filename==='automatic-download.txt'&&item.status==='completed');},'automatic download completion');
    assert.equal(completed.path,path.join(downloadDir,'automatic-download.txt'));
    assert.equal(fs.readFileSync(completed.path,'utf8'),'contents:automatic-download.txt');
    const hiddenDownloadDir=`${downloadDir}-temporarily-unavailable`;
    fs.renameSync(downloadDir,hiddenDownloadDir);
    await navigate(shell,base+'/unavailable-folder');
    const unavailable=await waitFor(async()=>{const result=await request('/downloads');return result.downloads.find(item=>item.filename==='unavailable-folder.txt'&&item.status==='failed');},'unavailable download folder error');
    assert.match(unavailable.error,/已保存的下载文件夹不可用/);
    fs.renameSync(hiddenDownloadDir,downloadDir);

    await navigate(shell,base+'/page');
    await waitFor(async()=>{const room=await activeRoom(shell);return room.tabs.some(tab=>tab.url===base+'/page');},'fixture page navigation');
    await stop();
    ({shell,request}=await start());
    let room=await waitFor(async()=>{const value=await activeRoom(shell);return value?.tabs.length===2&&value.tabs.some(tab=>tab.url===base+'/page')&&value;},'restored page and startup tab');
    assert.equal(room.tabs.length,2,'startup opens one additional user tab');
    const startupBlank=room.tabs.find(tab=>tab.url==='about:blank'&&tab.active);
    assert.ok(startupBlank,'the startup-created tab is active');
    const blankHasHome=await app.evaluate(async({webContents},tabId)=>{
      for(const contents of webContents.getAllWebContents()){
        try{if(contents.getURL()==='about:blank'&&await contents.executeJavaScript(`document.querySelector('[data-corvid-home-surface]')?.dataset.tabId===${JSON.stringify(tabId)}`))return true;}catch{}
      }
      return false;
    },startupBlank.id);
    assert.equal(blankHasHome,false,'blank preference omits the Corvid start surface');
    await stop();
    ({shell,request}=await start());
    room=await waitFor(async()=>{const value=await activeRoom(shell);return value?.tabs.length===2&&value.tabs.some(tab=>tab.url===base+'/page')&&value;},'second restored session');
    assert.equal(room.tabs.length,2,'restarting reuses the saved blank tab instead of accumulating tabs');

    await savePreferences(shell,{startup:'restore',newTab:'home',ask:false});
    await shell.locator('#new-tab').click();
    room=await waitFor(async()=>{const value=await activeRoom(shell);return value?.tabs.length===3&&value;},'new start-page tab');
    const homeTab=room.tabs.find(tab=>tab.active);
    assert.equal(homeTab.url,'about:blank');
    const homeInstalled=await waitFor(()=>app.evaluate(async({webContents},tabId)=>{
      for(const contents of webContents.getAllWebContents()){
        try{if(await contents.executeJavaScript(`document.querySelector('[data-corvid-home-surface]')?.dataset.tabId===${JSON.stringify(tabId)}`))return true;}catch{}
      }
      return false;
    },homeTab.id),'Corvid start surface injection');
    assert.equal(homeInstalled,true,'home preference installs the Corvid start surface on user tabs');
    await openSettings(shell);
    assert.equal(await shell.locator('#startup-behavior').inputValue(),'restore');
    assert.equal(await shell.locator('#new-tab-behavior').inputValue(),'home');
    assert.equal(await shell.locator('#download-directory').inputValue(),downloadDir);
    assert.equal(await shell.locator('#ask-where-to-save').isChecked(),false);
    await shell.locator('#settings-nav-agent').click();
    await shell.locator('#open-agent-models-from-settings').click();
    await waitFor(()=>shell.locator('#pi-model-settings').evaluate(dialog=>dialog.open),'open model manager from clean settings');
    const visiblePageViews=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.filter(view=>view.webContents?.getURL().startsWith('http')).map(view=>view.getVisible()));
    assert(visiblePageViews.length>0,'the local fixture page is present behind model management');
    assert(visiblePageViews.every(visible=>!visible),'model management keeps native webpage views hidden');
    await shell.locator('#close-pi-model-settings').click();
    await waitFor(()=>shell.locator('#pi-model-settings').evaluate(dialog=>!dialog.open),'close model manager from clean settings');
    await openSettings(shell);
    assert.equal(await shell.locator('#startup-behavior').inputValue(),'restore');
    await screenshot(shell,'zh-CN',1024,700);
    await shell.locator('#settings-nav-downloads').click();
    assert.equal(await shell.locator('#settings-downloads').isVisible(),true);
    assert.equal(await shell.locator('#settings-general').isHidden(),true);
    await screenshot(shell,'zh-CN',700,420);
    await shell.locator('#settings-nav-general').click();
    await shell.locator('#ui-locale').selectOption('en');
    await waitFor(()=>shell.locator('#settings-title').textContent().then(value=>value==='Settings'),'English settings labels');
    const invalidFolderEnglish=await shell.evaluate(async folder=>{try{await window.browserShell.invoke('setBrowserPreferences',{startupBehavior:'restore',newTabBehavior:'home',downloadDirectory:folder,askWhereToSave:false});return null;}catch(error){return {code:error.code,message:error.message};}},path.join(temp,'missing-english-folder'));
    assert.match(invalidFolderEnglish.message,/The selected download folder is unavailable/);
    const originalSearch=(await shell.evaluate(()=>window.browserShell.invoke('settings',{}))).searchTemplate;
    await shell.locator('#search-template').fill('https://search.example/?q={query}');
    await shell.locator('#download-directory').evaluate((input,folder)=>{input.value=folder;},path.join(temp,'missing-save-folder'));
    await shell.locator('#settings-form button[type="submit"]').click();
    await waitFor(()=>shell.locator('#settings-error').textContent().then(text=>text.includes('Search settings were saved, but the other browser preferences were not')),'partial settings save feedback');
    const partialState=await shell.evaluate(()=>window.browserShell.invoke('settings',{}));
    assert.equal(partialState.searchTemplate,'https://search.example/?q={query}','the first save step is retained if the second preference write fails');
    assert.notEqual(partialState.searchTemplate,originalSearch);
    await shell.locator('#search-template').fill(originalSearch);
    await shell.locator('#settings-nav-downloads').click();
    await shell.locator('#choose-download-directory').click();
    await waitFor(()=>shell.locator('#download-directory').inputValue().then(value=>value===downloadDir),'restore valid download directory after partial-save check');
    await saveSettings(shell);
    await openSettings(shell);
    await screenshot(shell,'en',1024,700);
    await shell.locator('#settings-nav-downloads').click();
    await screenshot(shell,'en',700,420);
    await shell.locator('#settings-nav-general').click();
    await shell.locator('#settings-nav-general').focus();
    await shell.locator('#settings-nav-general').press('Tab');
    const keyboardFocus=await shell.evaluate(()=>{const element=document.activeElement,style=getComputedStyle(element);return {id:element.id,focusVisible:element.matches(':focus-visible'),outline:style.getPropertyValue('outline-style')||'empty',width:style.getPropertyValue('outline-width')||'empty'};});
    assert.equal(keyboardFocus.id,'settings-nav-downloads','Tab moves focus through settings categories');
    assert.equal(keyboardFocus.focusVisible,true,`settings category receives keyboard-visible focus: ${JSON.stringify(keyboardFocus)}`);
    assert.equal(keyboardFocus.outline,'solid','keyboard focus keeps a visible outline distinct from the selected category');
    await shell.locator('#ui-locale').selectOption('zh-CN');
    await waitFor(()=>shell.locator('#settings-title').textContent().then(value=>value==='设置'),'Chinese settings labels');
    await shell.locator('#startup-behavior').selectOption('new-tab');
    await shell.locator('#settings-nav-agent').click();
    await shell.locator('#open-agent-models-from-settings').click();
    await waitFor(()=>shell.locator('#settings-leave-dialog').evaluate(dialog=>dialog.open),'unsaved settings decision');
    assert.match(await shell.locator('#settings-leave-description').textContent(),/语言和主题已立即生效并保存/);
    const leaveLayout=await shell.locator('#settings-leave-dialog').evaluate(dialog=>{const rect=dialog.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:innerWidth,height:innerHeight,buttons:[...dialog.querySelectorAll('button')].map(button=>{const item=button.getBoundingClientRect();return {left:item.left,right:item.right,top:item.top,bottom:item.bottom};})};});
    assert(leaveLayout.left>=0&&leaveLayout.right<=leaveLayout.width&&leaveLayout.top>=0&&leaveLayout.bottom<=leaveLayout.height,'unsaved-change choices stay inside a narrow window');
    assert(leaveLayout.buttons.every(button=>button.left>=leaveLayout.left&&button.right<=leaveLayout.right&&button.top>=leaveLayout.top&&button.bottom<=leaveLayout.bottom),'all unsaved-change choices remain visible');
    if(process.env.CORVID_CAPTURE_QA_SCREENSHOTS==='1')await shell.screenshot({path:path.join(root,'docs/qa/screenshots/issue-165-settings-unsaved-zh-CN-700x420.png')});
    await shell.locator('#settings-leave-stay').click();
    await waitFor(()=>shell.locator('#settings').evaluate(dialog=>dialog.open),'return to settings draft');
    assert.equal(await shell.locator('#startup-behavior').inputValue(),'new-tab','staying keeps the unsaved form draft');
    assert.equal(await shell.locator('#settings-nav-agent').getAttribute('aria-current'),'location','staying restores the current category');
    assert.equal(await shell.evaluate(()=>document.activeElement.id),'open-agent-models-from-settings','staying restores focus to the management action');
    await shell.locator('#open-agent-models-from-settings').click();
    await waitFor(()=>shell.locator('#settings-leave-dialog').evaluate(dialog=>dialog.open),'save before model management');
    await shell.locator('#settings-leave-save').click();
    await waitFor(()=>shell.locator('#pi-model-settings').evaluate(dialog=>dialog.open),'open model manager after saving');
    let savedSettings=await shell.evaluate(()=>window.browserShell.invoke('settings',{}));
    assert.equal(savedSettings.browserPreferences.startupBehavior,'new-tab','save and continue persists the staged preference');
    await shell.locator('#close-pi-model-settings').click();
    await waitFor(()=>shell.locator('#pi-model-settings').evaluate(dialog=>!dialog.open),'close model manager');
    await openSettings(shell);
    await shell.locator('#startup-behavior').selectOption('restore');
    await saveSettings(shell);
    await openSettings(shell);
    await shell.locator('#new-tab-behavior').selectOption('blank');
    const savedSearchTemplate=(await shell.evaluate(()=>window.browserShell.invoke('settings',{}))).searchTemplate;
    await shell.locator('#search-template').fill('');
    await shell.locator('#settings-nav-agent').click();
    await shell.locator('#open-agent-access').click();
    await waitFor(()=>shell.locator('#settings-leave-dialog').evaluate(dialog=>dialog.open),'discard before Agent access management');
    await shell.locator('#settings-leave-save').click();
    await waitFor(()=>shell.locator('#settings').evaluate(dialog=>dialog.open),'invalid save returns to settings');
    assert.notEqual(await shell.locator('#search-template').evaluate(input=>input.validationMessage), '', 'save and continue validates required settings');
    await shell.locator('#open-agent-access').click();
    await waitFor(()=>shell.locator('#settings-leave-dialog').evaluate(dialog=>dialog.open),'discard invalid draft before Agent access management');
    await shell.locator('#settings-leave-discard').click();
    await waitFor(()=>shell.locator('#agent-access-dialog').evaluate(dialog=>dialog.open),'open Agent access manager after discarding');
    savedSettings=await shell.evaluate(()=>window.browserShell.invoke('settings',{}));
    assert.equal(savedSettings.browserPreferences.newTabBehavior,'home','discard does not persist the staged preference');
    assert.equal(savedSettings.searchTemplate,savedSearchTemplate,'discard can leave settings with an invalid required field without saving it');
    await shell.locator('#close-agent-access').click();
    await waitFor(()=>shell.locator('#agent-access-dialog').evaluate(dialog=>!dialog.open),'close Agent access manager');
    await stop();
    ({shell,request}=await start());
    room=await waitFor(async()=>{const value=await activeRoom(shell);return value?.tabs.length===3&&value;},'restore behavior after restart');
    assert.equal(room.tabs.length,3,'restore behavior does not create an extra startup tab');
    await openSettings(shell);
    assert.equal(await shell.locator('#startup-behavior').inputValue(),'restore');
    assert.equal(await shell.locator('#new-tab-behavior').inputValue(),'home');
    await shell.locator('#settings-nav-appearance').click();
    const theme= shell.locator('#theme-preference');
    await theme.selectOption('light');
    await waitFor(()=>app.evaluate(({nativeTheme})=>nativeTheme.themeSource==='light'),'immediate light theme application');
    await shell.locator('#cancel-settings').click();
    await openSettings(shell);
    assert.equal(await shell.locator('#theme-preference').inputValue(),'light','theme changes persist immediately when the settings dialog is canceled');
    await shell.locator('#cancel-settings').click();
    console.log('PASS settings preferences: schema migration, localized UI, startup restore/new-tab, home/blank behavior, immediate theme persistence across cancel, save cancellation and automatic downloads');
  }finally{
    if(app)await app.close().catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
