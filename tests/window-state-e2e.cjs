const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-window-state-'));
  const statePath=path.join(dataDir,'window-state.json');
  let app;
  const until=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  const start=async()=>{app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});await app.firstWindow();return app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());};
  const stop=async()=>{await app.close();app=undefined;};
  try{
    const initial=await start();
    assert.deepEqual({width:initial.width,height:initial.height},{width:1280,height:850});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:130,y:150,width:1010,height:720}));
    await until(()=>{try{const saved=JSON.parse(fs.readFileSync(statePath,'utf8'));return saved.x===130&&saved.y===150&&saved.width===1010&&saved.height===720;}catch{return false;}},'window state file');
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
    await until(()=>{try{return JSON.parse(fs.readFileSync(statePath,'utf8')).width===980;}catch{return false;}},'window state rewritten');
    await stop();
    // A position on a detached monitor must not open the window off-screen.
    fs.writeFileSync(statePath,JSON.stringify({x:-99999,y:-99999,width:1000,height:700}));
    const offscreen=await start();
    assert.deepEqual({width:offscreen.width,height:offscreen.height},{width:1000,height:700});
    assert.ok(offscreen.x>-5000 && offscreen.x<5000,`expected a visible x, got ${offscreen.x}`);
    await stop();
    console.log('PASS window bounds persist, corrupt state falls back, detached-monitor position is clamped');
  }finally{
    if(app)await app.close().catch(()=>{});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
