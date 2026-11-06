const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const captureScreenshots=process.env.CORVID_CAPTURE_QA_SCREENSHOTS==='1';
function assertCatalogSourceHasUniqueKeys(){
  const source=fs.readFileSync(path.join(root,'desktop/locales.js'),'utf8');
  for(const locale of ['zh-CN','en']){
    const start=source.indexOf(locale==='en'?'    en: {':`    '${locale}': {`);
    assert.notEqual(start,-1,`locale catalog ${locale} exists`);
    const end=source.indexOf('\n    },',start);
    assert.notEqual(end,-1,`locale catalog ${locale} closes`);
    const seen=new Set();
    for(const match of source.slice(start,end).matchAll(/^      ([A-Za-z_$][\w$]*):/gm)){
      assert(!seen.has(match[1]),`locale catalog ${locale} defines ${match[1]} more than once`);
      seen.add(match[1]);
    }
  }
}
assertCatalogSourceHasUniqueKeys();
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-localization-'));
  const preferencePath=path.join(dataDir,'ui-preferences.json');
  fs.writeFileSync(preferencePath,JSON.stringify({schemaVersion:1,uiLocale:'zh-CN'}),{mode:0o600});
  let app;
  const start=async()=>{
    app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});
    return app.firstWindow();
  };
  const stop=async()=>{await app.close();app=undefined;};
  const waitFor=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(25);}throw new Error(`Timed out waiting for ${label}`);};
  const capture=async(shell,locale,width,height)=>{if(!captureScreenshots)return;const directory=path.join(root,'docs/qa/screenshots');fs.mkdirSync(directory,{recursive:true});const filename=locale.startsWith('issue-130-a2-')?`${locale}-${width}x${height}.png`:locale.endsWith('-settings')?`issue-165-settings-${locale.slice(0,-9)}-${width}x${height}.png`:`corvid-localization-${locale}-${width}x${height}.png`;await shell.screenshot({path:path.join(directory,filename)});};
  const verifyRenameError=async(shell,locale,expected)=>{
    await shell.locator('#profile-menu-trigger').click();
    const actionName=locale==='en'?'Rename current browsing profile':'重命名当前浏览身份';
    await shell.getByRole('menuitem',{name:actionName}).click();
    await shell.locator('#renamed-profile-name').fill('');
    await shell.locator('#rename-profile-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await waitFor(()=>shell.locator('#rename-profile-error').textContent().then(value=>value===expected),`localized ${locale} browsing-profile error`);
    await capture(shell,`issue-130-a2-profile-error-${locale}`,1024,700);
    await shell.locator('#cancel-rename-profile').click();
  };
  const assertSettingsScrollAtNarrowWindow=async(shell,label)=>{
    const geometry=await shell.locator('#settings').evaluate(dialog=>{
      const rect=dialog.getBoundingClientRect();
      const nav=dialog.querySelector('.settings-nav').getBoundingClientRect();
      const contentRect=dialog.querySelector('#settings-content').getBoundingClientRect();
      const actions=dialog.querySelector('.settings-actions').getBoundingClientRect();
      const content=dialog.querySelector('#settings-content');
      return {open:dialog.open,top:rect.top,bottom:rect.bottom,viewportHeight:window.innerHeight,navBottom:nav.bottom,contentTop:contentRect.top,actionsTop:actions.top,scrollHeight:content.scrollHeight,clientHeight:content.clientHeight};
    });
    assert(geometry.open,`${label}: settings dialog is open`);
    assert(geometry.top>=0&&geometry.bottom<=geometry.viewportHeight,`${label}: settings dialog stays inside the window`);
    assert(geometry.navBottom<=geometry.contentTop,`${label}: category navigation does not overlap settings content`);
    assert(geometry.actionsTop>geometry.contentTop,`${label}: fixed actions remain below settings content`);
    assert(geometry.scrollHeight>geometry.clientHeight,`${label}: long settings content is scrollable`);
    const saveButton=await shell.locator('#settings').evaluate(dialog=>{
      dialog.querySelector('#settings-content').scrollTop=dialog.querySelector('#settings-content').scrollHeight;
      const rect=dialog.querySelector('button[type="submit"]').getBoundingClientRect();
      const viewport=dialog.getBoundingClientRect();
      return {top:rect.top,bottom:rect.bottom,dialogTop:viewport.top,dialogBottom:viewport.bottom};
    });
    assert(saveButton.top>=saveButton.dialogTop&&saveButton.bottom<=saveButton.dialogBottom,`${label}: scrolling exposes the save action completely`);
  };
  try{
    let shell=await start();
    await shell.locator('#ui-locale').waitFor({state:'attached'});
    await shell.getByRole('button',{name:'设置'}).click();
    assert.equal(await shell.locator('#settings-nav-general').getAttribute('aria-current'),'location');
    assert.equal(await shell.locator('#settings-site-permissions').isDisabled(),true);
    const chineseSearchTemplate=await shell.locator('#search-template').inputValue();
    await shell.locator('#search-template').fill('not a search template');
    await shell.locator('#settings-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await waitFor(()=>shell.locator('#settings-error').textContent().then(Boolean),'Chinese search-template error');
    assert.equal(await shell.locator('#settings-error').textContent(),'搜索模板必须是 HTTP(S) 地址，并包含查询占位符。','search-template validation should use Chinese Corvid copy');
    await capture(shell,'issue-130-a2-error-zh-CN',1024,700);
    await shell.locator('#search-template').fill(chineseSearchTemplate);
    await shell.locator('#settings-error').evaluate(node=>{node.textContent='';});
    await shell.locator('#cancel-settings').click();
    await verifyRenameError(shell,'zh-CN','浏览身份名称不能为空');
    await shell.getByRole('button',{name:'设置'}).click();
    await shell.locator('#settings-nav-appearance').click();
    assert.equal(await shell.locator('#settings-nav-appearance').getAttribute('aria-current'),'location');
    assert.equal(await shell.locator('#settings-appearance').evaluate(node=>node.matches(':focus')),true);
    await shell.locator('#theme-preference').selectOption('dark');
    await waitFor(()=>app.evaluate(({nativeTheme})=>nativeTheme.themeSource==='dark'),'dark theme source');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir,'browser-preferences.json'),'utf8')),{schemaVersion:2,theme:'dark',startupBehavior:'restore',newTabBehavior:'home',downloadDirectory:'',askWhereToSave:true});
    assert.equal(fs.statSync(path.join(dataDir,'browser-preferences.json')).mode&0o777,0o600);
    await shell.evaluate(()=>window.browserShell.invoke('setUiLocale',{locale:'fr'})).then(()=>{throw new Error('unsupported locale unexpectedly succeeded');},()=>{});
    assert.equal(await shell.locator('html').getAttribute('lang'),'zh-CN');
    assert.equal(await shell.locator('#show-bookmarks').getAttribute('aria-label'),'书签');
    await shell.locator('#settings-nav-agent').click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:100,y:100,width:1024,height:700}));
    await delay(150);
    await capture(shell,'zh-CN-settings',1024,700);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:100,y:100,width:700,height:420}));
    await delay(150);
    await assertSettingsScrollAtNarrowWindow(shell,'Chinese settings');
    await shell.locator('#settings-nav-agent').click();
    await capture(shell,'zh-CN-settings',700,420);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:100,y:100,width:1024,height:700}));
    await delay(150);
    await shell.locator('#settings-nav-general').click();
    await shell.locator('#ui-locale').selectOption('en');
    await waitFor(()=>shell.locator('html').getAttribute('lang').then(value=>value==='en'),'English locale');
    await waitFor(()=>shell.locator('#show-bookmarks').getAttribute('aria-label').then(value=>value==='Bookmarks'),'localized bookmarks name');
    const englishSearchTemplate=await shell.locator('#search-template').inputValue();
    await shell.locator('#search-template').fill('not a search template');
    await shell.locator('#settings-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await waitFor(()=>shell.locator('#settings-error').textContent().then(Boolean),'English search-template error');
    assert.equal(await shell.locator('#settings-error').textContent(),'The search template must be an HTTP(S) address and include the query placeholder.','search-template validation should use English Corvid copy');
    await capture(shell,'issue-130-a2-error-en',1024,700);
    await shell.locator('#search-template').fill(englishSearchTemplate);
    await shell.locator('#settings-error').evaluate(node=>{node.textContent='';});
    assert.equal(await shell.locator('#address').getAttribute('placeholder'),'Search or enter address');
    assert.equal(await shell.locator('.brand-caption').textContent(),'AI browser');
    assert.equal(await shell.locator('#more-tools').getAttribute('aria-label'),'More browsing tools');
    assert.equal(await shell.locator('#clear-site').textContent(),'Clear this site data');
    assert.equal(await shell.locator('#toggle-fullscreen span').textContent(),'Full screen');
    assert.equal(await shell.locator('#fullscreen-shortcut').textContent(),process.platform==='darwin'?'⌃⌘F':'F11');
    assert.equal(await shell.locator('#site-tools').getAttribute('aria-label'),'More browsing tools');
    assert.equal(await shell.locator('#profile-select option').first().textContent(),'Default');
    assert.equal(await shell.locator('#room-strip button').first().textContent(),'My space');
    assert.match(await shell.locator('#room-actions button').first().textContent(),/New window/);
    assert.deepEqual(await shell.locator('#profile-menu [role="menuitem"]').allTextContents(),['New browsing profile','Rename current browsing profile','Delete a browsing profile…']);
    assert.deepEqual(await shell.locator('#room-menu [role="menuitem"]').allTextContents(),['Create space','Close current space']);
    await shell.locator('#settings-nav-profile').click();
    assert.equal(await shell.locator('#settings [data-i18n="chromeImportSettingsTitle"]').textContent(),'Import browser data');
    await shell.locator('#settings-nav-agent').click();
    assert.equal(await shell.locator('#settings [data-i18n="externalAgentAccessDescription"]').textContent(),'Grant external Agents or Browser MCP clients access to selected spaces. Access keys are shown only when created.');
    assert.equal(await shell.locator('#chrome-import-onboarding .panel-eyebrow').textContent(),'WELCOME TO CORVID');
    assert.equal(await shell.locator('#pi-auth-dialog .panel-eyebrow').textContent(),'MODEL SIGN IN');
    assert.equal(await shell.locator('#profile-extension-list .empty-extension-list').textContent(),'No extensions imported yet.');
    await delay(150);
    await capture(shell,'en-settings',1024,700);
    await shell.locator('#settings-nav-agent').click();
    await shell.locator('#open-agent-access').click();
    await shell.locator('#agent-access-dialog').waitFor({state:'visible'});
    assert.equal(await shell.locator('#agent-access-title').textContent(),'External Agent access');
    assert.equal(await shell.locator('#agent-access-dialog .panel-eyebrow').textContent(),'CORVID AGENT ACCESS');
    assert.equal(await shell.locator('#agent-room-scope legend').textContent(),'Spaces this client can access');
    assert.equal(await shell.locator('#agent-client-list').getAttribute('aria-label'),'Authorized clients');
    await shell.locator('#close-agent-access').click();
    await shell.getByRole('button',{name:'Settings'}).click();
    await shell.locator('#settings').waitFor({state:'visible'});
    await shell.locator('#settings-nav-agent').click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:100,y:100,width:700,height:420}));
    await delay(150);
    await assertSettingsScrollAtNarrowWindow(shell,'English settings');
    await shell.locator('#settings-nav-general').click();
    await capture(shell,'en-settings',700,420);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:100,y:100,width:1024,height:700}));
    await delay(150);
    await shell.locator('#settings-nav-profile').click();
    await shell.locator('#start-chrome-import').click();
    await shell.locator('#chrome-import').waitFor({state:'visible'});
    assert.equal(await shell.locator('#chrome-import-form h2').textContent(),'Import from Google Chrome');
    assert.equal(await shell.locator('#chrome-source-profile option').first().textContent(),'Choose a data folder first');
    assert.equal(await shell.locator('#chrome-import-categories legend').textContent(),'Choose data to import');
    assert.equal(await shell.locator('#chrome-import-preview').textContent(),'Choose a folder to see how many items can be imported.');
    await shell.locator('#cancel-chrome-import').click();
    await shell.getByRole('button',{name:'Corvid Agent'}).click();
    await shell.locator('#pi-task-prompt').waitFor({state:'visible'});
    assert.equal(await shell.locator('#pi-task-prompt').getAttribute('placeholder'),'Ask about this page or describe what you want to do…');
    await shell.locator('.pi-model-manage').click();
    await shell.locator('#pi-model-settings').waitFor({state:'visible'});
    assert.equal(await shell.locator('#pi-model-settings-title').textContent(),'Manage Corvid Agent models');
    assert.equal(await shell.locator('#pi-model-settings .panel-eyebrow').textContent(),'CORVID MODEL CATALOG');
    assert.equal(await shell.locator('#pi-endpoint-url').evaluate(node=>node.labels[0].querySelector('span').textContent),'Base URL');
    assert.equal(await shell.locator('#discover-pi-endpoint-models').textContent(),'Read model list from endpoint');
    await shell.locator('#close-pi-model-settings').click();
    await shell.getByRole('button',{name:'Agent workspace'}).click();
    await shell.locator('#library-items').waitFor({state:'visible'});
    assert.equal(await shell.locator('#library').getAttribute('aria-label'),'Agent workspace');
    assert.equal(await shell.locator('#library-title').textContent(),'Agent workspace');
    assert.match(await shell.locator('#library-items .workspace-empty-state').textContent(),/This browsing profile has no Agent spaces yet/);
    await shell.locator('#close-library').click();
    const unchangedData=await shell.evaluate(()=>window.browserShell.invoke('state'));
    assert.equal(unchangedData.profiles.find(profile=>profile.isDefault).name,'默认');
    assert.equal(unchangedData.rooms[0].name,'我的空间');
    await verifyRenameError(shell,'en','Enter a browser identity name.');
    const localeHelpers=await shell.evaluate(()=>({
      zhKeys:Object.keys(window.corvidI18n.catalogs['zh-CN']).sort(),
      enKeys:Object.keys(window.corvidI18n.catalogs.en).sort(),
      zhPluralKeys:Object.keys(window.corvidI18n.catalogs['zh-CN'].plural).sort(),
      enPluralKeys:Object.keys(window.corvidI18n.catalogs.en.plural).sort(),
      domResourceKeys:[...new Set([...document.querySelectorAll('[data-i18n],[data-i18n-aria-label],[data-i18n-title],[data-i18n-placeholder]')].flatMap(node=>['i18n','i18nAriaLabel','i18nTitle','i18nPlaceholder'].map(name=>node.dataset[name]).filter(Boolean)))].sort(),
      zhPlaceholders:Object.fromEntries(Object.entries(window.corvidI18n.catalogs['zh-CN']).map(([key,value])=>[key,JSON.stringify(value).match(/\{[a-zA-Z0-9_]+\}/g)||[]])),
      enPlaceholders:Object.fromEntries(Object.entries(window.corvidI18n.catalogs.en).map(([key,value])=>[key,JSON.stringify(value).match(/\{[a-zA-Z0-9_]+\}/g)||[]])),
      singular:window.corvidI18n.plural('tabs',1),
      plural:window.corvidI18n.plural('tabs',2),
      number:window.corvidI18n.formatNumber(1234.5),
      date:window.corvidI18n.formatDate('2020-01-02T00:00:00Z',{dateStyle:'medium',timeZone:'UTC'}),
    }));
    assert.deepEqual(localeHelpers.enKeys,localeHelpers.zhKeys);
    assert.deepEqual(localeHelpers.enPluralKeys,localeHelpers.zhPluralKeys);
    assert.deepEqual(localeHelpers.enPlaceholders,localeHelpers.zhPlaceholders);
    assert(localeHelpers.domResourceKeys.every(key=>localeHelpers.enKeys.includes(key)),'every static DOM resource key must exist in both catalogs');
    assert.equal(localeHelpers.singular,'1 tab');
    assert.equal(localeHelpers.plural,'2 tabs');
    assert.equal(localeHelpers.number,'1,234.5');
    assert.equal(localeHelpers.date,'Jan 2, 2020');
    const saved=await waitFor(()=>{try{return JSON.parse(fs.readFileSync(preferencePath,'utf8'));}catch{return null;}},'locale preference persistence');
    assert.deepEqual(saved,{schemaVersion:1,uiLocale:'en'});
    assert.equal(fs.statSync(preferencePath).mode&0o777,0o600);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:100,y:100,width:1024,height:700}));
    await delay(150);
    await capture(shell,'en',1024,700);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:100,y:100,width:700,height:420}));
    await delay(150);
    assert.equal(await shell.getByRole('button',{name:'Back'}).count(),1);
    assert.equal(await shell.locator('#show-settings').getAttribute('aria-label'),'Settings');
    await capture(shell,'en',700,420);
    await stop();

    shell=await start();
    await waitFor(()=>shell.locator('html').getAttribute('lang').then(value=>value==='en'),'persisted English locale');
    assert.equal(await shell.locator('#ui-locale').inputValue(),'en');
    await shell.getByRole('button',{name:'Settings'}).click();
    assert.equal(await shell.getByRole('dialog',{name:'Settings'}).count(),1);
    assert.equal(await shell.getByLabel('App language').inputValue(),'en');
    assert.equal(await shell.locator('#theme-preference').inputValue(),'dark');
    assert.equal(await app.evaluate(({nativeTheme})=>nativeTheme.themeSource),'dark');
    await shell.locator('#ui-locale').selectOption('zh-CN');
    await waitFor(()=>shell.locator('html').getAttribute('lang').then(value=>value==='zh-CN'),'Chinese locale after restart');
    await waitFor(()=>shell.locator('#profile-extension-list .empty-extension-list').textContent().then(value=>value==='尚未导入扩展。'),'localized extension empty state');
    assert.equal(await shell.getByRole('dialog',{name:'设置'}).count(),1);
    const chineseFormats=await shell.evaluate(()=>({plural:window.corvidI18n.plural('tabs',2),date:window.corvidI18n.formatDate('2020-01-02T00:00:00Z',{dateStyle:'medium',timeZone:'UTC'})}));
    assert.equal(chineseFormats.plural,'2 个标签页');
    assert.equal(chineseFormats.date,'2020年1月2日');
    assert.equal(await shell.locator('#clear-site').textContent(),'清理此站点数据');
    assert.equal(await shell.locator('#toggle-fullscreen span').textContent(),'全屏模式');
    assert.equal(await shell.locator('.brand-caption').textContent(),'AI 浏览器');
    await shell.locator('#cancel-settings').click();
    await waitFor(()=>shell.locator('#show-bookmarks').getAttribute('aria-label').then(value=>value==='书签'),'Chinese bookmarks name');
    assert.equal(JSON.parse(fs.readFileSync(preferencePath,'utf8')).uiLocale,'zh-CN');
    assert.equal(await shell.locator('#profile-select option').first().textContent(),'默认');
    assert.equal(await shell.locator('#room-strip button').first().textContent(),'我的空间');
    assert.match(await shell.locator('#room-actions button').first().textContent(),/新建窗口/);
    assert.deepEqual(await shell.locator('#profile-menu [role="menuitem"]').allTextContents(),['新建浏览身份','重命名当前浏览身份','删除浏览身份…']);
    assert.deepEqual(await shell.locator('#room-menu [role="menuitem"]').allTextContents(),['新建空间','关闭当前空间']);
    await shell.getByRole('button',{name:'设置'}).click();
    assert.equal(await shell.locator('#settings [data-i18n="chromeImportSettingsTitle"]').textContent(),'导入浏览器资料');
    await shell.locator('#settings-nav-agent').click();
    assert.equal(await shell.locator('#settings [data-i18n="externalAgentAccessDescription"]').textContent(),'为外部 Agent 或 Browser MCP 客户端单独授权空间。访问密钥仅在创建时显示。');
    assert.equal(await shell.locator('#chrome-import-onboarding .panel-eyebrow').textContent(),'欢迎使用 Corvid');
    assert.equal(await shell.locator('#pi-auth-dialog .panel-eyebrow').textContent(),'模型账号授权');
    await shell.locator('#open-agent-access').click();
    assert.equal(await shell.locator('#agent-access-title').textContent(),'外部 Agent 访问');
    assert.equal(await shell.locator('#agent-access-dialog .panel-eyebrow').textContent(),'CORVID AGENT 授权');
    assert.equal(await shell.locator('#agent-room-scope legend').textContent(),'允许访问的空间');
    await shell.locator('#close-agent-access').click();
    await shell.getByRole('button',{name:'设置'}).click();
    await shell.locator('#settings-nav-profile').click();
    await shell.locator('#start-chrome-import').click();
    assert.equal(await shell.locator('#chrome-import-form h2').textContent(),'从 Google Chrome 导入');
    assert.equal(await shell.locator('#chrome-source-profile option').first().textContent(),'先选择资料目录');
    assert.equal(await shell.locator('#chrome-import-categories legend').textContent(),'选择要导入的资料');
    await shell.locator('#cancel-chrome-import').click();
    await shell.getByRole('button',{name:'Corvid Agent'}).click();
    assert.equal(await shell.locator('#pi-task-prompt').getAttribute('placeholder'),'问问当前页面，或描述你想完成的事…');
    await shell.locator('.pi-model-manage').click();
    assert.equal(await shell.locator('#pi-model-settings-title').textContent(),'管理 Corvid Agent 模型');
    assert.equal(await shell.locator('#pi-model-settings .panel-eyebrow').textContent(),'CORVID 模型目录');
    assert.equal(await shell.locator('#pi-endpoint-url').evaluate(node=>node.labels[0].querySelector('span').textContent),'API 基础地址');
    assert.equal(await shell.locator('#discover-pi-endpoint-models').textContent(),'从端点读取模型列表');
    await shell.locator('#close-pi-model-settings').click();
    await shell.getByRole('button',{name:'Agent 工作区'}).click();
    await shell.locator('#library-title').waitFor({state:'visible'});
    assert.equal(await shell.locator('#library').getAttribute('aria-label'),'Agent 工作区');
    assert.equal(await shell.locator('#library-title').textContent(),'Agent 工作区');
    assert.match(await shell.locator('#library-items .workspace-empty-state').textContent(),/当前浏览身份还没有 Agent 空间/);
    await shell.locator('#close-library').click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:100,y:100,width:1024,height:700}));
    await delay(150);
    await capture(shell,'zh-CN',1024,700);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:100,y:100,width:700,height:420}));
    await delay(150);
    await capture(shell,'zh-CN',700,420);
    await stop();
    console.log('PASS app language selection, bilingual browser chrome labels, Intl formatting, narrow window visibility, secure persistence and restart restore');
  }finally{
    if(app)await app.close().catch(()=>{});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
