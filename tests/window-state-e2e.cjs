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
  let app;
  const until=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  const start=async()=>{app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});await app.firstWindow();return app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());};
  const stop=async()=>{await app.close();app=undefined;};
  try{
    const initial=await start();
    assert.deepEqual({width:initial.width,height:initial.height},{width:1280,height:850});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:130,y:150,width:1010,height:720}));
    await until(()=>{try{const states=readStates();return states[0]?.x===130&&states[0]?.y===150&&states[0]?.width===1010&&states[0]?.height===720;}catch{return false;}},'window state file');
    await stop();
    const restored=await start();
    assert.deepEqual({x:restored.x,y:restored.y,width:restored.width,height:restored.height},{x:130,y:150,width:1010,height:720});
    await stop();
    // A corrupt state file must fall back to the default window instead of
    // blocking startup.
    fs.writeFileSync(statePath,'{not json');
    const fallback=await start();
    assert.deepEqual({width:fallback.width,height:fallback.height},{width:1280,height:850});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:200,y:210,width:980,height:690}));
    await until(()=>{try{return readStates()[0]?.width===980;}catch{return false;}},'window state rewritten');
    await stop();
    // A position on a detached monitor must not open the window off-screen.
    fs.writeFileSync(statePath,JSON.stringify([{x:-99999,y:-99999,width:1000,height:700}]));
    const offscreen=await start();
    assert.deepEqual({width:offscreen.width,height:offscreen.height},{width:1000,height:700});
    assert.ok(offscreen.x>-5000 && offscreen.x<5000,`expected a visible x, got ${offscreen.x}`);
    await stop();
    // The v1 single-object shape must still be read as one window. macOS may
    // nudge the restored y position (title bar/menu bar constraints), so the
    // size is exact and the origin is compared with a small tolerance.
    fs.writeFileSync(statePath,JSON.stringify({x:160,y:170,width:1020,height:730}));
    const legacy=await start();
    assert.deepEqual({width:legacy.width,height:legacy.height},{width:1020,height:730});
    assert.ok(Math.abs(legacy.x-160)<=4,`expected x near 160, got ${legacy.x}`);
    assert.ok(Math.abs(legacy.y-170)<=24,`expected y near 170, got ${legacy.y}`);
    await stop();
    console.log('PASS window bounds persist, corrupt state falls back, detached-monitor position is clamped, legacy single-window state is read');
  }finally{
    if(app)await app.close().catch(()=>{});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});