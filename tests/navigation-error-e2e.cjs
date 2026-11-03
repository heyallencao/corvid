const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{for(let i=0;i<200;i++){const result=await fn();if(result)return result;await delay(25);}throw new Error(`Timed out waiting for ${label}`);};

(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-navigation-error-'));
  let app,client,failUntilRecovery=true,failedRequests=0,releaseCancel,signalCancelStarted;
  const cancelGate=new Promise(resolve=>releaseCancel=resolve);
  const cancelStarted=new Promise(resolve=>signalCancelStarted=resolve);
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/fail'){
      failedRequests++;
      if(failUntilRecovery){req.socket.destroy();return;}
      res.writeHead(200,{'content-type':'text/html'});res.end('<title>Recovered navigation</title><h1>Recovered</h1>');return;
    }
    if(req.url==='/cancel'){
      signalCancelStarted();await cancelGate;
      if(!res.destroyed){res.writeHead(200,{'content-type':'text/html'});res.end('<title>Cancelled navigation</title>');}
      return;
    }
    res.writeHead(200,{'content-type':'text/html'});res.end('<title>Navigation fixture</title><h1>Ready</h1>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_PORT:'0',CORVID_TEST_MODE:'1'}});
    const shell=await app.firstWindow();
    const connection=await until(()=>{try{return JSON.parse(fs.readFileSync(path.join(dataDir,'control.json'),'utf8'));}catch{return null;}},'control connection');
    client=await (await import('../sdk/index.js')).connect({dataDir});
    await shell.locator('#create-room-trigger').click();
    await shell.locator('#room-name').fill('Navigation errors');await shell.locator('#new-room-form').press('Enter');
    const room=await until(async()=>(await client.rooms()).find(item=>item.name==='Navigation errors'),'user-owned Room');
    await shell.locator('#new-room').waitFor({state:'hidden'});
    await shell.locator('#room-strip').getByRole('button',{name:'Navigation errors'}).click();
    let lastTabState;
    const waitForTab=predicate=>until(async()=>{lastTabState=(await room.tabs())[0];return predicate(lastTabState)?lastTabState:false;},'browser tab state').catch(error=>{console.error('Last tab state:',lastTabState);throw error;});
    await shell.locator('#address').fill(`${base}/home`);await shell.locator('#address').press('Enter');
    await waitForTab(tab=>tab.url===`${base}/home`&&tab.loadComplete);
    await shell.evaluate(()=>window.browserShell.invoke('setUiLocale',{locale:'en'}));
    await shell.locator('#address').fill(`${base}/fail`);await shell.locator('#address').press('Enter');
    await shell.locator('#status .navigation-error').waitFor();
    assert.ok(failedRequests>0,'fixture should receive the failed navigation request');
    assert.match(await shell.locator('#status .navigation-error').textContent(),/Page failed to load: Unable to load this page/);
    assert.equal(await shell.locator('#address').inputValue(),`${base}/fail`,'failed URL must remain visible for editing');
    assert.equal(await shell.locator('#status').getByRole('button',{name:'Retry'}).count(),1,'user-owned tab should expose retry');
    const failedTabId=(await room.tabs())[0].id;
    assert.equal(await shell.locator(`#tabs .tab[data-tab-id="${failedTabId}"] .tab-loading-indicator`).count(),0,'failed navigation must not leave a tab spinner');
    await shell.locator('#new-tab').click();
    const newTab=await until(async()=>(await room.tabs()).find(tab=>tab.id!==failedTabId),'second tab');
    await shell.locator(`#tabs .tab[data-tab-id="${newTab.id}"][data-active="true"]`).waitFor();
    await shell.locator('#address').fill(`${base}/home`);await shell.locator('#address').press('Enter');
    await until(async()=>{const tab=(await room.tabs()).find(item=>item.id===newTab.id);return tab?.url===`${base}/home`&&tab.loadComplete;},'second tab navigation');
    assert.equal(await shell.locator('#status .navigation-error').count(),0,'navigation failure must not leak across tabs');
    await shell.locator(`#tabs [data-tab-id="${failedTabId}"] .tab-main`).click();
    await shell.locator('#status .navigation-error').waitFor();
    assert.equal(await shell.locator('#address').inputValue(),`${base}/fail`,'returning to the failed tab should restore its retry URL');
    const roomState=await fetch(`${connection.baseUrl}/rooms`,{headers:{authorization:`Bearer ${connection.token}`}}).then(response=>response.json());
    const failedTab=roomState.rooms.find(item=>item.id===room.id).tabs.find(item=>item.id===failedTabId);
    assert.equal(failedTab.navigationError.url,`${base}/fail`,'error must be bound to its owning tab and URL');
    assert.equal(failedTab.isLoading,false,'failed navigation must leave loading state');
    failUntilRecovery=false;
    await shell.locator('#status').getByRole('button',{name:'Retry'}).click();
    const recovered=await waitForTab(tab=>tab.url===`${base}/fail`&&tab.loadComplete&&tab.title==='Recovered navigation');
    await until(async()=>await shell.locator('#status .navigation-error').count()===0,'error cleared after retry');
    assert.equal(recovered.title,'Recovered navigation');

    await shell.locator('#address').fill(`${base}/cancel`);await shell.locator('#address').press('Enter');
    await Promise.race([cancelStarted,new Promise((_,reject)=>setTimeout(()=>reject(new Error('cancel fixture did not start')),5000))]);
    await shell.locator('#status .navigation-loading').waitFor();
    await shell.locator('#address').fill(`${base}/home`);await shell.locator('#address').press('Enter');
    await waitForTab(tab=>tab.url===`${base}/home`&&tab.loadComplete);
    releaseCancel();
    await delay(150);
    assert.equal(await shell.locator('#status .navigation-error').count(),0,'superseded navigation must not leave a stale error');
    assert.equal(await shell.locator('#address').inputValue(),`${base}/home`);

    console.log('PASS navigation failure feedback, preserved URL, loading state, retry recovery and superseded navigation');
  }finally{
    releaseCancel?.();
    if(client)await client.disconnect().catch(()=>{});
    if(app)await app.close().catch(()=>{});
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
