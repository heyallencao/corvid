const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { closeElectron, launchElectron, waitForControl } = require('./electron-test-startup.cjs');

const project = path.resolve(__dirname, '..');

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-library-'));
  const fixture = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>Fixture Page</title><p>Local fixture</p>');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${fixture.address().port}/test`;
  let app;
  const captureScreenshots=process.env.CORVID_CAPTURE_QA_SCREENSHOTS==='1';
  async function captureEmpty(shell,kind,locale){
    if(!captureScreenshots)return;
    const directory=path.join(project,'docs/qa/screenshots');fs.mkdirSync(directory,{recursive:true});
    await shell.screenshot({path:path.join(directory,`issue-16-library-empty-after-${kind}-${locale}.png`)});
  }

  async function boot() {
    const launched = await launchElectron(_electron, {
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1' },
    }, { label: 'library-e2e', dataDir });
    app = launched.app;
    const shell = launched.shell;
    const config = await waitForControl(app, dataDir, { label: 'library-e2e' });
    const request = async (route, method = 'GET', body) => {
      const response = await fetch(config.baseUrl + route, {
        method,
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      return result;
    };
    return { shell, request };
  }
  async function stop() { await closeElectron(app); app = undefined; }

  try {
    let { shell, request } = await boot();
    await shell.getByRole('button', { name: '空间选项' }).click();
    await shell.getByRole('menuitem', { name: '新建空间' }).click();
    await shell.locator('#room-name').fill('测试Room');
    await shell.getByRole('button', { name: '创建', exact: true }).click();
    await shell.getByRole('button', { name: '测试Room' }).waitFor();
    await shell.locator('#new-room').waitFor({state:'hidden'});
    await shell.locator('#address').fill(url);
    const activeRoomId=(await request('/rooms')).activeRoomId;
    await shell.evaluate(()=>{window.__libraryStateUpdateSeen=false;window.browserShell.onState(()=>{window.__libraryStateUpdateSeen=true;});});
    await shell.locator('#address').evaluate(input=>input.blur());
    await shell.evaluate(roomId=>window.browserShell.invoke('activateRoom',{id:roomId}),activeRoomId);
    await shell.waitForFunction(()=>window.__libraryStateUpdateSeen);
    assert.equal(await shell.locator('#address').inputValue(),url,'a shell state refresh must preserve the unsubmitted address draft after focus changes');
    await shell.locator('#address').press('Enter');
    await shell.getByRole('button', { name: 'Fixture Page' }).waitFor();
    await shell.locator('#bookmark-current').click();
    await shell.getByText('Fixture Page', { exact: true }).first().waitFor();
    assert.equal((await request('/bookmarks')).bookmarks[0].url, url);
    assert.equal((await request('/history')).history.filter(item => item.url === url).length, 1);
    await stop();

    ({ shell, request } = await boot());
    assert.equal((await request('/bookmarks')).bookmarks.length, 1);
    assert.equal((await request('/history')).history.filter(item => item.url === url).length, 1);
    await shell.locator('#show-bookmarks').click();
    await shell.getByText('Fixture Page', { exact: true }).first().waitFor();
    assert.equal(await shell.locator('#library-search').isVisible(),true,'search remains available while the list has entries');
    await shell.locator('#library-search').fill('no-such-library-entry');
    await shell.getByRole('heading',{name:'没有匹配结果'}).waitFor();
    assert.equal(await shell.getByRole('button',{name:'清除搜索'}).isVisible(),true);
    await shell.getByRole('button',{name:'清除搜索'}).click();
    await shell.getByText('Fixture Page', { exact: true }).first().waitFor();
    await shell.getByRole('button', { name: '删除 Fixture Page' }).click();
    assert.equal((await request('/bookmarks')).bookmarks.length, 0);
    await shell.getByRole('heading',{name:'这里还没有书签'}).waitFor();
    assert.equal(await shell.locator('#library-search').isVisible(),false,'search is hidden for a truly empty collection');
    await shell.getByRole('button',{name:'收藏当前网页'}).click();
    assert.equal((await request('/bookmarks')).bookmarks.length,1,'the empty-state action bookmarks the active HTTP page');
    await shell.getByRole('button', { name: '删除 Fixture Page' }).click();
    await shell.locator('#show-history').click();
    await shell.getByRole('button', { name: '删除 Fixture Page' }).click();
    assert.equal((await request('/history')).history.length, 0);
    await shell.getByRole('heading',{name:'浏览记录会出现在这里'}).waitFor();
    await stop();

    ({ shell, request } = await boot());
    assert.equal((await request('/bookmarks')).bookmarks.length, 0);
    assert.equal((await request('/history')).history.length, 0);
    await shell.locator('#address').fill(url);
    await shell.locator('#address').press('Enter');
    await shell.getByRole('button',{name:'Fixture Page'}).waitFor();
    await shell.locator('#show-bookmarks').click();
    await shell.getByRole('heading',{name:'这里还没有书签'}).waitFor();
    assert.equal(await shell.getByRole('button',{name:'收藏当前网页'}).isVisible(),true);
    await captureEmpty(shell,'bookmarks','zh-CN');
    await shell.locator('#show-history').click();
    await shell.getByRole('button',{name:'删除 Fixture Page'}).click();
    await shell.getByRole('heading',{name:'浏览记录会出现在这里'}).waitFor();
    await captureEmpty(shell,'history','zh-CN');
    await shell.locator('#show-downloads').click();
    await shell.getByRole('heading',{name:'下载内容会保存在这里'}).waitFor();
    await captureEmpty(shell,'downloads','zh-CN');
    await shell.locator('#show-settings').click();
    await shell.locator('#ui-locale').selectOption('en');
    await shell.waitForFunction(()=>document.documentElement.lang==='en');
    await shell.locator('#cancel-settings').click();
    await shell.locator('#show-bookmarks').click();
    await shell.getByRole('heading',{name:'No bookmarks yet'}).waitFor();
    assert.equal(await shell.locator('#library-search').isVisible(),false);
    await shell.locator('#library-items .library-empty-action').getByText('Bookmark this page').waitFor();
    await captureEmpty(shell,'bookmarks','en');
    await shell.locator('#show-history').click();
    await shell.getByRole('heading',{name:'Your browsing history will appear here'}).waitFor();
    await captureEmpty(shell,'history','en');
    await shell.locator('#show-downloads').click();
    await shell.getByRole('heading',{name:'Your downloads will appear here'}).waitFor();
    await captureEmpty(shell,'downloads','en');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:100,y:100,width:700,height:420}));
    await shell.locator('#show-bookmarks').click();
    await shell.getByRole('heading',{name:'No bookmarks yet'}).waitFor();
    await shell.locator('#library-items .library-empty-action').waitFor({state:'visible'});
    const narrowEnglish=await shell.locator('#library-items .library-empty-state').boundingBox();
    const narrowPanel=await shell.locator('#library').boundingBox();
    assert(narrowEnglish&&narrowPanel&&narrowEnglish.x>=narrowPanel.x&&narrowEnglish.x+narrowEnglish.width<=narrowPanel.x+narrowPanel.width,'English empty state fits within the narrow library panel');
    await captureEmpty(shell,'bookmarks-narrow','en');
    await shell.locator('#show-settings').click();
    await shell.locator('#ui-locale').selectOption('zh-CN');
    await shell.waitForFunction(()=>document.documentElement.lang==='zh-CN');
    await shell.locator('#cancel-settings').click();
    await shell.locator('#show-bookmarks').click();
    await shell.getByRole('heading',{name:'这里还没有书签'}).waitFor();
    await shell.locator('#library-items .library-empty-action').waitFor({state:'visible'});
    const narrowChinese=await shell.locator('#library-items .library-empty-state').boundingBox();
    assert(narrowChinese&&narrowPanel&&narrowChinese.x>=narrowPanel.x&&narrowChinese.x+narrowChinese.width<=narrowPanel.x+narrowPanel.width,'Chinese empty state fits within the narrow library panel');
    await captureEmpty(shell,'bookmarks-narrow','zh-CN');
    await stop();
    console.log('PASS UI room creation, navigation, history/bookmarks, restart persistence, deletion and restart');
  } finally {
    if (app) await closeElectron(app).catch(error => { console.error(error); process.exitCode = 1; });
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
