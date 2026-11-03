const {_electron}=require('playwright-core');
const electron=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {closeElectron,launchElectron,waitForControl}=require('./electron-test-startup.cjs');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-restore-loading-'));
  let release,requests=0,app,token;
  const gate=new Promise(resolve=>release=resolve);
  const server=http.createServer(async(req,res)=>{if(req.url.startsWith('/slow')){requests++;await gate;}res.writeHead(200,{'content-type':'text/html'});res.end(`<title>${req.url}</title><p>${req.url}</p>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const saved={activeProfileId:'default',activeRoomId:'one',rooms:[{id:'one',name:'恢复Room',profileId:'default',ownership:'user',activeTabId:'fast',tabs:[{id:'slow',openedBy:'user',url:origin+'/slow'},{id:'fast',openedBy:'user',url:origin+'/fast'}]},{id:'two',name:'第二Room',profileId:'default',ownership:'user',activeTabId:'other',tabs:[{id:'other',openedBy:'user',url:origin+'/other'}]},{id:'three',name:'Agent room',profileId:'default',ownership:'agent',activeTabId:'agent',tabs:[{id:'agent',label:'p1',openedBy:'agent',url:origin+'/slow?agent'}]}]};
  fs.writeFileSync(path.join(dir,'rooms.json'),JSON.stringify(saved));
  async function until(fn){for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(25);}throw new Error('Timed out');}
  async function boot(){const launched=await launchElectron(_electron,{executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dir,CORVID_TEST_MODE:'1'}},{label:'restore-loading-e2e',dataDir:dir});app=launched.app;const shell=launched.shell;const config=await waitForControl(app,dir,{label:'restore-loading-e2e',previousToken:token});token=config.token;const call=async (route,body)=>{const result=await fetch(config.baseUrl+route,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(result.status,200);return result.json();};return {shell,call};}
  try{
    let {shell,call}=await boot();
    await until(()=>requests>=2);
    const state=await until(async()=>{const state=await call('/rooms');const fast=state.rooms.find(s=>s.id==='one')?.tabs.find(t=>t.id==='fast');const other=state.rooms.find(s=>s.id==='two')?.tabs[0];return fast?.ready && other?.ready && state;});
    assert.equal(state.rooms.find(s=>s.id==='one').tabs.find(t=>t.id==='slow').ready,false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'rooms.json'))).rooms[0].tabs[0].url,origin+'/slow');
    assert.equal((await call('/history')).history.length,0);
    await call('/tabs/agent/action',{operation:'navigate',args:{url:origin+'/agent-replacement'},pageLabel:'p1'});
    assert.equal((await call('/rooms')).rooms.find(s=>s.id==='three').tabs[0].url,origin+'/agent-replacement');
    await shell.locator('#tabs button').nth(0).click();
    await shell.locator('#address').fill(origin+'/replacement');await shell.locator('#address').press('Enter');
    await until(async()=>(await call('/rooms')).rooms.find(s=>s.id==='one').tabs.find(t=>t.id==='slow').url===origin+'/replacement');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'rooms.json'))).rooms[0].tabs[0].url,origin+'/replacement');
    assert.equal((await call('/history')).history.filter(item=>item.url===origin+'/replacement').length,1);
    release();await closeElectron(app);app=undefined;
    ({call}=await boot());
    await until(async()=>(await call('/rooms')).rooms.find(s=>s.id==='one').tabs.find(t=>t.id==='slow').url===origin+'/replacement');
    assert.equal((await call('/history')).history.filter(item=>item.url===origin+'/replacement').length,1);
    console.log('PASS slow session restore, saved URL preservation, independent rooms, navigation and restart');
  }finally{release();if(app)await closeElectron(app).catch(error=>{console.error(error);process.exitCode=1;});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
