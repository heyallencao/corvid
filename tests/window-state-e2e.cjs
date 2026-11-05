const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  // Window state is stored as a list of per-window entries (v0.3+). The earlier
  // single-object shape is still accepted on read, which the last case checks.
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-window-state-'));
  const statePath=path.join(dataDir,'window-state.json');
  const readStates=()=>{const saved=JSON.parse(fs.readFileSync(statePath,'utf8'));return Array.isArray(saved)?saved:[saved];};
  let app,shell;
  const qaDir=process.env.CORVID_WINDOW_MIN_SIZE_QA_DIR;
  const until=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  const start=async()=>{app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});shell=await app.firstWindow();return app.evaluate(({BrowserWindow,screen})=>({bounds:BrowserWindow.getAllWindows()[0].getBounds(),workArea:screen.getPrimaryDisplay().workArea}));};
  const assertDefaultBounds=({bounds,workArea})=>{assert.deepEqual({width:bounds.width,height:bounds.height},{width:Math.min(1280,workArea.width),height:Math.min(850,workArea.height)},`default bounds must fit the available work area: ${JSON.stringify({bounds,workArea})}`);assert.ok(bounds.x>=workArea.x&&bounds.y>=workArea.y&&bounds.x+bounds.width<=workArea.x+workArea.width&&bounds.y+bounds.height<=workArea.y+workArea.height,`default window must be fully contained in the work area: ${JSON.stringify({bounds,workArea})}`);};
  const stop=async()=>{await app.close();app=undefined;shell=undefined;};
  try{
    const initial=await start();
    assertDefaultBounds(initial);
    if(qaDir){fs.mkdirSync(qaDir,{recursive:true});await shell.screenshot({path:path.join(qaDir,'issue-303-window-default-workarea.png')});}
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:130,y:150,width:600,height:400}));
    const minimum=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
    assert.deepEqual({width:minimum.width,height:minimum.height},{width:719,height:420},`requested undersized bounds must respect the product minimum: ${JSON.stringify(minimum)}`);
    const compactLayout=await shell.evaluate(()=>({iconWidth:getComputedStyle(document.querySelector('#chrome-tools .icon-button')).width,documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth}));
    assert.equal(compactLayout.iconWidth,'28px','the compact chrome breakpoint is reachable at the minimum window width');
    assert.ok(compactLayout.documentWidth<=compactLayout.viewportWidth,`minimum window has no horizontal overflow: ${JSON.stringify(compactLayout)}`);
    if(qaDir){fs.mkdirSync(qaDir,{recursive:true});await shell.screenshot({path:path.join(qaDir,'issue-219-window-minimum-zh-CN-719x420.png')});}
    await until(()=>{try{const state=readStates()[0];return state?.width>=719&&state?.height>=420;}catch{return false;}},'minimum window state persistence');
    await stop();
    fs.writeFileSync(statePath,JSON.stringify([{x:130,y:150,width:600,height:400}]));
    const restoredMinimum=await start();
    assert.deepEqual({width:restoredMinimum.bounds.width,height:restoredMinimum.bounds.height},{width:719,height:420},'legacy undersized persisted bounds are normalized before restore');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:130,y:150,width:1010,height:720}));
    await until(()=>{try{const states=readStates();return states[0]?.x===130&&states[0]?.y===150&&states[0]?.width===1010&&states[0]?.height===720;}catch{return false;}},'window state file');
    await stop();
    const restored=await start();
    assert.deepEqual({x:restored.bounds.x,y:restored.bounds.y,width:restored.bounds.width,height:restored.bounds.height},{x:130,y:150,width:1010,height:720});
    await stop();
    // A corrupt state file must fall back to the default window instead of
    // blocking startup.
    fs.writeFileSync(statePath,'{not json');
    const fallback=await start();
    assertDefaultBounds(fallback);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:200,y:210,width:980,height:690}));
    await until(()=>{try{return readStates()[0]?.width===980;}catch{return false;}},'window state rewritten');
    await stop();
    // A position on a detached monitor must not open the window off-screen.
    fs.writeFileSync(statePath,JSON.stringify([{x:-99999,y:-99999,width:1000,height:700}]));
    const offscreen=await start();
    assert.deepEqual({width:offscreen.bounds.width,height:offscreen.bounds.height},{width:1000,height:700});
    assert.ok(offscreen.bounds.x>-5000 && offscreen.bounds.x<5000,`expected a visible x, got ${offscreen.bounds.x}`);
    await stop();
    // The v1 single-object shape must still be read as one window. macOS may
    // nudge the restored y position (title bar/menu bar constraints), so the
    // size is exact and the origin is compared with a small tolerance.
    fs.writeFileSync(statePath,JSON.stringify({x:160,y:170,width:1020,height:730}));
    const legacy=await start();
    assert.deepEqual({width:legacy.bounds.width,height:legacy.bounds.height},{width:1020,height:730});
    assert.ok(Math.abs(legacy.bounds.x-160)<=4,`expected x near 160, got ${legacy.bounds.x}`);
    assert.ok(Math.abs(legacy.bounds.y-170)<=24,`expected y near 170, got ${legacy.bounds.y}`);
    await stop();
    console.log('PASS window bounds enforce and restore the 719x420 minimum, compact CSS is reachable, corrupt state falls back, detached-monitor position is clamped, legacy single-window state is read');
  }finally{
    if(app)await app.close().catch(()=>{});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
