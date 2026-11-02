const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1' },
    });
    const shell = await app.firstWindow();
    let config;
    for (let i = 0; i < 200; i++) {
      try { config = JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); break; }
      catch { await delay(50); }
    }
    assert.ok(config, 'control.json was not created');
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
  async function stop() { await app.close(); app = undefined; }

  try {
    let { shell, request } = await boot();
    await shell.getByRole('button', { name: '空间选项' }).click();
    await shell.getByRole('menuitem', { name: '新建空间' }).click();
    await shell.locator('#room-name').fill('测试Room');
    await shell.getByRole('button', { name: '创建', exact: true }).click();
    await shell.getByRole('button', { name: '测试Room' }).waitFor();
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
    await shell.getByRole('button', { name: '删除 Fixture Page' }).click();
    assert.equal((await request('/bookmarks')).bookmarks.length, 0);
    await shell.locator('#show-history').click();
    await shell.getByRole('button', { name: '删除 Fixture Page' }).click();
    assert.equal((await request('/history')).history.length, 0);
    await stop();

    ({ request } = await boot());
    assert.equal((await request('/bookmarks')).bookmarks.length, 0);
    assert.equal((await request('/history')).history.length, 0);
    await stop();
    console.log('PASS UI room creation, navigation, history/bookmarks, restart persistence, deletion and restart');
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
