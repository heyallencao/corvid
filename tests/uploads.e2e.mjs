import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import electron from 'electron';
import { connect } from '../sdk/index.js';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await delay(25);}throw new Error('Timed out');}

test('upload local files with node identity and handle a change-handler dialog', {timeout:30000},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'corvid-upload-'));const first=path.join(dir,'first.txt'),second=path.join(dir,'second.txt');await writeFile(first,'first content');await writeFile(second,'second content');
  const fixture=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(`<input id="file" type="file" multiple><input id="single" type="file"><button id="choose">Choose</button><iframe id="frame" srcdoc="&lt;input type=file aria-label='Frame file'&gt;"></iframe><div id="shadow"></div><script>document.querySelector('#choose').onclick=()=>{const input=document.createElement('input');input.type='file';input.id='dynamic';input.onchange=()=>{window.dynamicConfirmed=confirm('Dynamic upload?')};document.body.append(input);input.click()};document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<input type="file" aria-label="Shadow file">';window.events=[];document.querySelector('#file').addEventListener('input',e=>events.push({type:e.type,trusted:e.isTrusted}));document.querySelector('#file').addEventListener('change',e=>{events.push({type:e.type,trusted:e.isTrusted});window.confirmed=confirm('Upload files?')});</script>`);});await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const app=spawn(electron,['.'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,CORVID_DATA_DIR:path.join(dir,'profile'),CORVID_TEST_MODE:'1'},stdio:['ignore','pipe','pipe']});let output='';app.stdout.on('data',x=>output+=x);app.stderr.on('data',x=>output+=x);
  try {
    await until(async()=>{try{return JSON.parse(await readFile(path.join(dir,'profile','control.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}});
    const client=await connect({dataDir:path.join(dir,'profile')});const room=await client.createRoom('Upload');const page=await room.open(`http://127.0.0.1:${fixture.address().port}/`);
    await assert.rejects(()=>page.setInputFiles('#single',[first,second]),/multiple/);
    await assert.rejects(()=>page.setInputFiles('#file',['relative.txt']),/absolute/);
    await assert.rejects(()=>page.setInputFiles('#file',[path.join(dir,'missing.txt')]));
    const upload=page.setInputFiles('#file',[first,second]);
    const dialog=await until(async()=>page.dialog());assert.equal(dialog.type,'confirm');assert.equal(dialog.message,'Upload files?');await page.acceptDialog();await upload;
    const details=await page.evaluate(async()=>({names:[...document.querySelector('#file').files].map(f=>f.name),contents:await Promise.all([...document.querySelector('#file').files].map(f=>f.text())),events,confirmed}));
    assert.deepEqual(details.names,['first.txt','second.txt']);assert.deepEqual(details.contents,['first content','second content']);assert.equal(details.confirmed,true);assert.deepEqual(details.events.map(e=>e.type),['input','change']);
    await page.setInputFiles('#single',first);assert.equal(await page.evaluate(()=>document.querySelector('#single').files[0].name),'first.txt');
    await page.evaluate(()=>{window.clearEvents=[];for(const type of ['input','change'])document.querySelector('#single').addEventListener(type,event=>clearEvents.push({type,trusted:event.isTrusted}));return true;});
    await page.setInputFiles('#single',[]);assert.equal(await page.evaluate(()=>document.querySelector('#single').files.length),0);
    assert.deepEqual(await page.evaluate(()=>window.clearEvents),[{type:'input',trusted:false},{type:'change',trusted:false}]);
    const snapshot=await page.snapshot();const frame=snapshot.items.find(item=>item.name==='Frame file'),shadow=snapshot.items.find(item=>item.name==='Shadow file');assert.ok(frame && shadow);
    await page.setInputFiles(frame.ref,second);await page.setInputFiles(shadow.ref,first);
    assert.equal(await page.evaluate(()=>document.querySelector('#frame').contentDocument.querySelector('input').files[0].name),'second.txt');
    assert.equal(await page.evaluate(()=>document.querySelector('#shadow').shadowRoot.querySelector('input').files[0].name),'first.txt');
    await page.evaluate(()=>new Promise(resolve=>{const frame=document.querySelector('#frame');frame.addEventListener('load',resolve,{once:true});frame.srcdoc='<input type=file>';}));
    await until(async()=>page.evaluate(()=>document.querySelector('#frame').contentDocument?.querySelector('input')?.getAttribute('aria-label')===null));
    await assert.rejects(()=>page.setInputFiles(frame.ref,first),/stale/i);
    const pendingChooser=page.waitForFileChooser();await page.click('#choose');const chooser=await pendingChooser;assert.equal(chooser.mode,'selectSingle');
    await assert.rejects(()=>chooser.setFiles([first,second]),/multiple/);
    const dynamic=chooser.setFiles(second);const dynamicDialog=await until(async()=>page.dialog());assert.equal(dynamicDialog.message,'Dynamic upload?');await page.dismissDialog();await dynamic;
    assert.equal(await page.evaluate(()=>document.querySelector('#dynamic').files[0].name),'second.txt');assert.equal(await page.evaluate(()=>window.dynamicConfirmed),false);
    const cancelWait=page.waitForFileChooser();await page.click('#choose');const cancelChooser=await cancelWait;await cancelChooser.cancel();
    await assert.rejects(()=>cancelChooser.setFiles(first),/not open|unavailable/i);
    const staleWait=page.waitForFileChooser();await page.click('#choose');const staleChooser=await staleWait;await page.evaluate(()=>{document.querySelectorAll('#dynamic').forEach(node=>node.remove());return true;});await assert.rejects(()=>staleChooser.setFiles(first),/stale|available|node/i);await staleChooser.cancel();
    const handedWait=page.waitForFileChooser();await page.click('#choose');const handedChooser=await handedWait;await room.yieldControl();await assert.rejects(()=>handedChooser.setFiles(first),/user control/);await room.resumeControl();await assert.rejects(()=>handedChooser.setFiles(first),/not open|unavailable/);
    await assert.rejects(()=>page.waitForFileChooser({timeout:150}),/timed out/i);
    const chooserBase=`/tabs/${page.tabId}/chooser`,abandoned=await client.api(`${chooserBase}/arm`,{method:'POST',body:{timeoutMs:150}});await delay(300);await assert.rejects(()=>client.api(`${chooserBase}?id=${abandoned.id}`),/expired|unavailable/);const rearmed=await client.api(`${chooserBase}/arm`,{method:'POST',body:{timeoutMs:1000}});await client.api(`${chooserBase}/cancel`,{method:'POST',body:{chooserId:rearmed.id}});
    const yieldControlWait=page.waitForFileChooser({timeout:2000});await page.chooserArm;const yieldControlRejected=assert.rejects(yieldControlWait,/expired|unavailable|user control/i);await room.yieldControl();await yieldControlRejected;await room.resumeControl();
    const finishWait=page.waitForFileChooser();await page.click('#choose');const finishChooser=await finishWait;const receipt=await room.finish({keep:[]});assert.equal(receipt.closedRoom,true);await assert.rejects(()=>finishChooser.setFiles(first),/not found/i);await client.disconnect();
  }catch(error){error.message+=`\nElectron output: ${output}`;throw error;}
  finally{if(app.exitCode===null && app.signalCode===null){app.kill('SIGTERM');await Promise.race([once(app,'exit'),delay(3000)]);if(app.exitCode===null && app.signalCode===null)app.kill('SIGKILL');}fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));await rm(dir,{recursive:true,force:true});}
});
