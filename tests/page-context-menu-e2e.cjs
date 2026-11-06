const { _electron } = require('playwright-core');
const electron = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { closeElectron, launchElectron, waitForControl } = require('./electron-test-startup.cjs');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-page-context-menu-'));
  const fixture = http.createServer((request, response) => {
    const origin = `http://127.0.0.1:${fixture.address().port}`;
    if (request.url === '/target') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<title>Local target</title><p>Context menu target page.</p>');
      return;
    }
    if (request.url === '/pixel.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#aabbcc"/></svg>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<title>Context fixture</title><main><a id="target" href="${origin}/target">Open local target</a><p id="selection">Selectable page text</p><img alt="fixture" src="${origin}/pixel.svg"><input id="editable" value="Editable fixture"></main>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  let app;
  try {
    const launched = await launchElectron(_electron, { executablePath: electron, args: [project], env: {
      ...process.env,
      CORVID_DATA_DIR: dataDir,
      CORVID_TEST_MODE: '1',
      CORVID_PORT: '0',
    } }, { label: 'page-context-menu-e2e', dataDir });
    app = launched.app;
    const control = await waitForControl(app, dataDir, { label: 'page-context-menu-e2e' });
    const shell = await app.firstWindow();
    const api = async (method, route, body) => {
      const response = await fetch(`${control.baseUrl}${route}`, {
        method,
        headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value = await response.json();
      assert.equal(response.status, 200, JSON.stringify(value));
      return value;
    };
    const waitFor = async (predicate, description) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await predicate();
        if (result) return result;
        await delay(25);
      }
      throw new Error(`Timed out waiting for ${description}`);
    };
    const openRoom = (await api('GET', '/rooms')).rooms.find(room => room.ownership === 'user');
    assert.ok(openRoom, 'the test app starts with a user-controlled browsing Room');
    await api('POST', `/rooms/${openRoom.id}/activate`, {});
    await shell.locator('#address').fill(origin);
    await shell.locator('#address').press('Enter');
    await waitFor(async () => {
      const tab = (await api('GET', '/rooms')).rooms.find(room => room.id === openRoom.id)?.tabs[0];
      return tab?.url === origin + '/' && tab.loadComplete;
    }, 'user fixture page load');

    await app.evaluate(({ Menu }) => {
      Menu.prototype.popup = function capturePageMenu() { globalThis.__corvidPageContextMenu = this; };
      globalThis.__corvidPageContextMenu = null;
    });
    const triggerContextMenu = async (pageUrl, linkURL = '') => app.evaluate(({ BrowserWindow }, { expectedUrl, linkURL }) => {
      const targetWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const view = targetWindow.contentView.children.find(child => child.webContents?.getURL() === expectedUrl);
      if (!view) throw new Error('The local fixture WebContentsView was not found');
      view.webContents.emit('context-menu', {}, {
        x: 40, y: 18, linkURL, isEditable: false, hasImageContents: false,
        canGoBack: false, canGoForward: false, editFlags: { canCopy: false },
      });
      return { visible: view.getVisible(), url: view.webContents.getURL() };
    }, { expectedUrl: pageUrl, linkURL });

    await triggerContextMenu(origin + '/', `${origin}/target`);
    const menu = await waitFor(async () => app.evaluate(() => globalThis.__corvidPageContextMenu ?
      globalThis.__corvidPageContextMenu.items.map(item => ({ id: item.id, label: item.label, enabled: item.enabled, role: item.role })) : null), 'page context menu handler');
    assert.ok(menu.some(item => item.id === 'corvid-page-open-link' && item.label === '在新标签页中打开链接'));
    assert.ok(menu.some(item => item.id === 'corvid-page-copy-link' && item.enabled));
    assert.equal(menu.some(item => /Developer|开发者|Electron|Inspect|检查元素/i.test(item.label || '')), false);

    await app.evaluate(({ BrowserWindow }) => {
      const item = globalThis.__corvidPageContextMenu.getMenuItemById('corvid-page-open-link');
      item.click(item, BrowserWindow.getFocusedWindow(), {});
    });
    const opened = await waitFor(async () => {
      const current = (await api('GET', '/rooms')).rooms.find(room => room.id === openRoom.id);
      return current?.tabs.length === 2 && current.tabs.find(tab => tab.url.endsWith('/target')) ? current : null;
    }, 'link opened in a second tab in the same room');
    assert.equal(opened.profileId, openRoom.profileId);

    const agentRoom = await api('POST', '/rooms', { name: 'Agent 控制的右键菜单夹具' });
    const agentTab = agentRoom.tabs[0];
    await api('POST', `/tabs/${agentTab.id}/navigate`, { url: `${origin}/agent` });
    await api('POST', `/rooms/${agentRoom.id}/activate`, {});
    await waitFor(async () => {
      const tab = (await api('GET', '/rooms')).rooms.find(room => room.id === agentRoom.id)?.tabs[0];
      return tab?.url === `${origin}/agent` && tab.loadComplete;
    }, 'Agent fixture page load');
    await app.evaluate(() => { globalThis.__corvidPageContextMenu = null; });
    await triggerContextMenu(`${origin}/agent`, `${origin}/target`);
    await delay(100);
    assert.equal(await app.evaluate(() => globalThis.__corvidPageContextMenu), null, 'a user context menu cannot take control of an Agent-owned Room');

    console.log('PASS webpage context menu event: localized actions, same-Room link tab, and Agent ownership guard');
  } finally {
    if (app) await closeElectron(app).catch(() => {});
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
