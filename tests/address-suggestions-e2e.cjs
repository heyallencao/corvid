const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { launchElectron, waitForControl } = require('./electron-test-startup.cjs');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-address-suggestions-'));
  const qaDir = process.env.CORVID_ADDRESS_SUGGESTIONS_QA_DIR;
  if (qaDir) fs.mkdirSync(qaDir, { recursive: true });
  const fixture = http.createServer((request, response) => {
    const title = request.url.startsWith('/search?') ? 'Local Search Fixture' : 'Corvid Guide';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fixture.address().port}`;
  const visitedUrl = `${base}/guide?fixtureSecret=not-rendered#section`;
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
    schemaVersion: 1,
    history: [
      { id: 'default-guide-old', profileId: 'default', url: visitedUrl, title: 'Corvid Guide', visitedAt: '2026-11-03T10:00:00.000Z' },
      { id: 'default-guide-new', profileId: 'default', url: visitedUrl, title: 'Corvid Guide', visitedAt: '2026-11-04T10:00:00.000Z' },
      { id: 'other-profile-guide', profileId: 'profile-other', url: `${base}/guide-private`, title: 'Private Profile Guide', visitedAt: '2026-11-04T11:00:00.000Z' },
    ],
    bookmarks: [],
    downloads: [],
  }));
  let app;
  try {
    const launched = await launchElectron(_electron, {
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1' },
    }, { label: 'address-suggestions-e2e', dataDir });
    app = launched.app;
    const shell = launched.shell;
    const control = await waitForControl(app, dataDir, { label: 'address-suggestions-e2e' });
    const readHistory = async () => {
      const response = await fetch(`${control.baseUrl}/history`, { headers: { Authorization: `Bearer ${control.token}` } });
      assert.equal(response.status, 200);
      return (await response.json()).history;
    };
    const address = shell.locator('#address');
    const list = shell.getByRole('listbox', { name: '地址建议' });

    await address.fill(`${base}/guide`);
    await list.waitFor({ state: 'visible' });
    const guide = list.getByRole('option', { name: /Corvid Guide/ });
    await guide.waitFor();
    assert.equal(await list.getByRole('option').count(), 1, 'one URL is shown even when history contains duplicate visits');
    assert.doesNotMatch(await guide.innerText(), /fixtureSecret|section/, 'history suggestions hide URL query and fragment values');
    assert.equal(await address.getAttribute('aria-expanded'), 'true');
    await address.press('ArrowDown');
    assert.equal(await address.getAttribute('aria-activedescendant'), 'address-suggestion-0');
    assert.equal(await shell.evaluate(() => document.activeElement.id), 'address', 'keyboard selection keeps focus in the address field');
    await address.press('Enter');
    await shell.getByRole('button', { name: 'Corvid Guide', exact: true }).waitFor();
    assert.equal(await address.inputValue(), visitedUrl, 'confirming a history suggestion navigates to the stored URL');
    assert.equal(await address.getAttribute('aria-expanded'), 'false');

    await shell.evaluate(async url => window.browserShell.invoke('saveSettings', { searchTemplate: `${url}/search?q={query}` }), base);
    await address.fill('safe local search');
    await list.waitFor({ state: 'visible' });
    await list.getByRole('option', { name: '搜索“safe local search”' }).waitFor();
    await address.press('Escape');
    assert.equal(await list.isVisible(), false, 'Escape closes suggestions');
    assert.equal(await address.inputValue(), 'safe local search', 'Escape preserves the typed query');
    await address.fill('safe local search');
    await list.waitFor({ state: 'visible' });
    await address.press('ArrowDown');
    await address.press('Enter');
    await shell.getByRole('button', { name: 'Local Search Fixture', exact: true }).waitFor();
    assert.ok((await readHistory()).some(item => item.url === `${base}/search?q=safe%20local%20search`), 'the search suggestion uses the saved local search template only after confirmation');

    await shell.evaluate(async () => window.browserShell.invoke('setUiLocale', { locale: 'en' }));
    await address.fill('safe local search');
    await shell.getByRole('listbox', { name: 'Address suggestions' }).getByRole('option', { name: 'Search for “safe local search”' }).waitFor();
    await shell.evaluate(async () => window.browserShell.invoke('setUiLocale', { locale: 'zh-CN' }));
    await address.fill('safe local search');
    await list.waitFor({ state: 'visible' });
    await list.getByRole('option', { name: '搜索“safe local search”' }).waitFor();
    await address.fill('');
    assert.equal(await list.isVisible(), false, 'clearing the address closes suggestions');
    assert.equal(await address.getAttribute('aria-expanded'), 'false');

    await address.fill(`${base}/guide`);
    await list.waitFor({ state: 'visible' });
    if (qaDir) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 700));
      await delay(100);
      await shell.screenshot({ path: path.join(qaDir, 'issue-191-suggestions-zh-CN-1024x700.png') });
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(704, 420));
    await delay(100);
    const bounds = await list.boundingBox();
    const geometry = await shell.evaluate(() => ({ width: innerWidth, right: document.querySelector('#address-suggestions').getBoundingClientRect().right, scrollWidth: document.querySelector('#chrome-tools').scrollWidth, clientWidth: document.querySelector('#chrome-tools').clientWidth }));
    assert.ok(bounds && bounds.width > 0, 'suggestions remain visible in a short window');
    assert.ok(geometry.right <= geometry.width, 'suggestions stay within the window');
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, 'the toolbar does not gain horizontal overflow');
    if (qaDir) await shell.screenshot({ path: path.join(qaDir, 'issue-191-suggestions-zh-CN-704x420.png') });
    console.log('PASS local history and search suggestions, keyboard selection, escape/clear, bilingual labels, profile boundary and narrow layout');
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
