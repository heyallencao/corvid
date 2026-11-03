const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {closeElectron,launchElectron,waitForControl}=require('./electron-test-startup.cjs');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-application-menu-'));
  let app,config,shell;
  const until=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  const api=async(route,body,method)=>{
    const response=await fetch(config.baseUrl+route,{method:method||(body?'POST':'GET'),headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
  };
  const menu=()=>app.evaluate(({Menu})=>{
    const serialize=current=>current.items.map(item=>({id:item.id,label:item.label,role:item.role,accelerator:item.accelerator,enabled:item.enabled,checked:item.checked,submenu:item.submenu?serialize(item.submenu):[]}));
    return serialize(Menu.getApplicationMenu());
  });
  const click=async id=>app.evaluate(({Menu,BrowserWindow},itemId)=>{
    const item=Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if(!item)throw new Error(`Missing menu item: ${itemId}`);
    if(!item.enabled)throw new Error(`Menu item is disabled: ${itemId}`);
    if(typeof item.click!=='function')throw new Error(`Menu item has no Corvid action: ${itemId}`);
    item.click(item,BrowserWindow.getFocusedWindow(),{});
  },id);
  const shortcut=async combination=>{
    const parts=combination.split('+'),keyCode=parts.pop(),modifiers=parts.map(part=>({Meta:'meta',Control:'control',Shift:'shift',Alt:'alt'})[part]);
    await app.evaluate(({BrowserWindow},{keyCode,modifiers})=>BrowserWindow.getFocusedWindow().webContents.sendInputEvent({type:'keyDown',keyCode,modifiers}),{keyCode,modifiers});
    await app.evaluate(({BrowserWindow},{keyCode,modifiers})=>BrowserWindow.getFocusedWindow().webContents.sendInputEvent({type:'keyUp',keyCode,modifiers}),{keyCode,modifiers});
  };
  const find=(items,id)=>{for(const item of items){if(item.id===id)return item;const nested=find(item.submenu||[],id);if(nested)return nested;}return null;};
  const labels=items=>items.flatMap(item=>[item.label,...labels(item.submenu||[])]).filter(Boolean);
  try{
    const launched=await launchElectron(_electron,{executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}},{label:'application-menu-e2e',dataDir});
    app=launched.app;shell=launched.shell;config=await waitForControl(app,dataDir,{label:'application-menu-e2e'});
    const first=await menu(),firstLabels=first.map(item=>item.label);
    if(process.platform==='darwin')assert.equal(first[0].id,'corvid-app-menu');
    assert.ok(firstLabels.includes('文件')&&firstLabels.includes('编辑')&&firstLabels.includes('视图'));
    assert.equal(find(first,'corvid-edit-copy').role,'copy');
    assert.equal(find(first,'corvid-edit-paste').role,'paste');
    assert.equal(find(first,'corvid-devtools'),null);
    assert.equal(labels(first).some(label=>/Electron|Pi|Developer Tools|开发者工具/i.test(label)),false);

    const firstWindow=(await api('/windows')).windows[0];
    await click('corvid-new-tab');
    await until(async()=>{const state=await api('/rooms');return state.rooms.find(room=>room.id===firstWindow.activeRoomId)?.tabs.length===2;},'new tab in the focused user window');
    await click('corvid-new-window');
    await until(async()=>(await api('/windows')).windows.length===2,'second browser window');
    const windows=(await api('/windows')).windows;
    const secondWindow=windows.find(window=>window.id!==firstWindow.id);
    const secondMenu=await menu();
    assert.ok(find(secondMenu,`corvid-window-${secondWindow.id}`),'the Window menu lists each open Corvid window');
    await click(`corvid-window-${firstWindow.id}`);
    await until(async()=>(await api('/windows')).focusedWindowId===firstWindow.id,'Window menu focuses the selected window');
    const selectedMenu=await menu();
    assert.equal(find(selectedMenu,`corvid-window-${firstWindow.id}`).checked,true);
    await click('corvid-new-tab');
    await until(async()=>{const state=await api('/rooms');return state.rooms.find(room=>room.id===firstWindow.activeRoomId)?.tabs.length===3;},'menu action follows focused window');
    const afterAgentRoom=await api('/rooms', {name:'Agent-owned menu fixture',profileId:'default'});
    const agentRoom=afterAgentRoom.rooms.find(room=>room.name==='Agent-owned menu fixture');
    assert.ok(agentRoom);
    await api(`/rooms/${agentRoom.id}/activate`,{},'POST');
    await until(async()=>find(await menu(),'corvid-new-tab')?.enabled===false,'user-only actions disabled in an Agent-owned Room');
    assert.equal(find(await menu(),'corvid-close-tab').enabled,false);
    for(const id of ['corvid-back','corvid-forward','corvid-reload','corvid-find','corvid-print','corvid-zoom-in','corvid-zoom-out','corvid-reset-zoom'])assert.equal(find(await menu(),id).enabled,false,`${id} is disabled in an Agent-owned Room`);
    const primary=process.platform==='darwin'?'Meta':'Control',agentState=await api('/rooms'),agentTabCount=agentState.rooms.find(room=>room.id===agentRoom.id).tabs.length,zoomBefore=(await api('/profiles')).profiles.find(profile=>profile.id==='default').zoom;
    await shortcut(`${primary}+t`);await shortcut(`${primary}+l`);await shortcut(`${primary}+=`);await delay(150);
    assert.equal((await api('/rooms')).rooms.find(room=>room.id===agentRoom.id).tabs.length,agentTabCount,'new-tab shortcut cannot mutate an Agent-owned Room');
    assert.notEqual(await shell.locator('#address').evaluate(element=>document.activeElement===element),true,'address-bar shortcut does not take over an Agent-owned page');
    assert.equal((await api('/profiles')).profiles.find(profile=>profile.id==='default').zoom,zoomBefore,'zoom shortcut cannot modify an Agent-owned page');
    await api(`/rooms/${firstWindow.activeRoomId}/activate`,{},'POST');
    await until(async()=>find(await menu(),'corvid-new-tab')?.enabled===true,'user actions restored in a user-owned Room');

    await shell.locator('#show-settings').click();
    await shell.locator('#ui-locale').selectOption('en');
    await until(async()=>{const value=await menu();return value.some(item=>item.label==='File')?value:false;},'menu labels switch to English');
    assert.ok((await menu()).some(item=>item.label==='Window'));
    await shell.locator('#cancel-settings').click();
    await closeElectron(app);app=undefined;

    const restarted=await launchElectron(_electron,{executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}},{label:'application-menu-e2e-restart',dataDir});
    app=restarted.app;config=await waitForControl(app,dataDir,{label:'application-menu-e2e-restart'});
    const restored=await menu();assert.ok(restored.some(item=>item.label==='File'),'selected language persists in the native menu after restart');
    assert.equal(find(restored,'corvid-devtools'),null);
    console.log('PASS Corvid native menu actions, focused-window routing, Agent Room guard, bilingual persistence, and no runtime/debug menu exposure');
  }finally{
    if(app)await closeElectron(app).catch(error=>{console.error(error);process.exitCode=1;});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
