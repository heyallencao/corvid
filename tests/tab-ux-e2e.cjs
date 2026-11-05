const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-tabux-'));
  const loadingQaDir=process.env.CORVID_TAB_LOADING_QA_DIR;
  if(loadingQaDir)fs.mkdirSync(loadingQaDir,{recursive:true});
  const favicon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#2d6cdf"/></svg>';
  const page=(title,body)=>`<!doctype html><title>${title}</title><link rel="icon" href="/favicon.svg?for=${encodeURIComponent(title)}"><body>${body}</body>`;
  let bookmarkFaviconRequests=0;
  const server=http.createServer((req,res)=>{
    if(new URL(req.url,'http://fixture').pathname==='/favicon.svg'){res.writeHead(200,{'content-type':'image/svg+xml','cache-control':'no-store'});res.end(favicon);return;}
    if(new URL(req.url,'http://fixture').pathname==='/favicon.ico')bookmarkFaviconRequests++;
    const url=new URL(req.url,'http://fixture');
    if(url.pathname==='/slow'){setTimeout(()=>{if(!res.destroyed){res.writeHead(200,{'content-type':'text/html'});res.end(page('Slow Fixture','<p>slow page ready</p>'));}},900);return;}
    res.writeHead(200,{'content-type':'text/html'});
    if(url.pathname==='/search'){res.end(page('Search Fixture',`<p>${url.searchParams.get('q')||''}</p>`));return;}
    if(url.pathname==='/edit'){res.end(page('Unsaved Fixture','<button id="arm" onclick="window.onbeforeunload=e=>{e.preventDefault();e.returnValue=\'\';}">Arm unsaved-change guard</button><input id="draft" value="keep me">'));return;}
    if(url.pathname==='/saved'){res.end(page('Saved Fixture','<p>saved shortcut target</p>'));return;}
    res.end(url.pathname==='/two'?page('Two','<p>second tab</p>'):page('Find Fixture','<p>needle one</p><p>needle two</p><p>needle three</p>'));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let app,call,agentClient;
  const until=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  const sendShortcut=async(key,modifier)=>{const mods=modifier?[modifier==='Meta'?'meta':'control']:[];await app.evaluate(({BrowserWindow},{keyCode,modifiers})=>{const contents=BrowserWindow.getAllWindows()[0].webContents;contents.sendInputEvent({type:'keyDown',keyCode,modifiers});contents.sendInputEvent({type:'keyUp',keyCode,modifiers});},{keyCode:key,modifiers:mods});};
  const activeHomeTabId=async()=>{const snapshot=await call('/rooms');return snapshot.rooms.find(room=>room.id===snapshot.activeRoomId)?.tabs.find(tab=>tab.active)?.id;};
  const homeEval=async source=>{const tabId=await activeHomeTabId();return app.evaluate(async({webContents},{source,tabId})=>{for(const contents of webContents.getAllWebContents()){let matches=false;try{matches=await contents.executeJavaScript(`document.querySelector('[data-corvid-home-surface]')?.dataset.tabId===${JSON.stringify(tabId)}`);}catch{}if(matches)return contents.executeJavaScript(source);}return null;},{source,tabId});};
  let homeThemeDebuggerAttachedByTest=false;
  const setHomeColorScheme=async colorScheme=>{const tabId=await activeHomeTabId();const result=await app.evaluate(async({webContents},{tabId,colorScheme})=>{for(const contents of webContents.getAllWebContents()){let matches=false;try{matches=await contents.executeJavaScript(`document.querySelector('[data-corvid-home-surface]')?.dataset.tabId===${JSON.stringify(tabId)}`);}catch{}if(matches){const attachedByTest=!contents.debugger.isAttached();if(attachedByTest)contents.debugger.attach('1.3');await contents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:colorScheme}]});return {found:true,attachedByTest};}}return {found:false,attachedByTest:false};},{tabId,colorScheme});homeThemeDebuggerAttachedByTest ||=result.attachedByTest;return result.found;};
  const captureHome=async output=>{const tabId=await activeHomeTabId();const base64=await app.evaluate(async({webContents},{tabId})=>{for(const contents of webContents.getAllWebContents()){try{if(await contents.executeJavaScript(`document.querySelector('[data-corvid-home-surface]')?.dataset.tabId===${JSON.stringify(tabId)}`))return (await contents.capturePage()).toPNG().toString('base64');}catch{}}return null;},{tabId});assert.ok(base64,'the active blank tab provides a capturable browser start page');fs.writeFileSync(output,Buffer.from(base64,'base64'));};
  try{
    app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});
    const shell=await app.firstWindow();
    let config;
    for(let i=0;i<200;i++){try{config=JSON.parse(fs.readFileSync(path.join(dataDir,'control.json')));break}catch{await delay(50)}}
    assert.ok(config);
    call=async(route)=>{const response=await fetch(config.baseUrl+route,{headers:{authorization:`Bearer ${config.token}`}});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
    const primary=process.platform==='darwin'?'Meta':'Control';
    const tabs=shell.locator('.tab');
    const axSession=await shell.context().newCDPSession(shell);
    await axSession.send('Accessibility.enable');
    const {nodes:initialAxNodes}=await axSession.send('Accessibility.getFullAXTree');
    const initialAxRoles=initialAxNodes.map(node=>node.role?.value);
    assert.ok(initialAxNodes.some(node=>node.role?.value==='group'&&node.name?.value==='标签页'),'the tab controls are exposed as a named group');
    assert.ok(initialAxNodes.some(node=>node.role?.value==='group'&&node.name?.value==='空间'),'the Room buttons are exposed as a named group');
    assert.equal(initialAxRoles.includes('tablist'),false,'the strip does not claim tablist arrow-key behavior');
    assert.equal(initialAxRoles.includes('tab'),false,'tab cards remain ordinary named buttons with a close action');
    await axSession.detach();
    assert.equal(await shell.locator('#tabs .tab-main').first().getAttribute('aria-current'),'page','the active browser tab is announced as current');
    assert.equal(await shell.locator('#room-strip button').first().getAttribute('aria-current'),'page','the active Room is announced as current');

    // Corvid paints its home surface inside the user-owned about:blank WebContentsView.
    await until(()=>homeEval("document.visibilityState==='visible'"),'visible Corvid home view');
    assert.equal(await homeEval('typeof window.browserHome'),'object','blank user tabs receive the scoped Corvid home bridge');
    for(const [action,kind] of [['bookmarks','bookmarks'],['history','history'],['agent','pi-workbench']]){
      await homeEval(`window.browserHome.action('panel',${JSON.stringify(action)})`);
      await until(async()=>await shell.locator('#library').getAttribute('data-kind')===kind,`${action} shortcut opens ${kind} panel`);
      await shell.locator('#close-library').click();
      await until(async()=>await shell.locator('#library').isHidden(),'shortcut panel closes');
    }
    await shell.locator('#show-settings').click();
    await shell.locator('#search-template').fill(`${base}/search?q={query}`);
    await shell.locator('#settings-form button[type="submit"]').click();
    await until(()=>homeEval("document.visibilityState==='visible'"),'home surface restored after settings closes');
    await until(async()=>!(await shell.locator('#settings').evaluate(dialog=>dialog.open)),'settings dialog closes');
    await delay(100);
    await homeEval("window.browserHome.action('navigate','corvid home')");
    await delay(250);
    await until(async()=>(await tabs.first().textContent()).includes('Search Fixture'),'Corvid home search navigation');
    await shell.locator('#address').fill(base+'/saved');
    await shell.locator('#address').press('Enter');
    await until(async()=>(await tabs.first().textContent()).includes('Saved Fixture'),'saved page title');
    await shell.locator('#bookmark-current').click();
    await shell.locator('#bookmarks-bar').getByRole('link',{name:/Saved Fixture/}).waitFor();

    // A new tab shows only bookmarks from its active Profile; another Profile
    // gets an empty state and cannot see this saved site.
    await until(async()=>bookmarkFaviconRequests>0,'existing bookmark bar favicon request');
    const faviconRequestsBeforeHome=bookmarkFaviconRequests;
    await shell.locator('#new-tab').click();
    await until(()=>homeEval("document.visibilityState==='visible'"),'visible home after opening a blank tab');
    await shell.locator('#bookmarks-bar').waitFor({state:'hidden'});
    await delay(150);
    assert.equal(bookmarkFaviconRequests,faviconRequestsBeforeHome,'the new-tab surface must not load remote bookmark favicons');
    assert.equal(await homeEval("Number(document.querySelector('[data-corvid-home-surface]').dataset.bookmarkCount)"),1,'the new tab lists only current Profile bookmarks');
    const homeTheme=()=>homeEval("(()=>{const host=document.querySelector('[data-corvid-home-surface]');const style=getComputedStyle(host);return {background:style.getPropertyValue('--home-page-background').trim(),text:style.getPropertyValue('--home-text-color').trim()}})()");
    assert.deepEqual(await homeTheme(),{background:'#fbfbfd',text:'#202334'},'the new-tab home starts with its light palette');
    assert.equal(await setHomeColorScheme('dark'),true,'the test can emulate the active page color scheme');
    await until(async()=>JSON.stringify(await homeTheme())===JSON.stringify({background:'#171b23',text:'#e7eaf0'}),'new-tab home follows dark color scheme');
    assert.deepEqual(await homeTheme(),{background:'#171b23',text:'#e7eaf0'},'the new-tab home switches to its dark palette');
    if(process.env.CORVID_DARK_THEME_SCREENSHOT_PATH)await captureHome(process.env.CORVID_DARK_THEME_SCREENSHOT_PATH);
    await setHomeColorScheme('light');
    await until(async()=>JSON.stringify(await homeTheme())===JSON.stringify({background:'#fbfbfd',text:'#202334'}),'new-tab home restores light color scheme');
    const themeTabId=await activeHomeTabId();
    if(homeThemeDebuggerAttachedByTest)await app.evaluate(async({webContents},{themeTabId})=>{for(const contents of webContents.getAllWebContents()){if(contents.debugger.isAttached()){try{if(await contents.executeJavaScript(`document.querySelector('[data-corvid-home-surface]')?.dataset.tabId===${JSON.stringify(themeTabId)}`)){contents.debugger.detach();break;}}catch{}}}},{themeTabId});
    await captureHome(path.join(os.tmpdir(),'corvid-new-tab-surface.png'));
    await homeEval(`window.browserHome.action('navigate',${JSON.stringify(base+'/saved')})`);
    await until(async()=>(await tabs.nth(1).textContent()).includes('Saved Fixture'),'bookmark shortcut navigation');
    await shell.locator('#profile-menu-trigger').click();
    await shell.getByRole('menuitem',{name:'新建浏览身份'}).click();
    await shell.locator('#profile-name').fill('起始页隔离测试');
    await shell.locator('#new-profile-form button[type="submit"]').click();
    await shell.locator('#create-room-trigger').click();
    await shell.locator('#room-name').fill('隔离空间');
    await shell.locator('#new-room-form button[type="submit"]').click();
    await until(()=>homeEval("document.visibilityState==='visible'"),'new Profile home surface');
    assert.equal(await homeEval("Number(document.querySelector('[data-corvid-home-surface]').dataset.bookmarkCount)"),0,'a new Profile must not see another Profile bookmarks');
    await shell.locator('#profile-select').selectOption('default');
    await until(async()=>(await tabs.count())===2 && await shell.locator('#profile-select').inputValue()==='default','return to original Profile');
    await shell.locator('.tab[data-active="true"] .tab-close').click();
    await until(async()=>(await tabs.count())===1,'close shortcut tab');

    await shell.locator('#address').fill(base+'/');
    await shell.locator('#address').press('Enter');
    await until(async()=>(await tabs.count())===1 && (await tabs.first().textContent()).includes('Find Fixture'),'first tab title');
    const icon=tabs.first().locator('img.favicon');
    await until(async()=>String(await icon.getAttribute('src')).includes('/favicon.svg'),`tab favicon from page; current src=${await icon.getAttribute('src')}; rooms=${JSON.stringify((await call('/rooms')).rooms.map(room=>({id:room.id,active:room.active,profileId:room.profileId,tabs:room.tabs.map(tab=>({id:tab.id,title:tab.title,url:tab.url,active:tab.active,faviconUrl:tab.faviconUrl}))})))}`);

    for(const [locale,label] of [['zh-CN','正在加载'],['en','Loading']]){
      await shell.evaluate(async locale=>window.browserShell.invoke('setUiLocale',{locale}),locale);
      await shell.locator('#address').fill(`${base}/slow?locale=${locale}`);await shell.locator('#address').press('Enter');
      const loading=tabs.first().locator('.tab-loading-indicator');await loading.waitFor({state:'visible'});
      assert.match(await tabs.first().locator('.tab-main').getAttribute('aria-label'),new RegExp(label),'loading tab has a localized accessible name');
      if(loadingQaDir&&locale==='zh-CN')await shell.screenshot({path:path.join(loadingQaDir,'issue-197-loading.png')});
      await loading.waitFor({state:'detached'});
      await until(async()=>{const snapshot=await call('/rooms');const current=snapshot.rooms.find(room=>room.id===snapshot.activeRoomId)?.tabs[0];return current?.title==='Slow Fixture'&&current.isLoading===false;},`${locale} slow tab completes`);
      await tabs.first().locator('.tab-loading-indicator').waitFor({state:'detached'});
      await tabs.first().locator('.favicon').waitFor({state:'visible'});
      assert.equal(await tabs.first().locator('.tab-loading-indicator').count(),0,'loading indicator is removed after navigation completes');
      if(loadingQaDir&&locale==='zh-CN')await shell.screenshot({path:path.join(loadingQaDir,'issue-197-loaded.png')});
      assert.equal(await tabs.first().locator('.tab-main').getAttribute('aria-label'),'Slow Fixture','tab title accessible name is restored after loading completes');
    }
    await shell.evaluate(async()=>window.browserShell.invoke('setUiLocale',{locale:'zh-CN'}));
    await shell.locator('#address').fill(`${base}/`);await shell.locator('#address').press('Enter');
    await until(async()=>{const snapshot=await call('/rooms');return snapshot.rooms.find(room=>room.id===snapshot.activeRoomId)?.tabs[0]?.title==='Find Fixture';},'restore find fixture');

    // Cmd/Ctrl+F opens the find bar against the active page; Enter/Shift+Enter
    // walk matches; Escape closes the bar.
    await sendShortcut('F',primary);
    await shell.locator('#findbar').waitFor({state:'visible'});
    await shell.locator('#find-input').fill('needle');
    await until(async()=>await shell.locator('#find-count').textContent()==='1/3','find count 1/3');
    await shell.locator('#find-input').press('Enter');
    await until(async()=>await shell.locator('#find-count').textContent()==='2/3','find count 2/3 forward');
    await shell.locator('#find-input').press('Shift+Enter');
    await until(async()=>await shell.locator('#find-count').textContent()==='1/3','find count 1/3 backward');
    await shell.locator('#find-input').press('Escape');
    await shell.locator('#findbar').waitFor({state:'hidden'});

    // Second tab, then drag the first tab to the right of it.
    await shell.locator('#new-tab').click();
    await until(async()=>(await tabs.count())===2,'two tabs');
    await shell.locator('#address').fill(base+'/two');
    await shell.locator('#address').press('Enter');
    await until(async()=>(await tabs.nth(1).textContent()).includes('Two'),'second tab title');
    const firstBox=await until(async()=>{const box=await tabs.nth(0).boundingBox();return box && box.width>0 ? box : false;},'first tab box');
    const secondBox=await until(async()=>{const box=await tabs.nth(1).boundingBox();return box && box.width>0 ? box : false;},'second tab box');
    await shell.mouse.move(firstBox.x+firstBox.width/2,firstBox.y+firstBox.height/2);
    await shell.mouse.down();
    await shell.mouse.move(secondBox.x+secondBox.width/2,secondBox.y+secondBox.height/2,{steps:10});
    await shell.mouse.up();
    await until(async()=>{const state=await call('/rooms');const room=state.rooms.find(item=>item.id===state.activeRoomId);return room.tabs[0].title==='Two';},'tab drag reorder');

    // Find bar belongs to its tab; switching tabs closes it.
    await sendShortcut('F',primary);
    await shell.locator('#findbar').waitFor({state:'visible'});
    await tabs.nth(1).click();
    await shell.locator('#findbar').waitFor({state:'hidden'});
    await until(async()=>{const state=await call('/rooms');const room=state.rooms.find(item=>item.id===state.activeRoomId);return room.tabs[1].active;},'second tab active');

    // Middle click closes a tab without opening it.
    await tabs.nth(0).click({button:'middle'});
    await until(async()=>(await tabs.count())===1,'middle-click close');
    assert.ok((await tabs.first().textContent()).includes('Find Fixture'));
    const beforeLastClose=await call('/rooms'),userRoom=beforeLastClose.rooms.find(room=>room.id===beforeLastClose.activeRoomId),oldTab=userRoom.tabs[0];
    await tabs.first().locator('.tab-close').click();
    await until(async()=>{const current=(await call('/rooms')).rooms.find(room=>room.id===userRoom.id);return current?.tabs.length===1&&current.tabs[0].url==='about:blank'&&current.tabs[0].id!==oldTab.id;},'close button replaces the last user tab with a blank start page');
    let currentRoom=(await call('/rooms')).rooms.find(room=>room.id===userRoom.id);
    assert.equal(currentRoom.profileId,userRoom.profileId);
    assert.equal(currentRoom.windowId,userRoom.windowId);
    assert.equal(currentRoom.ownership,'user');
    assert.equal(currentRoom.name,userRoom.name);
    assert.equal(currentRoom.tabs[0].openedBy,'user');
    await until(()=>homeEval("document.visibilityState==='visible'"),'replacement user tab shows Corvid start page');
    if(process.env.CORVID_LAST_TAB_SCREENSHOT_PATH)await captureHome(process.env.CORVID_LAST_TAB_SCREENSHOT_PATH);
    let replacementId=currentRoom.tabs[0].id;
    await tabs.first().click({button:'middle'});
    await until(async()=>{const current=(await call('/rooms')).rooms.find(room=>room.id===userRoom.id);return current?.tabs.length===1&&current.tabs[0].url==='about:blank'&&current.tabs[0].id!==replacementId;},'middle-click replaces the last user tab');
    currentRoom=(await call('/rooms')).rooms.find(room=>room.id===userRoom.id);replacementId=currentRoom.tabs[0].id;
    await sendShortcut('W',primary);
    await until(async()=>{const current=(await call('/rooms')).rooms.find(room=>room.id===userRoom.id);return current?.tabs.length===1&&current.tabs[0].url==='about:blank'&&current.tabs[0].id!==replacementId;},'Cmd/Ctrl+W replaces the last user tab');
    await until(()=>homeEval("document.visibilityState==='visible'"),'keyboard-created user start page is ready');
    // Issue #130-A1：起始页文案跟随 uiLocale；closed shadow 不可探测，断言 host dataset 镜像。
    const homeMirror=source=>homeEval(`(()=>{const host=document.querySelector('[data-corvid-home-surface]');return host?{locale:host.dataset.homeLocale,heading:host.dataset.homeHeading}:null;})()`);
    await until(async()=>(await homeMirror())?.locale==='zh-CN','zh start page declares its locale');
    assert.match((await homeMirror()).heading,/想去哪里/,'zh start page heading');
    await shell.locator('html').evaluate((element,next)=>window.browserShell.invoke('setUiLocale',{locale:next}),'en');
    await shell.waitForFunction(expected=>document.documentElement.lang===expected,'en');
    await shell.locator('#new-tab').click();
    await until(async()=>(await call('/rooms')).rooms.find(room=>room.id===userRoom.id)?.tabs.length===2,'localized start tab created');
    await until(async()=>(await homeMirror())?.locale==='en','en start page follows the switched locale');
    const enHeading=(await homeMirror()).heading;
    assert.match(enHeading,/Where to next/,'en start page heading');
    assert.equal(/[\u4e00-\u9fff]/.test(enHeading),false,'en start page heading has no Chinese residue');
    await shell.locator('html').evaluate((element,next)=>window.browserShell.invoke('setUiLocale',{locale:next}),'zh-CN');
    await shell.waitForFunction(expected=>document.documentElement.lang===expected,'zh-CN');
    await tabs.nth(1).locator('.tab-close').click();
    await until(async()=>{const current=(await call('/rooms')).rooms.find(room=>room.id===userRoom.id);return current?.tabs.length===1&&current.tabs[0].url==='about:blank';},'localized start tab closed, single blank tab restored');
    await homeEval(`window.browserHome.action('navigate',${JSON.stringify(base+'/edit')})`);
    await until(async()=>(await call('/rooms')).rooms.find(room=>room.id===userRoom.id)?.tabs[0]?.url===base+'/edit','guarded final tab navigation');
    const guardedTabId=(await call('/rooms')).rooms.find(room=>room.id===userRoom.id).tabs[0].id;
    await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(contents=>contents.getURL()===url).executeJavaScript("document.querySelector('#arm').click()"),base+'/edit');
    await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>0;});
    await tabs.first().locator('.tab-close').click();
    await shell.getByRole('alert').getByText(/页面取消关闭/).waitFor();
    currentRoom=(await call('/rooms')).rooms.find(room=>room.id===userRoom.id);
    assert.equal(currentRoom.tabs.length,1,'cancelling beforeunload must not create a replacement tab');
    assert.equal(currentRoom.tabs[0].id,guardedTabId);
    assert.equal(currentRoom.tabs[0].url,base+'/edit');
    await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;});
    await tabs.first().locator('.tab-close').click();
    await until(async()=>{const current=(await call('/rooms')).rooms.find(room=>room.id===userRoom.id);return current?.tabs.length===1&&current.tabs[0].url==='about:blank'&&current.tabs[0].id!==guardedTabId;},'confirmed close replaces guarded final tab');
    const {connect}=await import('../sdk/index.js');agentClient=await connect({dataDir});
    const agentRoom=await agentClient.openRoom('Agent close lifecycle'),agentPage=agentRoom.page('p1');
    await agentPage.close();
    const agentAfterClose=await agentClient.room(agentRoom.id);
    assert.equal(agentAfterClose.info.ownership,'agent');
    assert.equal(agentAfterClose.info.tabs.length,0,'Agent API close must not create a user start tab');
    await agentClient.disconnect();agentClient=undefined;
    console.log('PASS tab favicon, find, drag, last-tab recovery and middle-click close');
  }finally{
    if(agentClient)await agentClient.disconnect().catch(()=>{});
    if(app)await app.close().catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
