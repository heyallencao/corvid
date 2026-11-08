const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { closeElectron, launchElectron, waitForControl } = require('./electron-test-startup.cjs');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-browser-layout-'));
  const fixture = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Geometry fixture</title><style>html,body{margin:0;min-height:100%;background:#dcecff;color:#172033}main{padding:24px;font:20px sans-serif}</style><main>Local page canvas</main>');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${fixture.address().port}/geometry`;
  let app;

  async function boot() {
    const launched = await launchElectron(_electron, {
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1' },
    }, { label: 'browser-layout-e2e', dataDir });
    app = launched.app;
    const shell = launched.shell;
    const config = await waitForControl(app, dataDir, { label: 'browser-layout-e2e' });
    const request = async route => {
      const response = await fetch(config.baseUrl + route, { headers: { Authorization: `Bearer ${config.token}` } });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      return value;
    };
    return { shell, request };
  }

  async function measure(shell) {
    const chrome = await shell.evaluate(() => {
      const height = selector => {
        const element = document.querySelector(selector), rect = element.getBoundingClientRect();
        return { height: Math.ceil(rect.height), display: getComputedStyle(element).display, hidden: element.hidden, text: element.textContent.trim() };
      };
      return { total: Math.ceil(document.querySelector('#browser-shell').getBoundingClientRect().height), tabs: height('#tab-strip'), toolbar: height('#chrome-tools'), bookmarks: height('#bookmarks-bar'), status: height('#status') };
    });
    const pageViews = await app.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      if (!browserWindow) throw new Error('Missing Corvid browser window');
      return browserWindow.contentView.children.map(view => ({ url: view.webContents?.getURL(), bounds: view.getBounds() }));
    });
    return { chromeHeight: chrome.total, chrome, pageViews };
  }

  async function waitUntil(fn, label, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await fn();
      if (value) return value;
      await delay(40);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  async function assertPageStartsBelowChrome(shell, expectedHeight, label, pageUrl = url) {
    let lastMeasurement;
    const result = await waitUntil(async () => {
      const measured = await measure(shell);
      const page = measured.pageViews.find(item => item.url === pageUrl);
      lastMeasurement = { chrome: measured.chrome, page };
      const heightMatches = expectedHeight === null || measured.chromeHeight === expectedHeight;
      return page && heightMatches && page.bounds.y === measured.chromeHeight ? measured : false;
    }, `${label}: measured chrome and WebContentsView bounds agree`).catch(error => {
      error.message += `; last measurement ${JSON.stringify(lastMeasurement)}`;
      throw error;
    });
    const page = result.pageViews.find(item => item.url === pageUrl);
    // 页面画布底部为房间 dock 预留条带；其高度由渲染进程实时上报。
    const dockStrip = await shell.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-strip')) || 0);
    assert.equal(page.bounds.height + page.bounds.y, await shell.evaluate(() => window.innerHeight) - dockStrip);
    return result;
  }

  try {
    const { shell } = await boot();
    await assertPageStartsBelowChrome(shell, 84, 'empty bookmark/status rows', 'about:blank');

    await shell.locator('#address').fill(url);
    await shell.locator('#address').press('Enter');
    await shell.getByRole('button', { name: 'Geometry fixture' }).waitFor();
    await assertPageStartsBelowChrome(shell, 84, 'normal page without bookmarks');

    await shell.locator('#bookmark-current').click();
    await shell.getByText('已添加书签', { exact: true }).waitFor();
    await shell.locator('#bookmarks-bar .bookmark-item').waitFor();
    const withBookmarkAndStatus = await assertPageStartsBelowChrome(shell, null, 'bookmark and transient status rows');
    assert.ok(withBookmarkAndStatus.chromeHeight > 84, 'visible bookmark and status content increases measured chrome height');
    assert.ok(withBookmarkAndStatus.chrome.status.height > 0, 'transient bookmark feedback occupies a measured status row');

    await shell.locator('#library-trigger').click();
    await shell.locator('#library-menu:not([hidden])').waitFor();
    await shell.locator('#show-bookmarks').click();
    await shell.locator('#library:not([hidden])').waitFor();
    const panelPosition = await shell.locator('#library').evaluate(element => ({ top: Math.round(element.getBoundingClientRect().top), chromeHeight: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--browser-chrome-height')) }));
    assert.equal(panelPosition.top, panelPosition.chromeHeight + 12, 'library panel remains below all visible browser chrome');

    await shell.locator('#library .close-button').click();
    await shell.locator('#more-tools').click();
    await shell.locator('#site-tools:not([hidden])').waitFor();
    const toolsPosition = await shell.locator('#site-tools').evaluate(element => ({ top: Math.round(element.getBoundingClientRect().top), chromeHeight: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--browser-chrome-height')) }));
    assert.equal(toolsPosition.top, toolsPosition.chromeHeight + 12, 'site tools remain below all visible browser chrome');

    await shell.locator('#more-tools').click();
    await waitUntil(async () => !(await shell.locator('#status .bookmark-feedback').count()), 'transient bookmark feedback clears');
    const stableChromeHeight=(await measure(shell)).chromeHeight;
    assert.ok(stableChromeHeight>84, 'the visible bookmark row contributes to measured chrome');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(719, 420));
    await waitUntil(async () => shell.evaluate(() => window.innerWidth === 719), 'minimum supported viewport');
    const narrow = await assertPageStartsBelowChrome(shell, stableChromeHeight, 'narrow viewport with bookmark row');
    assert.equal(narrow.pageViews.find(item => item.url === url).bounds.width, await shell.evaluate(() => document.querySelector('#browser-shell').clientWidth));

    await shell.locator('#new-tab').click();
    await shell.getByRole('button', { name: 'about:blank' }).last().waitFor();
    await waitUntil(async () => {
      const chromeHeight = await shell.evaluate(() => Math.ceil(document.querySelector('#browser-shell').getBoundingClientRect().height));
      const visible = await shell.locator('#bookmarks-bar').evaluate(element => !element.hidden && getComputedStyle(element).display !== 'none');
      return chromeHeight === 84 && !visible;
    }, 'new-tab page collapses the bookmark row');

    console.log('PASS browser chrome geometry follows live DOM height across bookmark/status visibility, overlays, window resizing, and tab changes');
  } finally {
    if (app) await closeElectron(app).catch(error => { console.error(error); process.exitCode = 1; });
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
