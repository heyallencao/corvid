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
  const favicon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#2d6cdf"/></svg>';
  const page=(title,body)=>`<!doctype html><title>${title}</title><link rel="icon" href="/favicon.svg"><body>${body}</body>`;
  const server=http.createServer((req,res)=>{
    if(req.url==='/favicon.svg'){res.writeHead(200,{'content-type':'image/svg+xml','cache-control':'no-store'});res.end(favicon);return;}
    res.writeHead(200,{'content-type':'text/html'});
    res.end(req.url==='/two'?page('Two','<p>second tab</p>'):page('Find Fixture','<p>needle one</p><p>needle two</p><p>needle three</p>'));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let app;
  const until=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  const sendShortcut=async(key,modifier)=>{const mods=modifier?[modifier==='Meta'?'meta':'control']:[];await app.evaluate(({BrowserWindow},{keyCode,modifiers})=>{const contents=BrowserWindow.getAllWindows()[0].webContents;contents.sendInputEvent({type:'keyDown',keyCode,modifiers});contents.sendInputEvent({type:'keyUp',keyCode,modifiers});},{keyCode:key,modifiers:mods});};
  try{
    app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});
    const shell=await app.firstWindow();
    let config;
    for(let i=0;i<200;i++){try{config=JSON.parse(fs.readFileSync(path.join(dataDir,'control.json')));break}catch{await delay(50)}}
    assert.ok(config);
    const call=async(route)=>{const response=await fetch(config.baseUrl+route,{headers:{authorization:`Bearer ${config.token}`}});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
    const primary=process.platform==='darwin'?'Meta':'Control';
    const tabs=shell.locator('.tab');
    await shell.locator('#address').fill(base+'/');
    await shell.locator('#address').press('Enter');
    await until(async()=>(await tabs.count())===1 && (await tabs.first().textContent()).includes('Find Fixture'),'first tab title');
    const icon=tabs.first().locator('img.favicon');
    await until(async()=>String(await icon.getAttribute('src')).includes('/favicon.svg'),'tab favicon from page');

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
    console.log('PASS tab favicon, find in page, drag reorder and middle-click close');
  }finally{
    if(app)await app.close().catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
