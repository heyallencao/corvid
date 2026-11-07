const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');

const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-settings-accessibility-'));
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>Settings accessibility fixture</title><p>Local synthetic site.</p>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  let app;
  const waitFor=async(fn,label)=>{for(let i=0;i<240;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  try{
    app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_PORT:'0',CORVID_TEST_MODE:'1'}});
    const shell=await app.firstWindow();
    await app.evaluate(({dialog})=>{globalThis.settingsAccessibilityPrompts=[];dialog.showMessageBox=async(_window,options)=>{settingsAccessibilityPrompts.push(options);return {response:0};};});
    await waitFor(()=>{try{return JSON.parse(fs.readFileSync(path.join(dataDir,'control.json'),'utf8'));}catch{return null;}},'Corvid control endpoint');
    const axSession=await shell.context().newCDPSession(shell);
    await axSession.send('Accessibility.enable');
    const readAxTree=async()=>{
      const {nodes}=await axSession.send('Accessibility.getFullAXTree');
      return nodes.map(node=>({role:node.role?.value,name:node.name?.value}));
    };
    await shell.locator('#address').fill(origin+'/');
    await shell.locator('#address').press('Enter');
    await waitFor(()=>shell.locator('#address').inputValue().then(value=>value===origin+'/'),'local fixture navigation');
    await shell.locator('#library-trigger').click();await shell.locator('#library-menu:not([hidden])').waitFor();await shell.locator('#show-settings').click();
    await waitFor(()=>shell.locator('#settings').evaluate(dialog=>dialog.open),'settings dialog');
    assert.equal(await shell.locator('#settings-nav-general').getAttribute('aria-current'),'location');

    await shell.locator('#settings-nav-general').focus();
    for(let i=0;i<3;i++)await shell.keyboard.press('Tab');
    assert.equal(await shell.evaluate(()=>document.activeElement.id),'settings-nav-site','Tab reaches the current-site category');
    assert.equal(await shell.evaluate(()=>document.activeElement.matches(':focus-visible')),true,'keyboard focus is visible on the category');
    await shell.locator('#settings-nav-site').press('Enter');
    assert.equal(await shell.evaluate(()=>document.activeElement.id),'settings-site','Enter activates a category and focuses its content section');
    assert.equal(await shell.locator('#settings-nav-site').getAttribute('aria-current'),'location');
    assert.equal(await shell.locator('#settings-current-site').isVisible(),true);
    assert.equal(await shell.locator('#settings-site-permissions').isEnabled(),true);
    assert.equal(await shell.locator('#settings-clear-site').isEnabled(),true);
    await shell.keyboard.press('Tab');
    assert.equal(await shell.evaluate(()=>document.activeElement.id),'settings-site-permissions','site permission action is reachable by Tab');
    await shell.keyboard.press('Tab');
    assert.equal(await shell.evaluate(()=>document.activeElement.id),'settings-clear-site','site cleanup action follows in the keyboard order');
    await shell.locator('#settings-clear-site').press('Enter');
    await waitFor(()=>shell.locator('#settings-current-site').textContent().then(text=>text.includes('已取消清理')),'keyboard-canceled site cleanup');
    const prompts=await app.evaluate(()=>settingsAccessibilityPrompts.map(({buttons,defaultId,cancelId})=>({buttons,defaultId,cancelId})));
    assert.equal(prompts.length,1,'keyboard cleanup opens the site confirmation');
    assert.equal(prompts[0].defaultId,0,'the non-destructive confirmation option is the default');
    assert.equal(prompts[0].cancelId,0,'the confirmation can be canceled with Escape');
    assert.equal(await shell.locator('#settings-nav-site').getAttribute('aria-current'),'location');

    const zhAx=await readAxTree();
    assert(zhAx.some(node=>node.role==='dialog'&&node.name==='设置'),'settings dialog has a Chinese accessible name');
    assert(zhAx.some(node=>node.role==='navigation'&&node.name==='设置分类'),'category navigation has a Chinese accessible name');
    assert(zhAx.some(node=>node.role==='button'&&node.name==='当前网站'),'active category has a named button in the accessibility tree');
    assert.equal(await shell.locator('#settings-nav-site').getAttribute('aria-current'),'location','active category exposes the current-location state');
    assert(zhAx.some(node=>node.role==='button'&&node.name==='管理站点权限'),'site permission action has a Chinese accessible name');
    assert(zhAx.some(node=>node.role==='button'&&node.name==='清理此站点数据'),'site cleanup action has a Chinese accessible name');
    assert(zhAx.some(node=>node.role==='button'&&node.name==='保存设置'),'save action has a Chinese accessible name');
    assert(zhAx.some(node=>node.role==='button'&&node.name==='取消'),'cancel action has a Chinese accessible name');

    await shell.locator('#settings-nav-general').focus();
    await shell.locator('#settings-nav-general').press('Enter');
    await shell.locator('#ui-locale').selectOption('en');
    await waitFor(()=>shell.locator('#settings-title').textContent().then(value=>value==='Settings'),'English settings labels');
    await shell.locator('#settings-nav-site').focus();
    await shell.locator('#settings-nav-site').press('Enter');
    const enAx=await readAxTree();
    assert(enAx.some(node=>node.role==='dialog'&&node.name==='Settings'),'settings dialog has an English accessible name');
    assert(enAx.some(node=>node.role==='navigation'&&node.name==='Settings categories'),'category navigation has an English accessible name');
    assert(enAx.some(node=>node.role==='button'&&node.name==='Current site'),'active category accessible name follows English locale');
    assert.equal(await shell.locator('#settings-nav-site').getAttribute('aria-current'),'location','active category state remains set in English');
    assert(enAx.some(node=>node.role==='button'&&node.name==='Manage site permissions'),'site permission action has an English accessible name');
    assert(enAx.some(node=>node.role==='button'&&node.name==='Clear this site data'),'site cleanup action has an English accessible name');
    assert(enAx.some(node=>node.role==='button'&&node.name==='Save settings'),'save action has an English accessible name');
    assert(enAx.some(node=>node.role==='button'&&node.name==='Cancel'),'cancel action has an English accessible name');
    await axSession.detach();
    await shell.locator('#cancel-settings').focus();
    await shell.locator('#cancel-settings').press('Enter');
    await waitFor(()=>shell.locator('#settings').evaluate(dialog=>!dialog.open),'keyboard-canceled settings dialog');
    console.log(`PASS settings accessibility: Tab/Enter category and site actions, zh-CN/en Chromium AX names${prompts.length?`, ${prompts.length} native prompt(s)`:''}`);
  }finally{
    if(app)await app.close().catch(()=>{});
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
