const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const project=path.resolve(__dirname,'..');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-download-')),dataDir=path.join(root,'data'),downloadDir=path.join(root,'downloads');fs.mkdirSync(downloadDir);
  const original=path.join(downloadDir,'existing.txt');fs.writeFileSync(original,'preserve me');
  let existingAttempts=0;
  const server=http.createServer((req,res)=>{
    const retrying=req.url==='/existing'&&existingAttempts++>0;
    const name=req.url==='/existing'?(retrying?'existing-retry.bin':'existing.txt'):req.url==='/slow'?'slow.bin':req.url==='/restart'?'restart-success.bin':'new.txt';
    res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
    if(req.url==='/slow'){res.setHeader('Content-Length',5_000_000);let sent=0;const timer=setInterval(()=>{if(res.destroyed){clearInterval(timer);return;}res.write(Buffer.alloc(10000));sent+=10000;if(sent>=5_000_000){clearInterval(timer);res.end();}},30);res.on('close',()=>clearInterval(timer));}
    else if(retrying){res.setHeader('Content-Length',200_000);let sent=0;const timer=setInterval(()=>{if(res.destroyed){clearInterval(timer);return;}res.write(Buffer.alloc(10_000,114));sent+=10_000;if(sent>=200_000){clearInterval(timer);res.end();}},50);res.on('close',()=>clearInterval(timer));}
    else if(req.url==='/restart')res.end('recovered after restart');
    else res.end('download contents');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  let app;
  async function start(){app=await _electron.launch({executablePath:electronPath,args:[project],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_PORT:'0',CORVID_TEST_MODE:'1',CORVID_TEST_DOWNLOAD_DIR:downloadDir}});const shell=await app.firstWindow();let c;for(let i=0;i<200;i++){try{c=JSON.parse(fs.readFileSync(path.join(dataDir,'control.json')));break}catch{await delay(50)}}assert.ok(c);return {shell, list:async()=>{const r=await fetch(c.baseUrl+'/downloads',{headers:{Authorization:`Bearer ${c.token}`}});assert.ok(r.ok);return (await r.json()).downloads;}};}
  async function stop(){await app.close();app=undefined;}
  async function navigate(shell,url){await shell.locator('#address').fill(url);await shell.locator('#address').press('Enter');}
  async function until(list,predicate){for(let i=0;i<200;i++){const entries=await list();const found=entries.find(predicate);if(found)return found;await delay(50)}throw Error('Download state timeout');}
  try{
    let {shell,list}=await start();await shell.locator('#library-trigger').click();await shell.locator('#library-menu:not([hidden])').waitFor();await shell.locator('#show-downloads').click();
    await navigate(shell,base+'/ok');await until(list,x=>x.filename==='new.txt'&&x.status==='completed');assert.equal(fs.readFileSync(path.join(downloadDir,'new.txt'),'utf8'),'download contents');await shell.getByText('new.txt — 已完成',{exact:true}).waitFor();
    await navigate(shell,base+'/existing');const failedRetry=await until(list,x=>x.filename==='existing.txt'&&x.status==='failed');assert.equal(fs.readFileSync(original,'utf8'),'preserve me');await shell.getByText(/existing.txt — 失败/).waitFor();
    const failedRetryRow=shell.locator('.entry').filter({hasText:'existing.txt'});await failedRetryRow.getByRole('button',{name:'重试',exact:true}).click();
    const retryProgress=await until(list,x=>x.retryOf===failedRetry.id&&x.filename==='existing-retry.bin'&&x.status==='progressing');assert.equal((await list()).find(x=>x.id===failedRetry.id).retrying,true,'the source row must show a retry while its new transfer is active');
    assert.equal(await failedRetryRow.getByRole('button',{name:'重试中…',exact:true}).isDisabled(),true,'the source row must disable repeated retry while the new transfer is active');
    const completedRetry=await until(list,x=>x.retryOf===failedRetry.id&&x.filename==='existing-retry.bin'&&x.status==='completed');assert.equal(fs.statSync(path.join(downloadDir,completedRetry.filename)).size,200_000);
    assert.equal((await list()).find(x=>x.id===failedRetry.id).status,failedRetry.status,'a retry must preserve the original failed/interrupted record');
    await shell.getByText('existing-retry.bin — 已完成',{exact:true}).waitFor();await shell.screenshot({path:'/tmp/corvid-download-retry.png'});
    await navigate(shell,base+'/slow');await until(list,x=>x.filename==='slow.bin'&&x.status==='progressing'&&x.receivedBytes>0);await shell.getByText(/slow.bin — 下载中/).waitFor();await shell.getByRole('button',{name:'取消',exact:true}).click();await until(list,x=>x.filename==='slow.bin'&&x.status==='cancelled');await shell.getByText('slow.bin — 已取消',{exact:true}).waitFor();
    const cancelledSource=(await list()).find(x=>x.filename==='slow.bin');const slowRow=shell.locator('.entry').filter({hasText:'slow.bin — 已取消'});await slowRow.getByRole('button',{name:'重试',exact:true}).click();const slowRetry=await until(list,x=>x.retryOf===cancelledSource.id&&x.status==='progressing');await shell.locator('.entry').filter({hasText:'slow.bin — 下载中'}).getByRole('button',{name:'取消',exact:true}).click();await until(list,x=>x.id===slowRetry.id&&x.status==='cancelled');assert.equal((await list()).find(x=>x.id===cancelledSource.id).status,'cancelled');
    await shell.mouse.move(...Object.values(await shell.evaluate(()=>({x:Math.round(innerWidth/2),y:innerHeight-2}))),{steps:2});await shell.getByRole('button',{name:'浏览身份选项'}).click();await shell.getByRole('menuitem',{name:'新建浏览身份'}).click();await shell.locator('#profile-name').fill('隔离下载测试');await shell.getByRole('button',{name:'新建浏览身份'}).click();await shell.locator('#profile-select').selectOption({label:'隔离下载测试'});await shell.locator('#library-trigger').click();await shell.locator('#library-menu:not([hidden])').waitFor();await shell.locator('#show-downloads').click();assert.equal((await list()).length,0,'download history must be isolated by browser profile');await shell.locator('#profile-select').selectOption({index:0});
    await stop();
    const libraryPath=path.join(dataDir,'library.json'),libraryData=JSON.parse(fs.readFileSync(libraryPath,'utf8'));libraryData.downloads.push({id:'interrupted-before-restart',profileId:'default',url:`${base}/restart`,filename:'restart-before-crash.bin',path:null,status:'progressing',receivedBytes:1024,totalBytes:100000,createdAt:new Date().toISOString()});fs.writeFileSync(libraryPath,JSON.stringify(libraryData));
    ({shell,list}=await start());assert.equal((await list()).find(x=>x.id==='interrupted-before-restart').status,'interrupted');await shell.locator('#library-trigger').click();await shell.locator('#library-menu:not([hidden])').waitFor();await shell.locator('#show-downloads').click();await shell.locator('.entry').filter({hasText:'restart-before-crash.bin — 已中断'}).getByRole('button',{name:'重试',exact:true}).click();const recovered=await until(list,x=>x.retryOf==='interrupted-before-restart'&&x.status==='completed');assert.equal(recovered.filename,'restart-success.bin');assert.equal((await list()).find(x=>x.id==='interrupted-before-restart').status,'interrupted');
    await stop();({shell,list}=await start());assert.equal((await list()).length,7);await shell.locator('#library-trigger').click();await shell.locator('#library-menu:not([hidden])').waitFor();await shell.locator('#show-downloads').click();await shell.getByText('new.txt — 已完成',{exact:true}).waitFor();await shell.getByText('slow.bin — 已取消',{exact:true}).first().waitFor();await shell.locator('#library-search').fill('SLOW.BIN');await shell.getByText('slow.bin — 已取消',{exact:true}).first().waitFor();assert.equal(await shell.getByText('new.txt — 已完成',{exact:true}).count(),0);await shell.locator('#library-search').fill('/existing');await shell.getByText(/existing.txt — 失败/).waitFor();await shell.locator('#library-search').fill('no-such-download');await shell.getByText('没有匹配结果').waitFor();await stop();
    console.log('PASS downloads: complete, progress, cancel, safe retry, existing file preserved, UI and restart history');
  }finally{if(app)await app.close().catch(()=>{});await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
