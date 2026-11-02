const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const chromeImport=require('../desktop/chrome-import.cjs');

const project=path.resolve(__dirname,'..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(25);}throw new Error(`Timed out waiting for ${label}`);};

function writeBookmarks(profileDir,entries){
  const urls=entries.map((entry,index)=>({type:'url',id:String(index+4),name:entry.title,url:entry.url}));
  fs.writeFileSync(path.join(profileDir,'Bookmarks'),JSON.stringify({roots:{bookmark_bar:{type:'folder',children:[{type:'folder',name:'Nested',children:urls}]},other:{type:'folder',children:[]}}}));
}

function makeChromeFixture(root){
  const profiles=[{id:'Default',name:'个人 Chrome'},{id:'Profile 1',name:'工作 Chrome'}];
  fs.writeFileSync(path.join(root,'Local State'),JSON.stringify({profile:{info_cache:Object.fromEntries(profiles.map(item=>[item.id,{name:item.name}]))}}));
  for(const [index,profile] of profiles.entries()){
    const dir=path.join(root,profile.id);fs.mkdirSync(dir,{recursive:true});
    writeBookmarks(dir,[{url:`https://fixture.example/${index}/bookmark`,title:`书签 ${index}`}]);
    const historyPath=path.join(dir,'History'),history=new DatabaseSync(historyPath);
    history.exec('CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER)');
    const insert=history.prepare('INSERT INTO urls(url,title,last_visit_time) VALUES(?,?,?)');
    const timestamp=BigInt(Date.parse(`2026-10-0${index+1}T12:00:00.000Z`))*1000n+11644473600000000n;
    insert.run(`https://fixture.example/${index}/history`,`历史 ${index}`,timestamp);
    history.close();
    const cookies=new DatabaseSync(path.join(dir,'Cookies'));
    cookies.exec('CREATE TABLE cookies (host_key TEXT,name TEXT,value TEXT,encrypted_value BLOB,path TEXT,is_secure INTEGER,is_httponly INTEGER,has_expires INTEGER,expires_utc INTEGER,samesite INTEGER,top_frame_site_key TEXT)');
    cookies.close();
  }
  return profiles;
}

function verifyCookieDecryption(tempRoot){
  const profileDir=path.join(tempRoot,'cookie-decrypt');fs.mkdirSync(profileDir,{recursive:true});
  const key=crypto.pbkdf2Sync(Buffer.from('fixture chrome key'),Buffer.from('saltysalt'),1003,16,'sha1');
  const cipher=crypto.createCipheriv('aes-128-cbc',key,Buffer.alloc(16,0x20));
  const encrypted=Buffer.concat([Buffer.from('v10'),cipher.update('fixture-session'),cipher.final()]);
  const database=new DatabaseSync(path.join(profileDir,'Cookies'));
  database.exec('CREATE TABLE cookies (host_key TEXT,name TEXT,value TEXT,encrypted_value BLOB,path TEXT,is_secure INTEGER,is_httponly INTEGER,has_expires INTEGER,expires_utc INTEGER,samesite INTEGER,top_frame_site_key TEXT)');
  const add=database.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  add.run('example.com','host_session','',encrypted,'/',1,1,0,0,2,'');
  add.run('.example.com','domain_session','plain-domain','', '/app',0,0,0,0,0,'');
  add.run('example.com','unknown_cipher','',Buffer.from('v20ignored'), '/',1,0,0,0,1,'');
  add.run('example.com','partitioned','plain-partitioned','', '/',1,0,0,0,1,'https://top.example');
  database.close();
  const result=chromeImport.readCookiesWithKey(profileDir,key);
  assert.equal(result.cookies.length,2);
  assert.equal(result.unsupported,2);
  const hostOnly=result.cookies.find(cookie=>cookie.name==='host_session');
  assert.equal(hostOnly.value,'fixture-session');
  assert.equal(hostOnly.hostOnly,true);
  assert.equal(hostOnly.sourceDomain,'example.com');
  assert.equal(hostOnly.secure,true);
  assert.equal(hostOnly.httpOnly,true);
  assert.equal(hostOnly.sameSite,'lax');
  const domainCookie=result.cookies.find(cookie=>cookie.name==='domain_session');
  assert.equal(domainCookie.hostOnly,false);
  assert.equal(domainCookie.sourceDomain,'.example.com');
  assert.equal(domainCookie.path,'/app');
}

async function boot(dataDir){
  const app=await _electron.launch({executablePath:electron,args:[project],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_PORT:'0',CORVID_TEST_MODE:'1',CORVID_TEST_CHROME_IMPORT:'1'}});
  const shell=await app.firstWindow();
  const config=await until(()=>{try{return JSON.parse(fs.readFileSync(path.join(dataDir,'control.json'),'utf8'));}catch{return null;}},'control.json');
  const call=async(route,method='GET',body)=>{
    const response=await fetch(config.baseUrl+route,{method,headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
  };
  return {app,shell,call};
}

async function installDialogFixture(app,chromeRoot){
  await app.evaluate(({dialog},sourceRoot)=>{
    globalThis.chromeImportDialogCalls=0;
    dialog.showOpenDialog=async(_window,options)=>{globalThis.chromeImportDialogCalls++;globalThis.chromeImportDialogOptions=options;return {canceled:false,filePaths:[sourceRoot]};};
  },chromeRoot);
}

async function chooseSource(shell){
  await shell.locator('#choose-chrome-source').click();
  await shell.locator('#chrome-source-profile').selectOption('Default');
  await shell.locator('#chrome-import-preview').getByText(/找到 1 个书签、1 条历史记录/).waitFor();
}

(async()=>{
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-chrome-import-'));
  const chromeRoot=path.join(tempRoot,'chrome-user-data');fs.mkdirSync(chromeRoot);
  const chromeProfiles=makeChromeFixture(chromeRoot);
  verifyCookieDecryption(tempRoot);
  let server;
  try{
    assert.deepEqual(chromeImport.profiles(chromeRoot).map(item=>item.id),['Default','Profile 1']);
    const sourceBefore={bookmarks:crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','Bookmarks'))).digest('hex'),history:crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','History'))).digest('hex')};
    const preview=chromeImport.readProfile(chromeRoot,'Default');
    assert.equal(preview.bookmarks[0].title,'书签 0');
    assert.equal(preview.history[0].title,'历史 0');
    assert.equal(preview.history[0].visitedAt,'2026-10-01T12:00:00.000Z');

    const appData=path.join(tempRoot,'fresh-corvid-data');
    let {app,shell,call}=await boot(appData);
    await shell.getByRole('heading',{name:'从 Chrome 开始使用 Corvid？'}).waitFor();
    assert.equal(await app.evaluate(()=>globalThis.chromeImportDialogCalls||0),0,'first launch must not scan or open Chrome');
    await installDialogFixture(app,chromeRoot);
    await shell.locator('#begin-chrome-import').click();
    await shell.getByRole('heading',{name:'从 Google Chrome 导入'}).waitFor();
    await chooseSource(shell);
    await shell.locator('#confirm-chrome-import').click();
    await shell.locator('#chrome-import-error').getByText(/导入完成：书签新增 1 项/).waitFor();
    assert.equal((await call('/bookmarks')).bookmarks.length,1);
    assert.equal((await call('/history')).history.length,1);
    assert.equal((await call('/bookmarks')).bookmarks[0].profileId,'default');

    await shell.locator('#cancel-chrome-import').click();
    await shell.locator('#show-settings').click();
    await shell.locator('#start-chrome-import').click();
    await chooseSource(shell);
    await shell.locator('#confirm-chrome-import').click();
    await shell.locator('#chrome-import-error').getByText(/导入完成：书签新增 0 项（跳过 1 项）/).waitFor();
    assert.equal((await call('/bookmarks')).bookmarks.length,1,'repeat import must be idempotent');
    await shell.locator('#cancel-chrome-import').click();
    const work=await call('/profiles','POST',{name:'Imported work'});
    await shell.locator('#profile-select').selectOption(work.id);
    await shell.locator('#show-settings').click();
    await shell.locator('#start-chrome-import').click();
    await chooseSource(shell);
    await shell.locator('#chrome-import-target').getByText('Imported work').waitFor();
    await shell.locator('#chrome-source-profile').selectOption('Profile 1');
    await shell.locator('#chrome-import-preview').getByText(/工作 Chrome/).waitFor();
    await shell.locator('#confirm-chrome-import').click();
    await shell.locator('#chrome-import-error').getByText(/导入完成：书签新增 1 项/).waitFor();
    assert.equal((await call(`/bookmarks?profileId=${work.id}`)).bookmarks[0].title,'书签 1');
    assert.equal((await call('/bookmarks?profileId=default')).bookmarks[0].title,'书签 0');
    await shell.locator('#cancel-chrome-import').click();
    await app.close();app=undefined;

    assert.deepEqual(chromeImport.profiles(chromeRoot).map(item=>item.id),chromeProfiles.map(item=>item.id));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','Bookmarks'))).digest('hex'),sourceBefore.bookmarks);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','History'))).digest('hex'),sourceBefore.history);

    const pendingData=path.join(tempRoot,'pending-corvid-data');
    ({app,shell}=await boot(pendingData));
    await shell.getByRole('heading',{name:'从 Chrome 开始使用 Corvid？'}).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(path.join(pendingData,'chrome-import-onboarding.json'))).status,'pending');
    await app.close();app=undefined;
    ({app,shell}=await boot(pendingData));
    await shell.getByRole('heading',{name:'从 Chrome 开始使用 Corvid？'}).waitFor();
    await shell.locator('#skip-chrome-import').click();
    await until(()=>JSON.parse(fs.readFileSync(path.join(pendingData,'chrome-import-onboarding.json'))).status==='completed','onboarding decision');
    await app.close();app=undefined;
    ({app,shell}=await boot(pendingData));
    await delay(300);
    assert.equal(await shell.locator('#chrome-import-onboarding').evaluate(element=>element.open),false,'completed onboarding must not reappear');
    await app.close();app=undefined;

    const existingData=path.join(tempRoot,'existing-corvid-data');fs.mkdirSync(existingData);
    fs.writeFileSync(path.join(existingData,'profiles.json'),JSON.stringify([{id:'default',name:'Existing',isDefault:true}]));
    ({app,shell}=await boot(existingData));
    await delay(300);
    assert.equal(await shell.locator('#chrome-import-onboarding').evaluate(element=>element.open),false,'existing Corvid profiles must not get first-run onboarding');
    await app.close();app=undefined;
    console.log('PASS synthetic Chrome profile discovery, read-only bookmarks/history import, Profile isolation, repeat-import idempotency, v10 cookie decode, and first-run onboarding persistence');
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(tempRoot,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
