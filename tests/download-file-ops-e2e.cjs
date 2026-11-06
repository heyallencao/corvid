const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-download-ops-'));
  const downloadDir=path.join(dataDir,'downloads');fs.mkdirSync(downloadDir);
  const server=http.createServer((req,res)=>{
    if(req.url==='/file'){
      res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="notes.txt"'});
      res.end('download file contents');return;
    }
    res.writeHead(200,{'content-type':'text/html'});
    res.end('<!doctype html><title>Downloads</title><p>fixture</p>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let app;
  const until=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  try{
    app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0',CORVID_TEST_DOWNLOAD_DIR:downloadDir}});
    const shell=await app.firstWindow();
    let config;
    for(let i=0;i<200;i++){try{config=JSON.parse(fs.readFileSync(path.join(dataDir,'control.json')));break}catch{await delay(50)}}
    assert.ok(config);
    const downloads=async()=>{const response=await fetch(config.baseUrl+'/downloads',{headers:{authorization:`Bearer ${config.token}`}});assert.equal(response.status,200);return (await response.json()).downloads;};
    await shell.locator('#address').fill(base+'/file');
    await shell.locator('#address').press('Enter');
    const entry=await until(async()=>(await downloads()).find(item=>item.filename==='notes.txt'&&item.status==='completed'),'completed download');
    await shell.locator('#library-trigger').click();await shell.locator('#library-menu:not([hidden])').waitFor();await shell.locator('#show-downloads').click();
    await shell.getByText('notes.txt — 已完成',{exact:true}).waitFor();
    // Replacing the native shell helpers keeps the test offline: it verifies
    // which path the app forwards rather than opening a real application.
    await app.evaluate(({shell})=>{
      globalThis.__corvidShellCalls=[];
      shell.openPath=async target=>{globalThis.__corvidShellCalls.push(['open',target]);return '';};
      shell.showItemInFolder=target=>{globalThis.__corvidShellCalls.push(['reveal',target]);};
    });
    const calls=()=>app.evaluate(()=>globalThis.__corvidShellCalls);
    await shell.getByRole('button',{name:'打开',exact:true}).click();
    await until(async()=>(await calls()).some(([kind,target])=>kind==='open'&&target===entry.path),'open file call');
    await shell.getByRole('button',{name:'在文件夹中显示',exact:true}).click();
    await until(async()=>(await calls()).some(([kind,target])=>kind==='reveal'&&target===entry.path),'reveal file call');
    // A failure from the OS must surface as a visible alert instead of being
    // swallowed by the download panel.
    await app.evaluate(({shell})=>{shell.openPath=async()=>'permission denied';});
    await shell.getByRole('button',{name:'打开',exact:true}).click();
    await shell.getByRole('alert').filter({hasText:'无法打开文件：permission denied'}).waitFor();
    assert.equal(fs.readFileSync(path.join(downloadDir,'notes.txt'),'utf8'),'download file contents');
    console.log('PASS download open and reveal file actions plus OS error alert');
  }finally{
    if(app)await app.close().catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
