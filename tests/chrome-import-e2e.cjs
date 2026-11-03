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
  fs.writeFileSync(path.join(versionDir,'manifest.json'),JSON.stringify({manifest_version:3,name,version:'1.0.0',key:publicKey.toString('base64'),permissions:['storage'],optional_permissions:['tabs'],host_permissions:['<all_urls>'],optional_host_permissions:['https://*.example.com/*'],action:{default_popup:'popup.html'},content_scripts:[{matches:['<all_urls>'],js:['content.js'],run_at:'document_end'}]}));
  fs.writeFileSync(path.join(versionDir,'content.js'),`document.documentElement.dataset.${marker}='loaded';`);
  fs.writeFileSync(path.join(versionDir,'popup.html'),`<!doctype html><html><head><meta charset="utf-8"><style>html,body{width:320px;height:220px;margin:0}body{box-sizing:border-box;padding:24px;font:14px system-ui;color:#1c2430;background:#fff}.card{padding:18px;border:1px solid #e4e8ef;border-radius:14px}small{color:#64748b}</style></head><body><section class="card"><strong id="popup-name">${name}</strong><p>本地扩展弹窗夹具</p><small id="popup-id"></small></section><script src="popup.js"></script></body></html>`);
  fs.writeFileSync(path.join(versionDir,'popup.js'),`document.querySelector('#popup-id').textContent=chrome.runtime.id;`);
  return id;
}

function addExtensionVersion(profileDir,id,version){
  const source=path.join(profileDir,'Extensions',id,'1.0.0');
  const destination=path.join(profileDir,'Extensions',id,version);fs.mkdirSync(destination,{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));manifest.version=version;
  fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest));
  fs.copyFileSync(path.join(source,'content.js'),path.join(destination,'content.js'));
  fs.copyFileSync(path.join(source,'popup.html'),path.join(destination,'popup.html'));
  fs.copyFileSync(path.join(source,'popup.js'),path.join(destination,'popup.js'));
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

function addChromeCookie(profileDir,name,value,{host='auth.example.test',cookiePath='/'}={}){
  const database=new DatabaseSync(path.join(profileDir,'Cookies'));
  const add=database.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  add.run(host,name,value,Buffer.alloc(0),cookiePath,0,0,0,0,2,'');
  database.close();
}

function writeCorruptCookieIndex(profileDir){
  const file=path.join(profileDir,'Cookies');
  const database=new DatabaseSync(file);
  database.exec('DELETE FROM cookies');
  const insert=database.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for(let index=0;index<100;index++)insert.run('auth.example.test',`fixture_cookie_${String(index).padStart(4,'0')}`,'fixture-value',Buffer.alloc(0),'/',0,0,0,0,2,'');
  database.exec('CREATE INDEX cookies_name_idx ON cookies(name)');
  const rootPage=database.prepare("SELECT rootpage FROM sqlite_schema WHERE name='cookies_name_idx'").get().rootpage;
  const pageSize=database.prepare('PRAGMA page_size').get().page_size;
  database.close();
  const descriptor=fs.openSync(file,'r+');
  try{fs.writeSync(descriptor,Buffer.from([0xff]),0,1,(rootPage-1)*pageSize);}finally{fs.closeSync(descriptor);}
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
async function extensionPopupWindowOpen(app,urlPrefix){
  return app.evaluate(({BrowserWindow},prefix)=>BrowserWindow.getAllWindows().some(window=>window.webContents.getURL().startsWith(prefix)),urlPrefix);
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
  if(process.platform==='darwin')await shell.waitForFunction(()=>{
    const cookies=document.querySelector('input[name="chrome-category"][value="cookies"]');
    return cookies&&!cookies.disabled;
  });
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
  let server;const restrictedPaths=[];
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
      await shell.locator('#chrome-import-error').getByText(/测试注入：Chrome Cookie 持久化失败；Chrome Cookie 导入失败后回滚未完整完成.*持久化 Cookie 回滚结果.*本次导入的 Cookie 可能仍保留.*关闭对话框或重启 Corvid 后，请重新选择同一 Chrome 来源和目标 Profile/).waitFor();
      assert.equal(await shell.locator('#chrome-import-target-profile').isDisabled(),true,'a failed write must keep the target fixed for a same-target retry');
      const rolledBackCookies=await app.evaluate(({session})=>session.fromPartition('persist:corvid').cookies.get({}),{});
      assert.equal(rolledBackCookies.length,1,'failed Cookie flush must remove newly imported Cookies and preserve the preexisting conflict');
      assert.equal(rolledBackCookies[0].value,'corvid-existing-value','failed Cookie flush rollback must not change the existing conflicting Cookie');
      assert.equal((await call('/bookmarks')).bookmarks.length,0,'failed Cookie import must not start importing unselected library categories');
      assert.equal((await call('/history')).history.length,0,'failed Cookie import must leave history unchanged');
      await app.evaluate(async({session})=>session.fromPartition('persist:corvid').cookies.flushStore(),{});
      await shell.locator('#confirm-chrome-import').click();
      await shell.locator('#chrome-import-error').getByText(/Cookie 新增 2 项 ?[（(]跳过 1 项、不支持 2 项[）)]/).waitFor();
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
    assert.equal(await shell.locator('#chrome-import-target-profile').isDisabled(),true,'a library write failure must keep the target fixed for retry');
    assert.deepEqual(fs.readFileSync(path.join(appData,'library.json')),libraryBeforeFailedImport,'failed Chrome library replacement must preserve the existing library bytes');
    assert.equal(fs.existsSync(path.join(appData,'library.json.tmp')),false,'failed Chrome library replacement must remove its temporary file');
    assert.deepEqual((await call('/bookmarks')).bookmarks.map(item=>item.url),['https://corvid.fixture/preserved'],'failed import must not partially append Chrome bookmarks');
    assert.equal((await call('/history')).history.length,0,'failed import must not partially append Chrome history');
    await shell.locator('#confirm-chrome-import').click();
    await shell.locator('#chrome-import-error').getByText(new RegExp(`导入完成：书签新增 1 项.*历史新增 1 项.*${supportsCookieImport?'Cookie 新增 0 项 ?[（(]跳过 3 项、不支持 2 项[）)]':''}.*扩展新增 1 项.*未导入：Corvid Symlink[:：] ?Chrome 扩展包含不支持的符号链接`)).waitFor();
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
    const popupTrigger=shell.locator('#extension-toolbar .extension-toolbar-button');
    await popupTrigger.waitFor();assert.equal(await popupTrigger.count(),1,'only the enabled extension declaring a popup should appear in the toolbar');
    const localeContract=await shell.evaluate(()=>({locale:window.corvidI18n.locale,catalogs:window.corvidI18n.catalogs,label:window.corvidI18n.t('extensionPopup',{name:'Corvid Marker'})}));
    assert.deepEqual(Object.keys(localeContract.catalogs['zh-CN']).sort(),Object.keys(localeContract.catalogs.en).sort(),'extension popup UI strings must be complete in both locales');
    assert.equal(await popupTrigger.getAttribute('aria-label'),localeContract.label,'extension toolbar accessible name should use the active locale');
    const screenshotDir=path.join(project,'docs','qa','screenshots');fs.mkdirSync(screenshotDir,{recursive:true});
    await shell.screenshot({path:path.join(screenshotDir,'issue-129-extension-toolbar.png')});
    await popupTrigger.click();
    const popupUrlPrefix=`chrome-extension://${chromeProfiles[0].extensionId}/popup.html`;
    const popupPage=await until(async()=>app.windows().find(page=>page.url().startsWith(popupUrlPrefix))||null,'extension popup window');
    await popupPage.locator('#popup-id').waitFor();assert.equal(await popupPage.locator('#popup-id').textContent(),chromeProfiles[0].extensionId);
    const popupSize=await popupPage.evaluate(()=>({width:innerWidth,height:innerHeight}));
    await popupPage.screenshot({path:path.join(screenshotDir,'issue-129-extension-popup.png')});
    assert.deepEqual(popupSize,{width:320,height:220},'popup window should follow the extension content size within the Corvid bounds');
    const popupSessionPath=await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(contents=>contents.getURL()===url)?.session.getStoragePath(),popupPage.url());
    assert.ok(popupSessionPath?.endsWith(`${path.sep}Partitions${path.sep}corvid`),'popup should use the default Profile partition');
    const popupPreferences=await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(contents=>contents.getURL()===url)?.getLastWebPreferences(),popupPage.url());
    assert.equal(popupPreferences?.nodeIntegration,false,'extension popup must not receive Node integration');assert.equal(popupPreferences?.sandbox,true,'extension popup must remain sandboxed');
    await popupPage.bringToFront();await until(()=>popupPage.evaluate(()=>document.hasFocus()),'extension popup focus before Escape');
    await app.evaluate(({webContents},url)=>{const popup=webContents.getAllWebContents().find(contents=>contents.getURL()===url);popup.sendInputEvent({type:'keyDown',keyCode:'ESC'});popup.sendInputEvent({type:'keyUp',keyCode:'ESC'});},popupPage.url());
    await until(async()=>!await extensionPopupWindowOpen(app,popupUrlPrefix),'extension popup Escape close');
    assert.equal(await shell.evaluate(()=>document.activeElement?.dataset.extensionId),chromeProfiles[0].extensionId,'Escape should return focus to the toolbar trigger');
    await popupTrigger.click();
    await until(async()=>extensionPopupWindowOpen(app,popupUrlPrefix),'extension popup reopen');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().startsWith('file://'))?.focus());
    await until(async()=>!await extensionPopupWindowOpen(app,popupUrlPrefix),'extension popup closes after native parent-window activation');
    await shell.locator('#more-tools').click();
    await shell.locator('#site-tools').waitFor();
    assert.equal(JSON.parse(fs.readFileSync(path.join(appData,'managed-extensions.json'))).length,1,'failed extension copies must not remain in managed state');
    assert.equal(fs.existsSync(require('../desktop/chrome-extensions.cjs').managedPath(appData,'default',chromeProfiles[0].symlinkExtensionId,'1.0.0')),false,'failed extension copies must be cleaned up');

    await shell.locator('#show-settings').click();
    await shell.locator('#start-chrome-import').click();
    await chooseSource(shell);
    await shell.locator('input[name="chrome-category"][value="extensions"]').check();
    await selectAllExtensions(shell);
    if(supportsCookieImport){await shell.locator('input[name="chrome-category"][value="cookies"]').check();await allowCookieImport(shell);}
    await shell.locator('#confirm-chrome-import').click();
    await shell.locator('#chrome-import-error').getByText(new RegExp(`导入完成：书签新增 0 项.*${supportsCookieImport?'Cookie 新增 0 项 ?[（(]跳过 3 项、不支持 2 项[）)].*':''}扩展跳过 1 项`)).waitFor();
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
    assert.equal(await shell.locator('#chrome-import-target-profile').inputValue(),work.id,'the import dialog should default to the active Corvid Profile');
    await shell.locator('#chrome-source-profile').selectOption('Profile 1');
    await shell.locator('#chrome-import-preview').getByText(/工作 Chrome/).waitFor();
    await shell.locator('#chrome-import-target-profile').selectOption('default');
    await shell.locator('#confirm-chrome-import').click();
    await shell.locator('#chrome-import-error').getByText(/导入完成：书签新增 1 项、历史新增 1 项/).waitFor();
    assert.equal(await shell.locator('#chrome-import-target-profile').isDisabled(),true,'the target must be fixed after any successful or partial import result');
    assert.equal((await call('/bookmarks?profileId=default')).bookmarks.some(item=>item.title==='书签 1'),true,'the chosen destination must receive Chrome bookmarks even when it is not active');
    assert.equal((await call(`/bookmarks?profileId=${work.id}`)).bookmarks.length,0,'Chrome bookmarks must not be written to the active Profile when another target was selected');
    assert.equal((await call('/history?profileId=default')).history.some(item=>item.title==='历史 1'),true,'the chosen destination must receive Chrome history');
    await shell.locator('#cancel-chrome-import').click();
    await shell.locator('#show-settings').click();
    await shell.locator('#start-chrome-import').click();
    await chooseSource(shell);
    await shell.locator('#chrome-source-profile').selectOption('Profile 1');
    await shell.locator('#chrome-import-preview').getByText(/工作 Chrome/).waitFor();
    await shell.locator('#chrome-import-target-profile').selectOption(work.id);
    await shell.locator('input[name="chrome-category"][value="bookmarks"]').uncheck();
    await shell.locator('input[name="chrome-category"][value="history"]').uncheck();
    await shell.locator('input[name="chrome-category"][value="extensions"]').check();
    await selectAllExtensions(shell);
    await shell.locator('#confirm-chrome-import').click();
    await shell.locator('#chrome-import-error').getByText(/扩展新增 1 项/).waitFor();
    assert.equal((await call(`/bookmarks?profileId=${work.id}`)).bookmarks.length,0);
    assert.ok((await call('/bookmarks?profileId=default')).bookmarks.some(item=>item.title==='书签 0'));
    await shell.locator('#cancel-chrome-import').click();
    await shell.getByRole('button',{name:'新建标签'}).click();
    await shell.locator('#address').fill(extensionUrl);await shell.locator('#address').press('Enter');
    await shell.getByRole('button',{name:'Extension Fixture'}).waitFor();
    await until(async()=>await extensionValue(app,extensionUrl,'corvidWorkExtension',`persist:corvid-profile-${work.id}`)==='loaded','work Chrome extension content script');
    assert.equal(await extensionValue(app,extensionUrl,'corvidDefaultExtension',`persist:corvid-profile-${work.id}`),'','default extension must not be loaded in work Profile');
    const workPopupTrigger=shell.locator('#extension-toolbar .extension-toolbar-button');await workPopupTrigger.waitFor();
    await workPopupTrigger.click();
    const workPopupUrl=`chrome-extension://${chromeProfiles[1].extensionId}/popup.html`;
    const workPopupPage=await until(async()=>app.windows().find(page=>page.url().startsWith(workPopupUrl))||null,'work Profile extension popup');
    const workPopupSession=await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(contents=>contents.getURL()===url)?.session.getStoragePath(),workPopupPage.url());
    assert.ok(workPopupSession?.endsWith(`${path.sep}Partitions${path.sep}corvid-profile-${work.id}`),'work popup should use only its owning Profile session');
    await shell.locator('#profile-select').selectOption('default');
    await until(async()=>!await extensionPopupWindowOpen(app,workPopupUrl),'Profile switch should close the open extension popup');
    await shell.locator('#profile-select').selectOption(work.id);
    await shell.locator('#show-settings').click();
    await shell.getByRole('checkbox',{name:'停用 Corvid Work Marker'}).click();
    await shell.getByRole('checkbox',{name:'启用 Corvid Work Marker'}).waitFor();
    assert.equal(await shell.locator('#extension-toolbar .extension-toolbar-button').count(),0,'disabled extensions should disappear from the toolbar');
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

    if(supportsCookieImport){
      addChromeCookie(path.join(chromeRoot,'Default'),'write_retry_cookie','retry-cookie-value');
      const sourceAfterFixture=crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','Cookies'))).digest('hex');
      const retryData=path.join(tempRoot,'cookie-write-retry-data');
      ({app,shell,call}=await boot(retryData,{CORVID_TEST_CHROME_COOKIE_KEY:cookieKey.toString('hex'),CORVID_TEST_CHROME_COOKIE_SET_FAIL_NAME:'write_retry_cookie'}));
      await shell.getByRole('heading',{name:'从 Chrome 开始使用 Corvid？'}).waitFor();
      await shell.locator('#skip-chrome-import').click();
      await shell.locator('#show-settings').click();
      await shell.locator('#start-chrome-import').click();
      await installDialogFixture(app,chromeRoot);
      await chooseSource(shell);
      await shell.locator('input[name="chrome-category"][value="bookmarks"]').uncheck();
      await shell.locator('input[name="chrome-category"][value="history"]').uncheck();
      await shell.locator('input[name="chrome-category"][value="cookies"]').check();
      await allowCookieImport(shell);
      await shell.locator('#confirm-chrome-import').click();
      const importStatus=shell.locator('#chrome-import-error');
      await importStatus.getByText(/写入失败 1 项，可再次点击导入重试/).waitFor();
      assert.equal(await importStatus.getAttribute('data-partial'),'true','a per-cookie write error must be presented as a partial import');
      assert.equal(await importStatus.getAttribute('data-success'),null,'a partial Cookie import must not appear fully successful');
      assert.equal(await shell.locator('#confirm-chrome-import').isDisabled(),false,'the same source must remain available for retry');
      assert.equal(await shell.locator('#chrome-import-target-profile').isDisabled(),true,'a partial import must keep its original target fixed for retry');
      assert.match(await importStatus.textContent(),/不支持 2 项/,'unsupported source rows must remain distinct from the write failure');
      assert.match(await importStatus.textContent(),/Cookie 新增 3 项/,'other valid cookies must still import');
      const beforeRetry=await app.evaluate(({session})=>session.fromPartition('persist:corvid').cookies.get({}),{});
      assert.equal(beforeRetry.some(cookie=>cookie.name==='write_retry_cookie'),false,'the injected write failure must leave that Cookie absent');
      await shell.locator('#confirm-chrome-import').click();
      await importStatus.getByText(/Cookie 新增 1 项 ?[（(]跳过 3 项、不支持 2 项[）)]/).waitFor();
      assert.equal(await importStatus.getAttribute('data-success'),'true','successful retry must return to success state');
      assert.equal(await importStatus.getAttribute('data-partial'),null);
      assert.equal(await shell.locator('#confirm-chrome-import').isDisabled(),true,'a successful retry must finish the import');
      const afterRetry=await app.evaluate(({session})=>session.fromPartition('persist:corvid').cookies.get({}),{});
      assert.equal(afterRetry.find(cookie=>cookie.name==='write_retry_cookie')?.value,'retry-cookie-value','retry must import the previously failed Cookie');
      assert.equal(afterRetry.filter(cookie=>['encrypted_session','domain_session','persistent_import','write_retry_cookie'].includes(cookie.name)).length,4,'successful existing Cookie values must not be duplicated');
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(chromeRoot,'Default','Cookies'))).digest('hex'),sourceAfterFixture,'partial and retried imports must not modify Chrome source data');
      await shell.locator('#cancel-chrome-import').click();
      await app.close();app=undefined;

      addChromeCookie(path.join(chromeRoot,'Default'),'rollback_subject','fixture-rollback-value',{host:'.example.test',cookiePath:'/app'});
      for(const scenario of [{name:'remove',injectRemoveFailure:true,preserveExisting:false},{name:'preserve-existing',injectRemoveFailure:false,preserveExisting:true},{name:'preserve-existing-rollback-flush',injectRemoveFailure:false,preserveExisting:true,injectRollbackFlushFailure:true},{name:'restart-after-rollback-flush-failure',injectRemoveFailure:false,preserveExisting:true,injectRollbackFlushFailure:true,restartBeforeRetry:true}]){
        const rollbackData=path.join(tempRoot,`cookie-${scenario.name}-rollback-data`);
        const injection={
          CORVID_TEST_CHROME_COOKIE_KEY:cookieKey.toString('hex'),
          CORVID_TEST_CHROME_COOKIE_FLUSH_FAIL_ONCE:'1',
          ...(scenario.injectRemoveFailure?{CORVID_TEST_CHROME_COOKIE_REMOVE_FAIL_NAME:'rollback_subject'}:{}),
          ...(scenario.injectRollbackFlushFailure?{CORVID_TEST_CHROME_COOKIE_ROLLBACK_FLUSH_FAIL_ONCE:'1'}:{}),
        };
        ({app,shell,call}=await boot(rollbackData,injection));
        await shell.getByRole('heading',{name:'从 Chrome 开始使用 Corvid？'}).waitFor();
        await shell.locator('#skip-chrome-import').click();
        await shell.locator('#show-settings').click();
        await shell.locator('#start-chrome-import').click();
        await installDialogFixture(app,chromeRoot);
        await chooseSource(shell);
        if(scenario.preserveExisting)await app.evaluate(async({session})=>{
          const destination=session.fromPartition('persist:corvid');
          await destination.cookies.set({url:'http://example.test/',domain:'.example.test',name:'rollback_subject',value:'preserve-original-value',path:'/',expirationDate:1893456000});
          await destination.cookies.flushStore();
        });
        await shell.locator('input[name="chrome-category"][value="bookmarks"]').uncheck();
        await shell.locator('input[name="chrome-category"][value="history"]').uncheck();
        await shell.locator('input[name="chrome-category"][value="cookies"]').check();
        await allowCookieImport(shell);
        await shell.locator('#confirm-chrome-import').click();
        const rollbackStatus=shell.locator('#chrome-import-error');
        await rollbackStatus.getByText(/回滚未完整完成/).waitFor();
        assert.equal(await rollbackStatus.getAttribute('data-partial'),'true',`${scenario.name} failure must be shown as a partial rollback`);
        assert.equal(await rollbackStatus.getAttribute('data-success'),null,`${scenario.name} failure must not appear successful`);
        assert.equal(await shell.locator('#confirm-chrome-import').isDisabled(),false,`${scenario.name} failure must leave retry available`);
        assert.equal(await shell.locator('#chrome-import-target-profile').isDisabled(),true,`${scenario.name} retry must keep the destination Profile fixed`);
        assert.match(await rollbackStatus.textContent(),new RegExp(scenario.preserveExisting?'为保护目标 Profile 原有 Cookie':'删除本次新增 Cookie'));
        assert.match(await rollbackStatus.textContent(),/请在当前对话框中重试/,'rollback guidance must retain a direct retry path in the open importer');
        assert.match(await rollbackStatus.textContent(),/关闭对话框或重启 Corvid 后，请重新选择同一 Chrome 来源和目标 Profile，再次点击“导入”/,'rollback guidance must explain how to recover after the dialog or app is closed');
        if(scenario.injectRollbackFlushFailure)assert.match(await rollbackStatus.textContent(),/持久化 Cookie 回滚结果/,'a failed rollback flush must be reported alongside the preserved Cookie warning');
        const afterRollback=await app.evaluate(({session})=>session.fromPartition('persist:corvid').cookies.get({url:'http://example.test/app',name:'rollback_subject'}));
        assert.equal(afterRollback.find(cookie=>cookie.path==='/')?.value,scenario.preserveExisting?'preserve-original-value':undefined,`${scenario.name} failure must retain the target Cookie state`);
        assert.equal(afterRollback.find(cookie=>cookie.path==='/app')?.value,'fixture-rollback-value',`${scenario.name} failure must leave the imported Cookie state explicit`);
        if(scenario.restartBeforeRetry){
          const child=app.process();
          const exited=new Promise(resolve=>child.once('exit',resolve));
          app=undefined;shell=undefined;call=undefined;
          child.kill('SIGKILL');
          await exited;
          ({app,shell,call}=await boot(rollbackData,{CORVID_TEST_CHROME_COOKIE_KEY:cookieKey.toString('hex')}));
          await shell.locator('#show-settings').click();
          await shell.locator('#start-chrome-import').click();
          await installDialogFixture(app,chromeRoot);
          await chooseSource(shell);
          await shell.locator('input[name="chrome-category"][value="bookmarks"]').uncheck();
          await shell.locator('input[name="chrome-category"][value="history"]').uncheck();
          await shell.locator('input[name="chrome-category"][value="cookies"]').check();
          await allowCookieImport(shell);
        }
        const retryStatus=shell.locator('#chrome-import-error');
        await shell.locator('#confirm-chrome-import').click();
        await retryStatus.getByText(/Cookie 新增/).waitFor();
        assert.equal(await retryStatus.getAttribute('data-success'),'true',`${scenario.name} retry must complete successfully`);
        const afterRetry=await app.evaluate(({session})=>session.fromPartition('persist:corvid').cookies.get({url:'http://example.test/app',name:'rollback_subject'}));
        assert.equal(afterRetry.find(cookie=>cookie.path==='/')?.value,scenario.preserveExisting?'preserve-original-value':undefined,'retry must not lose an existing target Cookie');
        assert.equal(afterRetry.find(cookie=>cookie.path==='/app')?.value,'fixture-rollback-value','retry must not duplicate the selected Chrome Cookie');
        await app.close();app=undefined;
      }

      const diskFailureData=path.join(tempRoot,'cookie-readonly-store-data');
      const cookieStorePath=path.join(diskFailureData,'Partitions','corvid');
      fs.mkdirSync(cookieStorePath,{recursive:true});fs.chmodSync(cookieStorePath,0o500);restrictedPaths.push(cookieStorePath);
      ({app,shell,call}=await boot(diskFailureData,{CORVID_TEST_CHROME_COOKIE_KEY:cookieKey.toString('hex')}));
      try{
        assert.throws(()=>fs.writeFileSync(path.join(cookieStorePath,'write-probe'),'x'),error=>error.code==='EACCES','the fixture must actually deny writes to the Cookie store directory');
        await shell.getByRole('heading',{name:'从 Chrome 开始使用 Corvid？'}).waitFor();
        await shell.locator('#skip-chrome-import').click();
        await shell.locator('#show-settings').click();
        await shell.locator('#start-chrome-import').click();
        await installDialogFixture(app,chromeRoot);
        await chooseSource(shell);
        await shell.locator('input[name="chrome-category"][value="bookmarks"]').uncheck();
        await shell.locator('input[name="chrome-category"][value="history"]').uncheck();
        await shell.locator('input[name="chrome-category"][value="cookies"]').check();
        await allowCookieImport(shell);
        await shell.locator('#confirm-chrome-import').click();
        const diskFailureStatus=shell.locator('#chrome-import-error');
        const diskFailureText=await until(async()=>await diskFailureStatus.textContent()||false,'Cookie import result under a read-only profile');
        assert.match(diskFailureText,/Cookie.*持久化/,'a disk write failure must be surfaced instead of reporting Cookie import success');
        assert.equal(await diskFailureStatus.getAttribute('data-success'),null,'a silently resolved flushStore must not be reported as a successful import when disk data is absent');
        const inMemoryAfterFailure=await app.evaluate(async({session})=>session.fromPartition('persist:corvid').cookies.get({url:'http://example.test/'}));
        assert.equal(inMemoryAfterFailure.some(cookie=>cookie.name==='persistent_import'),false,'an unpersisted Cookie should be removed from the live store before retry');

        fs.chmodSync(cookieStorePath,0o700);
        const child=app.process();const exited=new Promise(resolve=>child.once('exit',resolve));
        app=undefined;shell=undefined;call=undefined;child.kill('SIGKILL');await exited;
        ({app,shell,call}=await boot(diskFailureData,{CORVID_TEST_CHROME_COOKIE_KEY:cookieKey.toString('hex')}));
        const beforeDiskRetry=await app.evaluate(async({session})=>session.fromPartition('persist:corvid').cookies.get({url:'http://example.test/'}));
        assert.equal(beforeDiskRetry.some(cookie=>cookie.name==='persistent_import'),false,'a silently resolved flushStore must not survive a process restart when the store directory is not writable');
        await shell.locator('#show-settings').click();
        await shell.locator('#start-chrome-import').click();
        await installDialogFixture(app,chromeRoot);
        await chooseSource(shell);
        await shell.locator('input[name="chrome-category"][value="bookmarks"]').uncheck();
        await shell.locator('input[name="chrome-category"][value="history"]').uncheck();
        await shell.locator('input[name="chrome-category"][value="cookies"]').check();
        await allowCookieImport(shell);
        await shell.locator('#confirm-chrome-import').click();
        const retryStatus=shell.locator('#chrome-import-error');
        await retryStatus.getByText(/Cookie 新增 5 项/).waitFor();
        assert.equal(await retryStatus.getAttribute('data-success'),'true','the same source can be selected and retried after storage permissions are restored');
        await shell.locator('#cancel-chrome-import').click();
        await app.close();app=undefined;
        ({app}=await boot(diskFailureData,{CORVID_TEST_CHROME_COOKIE_KEY:cookieKey.toString('hex')}));
        const afterDiskRecovery=await app.evaluate(async({session})=>session.fromPartition('persist:corvid').cookies.get({url:'http://example.test/'}));
        assert.equal(afterDiskRecovery.find(cookie=>cookie.name==='persistent_import')?.value,'fixture-persistent-value','re-import after restoring disk access must persist across restart');
      }finally{
        try{fs.chmodSync(cookieStorePath,0o700);}catch{}
        if(app)await app.close().catch(()=>{});app=undefined;
      }
    }

    if(supportsCookieImport){
      const corruptChromeRoot=path.join(tempRoot,'corrupt-chrome-user-data');
      fs.cpSync(chromeRoot,corruptChromeRoot,{recursive:true});
      const corruptCookieFile=path.join(corruptChromeRoot,'Default','Cookies');
      writeCorruptCookieIndex(path.join(corruptChromeRoot,'Default'));
      const corruptCookieBytes=fs.readFileSync(corruptCookieFile);
      const corruptData=path.join(tempRoot,'corrupt-source-corvid-data');
      ({app,shell,call}=await boot(corruptData,{CORVID_TEST_CHROME_COOKIE_KEY:cookieKey.toString('hex')}));
      await shell.getByRole('heading',{name:'从 Chrome 开始使用 Corvid？'}).waitFor();
      await shell.locator('#skip-chrome-import').click();
      await call('/bookmarks','POST',{url:'https://corvid.fixture/preserved-corrupt-source','title':'损坏来源前的既有书签'});
      const libraryBeforeCorruptImport=fs.readFileSync(path.join(corruptData,'library.json'));
      await installDialogFixture(app,corruptChromeRoot);
      await shell.locator('#show-settings').click();
      await shell.locator('#start-chrome-import').click();
      await chooseSource(shell);
      await shell.locator('input[name="chrome-category"][value="bookmarks"]').uncheck();
      await shell.locator('input[name="chrome-category"][value="history"]').uncheck();
      await shell.locator('input[name="chrome-category"][value="cookies"]').check();
      await allowCookieImport(shell);
      await shell.locator('#confirm-chrome-import').click();
      const corruptImportStatus=shell.locator('#chrome-import-error');
      await corruptImportStatus.waitFor({state:'visible'});
      assert.match(await corruptImportStatus.textContent(),/数据库可能已损坏或格式不受支持/,'a corrupt Cookie database must receive corruption guidance instead of a generic Chrome-in-use suggestion');
      assert.equal(await corruptImportStatus.getAttribute('data-success'),null,'an unreadable Cookie database must not be reported as a successful import');
      assert.deepEqual(fs.readFileSync(path.join(corruptData,'library.json')),libraryBeforeCorruptImport,'a corrupt Chrome Cookie database must leave the target library byte-for-byte unchanged');
      assert.deepEqual((await call('/bookmarks')).bookmarks.map(item=>item.url),['https://corvid.fixture/preserved-corrupt-source'],'a corrupt Cookie database must not partially import Chrome bookmarks');
      assert.deepEqual(await app.evaluate(({session})=>session.fromPartition('persist:corvid').cookies.get({})),[],'a corrupt Cookie database must not modify the target Cookie store');
      assert.deepEqual(fs.readFileSync(corruptCookieFile),corruptCookieBytes,'Corvid must leave the corrupt Chrome source untouched');
      await shell.locator('#cancel-chrome-import').click();
      await app.close();app=undefined;

      const lockedChromeRoot=path.join(tempRoot,'locked-chrome-user-data');
      fs.cpSync(chromeRoot,lockedChromeRoot,{recursive:true});
      const lockedCookieFile=path.join(lockedChromeRoot,'Default','Cookies');
      const lockedCookieBytes=fs.readFileSync(lockedCookieFile);
      const lockedDatabase=new DatabaseSync(lockedCookieFile);
      const lockedData=path.join(tempRoot,'locked-source-corvid-data');
      try{
        ({app,shell,call}=await boot(lockedData,{CORVID_TEST_CHROME_COOKIE_KEY:cookieKey.toString('hex')}));
        await shell.getByRole('heading',{name:'从 Chrome 开始使用 Corvid？'}).waitFor();
        await shell.locator('#skip-chrome-import').click();
        await call('/bookmarks','POST',{url:'https://corvid.fixture/preserved-locked-source','title':'占用来源前的既有书签'});
        const libraryBeforeLockedImport=fs.readFileSync(path.join(lockedData,'library.json'));
        await installDialogFixture(app,lockedChromeRoot);
        await shell.locator('#show-settings').click();
        await shell.locator('#start-chrome-import').click();
        await chooseSource(shell);
        await shell.locator('input[name="chrome-category"][value="bookmarks"]').uncheck();
        await shell.locator('input[name="chrome-category"][value="history"]').uncheck();
        await shell.locator('input[name="chrome-category"][value="cookies"]').check();
        await allowCookieImport(shell);
        lockedDatabase.exec('BEGIN EXCLUSIVE');
        await shell.locator('#confirm-chrome-import').click();
        const lockedImportStatus=shell.locator('#chrome-import-error');
        await lockedImportStatus.waitFor({state:'visible'});
        assert.match(await lockedImportStatus.textContent(),/可能仍被 Chrome 占用/,'a busy Cookie database must direct the user to close Chrome rather than report corruption');
        assert.equal(await lockedImportStatus.getAttribute('data-success'),null,'a locked Cookie database must not be reported as a successful import');
        assert.deepEqual(fs.readFileSync(path.join(lockedData,'library.json')),libraryBeforeLockedImport,'a locked Chrome Cookie database must leave the target library byte-for-byte unchanged');
        assert.deepEqual((await call('/bookmarks')).bookmarks.map(item=>item.url),['https://corvid.fixture/preserved-locked-source'],'a locked Chrome Cookie database must not partially import Chrome bookmarks');
        assert.deepEqual(await app.evaluate(({session})=>session.fromPartition('persist:corvid').cookies.get({})),[],'a locked Chrome Cookie database must not modify the target Cookie store');
        assert.deepEqual(fs.readFileSync(lockedCookieFile),lockedCookieBytes,'Corvid must leave the locked Chrome source untouched');
        await shell.locator('#cancel-chrome-import').click();
        await app.close();app=undefined;
      }finally{
        try{lockedDatabase.exec('ROLLBACK');}catch{}
        lockedDatabase.close();
        if(app){await app.close().catch(()=>{});app=undefined;}
      }
    }

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
    console.log('PASS Chrome import, Cookie decryption/write/Profile isolation and persistence semantics, per-Cookie write failure/retry, rollback deletion failure and old-Cookie preservation, post-SIGKILL re-import recovery, extension version/failure handling, content execution, disable/remove and restart restore');
  }finally{
    for(const restrictedPath of restrictedPaths)try{fs.chmodSync(restrictedPath,0o700);}catch{}
    if(app)await app.close().catch(()=>{});
    if(server)await new Promise(resolve=>server.close(resolve));
    fs.rmSync(tempRoot,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
