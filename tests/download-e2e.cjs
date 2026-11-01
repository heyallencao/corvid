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
  const server=http.createServer((req,res)=>{
    const name=req.url==='/existing'?'existing.txt':req.url==='/slow'?'slow.bin':'new.txt';
    res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
    if(req.url==='/slow'){res.setHeader('Content-Length',5_000_000);let sent=0;const timer=setInterval(()=>{if(res.destroyed){clearInterval(timer);return;}res.write(Buffer.alloc(10000));sent+=10000;if(sent>=5_000_000){clearInterval(timer);res.end();}},30);res.on('close',()=>clearInterval(timer));}
    else res.end('download contents');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  let app;
  async function start(){app=await _electron.launch({executablePath:electronPath,args:[project],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_PORT:'0',CORVID_TEST_MODE:'1',CORVID_TEST_DOWNLOAD_DIR:downloadDir}});const shell=await app.firstWindow();let c;for(let i=0;i<200;i++){try{c=JSON.parse(fs.readFileSync(path.join(dataDir,'control.json')));break}catch{await delay(50)}}assert.ok(c);return {shell, list:async()=>{const r=await fetch(c.baseUrl+'/downloads',{headers:{Authorization:`Bearer ${c.token}`}});assert.ok(r.ok);return (await r.json()).downloads;}};}
  async function stop(){await app.close();app=undefined;}
  async function navigate(shell,url){await shell.locator('#address').fill(url);await shell.locator('#address').press('Enter');}
  async function until(list,predicate){for(let i=0;i<200;i++){const entries=await list();const found=entries.find(predicate);if(found)return found;await delay(50)}throw Error('Download state timeout');}
  try{
    let {shell,list}=await start();await shell.locator('#show-downloads').click();
    await navigate(shell,base+'/ok');await until(list,x=>x.filename==='new.txt'&&x.status==='completed');assert.equal(fs.readFileSync(path.join(downloadDir,'new.txt'),'utf8'),'download contents');await shell.getByText('new.txt — 已完成',{exact:true}).waitFor();
    await navigate(shell,base+'/existing');await until(list,x=>x.filename==='existing.txt'&&x.status==='failed');assert.equal(fs.readFileSync(original,'utf8'),'preserve me');await shell.getByText(/existing.txt — 失败/).waitFor();
    await navigate(shell,base+'/slow');await until(list,x=>x.filename==='slow.bin'&&x.status==='progressing'&&x.receivedBytes>0);await shell.getByText(/slow.bin — 下载中/).waitFor();await shell.getByRole('button',{name:'取消',exact:true}).click();await until(list,x=>x.filename==='slow.bin'&&x.status==='cancelled');await shell.getByText('slow.bin — 已取消',{exact:true}).waitFor();
    await stop();({shell,list}=await start());assert.equal((await list()).length,3);await shell.locator('#show-downloads').click();await shell.getByText('new.txt — 已完成',{exact:true}).waitFor();await shell.getByText('slow.bin — 已取消',{exact:true}).waitFor();await shell.locator('#library-search').fill('SLOW.BIN');await shell.getByText('slow.bin — 已取消',{exact:true}).waitFor();assert.equal(await shell.getByText('new.txt — 已完成',{exact:true}).count(),0);await shell.locator('#library-search').fill('/existing');await shell.getByText(/existing.txt — 失败/).waitFor();await shell.locator('#library-search').fill('no-such-download');await shell.getByText('没有匹配结果').waitFor();await stop();
    console.log('PASS downloads: complete, progress, cancel, existing file preserved, UI and restart history');
  }finally{if(app)await app.close().catch(()=>{});await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
