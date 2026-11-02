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

function writeExtension(profileDir,name,marker){
  const idDir=path.join(profileDir,'Extensions');fs.mkdirSync(idDir,{recursive:true});
  const {publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:1024,publicKeyEncoding:{type:'spki',format:'der'},privateKeyEncoding:{type:'pkcs1',format:'pem'}});
  const id=crypto.createHash('sha256').update(publicKey).digest().subarray(0,16).toString('hex').replace(/[0-9a-f]/g,n=>String.fromCharCode('a'.charCodeAt(0)+parseInt(n,16)));
  const versionDir=path.join(idDir,id,'1.0.0');fs.mkdirSync(versionDir,{recursive:true});
  fs.writeFileSync(path.join(versionDir,'manifest.json'),JSON.stringify({manifest_version:3,name,version:'1.0.0',key:publicKey.toString('base64'),permissions:['storage'],optional_permissions:['tabs'],host_permissions:['<all_urls>'],optional_host_permissions:['https://*.example.com/*'],content_scripts:[{matches:['<all_urls>'],js:['content.js'],run_at:'document_end'}]}));
  fs.writeFileSync(path.join(versionDir,'content.js'),`document.documentElement.dataset.${marker}='loaded';`);
  return id;
}

function addExtensionVersion(profileDir,id,version){
  const source=path.join(profileDir,'Extensions',id,'1.0.0');
  const destination=path.join(profileDir,'Extensions',id,version);fs.mkdirSync(destination,{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));manifest.version=version;
  fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest));
  fs.copyFileSync(path.join(source,'content.js'),path.join(destination,'content.js'));
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
  profiles[0].extensionId=writeExtension(path.join(root,'Default'),'Corvid Marker','corvidDefaultExtension');
  addExtensionVersion(path.join(root,'Default'),profiles[0].extensionId,'2.0.0');
  const invalidId=writeExtension(path.join(root,'Default'),'Invalid Manifest','invalidManifest');
  fs.writeFileSync(path.join(root,'Default','Extensions',invalidId,'1.0.0','manifest.json'),'{invalid json');
  profiles[0].symlinkExtensionId=writeExtension(path.join(root,'Default'),'Corvid Symlink','corvidSymlinkExtension');
  const external=path.join(root,'..','extension-source-outside-profile.txt');fs.writeFileSync(external,'outside profile');
  fs.symlinkSync(external,path.join(root,'Default','Extensions',profiles[0].symlinkExtensionId,'1.0.0','outside.txt'));
  profiles[1].extensionId=writeExtension(path.join(root,'Profile 1'),'Corvid Work Marker','corvidWorkExtension');
  return profiles;
}

function fixtureCookieKey(){return crypto.pbkdf2Sync(Buffer.from('fixture chrome key'),Buffer.from('saltysalt'),1003,16,'sha1');}
function encryptCookie(key,value){
  const cipher=crypto.createCipheriv('aes-128-cbc',key,Buffer.alloc(16,0x20));
  return Buffer.concat([Buffer.from('v10'),cipher.update(value),cipher.final()]);
}
function writeChromeCookies(profileDir,key){
  const database=new DatabaseSync(path.join(profileDir,'Cookies'));
  const add=database.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  add.run('auth.example.test','encrypted_session','',encryptCookie(key,'fixture-login-token'),'/',0,1,0,0,2,'');
  const expiresUtc=BigInt(Date.parse('2030-01-01T00:00:00.000Z'))*1000n+11644473600000000n;
  add.run('.example.test','domain_session','fixture-domain-value',Buffer.alloc(0),'/',0,0,1,expiresUtc,0,'');
  add.run('.example.test','persistent_import','fixture-persistent-value',Buffer.alloc(0),'/',0,0,1,expiresUtc,0,'');
  add.run('auth.example.test','unknown_cipher','',Buffer.from('v20unsupported'), '/',1,0,0,0,1,'');
  add.run('auth.example.test','partitioned_session','partitioned-value',Buffer.alloc(0),'/',1,0,0,0,1,'https://top.example.test');
  database.close();
}

function verifyCookieDecryption(tempRoot){
  const profileDir=path.join(tempRoot,'cookie-decrypt');fs.mkdirSync(profileDir,{recursive:true});
  const key=fixtureCookieKey();
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

async function boot(dataDir,extraEnv={}){
  const app=await _electron.launch({executablePath:electron,args:[project],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_PORT:'0',CORVID_TEST_MODE:'1',CORVID_TEST_CHROME_IMPORT:'1',...extraEnv}});
  const shell=await app.firstWindow();
  const config=await until(()=>{try{return JSON.parse(fs.readFileSync(path.join(dataDir,'control.json'),'utf8'));}catch{return null;}},'control.json');
  const call=async(route,method='GET',body)=>{
    const response=await fetch(config.baseUrl+route,{method,headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
  };
  return {app,shell,call};
}

async function extensionValue(app,url,key,partition='persist:corvid'){
  return app.evaluate(({webContents},{target,keyName,partitionName})=>{
    const storageSuffix=`/Partitions/${partitionName.replace(/^persist:/,'')}`;
    const page=webContents.getAllWebContents().find(contents=>contents.getURL()===target&&contents.session.getStoragePath()?.endsWith(storageSuffix));
    return page?page.executeJavaScript(`document.documentElement.dataset.${keyName} || ''`):'';
  },{target:url,keyName:key,partitionName:partition});
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

async function selectAllExtensions(shell){
  for(const checkbox of await shell.locator('#chrome-extension-choices input').all())await checkbox.check();
}

async function allowCookieImport(shell){
  await shell.locator('#chrome-cookie-consent').getByText(/会请求访问“Chrome Safe Storage”/).waitFor();
  assert.equal(await shell.locator('#confirm-chrome-import').isDisabled(),true,'Cookie import must require a separate explicit consent');
  await shell.locator('#chrome-cookie-consent-check').check();
  assert.equal(await shell.locator('#confirm-chrome-import').isDisabled(),false,'Cookie consent should enable import when all other choices are valid');
  await shell.locator('input[name="chrome-category"][value="cookies"]').uncheck();
  assert.equal(await shell.locator('#chrome-cookie-consent').isHidden(),true,'Cookie consent must disappear when Cookie import is deselected');
  await shell.locator('input[name="chrome-category"][value="cookies"]').check();
  assert.equal(await shell.locator('#chrome-cookie-consent-check').isChecked(),false,'Cookie consent must reset when Cookie import is selected again');
  assert.equal(await shell.locator('#confirm-chrome-import').isDisabled(),true,'reselecting Cookies must require renewed consent');
  await shell.locator('#chrome-cookie-consent-check').check();
}

(async()=>{
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-chrome-import-'));
  const chromeRoot=path.join(tempRoot,'chrome-user-data');fs.mkdirSync(chromeRoot);
  const chromeProfiles=makeChromeFixture(chromeRoot);
  const cookieKey=fixtureCookieKey(),supportsCookieImport=process.platform==='darwin';
  if(supportsCookieImport)writeChromeCookies(path.join(chromeRoot,'Default'),cookieKey);
  let server;
  let app,shell,call;
  server=http.createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<title>Extension Fixture</title><html><body>local extension test</body></html>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const extensionUrl=`http://127.0.0.1:${server.address().port}/extension-fixture`;
  verifyCookieDecryption(tempRoot);
  try{
    assert.deepEqual(chromeImport.profiles(chromeRoot).map(item=>item.id),['Default','Profile 1']);
    assert.throws(()=>chromeImport.assertCookieConsent(['cookies'],false,'darwin'),/请先确认 Cookie 导入说明/,'Cookie import must reject missing explicit consent before reading source secrets');
    assert.doesNotThrow(()=>chromeImport.assertCookieConsent(['cookies'],true,'darwin'),'explicit Cookie consent should be accepted on macOS');
    assert.throws(()=>chromeImport.assertCookieConsent(['cookies'],true,'win32'),/只支持 macOS/,'Cookie consent must not bypass the platform support boundary');
    assert.doesNotThrow(()=>chromeImport.assertCookieConsent(['bookmarks'],false,'win32'),'non-sensitive import categories must not require Cookie consent');
    const sourceBefore={bookmarks:crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','Bookmarks'))).digest('hex'),history:crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','History'))).digest('hex'),extensionManifest:crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','Extensions',chromeProfiles[0].extensionId,'2.0.0','manifest.json'))).digest('hex'),cookies:supportsCookieImport?crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','Cookies'))).digest('hex'):null};
    const preview=chromeImport.readProfile(chromeRoot,'Default');
    assert.equal(preview.bookmarks[0].title,'书签 0');
    assert.equal(preview.history[0].title,'历史 0');
    assert.equal(preview.history[0].visitedAt,'2026-10-01T12:00:00.000Z');
    const discoveredExtensions=require('../desktop/chrome-extensions.cjs').discover(path.join(chromeRoot,'Default'));
    assert.equal(discoveredExtensions.length,2,'invalid extension manifests must be excluded');
    assert.equal(discoveredExtensions.find(item=>item.id===chromeProfiles[0].extensionId).version,'2.0.0','the newest valid extension version must be selected');

    const appData=path.join(tempRoot,'fresh-corvid-data');
    const testEnv={CORVID_TEST_CHROME_LIBRARY_IMPORT_FAIL_RENAME_ONCE:'1'};
    if(supportsCookieImport)Object.assign(testEnv,{CORVID_TEST_CHROME_COOKIE_KEY:cookieKey.toString('hex'),CORVID_TEST_CHROME_COOKIE_FLUSH_FAIL_ONCE:'1',CORVID_TEST_CHROME_COOKIE_ROLLBACK_FLUSH_FAIL_ONCE:'1'});
    ({app,shell,call}=await boot(appData,testEnv));
    await shell.getByRole('heading',{name:'从 Chrome 开始使用 Corvid？'}).waitFor();
    assert.equal(await app.evaluate(()=>globalThis.chromeImportDialogCalls||0),0,'first launch must not scan or open Chrome');
    await installDialogFixture(app,chromeRoot);
    await shell.locator('#begin-chrome-import').click();
    await shell.getByRole('heading',{name:'从 Google Chrome 导入'}).waitFor();
    await chooseSource(shell);
    await shell.locator('#chrome-import-preview').getByText(/2 个可读取扩展/).waitFor();
    if(supportsCookieImport){
      await app.evaluate(async({session})=>{
        const destination=session.fromPartition('persist:corvid');
        await destination.cookies.set({url:'http://example.test/',domain:'.example.test',name:'domain_session',value:'corvid-existing-value',path:'/',expirationDate:1893456000});
        await destination.cookies.flushStore();
      },{});
      await shell.locator('input[name="chrome-category"][value="bookmarks"]').uncheck();
      await shell.locator('input[name="chrome-category"][value="history"]').uncheck();
      await shell.locator('input[name="chrome-category"][value="cookies"]').check();
      await allowCookieImport(shell);
      await shell.locator('#confirm-chrome-import').click();
      await shell.locator('#chrome-import-error').getByText(/测试注入：Chrome Cookie 持久化失败；Chrome Cookie 导入失败后回滚未完整完成.*持久化 Cookie 回滚结果.*可能仍留有部分 Cookie/).waitFor();
      const rolledBackCookies=await app.evaluate(({session})=>session.fromPartition('persist:corvid').cookies.get({}),{});
      assert.equal(rolledBackCookies.length,1,'failed Cookie flush must remove newly imported Cookies and preserve the preexisting conflict');
      assert.equal(rolledBackCookies[0].value,'corvid-existing-value','failed Cookie flush rollback must not change the existing conflicting Cookie');
      assert.equal((await call('/bookmarks')).bookmarks.length,0,'failed Cookie import must not start importing unselected library categories');
      assert.equal((await call('/history')).history.length,0,'failed Cookie import must leave history unchanged');
      await app.evaluate(async({session})=>session.fromPartition('persist:corvid').cookies.flushStore(),{});
      await shell.locator('#confirm-chrome-import').click();
      await shell.locator('#chrome-import-error').getByText(/Cookie 新增 2 项（跳过 1 项、不支持 2 项）/).waitFor();
      const retriedCookies=await app.evaluate(({session})=>session.fromPartition('persist:corvid').cookies.get({}),{});
      assert.equal(retriedCookies.length,3,'Cookie import must be retryable after a rolled-back flush failure while preserving existing state');
      assert.equal(retriedCookies.find(cookie=>cookie.name==='domain_session')?.value,'corvid-existing-value','Chrome import must skip rather than overwrite a conflicting target Cookie');
      await shell.locator('#cancel-chrome-import').click();
      await shell.locator('#show-settings').click();
      await shell.locator('#start-chrome-import').click();
      await chooseSource(shell);
    }
    await call('/bookmarks','POST',{url:'https://corvid.fixture/preserved','title':'已有书签'});
    const libraryBeforeFailedImport=fs.readFileSync(path.join(appData,'library.json'));
    await shell.locator('input[name="chrome-category"][value="extensions"]').check();
    await selectAllExtensions(shell);
    if(supportsCookieImport){await shell.locator('input[name="chrome-category"][value="cookies"]').check();await allowCookieImport(shell);}
    await shell.locator('#confirm-chrome-import').click();
    await shell.locator('#chrome-import-error').getByText('测试注入：Chrome 导入浏览资料库替换失败').waitFor();
    assert.deepEqual(fs.readFileSync(path.join(appData,'library.json')),libraryBeforeFailedImport,'failed Chrome library replacement must preserve the existing library bytes');
    assert.equal(fs.existsSync(path.join(appData,'library.json.tmp')),false,'failed Chrome library replacement must remove its temporary file');
    assert.deepEqual((await call('/bookmarks')).bookmarks.map(item=>item.url),['https://corvid.fixture/preserved'],'failed import must not partially append Chrome bookmarks');
    assert.equal((await call('/history')).history.length,0,'failed import must not partially append Chrome history');
    await shell.locator('#confirm-chrome-import').click();
    await shell.locator('#chrome-import-error').getByText(new RegExp(`导入完成：书签新增 1 项.*${supportsCookieImport?'Cookie 新增 0 项（跳过 3 项、不支持 2 项）.*':''}扩展新增 1 项.*未导入：Corvid Symlink：Chrome 扩展包含不支持的符号链接`)).waitFor();
    assert.equal((await call('/bookmarks')).bookmarks.length,2);
    assert.equal((await call('/history')).history.length,1);
    assert.equal((await call('/bookmarks')).bookmarks[0].profileId,'default');
    if(supportsCookieImport){
      const cookies=await app.evaluate(({session},input)=>session.fromPartition(input.partition).cookies.get({url:input.url}),{partition:'persist:corvid',url:'http://auth.example.test/'});
      assert.equal(cookies.find(cookie=>cookie.name==='encrypted_session')?.value,'fixture-login-token','decrypted host-only Chrome Cookie must reach the selected Corvid Profile');
      const domainCookies=await app.evaluate(({session},input)=>session.fromPartition(input.partition).cookies.get({url:input.url}),{partition:'persist:corvid',url:'http://example.test/'});
      assert.equal(domainCookies.find(cookie=>cookie.name==='domain_session')?.value,'corvid-existing-value','conflicting Chrome Cookie must not overwrite the target Profile value');
      assert.equal(domainCookies.find(cookie=>cookie.name==='persistent_import')?.value,'fixture-persistent-value','non-conflicting persistent Chrome Cookie must reach the selected Corvid Profile');
    }
    await shell.locator('#cancel-chrome-import').click();
    await shell.locator('#show-settings').click();
    await shell.locator('#profile-extension-list').getByText(/必需权限：storage、<all_urls>；可选权限：tabs、https:\/\/\*\.example\.com\/\*/).waitFor();
    await shell.locator('#settings').press('Escape');
    await shell.getByRole('button',{name:'新建标签'}).click();
    await shell.locator('#address').fill(extensionUrl);await shell.locator('#address').press('Enter');
    await shell.getByRole('button',{name:'Extension Fixture'}).waitFor();
    await until(async()=>await extensionValue(app,extensionUrl,'corvidDefaultExtension')==='loaded','default Chrome extension content script');
    assert.equal(JSON.parse(fs.readFileSync(path.join(appData,'managed-extensions.json'))).length,1,'failed extension copies must not remain in managed state');
    assert.equal(fs.existsSync(require('../desktop/chrome-extensions.cjs').managedPath(appData,'default',chromeProfiles[0].symlinkExtensionId,'1.0.0')),false,'failed extension copies must be cleaned up');

    await shell.locator('#show-settings').click();
    await shell.locator('#start-chrome-import').click();
    await chooseSource(shell);
    await shell.locator('input[name="chrome-category"][value="extensions"]').check();
    await selectAllExtensions(shell);
    if(supportsCookieImport){await shell.locator('input[name="chrome-category"][value="cookies"]').check();await allowCookieImport(shell);}
    await shell.locator('#confirm-chrome-import').click();
    await shell.locator('#chrome-import-error').getByText(new RegExp(`导入完成：书签新增 0 项.*${supportsCookieImport?'Cookie 新增 0 项（跳过 3 项、不支持 2 项）.*':''}扩展跳过 1 项`)).waitFor();
    assert.equal((await call('/bookmarks')).bookmarks.length,2,'repeat import must be idempotent');
    assert.equal(JSON.parse(fs.readFileSync(path.join(appData,'managed-extensions.json'))).length,1,'repeat extension import must skip the existing extension');
    await shell.locator('#cancel-chrome-import').click();
    const work=await call('/profiles','POST',{name:'Imported work'});
    await call('/rooms','POST',{name:'Imported work room',profileId:work.id});
    if(supportsCookieImport){
      const workCookies=await app.evaluate(({session},input)=>session.fromPartition(input.partition).cookies.get({url:input.url}),{partition:`persist:corvid-profile-${work.id}`,url:'http://auth.example.test/'});
      assert.equal(workCookies.some(cookie=>cookie.name==='encrypted_session'),false,'Chrome Cookies imported to default must not leak into Work Profile');
      const workDomainCookies=await app.evaluate(({session},input)=>session.fromPartition(input.partition).cookies.get({url:input.url}),{partition:`persist:corvid-profile-${work.id}`,url:'http://example.test/'});
      assert.equal(workDomainCookies.some(cookie=>cookie.name==='domain_session'),false,'persistent Chrome Cookies imported to default must not leak into Work Profile');
      assert.equal(workDomainCookies.some(cookie=>cookie.name==='persistent_import'),false,'non-conflicting persistent Chrome Cookies imported to default must not leak into Work Profile');
    }
    await shell.locator('#profile-select').selectOption(work.id);
    await shell.locator('#show-settings').click();
    await shell.locator('#start-chrome-import').click();
    await chooseSource(shell);
    await shell.locator('#chrome-import-target').getByText('Imported work').waitFor();
    await shell.locator('#chrome-source-profile').selectOption('Profile 1');
    await shell.locator('#chrome-import-preview').getByText(/工作 Chrome/).waitFor();
    await shell.locator('input[name="chrome-category"][value="extensions"]').check();
    await selectAllExtensions(shell);
    await shell.locator('#confirm-chrome-import').click();
    await shell.locator('#chrome-import-error').getByText(/扩展新增 1 项/).waitFor();
    assert.equal((await call(`/bookmarks?profileId=${work.id}`)).bookmarks[0].title,'书签 1');
    assert.ok((await call('/bookmarks?profileId=default')).bookmarks.some(item=>item.title==='书签 0'));
    await shell.locator('#cancel-chrome-import').click();
    await shell.getByRole('button',{name:'新建标签'}).click();
    await shell.locator('#address').fill(extensionUrl);await shell.locator('#address').press('Enter');
    await shell.getByRole('button',{name:'Extension Fixture'}).waitFor();
    await until(async()=>await extensionValue(app,extensionUrl,'corvidWorkExtension',`persist:corvid-profile-${work.id}`)==='loaded','work Chrome extension content script');
    assert.equal(await extensionValue(app,extensionUrl,'corvidDefaultExtension',`persist:corvid-profile-${work.id}`),'','default extension must not be loaded in work Profile');
    await shell.locator('#show-settings').click();
    await shell.getByRole('checkbox',{name:'停用 Corvid Work Marker'}).click();
    await shell.getByRole('checkbox',{name:'启用 Corvid Work Marker'}).waitFor();
    await shell.locator('#settings').press('Escape').catch(()=>{});
    await shell.locator('#address').fill('about:blank');await shell.locator('#address').press('Enter');
    await shell.locator('#address').fill(extensionUrl);await shell.locator('#address').press('Enter');
    await until(async()=>await extensionValue(app,extensionUrl,'corvidWorkExtension',`persist:corvid-profile-${work.id}`)==='','disabled extension must not run after navigation');
    await shell.locator('#show-settings').click();
    await shell.getByRole('button',{name:'移除',exact:true}).click();
    assert.equal(JSON.parse(fs.readFileSync(path.join(appData,'managed-extensions.json'))).some(item=>item.profileId===work.id),false);
    await shell.locator('#settings').press('Escape').catch(()=>{});
    await app.close();app=undefined;

    assert.deepEqual(chromeImport.profiles(chromeRoot).map(item=>item.id),chromeProfiles.map(item=>item.id));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','Bookmarks'))).digest('hex'),sourceBefore.bookmarks);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','History'))).digest('hex'),sourceBefore.history);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','Extensions',chromeProfiles[0].extensionId,'2.0.0','manifest.json'))).digest('hex'),sourceBefore.extensionManifest);
    if(supportsCookieImport)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','Cookies'))).digest('hex'),sourceBefore.cookies,'Chrome Cookie source must remain unchanged');

    ({app,shell,call}=await boot(appData));
    await shell.locator('#profile-select').selectOption('default');
    await shell.locator('#address').fill(extensionUrl);await shell.locator('#address').press('Enter');
    await until(async()=>await extensionValue(app,extensionUrl,'corvidDefaultExtension')==='loaded','default extension restored after restart');
    if(supportsCookieImport){
      const persistentCookies=await app.evaluate(({session},input)=>session.fromPartition(input.partition).cookies.get({url:input.url}),{partition:'persist:corvid',url:'http://example.test/'});
      assert.equal(persistentCookies.find(cookie=>cookie.name==='domain_session')?.value,'corvid-existing-value','preexisting conflicting Cookie must persist unchanged after restart');
      assert.equal(persistentCookies.find(cookie=>cookie.name==='persistent_import')?.value,'fixture-persistent-value','non-conflicting imported Cookie must persist after restart');
      const sessionCookies=await app.evaluate(({session},input)=>session.fromPartition(input.partition).cookies.get({url:input.url}),{partition:'persist:corvid',url:'http://auth.example.test/'});
      assert.equal(sessionCookies.some(cookie=>cookie.name==='encrypted_session'),false,'session Chrome Cookie must expire when Corvid exits');
    }
    assert.equal(await extensionValue(app,extensionUrl,'corvidWorkExtension'),'','removed work extension must stay absent after restart');
    await app.close();app=undefined;

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
    console.log('PASS Chrome import, Cookie decryption/write/Profile isolation and persistence semantics, extension version/failure handling, content execution, disable/remove and restart restore');
  }finally{
    if(app)await app.close().catch(()=>{});
    if(server)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(tempRoot,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
