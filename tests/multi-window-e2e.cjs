const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-multiwindow-'));
  const page=title=>`<!doctype html><meta charset="utf-8"><title>${title}</title><body><p>${title}</p></body>`;
  const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(page(req.url.slice(1)||'home'));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let app,config;
  const until=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  const api=async(route,body,method)=> {
    const response=await fetch(config.baseUrl+route,{method:method||(body?'POST':'GET'),headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();
    assert.equal(response.status,200,JSON.stringify(data));
    return data;
  };
  const start=async()=>{
    app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});
    const shell=await app.firstWindow();
    for(let i=0;i<200;i++){try{config=JSON.parse(fs.readFileSync(path.join(dataDir,'control.json')));break}catch{await delay(50)}}
    assert.ok(config);
    return shell;
  };
  const stop=async()=>{await app.close();app=undefined;};
  try{
    let shell=await start();
    const first=await api('/rooms');
    assert.equal(first.windows.length,1,'a fresh session opens one window');
    assert.equal(first.windowCount,1);

    // A second window gets its own Room; the two windows do not share a Room list.
    await shell.getByRole('button',{name:'新建窗口'}).click();
    // The window record appears before the new Room finishes initializing, so
    // wait for both windows and all their Rooms.
    const two=await until(async()=>{const state=await api('/rooms');return state.windows.length===2 && state.rooms.length===2 ? state : false;},'second window and its room');
    assert.equal(two.windowCount,2);
    const windowIds=two.windows.map(item=>item.id);
    const byWindow=windowIds.map(id=>two.rooms.filter(room=>room.windowId===id));
    assert.equal(byWindow[0].length,1);
    assert.equal(byWindow[1].length,1);
    assert.notEqual(byWindow[0][0].id,byWindow[1][0].id);
    // The control API still sees every Room: agent work is not scoped to a window.
    const allRoomIds=new Set(two.rooms.map(room=>room.id));
    assert.equal(allRoomIds.size,2);

    // Each shell window renders only its own Room. Playwright reports every
    // webContents as a window, so identify the shell pages by their markup.
    const shells=await until(async()=>{
      const pages=[];
      for (const page of app.windows()) {
        try { if (await page.locator('#rooms').count()) pages.push(page); } catch {}
      }
      return pages.length===2?pages:false;
    },'two shell windows');
    assert.equal(shells.length,2,'two shell windows are open');
    await until(async()=>{for(const page of shells)if(await page.locator('#room-strip button').count()<1)return false;return true;},'each window renders its Room list');
    const roomTitlesPerWindow=[];
    for (const page of shells) {
      await page.locator('#rooms').waitFor();
      const labels=await page.locator('#room-strip button').allTextContents();
      roomTitlesPerWindow.push(labels.filter(label=>label.startsWith('我的空间')||label.startsWith('新窗口的空间')));
    }
    assert.deepEqual(roomTitlesPerWindow.map(labels=>labels.length),[1,1],JSON.stringify(roomTitlesPerWindow));
    assert.notDeepEqual(roomTitlesPerWindow[0],roomTitlesPerWindow[1],'each window shows its own Room');

    // Agent work in one window's Room is usable from the API regardless of focus.
    const agentRoom=await api('/rooms',{name:'agent-across-windows'});
    await api(`/tabs/${agentRoom.tabs[0].id}/navigate`,{url:base+'/agent'});
    const snapshot=await api(`/tabs/${agentRoom.tabs[0].id}/action`,{operation:'evaluate',args:{expression:'document.title'}});
    assert.equal(snapshot.value,'agent');

    // Closing one window hands its Rooms to the remaining window instead of
    // ending them.
    const beforeClose=await api('/rooms');
    const closingId=beforeClose.windows.find(item=>item.id!==beforeClose.windows[0].id).id;
    await api(`/windows/${closingId}`,null,'DELETE');
    const afterClose=await until(async()=>{const state=await api('/rooms');return state.windows.length===1?state:false;},'one window left');
    assert.equal(afterClose.windowCount,1);
    assert.equal(afterClose.rooms.length,beforeClose.rooms.length,'rooms survive the closed window');
    assert.ok(afterClose.rooms.every(room=>room.windowId===afterClose.windows[0].id),'rooms were adopted by the remaining window');

    // Multiple windows and their Room assignment survive a restart. The shell
    // page used earlier belonged to the window that was just closed, so pick a
    // live one.
    shell=await until(async()=>{
      for (const page of app.windows()) {
        try { if (await page.locator('#rooms').count()) { await page.getByRole('button',{name:'新建窗口'}).click(); return page; } } catch {}
      }
      return false;
    },'a live shell window');
    const beforeSecondCreate=afterClose.rooms.length;
    await until(async()=>{
      const state=await api('/rooms');
      if(state.windows.length!==2 || state.rooms.length!==beforeSecondCreate+1 || state.rooms.some(room=>room.tabs.some(tab=>!tab.ready)))return false;
      const saved=JSON.parse(fs.readFileSync(path.join(dataDir,'rooms.json'),'utf8'));
      if(saved.windows.length!==2 || saved.rooms.length!==state.rooms.length)return false;
      const savedAssignments=new Map(saved.rooms.map(room=>[room.id,room.windowId]));
      if(state.rooms.some(room=>savedAssignments.get(room.id)!==room.windowId))return false;
      return state;
    },'second window, initialized room and durable window assignment');
    const preRestart=await api('/rooms');
    const assignment=Object.fromEntries(preRestart.rooms.map(room=>[room.id,room.windowId]));
    await stop();
    const persistedBeforeRestart=JSON.parse(fs.readFileSync(path.join(dataDir,'rooms.json'),'utf8'));
    assert.equal(persistedBeforeRestart.windows.length,2,'shutdown must retain both persisted windows');
    assert.deepEqual(Object.fromEntries(persistedBeforeRestart.rooms.map(room=>[room.id,room.windowId])),assignment,'shutdown must retain each Room assignment');
    await start();
    let latestRestoreState;
    let restored;
    try {
      restored=await until(async()=>{latestRestoreState=await api('/rooms');return latestRestoreState.windows.length===2?latestRestoreState:false;},'two windows restored');
    } catch(error) {
      const shellWindows=await Promise.all(app.windows().map(async page=>({url:page.url(),roomStripButtons:await page.locator('#room-strip button').count().catch(()=>-1)})));
      console.error('MULTI-WINDOW RESTORE DIAGNOSTICS',JSON.stringify({savedWindows:persistedBeforeRestart.windows,savedRooms:persistedBeforeRestart.rooms.map(room=>({id:room.id,name:room.name,windowId:room.windowId})),apiWindows:latestRestoreState?.windows,apiRooms:latestRestoreState?.rooms?.map(room=>({id:room.id,name:room.name,windowId:room.windowId})),windowCount:latestRestoreState?.windowCount,shellWindows}));
      throw error;
    }
    assert.equal(restored.windows.length,2);
    for (const room of restored.rooms) assert.equal(room.windowId,assignment[room.id],`room ${room.name} kept its window`);
    const saved=JSON.parse(fs.readFileSync(path.join(dataDir,'rooms.json'),'utf8'));
    assert.equal(saved.schemaVersion,2,'session file is written as schema v2');
    assert.equal(saved.windows.length,2);
    await stop();
    console.log('PASS multi-window: create, per-window rooms, agent access across windows, room adoption on close, restart');
  }finally{
    if(app)await app.close().catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
