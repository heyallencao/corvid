import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import electron from 'electron';
import { connect } from '../sdk/index.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(25);}throw new Error('Timed out waiting for dialog or app');}

test('page dialogs can be handled while their triggering action is pending', {timeout:30000},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'corvid-dialog-'));
  const server=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(`<title>Dialogs</title><button id="alert" onclick="alert('hello');document.body.dataset.alert='done'">alert</button><button id="confirm" onclick="document.body.dataset.confirm=confirm('continue?')">confirm</button><button id="do-prompt" onclick="document.body.dataset.prompt=window.prompt('name?','default')">prompt</button><button id="sequence" onclick="alert('first');document.body.dataset.sequence=prompt('second','')">sequence</button><script>window.errors=[];window.onerror=(message)=>window.errors.push(message);window.clicks=[];document.addEventListener("click",e=>window.clicks.push(e.target.id),true)</script>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const app=spawn(electron,['.'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,CORVID_DATA_DIR:dir,CORVID_TEST_MODE:'1'},stdio:['ignore','pipe','pipe']});
  let output='';app.stderr.on('data',chunk=>output+=chunk);app.stdout.on('data',chunk=>output+=chunk);
  try{
    const config=await until(async()=>{try{return JSON.parse(await readFile(path.join(dir,'control.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}});
    const client=await connect({dataDir:dir});const room=await client.createRoom('Dialog test');const page=await room.open(`http://127.0.0.1:${server.address().port}/`);
    for(const [selector,type,message,answer] of [['#alert','alert','hello','accept'],['#confirm','confirm','continue?','dismiss'],['#do-prompt','prompt','name?','prompt']]){
      let actionError, completed=false;const click=page.click(selector).then(()=>{completed=true;},error=>{actionError=error;});
      let opened;try {opened=await until(async()=>{if(actionError)throw actionError;return page.dialog();});}catch(error){error.message+=` (selector=${selector}, clickCompleted=${completed}, data=${JSON.stringify(await page.evaluate(()=>({dataset:{...document.body.dataset},clicks:window.clicks,promptType:typeof window.prompt,errors:window.errors})))})`;throw error;}assert.equal(opened.type,type);assert.equal(opened.message,message);
      assert.equal((await client.room(room.id)).info.ownership,'agent');
      if(answer==='dismiss') await page.dismissDialog();else if(answer==='prompt') {assert.equal(opened.defaultPrompt,'default');const nextClient=await connect({dataDir:dir});const nextPage=await (await nextClient.room(room.id)).page(page.tabId);assert.equal((await nextPage.dialog()).message,'name?');await nextPage.acceptDialog('agent');await nextClient.disconnect();}else await page.acceptDialog();
      await click;await until(async()=>!(await page.dialog()));
    }
    const sequence=page.click('#sequence');await until(async()=>{const dialog=await page.dialog();return dialog?.message==='first';});await page.acceptDialog();await until(async()=>{const dialog=await page.dialog();return dialog?.message==='second';});await page.acceptDialog('sequential');await sequence;
    assert.deepEqual(await page.evaluate(()=>({...document.body.dataset})),{alert:'done',confirm:'false',prompt:'agent',sequence:'sequential'});
    const defaultAnswer=page.evaluate(()=>prompt('default test','original'));await until(async()=>(await page.dialog())?.message==='default test');await page.acceptDialog();assert.equal(await defaultAnswer,'original');
    const cancelled=page.evaluate(()=>prompt('cancel test','original'));await until(async()=>(await page.dialog())?.message==='cancel test');await page.dismissDialog();assert.equal(await cancelled,null);
    const controller=new AbortController();const abandoned=fetch(`${config.baseUrl}/tabs/${page.tabId}/action`,{method:'POST',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},body:JSON.stringify({operation:'evaluate',args:{expression:"window.abandoned=prompt('reconnect','seed')"}}),signal:controller.signal}).catch(error=>error);
    await until(async()=>(await page.dialog())?.message==='reconnect');controller.abort();await abandoned;
    const resumed=await connect({dataDir:dir});const resumedPage=await (await resumed.room(room.id)).page(page.tabId);assert.equal((await resumedPage.dialog()).defaultPrompt,'seed');await resumedPage.acceptDialog('resumed');await until(async()=>(await resumedPage.evaluate(()=>window.abandoned))==='resumed');await resumed.disconnect();
    await room.close();await client.disconnect();
  } catch(error){error.message+=`\nElectron output: ${output}`;throw error;}
  finally{if(app.exitCode===null && app.signalCode===null){app.kill('SIGTERM');await Promise.race([once(app,'exit'),sleep(3000)]);if(app.exitCode===null && app.signalCode===null)app.kill('SIGKILL');}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
