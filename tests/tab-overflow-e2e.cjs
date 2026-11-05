const {_electron}=require('playwright-core');
const electron=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {closeElectron,launchElectron,waitForControl}=require('./electron-test-startup.cjs');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-tab-overflow-'));
  const qaDir=process.env.CORVID_TAB_OVERFLOW_QA_DIR;
  const page=number=>`<!doctype html><meta charset="utf-8"><title>Page ${number} · Fixture</title><body><h1>Page ${number} · Fixture</h1></body>`;
  const server=http.createServer((req,res)=>{const number=Number(new URL(req.url,'http://fixture').pathname.slice(1))||1;res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(page(number));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let app;
  const until=async(fn,label)=>{for(let i=0;i<240;i++){const value=await fn();if(value)return value;await delay(50);}throw new Error(`Timed out waiting for ${label}`);};
  try{
    const launched=await launchElectron(_electron,{executablePath:electron,args:[root],env:{...process.env,CORVID_DATA_DIR:dataDir,CORVID_TEST_MODE:'1',CORVID_PORT:'0'}},{label:'tab-overflow-e2e',dataDir});
    app=launched.app;
    const shell=launched.shell;
    await shell.emulateMedia({reducedMotion:'reduce'});
    const config=await waitForControl(app,dataDir);
    const state=async()=>{const response=await fetch(`${config.baseUrl}/rooms`,{headers:{authorization:`Bearer ${config.token}`}});assert.equal(response.status,200);return response.json();};
    const activeRoom=async()=>{const snapshot=await state();return snapshot.rooms.find(room=>room.id===snapshot.activeRoomId);};
    const tabs=shell.locator('#tabs .tab');
    const resize=async(width,height)=>{await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(size.width,size.height),{width,height});await until(()=>shell.evaluate(expected=>window.innerWidth===expected,width),`window width ${width}`);};
    const navigateCurrent=async(number)=>{const url=`${base}/${number}`;await shell.locator('#address').fill(url);await shell.locator('#address').press('Enter');await until(async()=>{const room=await activeRoom();return room.tabs.some(tab=>tab.active&&tab.ready&&tab.url===url);},`page ${number} loaded`);await until(async()=>await tabs.filter({hasText:`Page ${number} · Fixture`}).count()>0,`page ${number} title rendered`);};
    await resize(1280,850);
    await navigateCurrent(1);
    assert.equal(await tabs.count(),1);
    assert.equal(await shell.locator('#tab-scroll-left').isHidden(),true,`single tab has no scroll controls: ${JSON.stringify(await shell.locator('#tabs').evaluate(element=>({client:element.clientWidth,scroll:element.scrollWidth,tabs:element.children.length,hidden:[...document.querySelectorAll('.tab-scroll-control')].map(item=>item.hidden)})))}`);
    assert.equal(await shell.locator('#tab-scroll-right').isHidden(),true,'single tab has no scroll controls');
    await tabs.first().locator('.favicon-fallback').waitFor({state:'visible'});
    const fallback=await tabs.first().locator('.favicon').evaluate(icon=>({tag:icon.localName,classes:icon.className.baseVal||icon.className,source:icon.dataset.source,background:getComputedStyle(icon.querySelector('rect')).fill,foregroundAttribute:icon.querySelector('text').getAttribute('fill'),label:icon.querySelector('text').textContent}));
    assert.equal(fallback.tag,'svg','a site without an icon gets an inline SVG fallback');
    assert.match(fallback.classes,/favicon-fallback/);
    assert.ok(fallback.source===`domain:127.0.0.1`||fallback.source===`url:${base}/favicon.ico`,'the fallback identity is stable for the host or its failed favicon URL');
    assert.match(fallback.background,/^rgb\(/,'the site color comes from a CSS hue variable');
    assert.equal(fallback.foregroundAttribute,null,'the foreground comes from the CSS theme token, not a hardcoded SVG color');
    assert.ok(fallback.label,'the generated favicon contains a safe local hostname initial');

    for(let number=2;number<=5;number++){
      await shell.locator('#new-tab').click();
      await until(async()=>await tabs.count()===number,`${number} tabs rendered`);
      await navigateCurrent(number);
    }
    assert.equal(await tabs.count(),5);
    assert.equal(await shell.locator('#tab-scroll-right').isHidden(),true,'five tabs fit in the regular window');
    const visibleNames=await shell.locator('#tabs .tab-main').evaluateAll(elements=>elements.map(element=>element.getAttribute('aria-label')));
    assert.equal(new Set(visibleNames).size,5,`each regular tab has a distinct accessible title: ${JSON.stringify({visibleNames,state:(await activeRoom()).tabs.map(tab=>({url:tab.url,title:tab.title,active:tab.active}))})}`);
    assert.ok(await tabs.first().evaluate(element=>parseFloat(getComputedStyle(element).minWidth)>=120),'regular tabs preserve enough width to identify titles');

    for(let number=6;number<=14;number++){
      await shell.locator('#new-tab').click();
      await until(async()=>await tabs.count()===number,`${number} tabs rendered`);
      await navigateCurrent(number);
    }
    assert.equal(await tabs.count(),14);
    const crowdedTabWidths=await tabs.evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().width));
    assert.ok(crowdedTabWidths.every(width=>width>=120),`crowded tabs retain the 120px minimum: ${JSON.stringify(crowdedTabWidths)}`);
    assert.ok(crowdedTabWidths.some(width=>width<170),`crowded tabs can contract from their 170px preferred width: ${JSON.stringify(crowdedTabWidths)}`);
    await until(()=>shell.locator('#tab-scroll-right').isVisible(),'right scroll control appears with overflow');
    await shell.locator('#tab-scroll-right').click();
    await until(()=>shell.locator('#tabs').evaluate(element=>element.scrollLeft>0),'tab strip scrolls right');
    for(let attempt=0;attempt<5&&!(await shell.locator('#tab-scroll-right').isDisabled());attempt++){await shell.locator('#tab-scroll-right').click();await delay(40);}
    assert.equal(await shell.locator('#tab-scroll-right').isDisabled(),true,'right control disables at the end');
    if(qaDir){fs.mkdirSync(qaDir,{recursive:true});await shell.screenshot({path:path.join(qaDir,'issue-201-tabs-14-zh-CN-1280x850.png')});}
    const lastTab=shell.locator('#tabs .tab-main').last();
    await lastTab.focus();
    await shell.keyboard.press('Enter');
    await until(async()=>(await activeRoom()).tabs.find(tab=>tab.active)?.title==='Page 14 · Fixture','keyboard tab activation');
    assert.equal(await shell.locator('#tabs .tab-main').last().getAttribute('aria-label'),'Page 14 · Fixture','the active tab retains its full title as an accessible name');
    assert.ok(await shell.locator('#new-tab').isVisible(),'the new-tab action stays reachable after scrolling');

    await resize(719,420);
    await until(()=>tabs.first().evaluate(element=>getComputedStyle(element).width==='44px'),'narrow icon layout');
    const closeTo=async count=>{while(await tabs.count()>count){const before=await tabs.count();await tabs.last().locator('.tab-close').click();await until(async()=>await tabs.count()===before-1,`${before-1} narrow tabs remain`);}};
    await closeTo(5);
    assert.equal(await shell.locator('#tab-scroll-right').isHidden(),true,'five narrow tabs fit without overflow');
    await closeTo(1);
    assert.equal(await shell.locator('#tab-scroll-right').isHidden(),true,'one narrow tab needs no scroll controls');
    for(let number=2;number<=5;number++){await shell.locator('#new-tab').click();await until(async()=>await tabs.count()===number,`${number} narrow tabs rendered`);await navigateCurrent(number);}
    assert.equal(await shell.locator('#tab-scroll-right').isHidden(),true,'five narrow tabs remain individually reachable');
    for(let number=6;number<=14;number++){await shell.locator('#new-tab').click();await until(async()=>await tabs.count()===number,`${number} narrow tabs rendered`);await navigateCurrent(number);}
    await until(()=>shell.locator('#tab-scroll-right').isVisible(),'narrow tab overflow controls');
    assert.equal(await tabs.first().evaluate(element=>getComputedStyle(element).width),'44px','narrow tabs use the compact icon width');
    assert.equal(await tabs.first().locator('.tab-title').evaluate(element=>getComputedStyle(element).display),'none','narrow tabs use favicon-only presentation');
    assert.match(await tabs.first().locator('.tab-main').getAttribute('aria-label'),/^Page 1 · Fixture$/,'favicon-only tabs retain a full accessible title');
    assert.equal(await shell.locator('#new-tab').isVisible(),true,'new-tab remains reachable in narrow mode');
    assert.equal(await shell.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'tab overflow stays inside its scroll viewport');
    assert.equal(await shell.locator('#tab-scroll-left').isDisabled(),true,'left control is disabled at the beginning');
    assert.equal(await shell.locator('#tab-scroll-left').getAttribute('aria-label'),'向左滚动标签页');
    assert.equal(await shell.locator('#tab-scroll-right').getAttribute('aria-label'),'向右滚动标签页');
    await shell.locator('#tab-scroll-right').click();
    await until(()=>shell.locator('#tabs').evaluate(element=>element.scrollLeft>0),'narrow strip scrolls with its control');
    await shell.locator('#tab-scroll-left').click();
    await until(()=>shell.locator('#tab-scroll-left').isDisabled(),'left control disables after scrolling to the beginning');
    await shell.locator('#show-settings').click();
    await shell.locator('#ui-locale').selectOption('en');
    await until(()=>shell.locator('html').getAttribute('lang').then(locale=>locale==='en'),'English shell locale');
    assert.equal(await shell.locator('#tab-scroll-left').getAttribute('aria-label'),'Scroll tabs left');
    assert.equal(await shell.locator('#tab-scroll-right').getAttribute('aria-label'),'Scroll tabs right');
    await shell.locator('#cancel-settings').click();
    if(qaDir)await shell.screenshot({path:path.join(qaDir,'issue-201-tabs-14-en-704x420.png')});
    console.log('PASS tab identity and overflow: 1/5/14 tabs, regular/narrow layout, arrows, keyboard activation, labels and local favicon fallback');
  }finally{
    if(app)await closeElectron(app);
    server.close();
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
