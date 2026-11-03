const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-tab-pin-'));
  const page=title=>`<!doctype html><meta charset="utf-8"><title>${title}</title><body><p>${title}</p></body>`;
  const server=http.createServer((req,res)=>{if(req.url==='/slow'){setTimeout(()=>{if(!res.destroyed){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(page('Slow Pinned'));}},900);return;}res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(page(req.url==='/two'?'Two':req.url==='/three'?'Three':'One'));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let app;
  const until=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  const start=async()=>{
    app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});
    const shell=await app.firstWindow();
    let config;
    for(let i=0;i<200;i++){try{config=JSON.parse(fs.readFileSync(path.join(dataDir,'control.json')));break}catch{await delay(50)}}
    assert.ok(config);
    const call=async(route)=>{const response=await fetch(config.baseUrl+route,{headers:{authorization:`Bearer ${config.token}`}});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
    const tabs=async()=>{const state=await call('/rooms');const room=state.rooms.find(item=>item.id===state.activeRoomId);return room.tabs;};
    return {shell,call,tabs};
  };
  const stop=async()=>{await app.close();app=undefined;};
  try{
    let {shell,tabs}=await start();
    const navigate=async (url,expectedCount)=>{await until(async()=>(await tabs()).length===expectedCount,`tab count ${expectedCount}`);await shell.locator('#address').fill(url);await shell.locator('#address').press('Enter');await until(async()=>(await tabs()).some(tab=>tab.url===url&&tab.active&&tab.ready),`load ${url}`);};
    // Wait for the new tab to exist before typing into the address bar: the
    // renderer only becomes active for the new tab once the state update lands.
    // The renderer receives state asynchronously: wait for the tab bar and the
    // address bar to reflect the new tab before typing, otherwise the address
    // submit still targets the previously active tab.
    const openTab=async url=>{const before=await shell.locator('.tab').count();await shell.locator('#new-tab').click();await until(async()=>(await shell.locator('.tab').count())===before+1,'new tab rendered');await until(async()=>await shell.locator('#address').inputValue()==='','address bar follows the new tab');await shell.locator('#address').fill(url);await shell.locator('#address').press('Enter');await until(async()=>(await tabs()).find(tab=>tab.active)?.url===url,`load ${url}`);};

    await navigate(base+'/one',1);
    await openTab(base+'/two');
    await openTab(base+'/three');
    assert.equal((await tabs()).length,3);

    // Stub the native pieces: the pinned-close confirmation and the system clipboard.
    await app.evaluate(({dialog,clipboard})=>{
      globalThis.__pinPromptCount=0;
      dialog.showMessageBox=async()=>{globalThis.__pinPromptCount+=1;return {response:globalThis.__pinPromptAnswer ?? 0};};
      clipboard.writeText=text=>{globalThis.__copiedUrl=text;};
    });

    // The tab context menu supports pointer and keyboard invocation with a
    // complete focus loop before any menu action mutates the tab list.
    const third=shell.locator('.tab').nth(2);
    const thirdMain=shell.locator(`.tab[data-tab-id="${await third.getAttribute('data-tab-id')}"] .tab-main`),tabMenu=shell.locator('#tab-menu');
    assert.equal(await thirdMain.getAttribute('aria-haspopup'),'menu');
    assert.equal(await thirdMain.getAttribute('aria-controls'),'tab-menu');
    assert.equal(await thirdMain.getAttribute('aria-expanded'),'false');
    await third.click({button:'right'});
    await tabMenu.waitFor({state:'visible'});
    assert.equal(await thirdMain.getAttribute('aria-expanded'),'true');
    assert.equal(await shell.evaluate(()=>document.activeElement.textContent),'固定标签','opening the context menu moves focus to the first item');
    await shell.keyboard.press('ArrowDown');assert.equal(await shell.evaluate(()=>document.activeElement.textContent),'重新加载');
    await shell.keyboard.press('ArrowUp');assert.equal(await shell.evaluate(()=>document.activeElement.textContent),'固定标签');
    await shell.keyboard.press('End');assert.equal(await shell.evaluate(()=>document.activeElement.textContent),'关闭其他标签');
    await shell.keyboard.press('Home');assert.equal(await shell.evaluate(()=>document.activeElement.textContent),'固定标签');
    await shell.keyboard.press('Escape');await tabMenu.waitFor({state:'hidden'});
    assert.equal(await thirdMain.getAttribute('aria-expanded'),'false');
    assert.equal(await thirdMain.evaluate(element=>element===document.activeElement),true,'Escape restores focus to the tab that opened the menu');
    await thirdMain.focus();await shell.keyboard.press('Shift+F10');await tabMenu.waitFor({state:'visible'});
    await shell.screenshot({path:path.join(os.tmpdir(),'corvid-tab-menu-keyboard.png')});
    await shell.keyboard.press('Tab');await tabMenu.waitFor({state:'hidden'});
    assert.equal(await shell.evaluate(()=>document.activeElement.classList.contains('tab-close')),true,'Tab leaves the menu for the next shell control');
    await thirdMain.focus();await shell.keyboard.press('Shift+F10');await tabMenu.waitFor({state:'visible'});
    await shell.keyboard.press('Shift+Tab');await tabMenu.waitFor({state:'hidden'});
    assert.equal(await shell.evaluate(()=>document.activeElement.classList.contains('tab-close')),true,'Shift+Tab leaves the menu for the previous shell control');
    await thirdMain.press('ContextMenu');await tabMenu.waitFor({state:'visible'});
    await shell.keyboard.press('Escape');await tabMenu.waitFor({state:'hidden'});
    await third.click({button:'right'});await tabMenu.waitFor({state:'visible'});
    await shell.getByRole('menuitem',{name:'固定标签'}).click();
    await tabMenu.waitFor({state:'hidden'});
    assert.equal(await thirdMain.getAttribute('aria-expanded'),'false');
    let list=await tabs();
    assert.equal(list[0].pinned,true,'pinned tab moves to the front');
    assert.equal(list.filter(tab=>tab.pinned).length,1);
    assert.equal(await shell.locator('.tab.pinned').count(),1);
    assert.equal(await shell.locator('.tab.pinned .pin-icon').count(),1);
    await shell.locator('.tab.pinned .tab-main').click();
    await shell.locator('#address').fill(base+'/slow');await shell.locator('#address').press('Enter');
    const pinnedLoading=shell.locator('.tab.pinned .tab-loading-indicator');await pinnedLoading.waitFor({state:'visible'});
    assert.equal(await pinnedLoading.locator('.pin-icon').count(),1,'pinned tabs retain their pin glyph inside the loading ring');
    assert.match(await shell.locator('.tab.pinned .tab-main').getAttribute('aria-label'),/已固定|Loading pinned tab/,'pinned loading status is available to assistive technology');
    await pinnedLoading.waitFor({state:'detached'});
    await shell.locator('.tab.pinned img.favicon').waitFor({state:'visible'});
    await shell.locator('#address').fill(base+'/three');await shell.locator('#address').press('Enter');
    await until(async()=>(await tabs()).find(tab=>tab.title==='Three')?.active,'restore pinned tab page after loading indicator check');

    // Dragging an unpinned tab into the pinned group must not reorder or pin it.
    const pinnedBox=await until(async()=>{const box=await shell.locator('.tab.pinned').boundingBox();return box&&box.width>0?box:false;},'pinned tab box');
    const otherBox=await until(async()=>{const box=await shell.locator('.tab:not(.pinned)').nth(1).boundingBox();return box&&box.width>0?box:false;},'unpinned tab box');
    await shell.mouse.move(otherBox.x+otherBox.width/2,otherBox.y+otherBox.height/2);
    await shell.mouse.down();
    await shell.mouse.move(pinnedBox.x+2,pinnedBox.y+pinnedBox.height/2,{steps:10});
    await shell.mouse.up();
    await delay(300);
    list=await tabs();
    assert.equal(list[0].pinned,true,'pinned tab still leads after a cross-group drag');
    assert.equal(list.filter(tab=>tab.pinned).length,1,'no tab was implicitly pinned');
    assert.equal(list.length,3);

    // Copy link and reload entries act on the tab that opened the menu, not on
    // whichever tab happens to be active.
    const twoTab=shell.locator('.tab').filter({hasText:'Two'});
    assert.equal(await twoTab.count(),1,'expected a single tab titled Two');
    await twoTab.click({button:'right'});
    await shell.getByRole('menuitem',{name:'复制链接'}).click();
    const copied=await until(()=>app.evaluate(()=>globalThis.__copiedUrl),'clipboard write');
    assert.equal(copied,base+'/two');
    assert.equal((await tabs()).find(tab=>tab.active).url,base+'/three','the active tab did not change');

    // "Close other tabs" keeps the pinned tab and closes the rest.
    await shell.locator('.tab.pinned').click({button:'right'});
    await shell.getByRole('menuitem',{name:'关闭其他标签'}).click();
    await until(async()=>(await tabs()).length===1,'other tabs closed');
    assert.equal((await tabs())[0].pinned,true);

    // Closing a pinned tab asks first: cancel keeps it, confirm returns to a new start tab.
    await app.evaluate(()=>{globalThis.__pinPromptAnswer=0;});
    await shell.locator('.tab.pinned').click({button:'right'});
    await shell.getByRole('menuitem',{name:'关闭标签'}).click();
    await until(()=>app.evaluate(()=>globalThis.__pinPromptCount) ,'pin close prompt');
    await delay(200);
    assert.equal((await tabs()).length,1,'cancel keeps the pinned tab');
    await app.evaluate(()=>{globalThis.__pinPromptAnswer=1;});
    await shell.locator('.tab.pinned').click({button:'right'});
    await shell.getByRole('menuitem',{name:'关闭标签'}).click();
    await until(async()=>(await tabs()).length===1&&(await tabs())[0].url==='about:blank','confirmed close returns to the start tab');
    assert.equal((await tabs())[0].openedBy,'user');

    // Pin again and verify it survives a restart with its pinned flag.
    await until(async()=>(await shell.locator('.tab').count())===1,'new tab rendered');
    await until(async()=>await shell.locator('#address').inputValue()==='','address bar follows the new tab');
    await navigate(base+'/one',1);
    await shell.locator('.tab').first().click({button:'right'});
    await shell.getByRole('menuitem',{name:'固定标签'}).click();
    await until(async()=>(await tabs())[0]?.pinned===true,'pinned before restart');
    await stop();
    ({shell,tabs}=await start());
    await until(async()=>(await tabs()).length===1,'tab restored');
    assert.equal((await tabs())[0].pinned,true,'pinned survives restart');
    assert.equal(await shell.locator('.tab.pinned').count(),1);
    await shell.locator('.tab.pinned').click({button:'right'});
    await shell.getByRole('menuitem',{name:'取消固定'}).click();
    await until(async()=>(await tabs())[0]?.pinned===false,'unpin');
    assert.equal(await shell.locator('.tab.pinned').count(),0);
    console.log('PASS pinned tabs and tab context menu: pin, group-stable drag, close others, confirmed close, restart');
  }finally{
    if(app)await app.close().catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
