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
  async function toggleBookmark(shell, message, pressed) {
    const startedAt = Date.now(), button = shell.locator('#bookmark-current');
    await button.click();
    await shell.locator('#status .bookmark-feedback').getByText(message, { exact: true }).waitFor({ timeout: 1_000 });
    assert.equal(await button.getAttribute('aria-pressed'), String(pressed));
    assert.ok(Date.now() - startedAt < 1_000, `bookmark feedback exceeded 1s: ${message}`);
  }

  try {
    let { shell, request } = await boot();
    await shell.mouse.move(...Object.values(await shell.evaluate(()=>({x:Math.round(innerWidth/2),y:innerHeight-2}))),{steps:2});await shell.getByRole('button', { name: '空间选项' }).click();
    await shell.getByRole('menuitem', { name: '新建空间' }).click();
    await shell.locator('#room-name').fill('测试Room');
    await shell.getByRole('button', { name: '创建', exact: true }).click();
    await shell.getByRole('button', { name: '测试Room' }).waitFor();
    await shell.locator('#new-room').waitFor({state:'hidden'});
    await shell.waitForFunction(() => document.querySelector('#bookmark-current').disabled);
    await shell.locator('#address').fill(url);
    const activeRoomId=(await request('/rooms')).activeRoomId;
    await shell.evaluate(()=>{window.__libraryStateUpdateSeen=false;window.browserShell.onState(()=>{window.__libraryStateUpdateSeen=true;});});
    await shell.locator('#address').evaluate(input=>input.blur());
    await shell.evaluate(roomId=>window.browserShell.invoke('activateRoom',{id:roomId}),activeRoomId);
    await shell.waitForFunction(()=>window.__libraryStateUpdateSeen);
    assert.equal(await shell.locator('#address').inputValue(),url,'a shell state refresh must preserve the unsubmitted address draft after focus changes');
    await shell.locator('#address').press('Enter');
    await shell.getByRole('button', { name: 'Fixture Page' }).waitFor();
    await shell.setViewportSize({ width: 1280, height: 800 });
    await shell.evaluate(() => window.browserShell.invoke('setUiLocale', { locale: 'zh-CN' }));
    await shell.waitForFunction(() => document.querySelector('#bookmark-current').getAttribute('aria-label') === '将此页加入书签');
    await toggleBookmark(shell, '已添加书签', true);
    assert.equal((await request('/bookmarks')).bookmarks[0].url, url);
    assert.equal((await request('/history')).history.filter(item => item.url === url).length, 1);
    if (process.env.CORVID_BOOKMARK_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.CORVID_BOOKMARK_SCREENSHOT_DIR, { recursive: true });
      await shell.screenshot({ path: path.join(process.env.CORVID_BOOKMARK_SCREENSHOT_DIR, 'issue-195-bookmark-added-zh-CN.png') });
    }
    await toggleBookmark(shell, '已移除书签', false);
    assert.equal((await request('/bookmarks')).bookmarks.length, 0);
    await shell.evaluate(() => window.browserShell.invoke('setUiLocale', { locale: 'en' }));
    await shell.waitForFunction(() => document.querySelector('#bookmark-current').getAttribute('aria-label') === 'Bookmark this page');
    await toggleBookmark(shell, 'Bookmark added', true);
    if (process.env.CORVID_BOOKMARK_SCREENSHOT_DIR) await shell.screenshot({ path: path.join(process.env.CORVID_BOOKMARK_SCREENSHOT_DIR, 'issue-195-bookmark-added-en.png') });
    await shell.setViewportSize({ width: 704, height: 420 });
    await shell.waitForFunction(() => {
      const address = document.querySelector('#address-form'), status = document.querySelector('#status');
      return address.clientWidth >= 80 && address.scrollWidth <= address.clientWidth && status.scrollWidth <= status.clientWidth;
    });
    if (process.env.CORVID_BOOKMARK_SCREENSHOT_DIR) {
      await shell.screenshot({ path: path.join(process.env.CORVID_BOOKMARK_SCREENSHOT_DIR, 'issue-195-bookmark-added-en-704x420.png') });
    }
    await shell.setViewportSize({ width: 1280, height: 800 });
    await toggleBookmark(shell, 'Bookmark removed', false);
    assert.equal((await request('/bookmarks')).bookmarks.length, 0);
    await shell.evaluate(() => window.browserShell.invoke('setUiLocale', { locale: 'zh-CN' }));
    await shell.waitForFunction(() => document.querySelector('#bookmark-current').getAttribute('aria-label') === '将此页加入书签');
    await toggleBookmark(shell, '已添加书签', true);
    assert.equal((await request('/bookmarks')).bookmarks.length, 1);
    await stop();

    ({ shell, request } = await boot());
    assert.equal((await request('/bookmarks')).bookmarks.length, 1);
    assert.equal((await request('/history')).history.filter(item => item.url === url).length, 1);
    await shell.locator('#library-trigger').click();await shell.locator('#library-menu:not([hidden])').waitFor();await shell.locator('#show-bookmarks').click();
    await shell.getByText('Fixture Page', { exact: true }).first().waitFor();
    await shell.getByRole('button', { name: '删除 Fixture Page' }).click();
    assert.equal((await request('/bookmarks')).bookmarks.length, 0);
    await shell.locator('#library-trigger').click();await shell.locator('#library-menu:not([hidden])').waitFor();await shell.locator('#show-history').click();
    await shell.getByRole('button', { name: '删除 Fixture Page' }).click();
    assert.equal((await request('/history')).history.length, 0);
    await stop();

    ({ request } = await boot());
    assert.equal((await request('/bookmarks')).bookmarks.length, 0);
    assert.equal((await request('/history')).history.length, 0);
    await stop();
    console.log('PASS UI room creation, navigation, localized bookmark add/remove state and feedback, narrow layout, history, restart persistence and deletion');
  } finally {
    if (app) await closeElectron(app).catch(error => { console.error(error); process.exitCode = 1; });
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
