const {_electron}=require('playwright-core');
const electron=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-risk-'));
  let app;
  async function boot(){
    app=await _electron.launch({executablePath:electron,args:[project],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});
    const shell=await app.firstWindow(); let config;
    for(let i=0;i<200;i++){try{config=JSON.parse(fs.readFileSync(path.join(dataDir,'control.json')));break;}catch{await delay(50);}}
    assert.ok(config,'control service started');
    const request=async(method,route,body)=>{const response=await fetch(config.baseUrl+route,{method,headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};};
    const call=async(method,route,body)=>{const result=await request(method,route,body);assert.equal(result.status,200,JSON.stringify(result.body));return result.body;};
    return {shell,request,call};
  }
  try {
    let {shell,request,call}=await boot();
    const room=await call('POST','/rooms',{name:'Risk'});
    const tab=room.tabs[0];
    const result=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'new Promise(() => {})',timeoutMs:100}});
    assert.equal(result.status,'timed_out');
    await call('POST',`/rooms/${room.id}/activate`,{});
    await shell.getByRole('button',{name:/页面执行状态未知/}).waitFor();
    await app.close(); app=undefined;
    ({shell,request,call}=await boot());
    let current=(await call('GET','/rooms')).rooms.find(item=>item.id===room.id);
    assert.equal(current.executionRisk.status,'unknown_after_restart');
    assert.match((await request('POST',`/tabs/${tab.id}/action`,{operation:'snapshot'})).body.error,/unresolved timed-out/);
    // Stub the native confirmation choice; the shell button and actual main-process
    // ownership/state transition still run in the real application.
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
    await shell.getByRole('button',{name:/页面执行状态未知/}).click();
    current=(await call('GET','/rooms')).rooms.find(item=>item.id===room.id);
    assert.equal(current.ownership,'user'); assert.ok(current.executionRisk);
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
    await shell.getByRole('button',{name:/页面执行状态未知/}).click();
    for(let i=0;i<100;i++){current=(await call('GET','/rooms')).rooms.find(item=>item.id===room.id);if(!current.executionRisk)break;await delay(25);}
    assert.equal(current.executionRisk,null);
    await shell.getByRole('button',{name:'交还 Agent'}).click();
    assert.ok((await call('POST',`/tabs/${tab.id}/action`,{operation:'snapshot'})).items);
    await call('DELETE',`/rooms/${room.id}`);
    console.log('PASS evaluation timeout state, restart, user review and resumeControl');
  } finally {
    if(app) await app.close().catch(()=>{});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
