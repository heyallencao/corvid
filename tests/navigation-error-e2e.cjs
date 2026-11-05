const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const net=require('node:net');
const os=require('node:os');
const path=require('node:path');
const {navigationFailureDetails,navigationHttpStatusFailure}=require('../desktop/navigation-errors.cjs');

const root=path.resolve(__dirname,'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{for(let i=0;i<200;i++){const result=await fn();if(result)return result;await delay(25);}throw new Error(`Timed out waiting for ${label}`);};

(async()=>{
  assert.deepEqual(navigationFailureDetails(-105,'net::ERR_NAME_NOT_RESOLVED','en'),{message:'Server not found',code:'ERR_NAME_NOT_RESOLVED'},'DNS failures should retain a specific reason and safe Chromium code');
  assert.deepEqual(navigationFailureDetails(-118,'net::ERR_TIMED_OUT','en'),{message:'Connection timed out',code:'ERR_TIMED_OUT'},'Chromium timeout errors should have a specific localized reason and safe code');
  assert.deepEqual(navigationFailureDetails(-777,'https://fixture.invalid/ERR_CONNECTION_REFUSED','en'),{message:'Unable to load this page',code:'-777'},'error details should not extract code-like strings from URLs');
  assert.deepEqual(navigationHttpStatusFailure(408,'zh-CN'),{message:'服务器返回 HTTP 408',code:'HTTP 408'});
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-navigation-error-'));
  let app,client,failUntilRecovery=true,failedRequests=0,releaseCancel,signalCancelStarted;
  const cancelGate=new Promise(resolve=>releaseCancel=resolve);
  const cancelStarted=new Promise(resolve=>signalCancelStarted=resolve);
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/status/500'||req.url==='/status/408'){
      const statusCode=Number(req.url.split('/').at(-1));
      if(statusCode===408)await delay(250);
      res.writeHead(statusCode,{'content-type':'text/html'});res.end(`<title>HTTP ${statusCode} fixture</title><h1>HTTP ${statusCode}</h1>`);return;
    }
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
  const unusedPortServer=net.createServer();
  await new Promise(resolve=>unusedPortServer.listen(0,'127.0.0.1',resolve));
  const refusedPort=unusedPortServer.address().port;
  await new Promise((resolve,reject)=>unusedPortServer.close(error=>error?reject(error):resolve()));
  try{
    app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_PORT:'0',CORVID_TEST_MODE:'1'}});
    const shell=await app.firstWindow();
    await app.evaluate(({clipboard})=>{globalThis.__corvidIssue202CopiedUrl=null;clipboard.writeText=text=>{globalThis.__corvidIssue202CopiedUrl=text;};});
    const connection=await until(()=>{try{return JSON.parse(fs.readFileSync(path.join(dataDir,'control.json'),'utf8'));}catch{return null;}},'control connection');
    client=await (await import('../sdk/index.js')).connect({dataDir});
    await shell.locator('#create-room-trigger').click();
    await shell.locator('#room-name').fill('Navigation errors');await shell.locator('#new-room-form').press('Enter');
    const room=await until(async()=>(await client.rooms()).find(item=>item.name==='Navigation errors'),'user-owned Room');
    await shell.locator('#new-room').waitFor({state:'hidden'});
    await shell.locator('#room-strip').getByRole('button',{name:'Navigation errors'}).click();
    let lastTabState;
    const waitForTab=predicate=>until(async()=>{lastTabState=(await room.tabs())[0];return predicate(lastTabState)?lastTabState:false;},'browser tab state').catch(error=>{console.error('Last tab state:',lastTabState);throw error;});
    const waitForError=message=>until(async()=>{const value=await shell.locator('#status .navigation-error').textContent().catch(()=>null);return value?.includes(message)?value:false;},`navigation message ${message}`);
    const waitForHttpStatus=async(statusCode,message)=>{await waitForError(message);return waitForTab(tab=>tab.loadComplete&&tab.navigationError?.code===`HTTP ${statusCode}`);};
    await shell.evaluate(()=>window.browserShell.invoke('setUiLocale',{locale:'en'}));
    await shell.waitForFunction(()=>document.querySelector('#connection-indicator')?.getAttribute('aria-label')==='Local page');
    await shell.locator('#address').fill(`${base}/home`);await shell.locator('#address').press('Enter');
    await waitForTab(tab=>tab.url===`${base}/home`&&tab.loadComplete);
    await shell.waitForFunction(()=>document.querySelector('#connection-indicator')?.getAttribute('aria-label')==='Connection is not encrypted');
    assert.equal(await shell.locator('#connection-indicator').getAttribute('data-connection-state'),'unencrypted','an HTTP page should show that its connection is unencrypted');
    assert.equal(await shell.locator('#connection-indicator').getAttribute('aria-label'),'Connection is not encrypted','the connection state should be accessible in English');
    assert.equal(await shell.locator('.nav-symbol').evaluateAll(icons=>icons.length===6&&icons.every(icon=>icon.querySelector('svg')&&!icon.textContent.trim())),true,'sidebar navigation should render drawn SVG icons instead of text glyphs');
    await shell.evaluate(()=>window.browserShell.invoke('setUiLocale',{locale:'zh-CN'}));
    await shell.waitForFunction(()=>document.querySelector('#connection-indicator')?.getAttribute('aria-label')==='连接未加密');
    assert.equal(await shell.locator('#connection-indicator').getAttribute('aria-label'),'连接未加密','the connection state should follow the Chinese locale');
    await shell.locator('#address').fill(`${base}/status/500`);await shell.locator('#address').press('Enter');
    const http500Zh=await waitForHttpStatus(500,'服务器返回 HTTP 500');
    assert.equal(await shell.locator('#connection-indicator').getAttribute('data-connection-state'),'unencrypted','an HTTP error response is still an unencrypted connection, not an unknown connection');
    assert.equal(await shell.locator('#status .navigation-error').textContent(),'服务器返回 HTTP 500','Chinese UI should state the HTTP 500 response without calling the loaded page a navigation failure');
    assert.equal(http500Zh.navigationError.code,'HTTP 500');
    assert.equal(await shell.locator('#status').getAttribute('data-tone'),'danger','navigation errors should use the danger status tone');
    assert.equal(await shell.locator('#tabs .tab[data-active="true"] .tab-title').textContent(),`127.0.0.1:${server.address().port}`,'a failed tab should show its site host instead of the raw URL');
    await shell.locator('#status').getByRole('button',{name:'复制链接'}).click();
    assert.equal(await app.evaluate(()=>globalThis.__corvidIssue202CopiedUrl),`${base}/status/500`,'copy link should copy the failed navigation URL');
    assert.equal(await shell.locator('#address').inputValue(),`${base}/status/500`,'HTTP response errors should preserve the address for editing');
    await shell.locator('#status').getByRole('button',{name:'重试'}).click();
    await waitForHttpStatus(500,'服务器返回 HTTP 500');
    const qaDir=process.env.CORVID_NAVIGATION_QA_DIR,issue202QaDir=process.env.CORVID_ISSUE202_QA_DIR;
    if(qaDir){
      fs.mkdirSync(qaDir,{recursive:true});
      await shell.setViewportSize({width:1024,height:700});
      await shell.screenshot({path:path.join(qaDir,'issue-198-http-500-zh-CN-1024x700.png')});
    }
    if(issue202QaDir){
      fs.mkdirSync(issue202QaDir,{recursive:true});
      await shell.setViewportSize({width:1024,height:700});
      await shell.screenshot({path:path.join(issue202QaDir,'issue-202-http-500-zh-CN-1024x700.png')});
      await shell.setViewportSize({width:700,height:420});
      await shell.screenshot({path:path.join(issue202QaDir,'issue-202-http-500-zh-CN-700x420.png')});
      await shell.setViewportSize({width:1024,height:700});
    }
    await shell.evaluate(()=>window.browserShell.invoke('setUiLocale',{locale:'en'}));
    await shell.locator('#address').fill(`${base}/status/408`);await shell.locator('#address').press('Enter');
    const http408En=await waitForHttpStatus(408,'Server returned HTTP 408');
    assert.equal(await shell.locator('#status .navigation-error').textContent(),'Server returned HTTP 408','HTTP 408 should explain the server timeout response');
    assert.equal(http408En.navigationError.code,'HTTP 408');
    assert.equal(await shell.locator('#status').getByRole('button',{name:'Copy link'}).count(),1,'copy link should be localized in English');
    await shell.locator('#address').fill(`${base}/status/500`);await shell.locator('#address').press('Enter');
    await waitForHttpStatus(500,'Server returned HTTP 500');
    if(issue202QaDir){await shell.setViewportSize({width:1280,height:850});await shell.screenshot({path:path.join(issue202QaDir,'issue-202-http-500-en-1280x850.png')});}
    await shell.setViewportSize({width:700,height:420});
    assert.equal(await shell.locator('#status').evaluate(element=>element.scrollWidth<=element.clientWidth),true,'short-window error status should not overflow horizontally');
    assert.equal(await shell.locator('#status').getByRole('button',{name:'Retry'}).isVisible(),true,'short-window retry should remain visible');
    assert.equal(await shell.locator('#status').getByRole('button',{name:'Copy link'}).isVisible(),true,'short-window copy link should remain visible');
    assert.equal(await shell.locator('#status .navigation-error-details summary').isVisible(),true,'short-window error-code disclosure should remain visible');
    if(qaDir){
      await shell.screenshot({path:path.join(qaDir,'issue-198-http-500-en-700x420.png')});
    }
    await shell.setViewportSize({width:1280,height:850});
    const details=shell.locator('#status .navigation-error-details');
    assert.equal(await details.locator('code').isVisible(),false,'the raw status code should remain collapsed until requested');
    await details.locator('summary').click();
    assert.equal(await details.locator('code').textContent(),'HTTP 500','the collapsed technical detail should expose the raw HTTP status code');
    const refusedUrl=`http://127.0.0.1:${refusedPort}/unavailable`;
    await shell.locator('#address').fill(refusedUrl);await shell.locator('#address').press('Enter');
    assert.match(await waitForError('Server refused the connection'),/Page failed to load: Server refused the connection/,'connection refusal should differ from HTTP failures');
    assert.equal((await room.tabs())[0].navigationError.code,'ERR_CONNECTION_REFUSED');
    assert.equal(await shell.locator('#connection-indicator').getAttribute('data-connection-state'),'unknown','a failed connection must not be shown as encrypted');
    await shell.locator('#address').fill(`${base}/fail`);await shell.locator('#address').press('Enter');
    await waitForError('Unable to load this page');
    assert.ok(failedRequests>0,'fixture should receive the failed navigation request');
    assert.match(await shell.locator('#status .navigation-error').textContent(),/Page failed to load: Unable to load this page/);
    assert.equal(await shell.locator('#address').inputValue(),`${base}/fail`,'failed URL must remain visible for editing');
    assert.equal(await shell.locator('#status').getByRole('button',{name:'Retry'}).count(),1,'user-owned tab should expose retry');
    const failedTabId=(await room.tabs())[0].id;
    assert.equal(await shell.locator(`#tabs .tab[data-tab-id="${failedTabId}"] .tab-title`).textContent(),`127.0.0.1:${server.address().port}`,'connection errors should also show the site host');
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
    const loadingTab=await waitForTab(tab=>tab.isLoading);
    await shell.locator(`#tabs .tab[data-tab-id="${loadingTab.id}"] .tab-loading-indicator`).waitFor();
    assert.equal(await shell.locator('#status .navigation-loading').count(),0,'loading feedback should not add a status-bar row');
    assert.equal(await shell.locator('#status').isVisible(),false,'loading should not make the status bar appear');
    assert.equal(await shell.locator('#chrome-tools').evaluate(element=>getComputedStyle(element,'::after').height),'2px','loading should use a two-pixel progress line inside the existing toolbar');
    assert.equal(await shell.locator('#chrome-tools').evaluate(element=>Number(getComputedStyle(element,'::after').opacity)),1,'the progress line should be visible during navigation');
    assert.equal(await shell.locator('#chrome-tools').evaluate(element=>element.getBoundingClientRect().height),50,'the progress line should not change toolbar height');
    await shell.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await shell.locator('#chrome-tools').evaluate(element=>getComputedStyle(element,'::after').animationName),'none','the progress line should respect reduced motion');
    if(issue202QaDir)await shell.screenshot({path:path.join(issue202QaDir,'issue-202-loading-tab-spinner-en-1280x850.png')});
    await shell.emulateMedia({reducedMotion:'no-preference'});
    await shell.locator('#address').fill(`${base}/home`);await shell.locator('#address').press('Enter');
    await waitForTab(tab=>tab.url===`${base}/home`&&tab.loadComplete);
    releaseCancel();
    await delay(150);
    assert.equal(await shell.locator('#chrome-tools').evaluate(element=>Number(getComputedStyle(element,'::after').opacity)),0,'the progress line should clear after navigation completes');
    assert.equal(await shell.locator('#status .navigation-error').count(),0,'superseded navigation must not leave a stale error');
    assert.equal(await shell.locator('#address').inputValue(),`${base}/home`);

    console.log('PASS localized connection, timeout-code, HTTP status and unknown failures; preserved URL, retry recovery and superseded navigation');
  }finally{
    releaseCancel?.();
    if(client)await client.disconnect().catch(()=>{});
    if(app)await app.close().catch(()=>{});
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
