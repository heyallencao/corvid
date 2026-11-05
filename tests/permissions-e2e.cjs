const {_electron}=require('playwright-core');const electron=require('electron');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');
const {permissionDisplayName,unknownPermissionLabel}=require('../desktop/permission-labels.cjs');
const {createMainLocale,catalogs:mainCatalogs}=require('../desktop/main-locales.cjs');
const placeholderNames=value=>[...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(match=>match[1]).sort();
assert.deepEqual(Object.keys(mainCatalogs['zh-CN']).sort(),Object.keys(mainCatalogs.en).sort(),'main-process locale resources expose the same keys');
for(const key of Object.keys(mainCatalogs.en)){
  if(key==='plural')for(const pluralKey of Object.keys(mainCatalogs.en.plural)){for(const locale of ['zh-CN','en'])assert.ok(mainCatalogs[locale].plural[pluralKey].other,`${locale}: ${pluralKey} has an other form`);for(const form of new Set([...Object.keys(mainCatalogs['zh-CN'].plural[pluralKey]),...Object.keys(mainCatalogs.en.plural[pluralKey])])){const template=mainCatalogs['zh-CN'].plural[pluralKey][form]||mainCatalogs['zh-CN'].plural[pluralKey].other;assert.deepEqual(placeholderNames(template),placeholderNames(mainCatalogs.en.plural[pluralKey][form]||mainCatalogs.en.plural[pluralKey].other),`${pluralKey}.${form}: placeholders match`);}}
  else assert.deepEqual(placeholderNames(mainCatalogs['zh-CN'][key]),placeholderNames(mainCatalogs.en[key]),`${key}: locale placeholders match`);
}
const electronTypes=fs.readFileSync(require.resolve('electron/electron.d.ts'),'utf8');
const permissionUnion=electronTypes.match(/setPermissionRequestHandler\(handler: \(\(webContents: WebContents, permission: ([^,]+), callback:/);
assert.ok(permissionUnion,'Electron permission types must remain discoverable');
const permissionTypes=permissionUnion[1].split('|').map(value=>value.trim().slice(1,-1));
for(const locale of ['zh-CN','en'])for(const permission of permissionTypes){const label=permissionDisplayName(permission,[],locale);assert.ok(label && label!==permission,`${locale}: ${permission} must have a readable localized label`);if(permission!=='unknown')assert.notEqual(label,permissionDisplayName('future-permission-id',[],locale),`${locale}: ${permission} needs a specific label`);}
assert.equal(permissionDisplayName('future-permission-id'),unknownPermissionLabel,'unknown identifiers stay hidden');
assert.match(permissionDisplayName('media',['audio','video']),/麦克风.*摄像头/);
assert.match(permissionDisplayName('media',['audio','video'],'en'),/microphone.*camera/);
assert.equal(permissionDisplayName('display-capture',['video','audio']),'共享屏幕或窗口及音频');
assert.equal(permissionDisplayName('display-capture',['video','audio'],'en'),'share a screen or window and audio');
const localeContract=createMainLocale('en');assert.equal(localeContract.t('closeSpaceDetails',{tabs:localeContract.plural('tabs',2),ownership:localeContract.t('userOwnsSpace')}).includes('2 tabs'),true);
for(const scopeKey of ['permissionAllowedThisSession','permissionCurrentRequestOnly']){
  const detail=localeContract.t('permissionRequestDetail',{profile:'Default',room:'Example',scope:localeContract.t(scopeKey),deviceLimit:localeContract.t('permissionDeviceLimit')});
  assert.match(detail,/\. System or device restrictions/,'English permission detail keeps a word boundary between complete sentences');
}
const project=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-permissions-'));const fixture=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<title>Permission fixture</title>');});await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));let app;
try{app=await _electron.launch({executablePath:electron,args:[project],env:{...process.env,CORVID_DATA_DIR:dir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});const shell=await app.firstWindow();let config;for(let i=0;i<200;i++){try{config=JSON.parse(fs.readFileSync(path.join(dir,'control.json')));break;}catch{await delay(25);}}assert.ok(config);
const call=async(method,route,body)=>{const response=await fetch(config.baseUrl+route,{method,headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
await app.evaluate(({dialog})=>{globalThis.permissionPrompts=[];dialog.showMessageBox=async(_window,options)=>{globalThis.permissionPrompts.push(options);return {response:0};};});
await shell.evaluate(()=>window.browserShell.invoke('setUiLocale',{locale:'en'}));
const room=await call('POST','/rooms',{name:'Permission fixture'});const tab=room.tabs[0];await call('POST',`/tabs/${tab.id}/navigate`,{url:`http://127.0.0.1:${fixture.address().port}/`});
const result=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'Notification.requestPermission()'}});assert.equal(result.value,'denied');
const prompts=await app.evaluate(()=>globalThis.permissionPrompts);assert.equal(prompts.length,1);assert.match(prompts[0].title,/Website permission request/);assert.match(prompts[0].message,/127\.0\.0\.1.*send notifications/);assert.equal(prompts[0].message,`${prompts[0].message.split(' is requesting')[0]} is requesting permission to send notifications.`);assert.match(prompts[0].detail,/Browsing profile: Default.*space: Permission fixture/);assert.match(prompts[0].detail,/session\. System or device restrictions/);assert.deepEqual(prompts[0].buttons,['Deny','Allow']);assert.equal(prompts[0].defaultId,0);assert.equal(prompts[0].cancelId,0);
assert.equal((await call('GET','/rooms')).rooms.find(s=>s.id===room.id).ownership,'user');await call('POST',`/rooms/${room.id}/resumeControl`,{});
await app.evaluate(({dialog})=>{dialog.showMessageBox=async(_window,options)=>{globalThis.permissionPrompts.push(options);return {response:1};};});
await call('POST',`/tabs/${tab.id}/navigate`,{url:`http://localhost:${fixture.address().port}/`});
const allowed=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'Notification.requestPermission()'}});assert.equal(allowed.value,'granted');
assert.match((await app.evaluate(()=>globalThis.permissionPrompts))[1].message,/localhost.*send notifications/);assert.match((await app.evaluate(()=>globalThis.permissionPrompts))[1].message,/ is requesting permission to send notifications\.$/);
await shell.evaluate(()=>window.browserShell.invoke('setUiLocale',{locale:'zh-CN'}));
assert.equal((await call('GET','/rooms')).rooms.find(s=>s.id===room.id).ownership,'user');await call('POST',`/rooms/${room.id}/resumeControl`,{});
const afterGrant=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:"(async()=>({notification:Notification.permission,query:(await navigator.permissions.query({name:'notifications'})).state}))()"}});assert.deepEqual(afterGrant.value,{notification:'granted',query:'granted'});
const again=await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'Notification.requestPermission()'}});assert.equal(again.value,'granted');assert.equal((await app.evaluate(()=>globalThis.permissionPrompts)).length,2);
await call('POST',`/tabs/${tab.id}/navigate`,{url:`http://localhost:${fixture.address().port}/`});assert.equal((await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'Notification.permission'}})).value,'granted');
const shared=await call('POST','/rooms',{name:'Same Profile'}),otherProfile=await call('POST','/profiles',{name:'Other Profile'}),isolated=await call('POST','/rooms',{name:'Isolated',profileId:otherProfile.id});
for(const item of [shared,isolated])await call('POST',`/tabs/${item.tabs[0].id}/navigate`,{url:`http://localhost:${fixture.address().port}/`});
const query=async(item,expression)=>(await call('POST',`/tabs/${item.tabs[0].id}/action`,{operation:'evaluate',args:{expression}})).value;
assert.equal(await query(shared,'Notification.permission'),'granted');assert.equal(await query(isolated,'Notification.permission'),'denied');assert.equal(await query(shared,"navigator.permissions.query({name:'geolocation'}).then(result=>result.state)"),'denied');
assert.equal(await query(isolated,'Notification.requestPermission()'),'granted');await call('POST',`/rooms/${isolated.id}/resumeControl`,{});
await call('POST',`/rooms/${shared.id}/activate`,{});
const siteToolsTrigger=shell.getByRole('button',{name:'更多浏览工具'}),siteTools=shell.locator('#site-tools');
await siteToolsTrigger.press('ArrowDown');
assert.equal(await siteToolsTrigger.getAttribute('aria-expanded'),'true');
assert.equal(await shell.evaluate(()=>document.activeElement.id),'clear-site','opening the menu moves focus to its first action');
await shell.screenshot({path:path.join(os.tmpdir(),'corvid-site-tools-menu.png')});
await shell.keyboard.press('ArrowDown');assert.equal(await shell.evaluate(()=>document.activeElement.id),'toggle-fullscreen');
await shell.keyboard.press('Home');assert.equal(await shell.evaluate(()=>document.activeElement.id),'clear-site');
await shell.keyboard.press('End');assert.equal(await shell.evaluate(()=>document.activeElement.id),'print-page');
await shell.keyboard.press('ArrowUp');assert.equal(await shell.evaluate(()=>document.activeElement.id),'site-permissions');
await shell.keyboard.press('Escape');await siteTools.waitFor({state:'hidden'});
assert.equal(await siteToolsTrigger.getAttribute('aria-expanded'),'false');assert.equal(await shell.evaluate(()=>document.activeElement.id),'more-tools','Escape returns focus to the trigger');
await siteToolsTrigger.click();await shell.locator('#address').click();await siteTools.waitFor({state:'hidden'});
assert.equal(await siteToolsTrigger.getAttribute('aria-expanded'),'false','outside click resets expanded state');
await siteToolsTrigger.press('ArrowDown');await shell.keyboard.press('Tab');await siteTools.waitFor({state:'hidden'});
assert.equal(await siteToolsTrigger.getAttribute('aria-expanded'),'false');assert.equal(await shell.evaluate(()=>document.activeElement.closest('#site-tools')===null),true,'Tab leaves the menu');assert.notEqual(await shell.evaluate(()=>document.activeElement.id),'more-tools','Tab advances away from the menu trigger');
await app.evaluate(({dialog})=>{dialog.showMessageBox=async(_window,options)=>{globalThis.permissionReview=options;return {response:0};};});await siteToolsTrigger.click();await shell.getByRole('menuitem',{name:'管理站点权限'}).click();await delay(50);assert.equal(await query(shared,'Notification.permission'),'granted');assert.match((await app.evaluate(()=>globalThis.permissionReview)).detail,/发送通知/);assert.doesNotMatch((await app.evaluate(()=>globalThis.permissionReview)).detail,/notifications/);
assert.equal(await siteToolsTrigger.getAttribute('aria-haspopup'),'menu');assert.equal(await siteToolsTrigger.getAttribute('aria-expanded'),'false');assert.equal(await shell.evaluate(()=>document.activeElement.id),'more-tools','menu actions return focus to the trigger');
await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});await shell.getByRole('button',{name:'更多浏览工具'}).click();await shell.getByRole('menuitem',{name:'管理站点权限'}).click();await shell.getByRole('status').getByText(/已撤销/).waitFor();assert.equal(await query(shared,'Notification.permission'),'denied');assert.equal((await call('POST',`/tabs/${tab.id}/action`,{operation:'evaluate',args:{expression:'Notification.permission'}})).value,'denied');assert.equal(await query(isolated,'Notification.permission'),'granted');
assert.equal(await query(shared,'Notification.requestPermission()'),'granted');await call('POST',`/rooms/${shared.id}/resumeControl`,{});
const raceProfile=await call('POST','/profiles',{name:'Navigation race'}),race=await call('POST','/rooms',{name:'Navigation race',profileId:raceProfile.id});await call('POST',`/tabs/${race.tabs[0].id}/navigate`,{url:`http://localhost:${fixture.address().port}/`});
await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>new Promise(resolve=>{globalThis.finishPermission=resolve;});});
const pending=call('POST',`/tabs/${race.tabs[0].id}/action`,{operation:'evaluate',args:{expression:`(()=>{setTimeout(()=>location.href='http://127.0.0.1:${fixture.address().port}/moved',50);return Notification.requestPermission()})()`}}).catch(()=>{});
for(let i=0;i<200 && !(await app.evaluate(()=>Boolean(globalThis.finishPermission)));i++)await delay(25);
assert.ok(await app.evaluate(()=>Boolean(globalThis.finishPermission)));
for(let i=0;i<200;i++){const status=await call('GET','/rooms');if(status.rooms.find(s=>s.id===race.id).tabs[0].url.includes('/moved'))break;await delay(25);}
assert.match((await call('GET','/rooms')).rooms.find(s=>s.id===race.id).tabs[0].url,/\/moved/);await app.evaluate(()=>globalThis.finishPermission({response:1}));await pending;await call('POST',`/rooms/${race.id}/resumeControl`,{});await call('POST',`/tabs/${race.tabs[0].id}/navigate`,{url:`http://localhost:${fixture.address().port}/`});assert.equal(await query(race,'Notification.permission'),'denied');
const previousToken=config.token;await app.close();app=undefined;app=await _electron.launch({executablePath:electron,args:[project],env:{...process.env,CORVID_DATA_DIR:dir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});await app.firstWindow();for(let i=0;i<200;i++){try{const current=JSON.parse(fs.readFileSync(path.join(dir,'control.json')));if(current.token!==previousToken){config=current;break;}}catch{}await delay(25);}assert.notEqual(config.token,previousToken);assert.equal(await query(shared,'Notification.permission'),'denied');
for(const item of [room,shared,isolated,race])await call('DELETE',`/rooms/${item.id}`);console.log('PASS scoped notification permission, queries, profile isolation and restart');
}finally{if(app)await app.close().catch(()=>{});await new Promise(resolve=>fixture.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
