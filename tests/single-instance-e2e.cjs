const {_electron}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {launchPackagedApp}=require('./packaged-app-launcher.cjs');

const project=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const packagedAppPath=process.env.CORVID_PACKAGED_APP_PATH?path.resolve(process.env.CORVID_PACKAGED_APP_PATH):null;
const executablePath=packagedAppPath||require('electron');
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-single-instance-'));
  let app,second;
  try{
    const appEnv={...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'};
    if(packagedAppPath){
      app=await launchPackagedApp({executablePath:packagedAppPath,dataDir,env:appEnv});
    }else{
      app=await _electron.launch({executablePath,args:[project],env:appEnv});
    }
    const shell=packagedAppPath?app.page:await app.firstWindow();
    let control;
    for(let attempt=0;attempt<200;attempt++){
      try{control=JSON.parse(fs.readFileSync(path.join(dataDir,'control.json'),'utf8'));break;}catch{await delay(50);}
    }
    assert.ok(control?.baseUrl&&control?.token,'first instance exposes its control endpoint');
    if(!packagedAppPath){
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
      assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false,'the first window is hidden before the second launch');
    }

    second=spawn(executablePath,process.env.CORVID_PACKAGED_APP_PATH?[]:[project],{cwd:project,env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'},stdio:'ignore'});
    const secondExit=await new Promise(resolve=>{
      const timer=setTimeout(()=>resolve(null),10_000);
      second.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});
      second.once('error',error=>{clearTimeout(timer);resolve({error});});
    });
    assert.ok(secondExit,'second Corvid process exits after handing activation to the first instance');
    assert.equal(secondExit.error,undefined);
    assert.equal(secondExit.signal,null);
    assert.equal(secondExit.code,0);

    const response=await fetch(`${control.baseUrl}/rooms`,{headers:{authorization:`Bearer ${control.token}`}});
    assert.equal(response.status,200,'the original process retains the control service');
    if(packagedAppPath){
      assert.equal(shell.isClosed(),false,'the original packaged renderer remains open');
      assert.equal(shell.context().pages().filter(page=>page.url().startsWith('file://')).length,1,'the second process does not open another packaged renderer');
    }else{
      assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1,'the second process does not create another BrowserWindow');
      assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true,'the second-instance event shows the existing window');
    }
    assert.ok(await shell.locator('#rooms').count());
    console.log('PASS a second process focuses the running Corvid instance without opening another window');
  }finally{
    if(second&&second.exitCode===null&&!second.signalCode){second.kill('SIGTERM');await new Promise(resolve=>second.once('exit',resolve));}
    if(app)await app.close().catch(()=>{});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
