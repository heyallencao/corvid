const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-fullscreen-'));
  const server=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><title>Fullscreen fixture</title>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const fixtureUrl=`http://127.0.0.1:${server.address().port}/fullscreen`;
  let app,config;
  const until=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  const api=async(route,body,method)=>{
    const response=await fetch(config.baseUrl+route,{method:method||(body?'POST':'GET'),headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
  };
  const sendShortcut=async(combination,windowIndex=0)=>{
    const parts=combination.split('+');
    const keyCode=parts.pop().toUpperCase();
    const modifiers=parts.map(part=>({Meta:'meta',Control:'control',Shift:'shift',Alt:'alt'})[part]);
    await app.evaluate(({BrowserWindow},{keyCode,modifiers,windowIndex})=>{
      const browserWindow=BrowserWindow.getAllWindows()[windowIndex];
      if(!browserWindow)throw new Error('Shortcut target window does not exist');
      browserWindow.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
      browserWindow.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});
    },{keyCode,modifiers,windowIndex});
  };
  try{
    app=await _electron.launch({executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}});
    const shell=await app.firstWindow();
    await until(()=>{try{config=JSON.parse(fs.readFileSync(path.join(dataDir,'control.json')));return Boolean(config);}catch{return false;}},'control API config');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());
    await until(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()),'maximized window before full screen');
    await shell.getByRole('button',{name:'更多浏览工具'}).click();
    const toggle=shell.getByRole('menuitemcheckbox',{name:'全屏模式'});
    assert.equal(await toggle.getAttribute('aria-checked'),'false');
    assert.equal(await shell.locator('#fullscreen-shortcut').textContent(),process.platform==='darwin'?'⌃⌘F':'F11');
    await toggle.click();
    await until(async()=>{const state=await api('/rooms');return state.windows[0]?.fullscreen===true;},'app full-screen state');
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),true);
    assert.equal(await shell.locator('#rooms').isVisible(),true,'browser navigation remains visible in app full screen');

    await shell.getByRole('button',{name:'更多浏览工具'}).click();
    assert.equal(await shell.getByRole('menuitemcheckbox',{name:'全屏模式'}).getAttribute('aria-checked'),'true');
    await shell.getByRole('menuitemcheckbox',{name:'全屏模式'}).click();
    await until(async()=>{const state=await api('/rooms');return state.windows[0]?.fullscreen===false;},'app window returns from full screen');
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),false);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()),true,'full screen restores the prior maximized state');

    const shortcut=process.platform==='darwin'?'Control+Meta+F':'F11';
    await sendShortcut(shortcut);
    await until(async()=>{const state=await api('/rooms');return state.windows[0]?.fullscreen===true;},'keyboard shortcut enters full screen');
    await sendShortcut(shortcut);
    await until(async()=>{const state=await api('/rooms');return state.windows[0]?.fullscreen===false;},'keyboard shortcut exits full screen');

    await shell.getByRole('button',{name:'新建窗口'}).click();
    const otherShell=await until(async()=>{
      const pages=app.windows();
      for(const page of pages){if(page===shell)continue;try{if(await page.locator('#rooms').count())return page;}catch{}}
      return false;
    },'second browser window');
    await until(async()=>{const state=await api('/rooms');return state.windows.length===2?state:false;},'two window records');
    const toggleInWindow=async page=>{
      await page.getByRole('button',{name:'更多浏览工具'}).click();
      await page.getByRole('menuitemcheckbox',{name:'全屏模式'}).click();
    };
    await toggleInWindow(otherShell);
    await until(async()=>{const state=await api('/rooms');return state.windows.filter(item=>item.fullscreen).length===1?state:false;},'second window enters full screen independently');
    await toggleInWindow(shell);
    await until(async()=>{const state=await api('/rooms');return state.windows.filter(item=>item.fullscreen).length===2?state:false;},'both windows can be full screen independently');
    await toggleInWindow(shell);
    await until(async()=>{const state=await api('/rooms');return state.windows.filter(item=>item.fullscreen).length===1?state:false;},'exiting one window leaves the other unchanged');
    await toggleInWindow(otherShell);
    await until(async()=>{const state=await api('/rooms');return state.windows.every(item=>!item.fullscreen)?state:false;},'both windows exit full screen independently');

    await shell.locator('#address').fill(fixtureUrl);
    await shell.locator('#address').press('Enter');
    await until(()=>app.evaluate(({webContents},url)=>webContents.getAllWebContents().some(contents=>contents.getURL()===url),fixtureUrl),'page full-screen fixture');
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
    await app.evaluate(async({webContents},url)=>{
      const contents=webContents.getAllWebContents().find(item=>item.getURL()===url);
      await contents.executeJavaScript('window.__fullscreenStarted=true;document.documentElement.requestFullscreen().then(()=>window.__fullscreenResult="resolved").catch(error=>window.__fullscreenResult=error.name+": "+error.message);true',true);
    },fixtureUrl);
    const fullscreenState=await until(async()=>{
      const state=await app.evaluate(async({webContents},url)=>{
      const contents=webContents.getAllWebContents().find(item=>item.getURL()===url);
      return contents&&contents.executeJavaScript('JSON.stringify({active:Boolean(document.fullscreenElement),started:Boolean(window.__fullscreenStarted),result:window.__fullscreenResult||null})');
      },fixtureUrl);
      if(state){const result=JSON.parse(state);if(result.result&&result.result!=='resolved')throw new Error(`HTML Fullscreen request failed: ${result.result}`);if(result.active||result.result==='resolved')return result;}
      return false;
    },'page receives HTML Fullscreen click');
    assert.equal(fullscreenState.active,true,`HTML Fullscreen request did not activate: ${JSON.stringify(fullscreenState)}`);
    await until(async()=>{const state=await api('/rooms');return state.windows.some(item=>item.pageFullscreen);},'page full-screen state');
    await until(()=>shell.locator('#toggle-fullscreen').isDisabled(),'browser full-screen action is disabled during page fullscreen');
    assert.equal(await shell.locator('#toggle-fullscreen').getAttribute('title'),'请先退出网页全屏，再切换浏览器全屏。');
    const nativeFullscreenBefore=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(window=>window.isFullScreen()));
    const blocked=await shell.evaluate(()=>window.browserShell.invoke('toggleFullscreen'));
    assert.equal(blocked.blockedByPageFullscreen,true,'app full screen is blocked while the page owns full screen');
    assert.equal(await app.evaluate(async({webContents},url)=>{
      const contents=webContents.getAllWebContents().find(item=>item.getURL()===url);
      return contents&&contents.executeJavaScript('Boolean(document.fullscreenElement)');
    },fixtureUrl),true,'the app action must not exit page HTML Fullscreen');
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(window=>window.isFullScreen())),nativeFullscreenBefore,'the app action must not change native page fullscreen state');
    await shell.locator('.tab[data-active="true"] .tab-close').click({force:true});
    await until(()=>app.evaluate(({webContents},url)=>!webContents.getAllWebContents().some(contents=>contents.getURL()===url),fixtureUrl),'fullscreen page closes');
    await until(async()=>{const state=await api('/rooms');return state.windows.every(item=>!item.pageFullscreen);},'page full-screen state clears');
    console.log('PASS full-screen menu reflects native state, preserves browser chrome, and restores the prior maximized state');
  }finally{
    if(app)await app.close().catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
