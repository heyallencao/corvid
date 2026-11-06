const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { launchPackagedApp } = require('./packaged-app-launcher.cjs');

const root = path.resolve(__dirname, '..');
const executablePath = process.env.CORVID_PACKAGED_APP_PATH
  ? path.resolve(process.env.CORVID_PACKAGED_APP_PATH)
  : path.join(root, 'dist', 'win-unpacked', 'Corvid.exe');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-packaged-win-ui-'));
  const hits = [];
  const fixture = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture');
    hits.push(`${url.pathname}${url.search}`);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Packaged UI fixture</title><p>local fixture</p>');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fixture.address().port}`;
  let app;
  const waitFor = async (fn, label) => {
    for (let attempt = 0; attempt < 240; attempt++) {
      const value = await fn();
      if (value) return value;
      await delay(50);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const request = async route => {
    const response = await fetch(`${app.control.baseUrl}${route}`, {
      headers: { authorization: `Bearer ${app.control.token}` },
    });
    assert.ok(response.ok, `${route} returns ${response.status}`);
    return response.json();
  };

  try {
    app = await launchPackagedApp({
      executablePath,
      dataDir,
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const shell = app.page;
    assert.match(shell.url(), /\.asar\//, 'the packaged desktop page loads from app.asar');
    await shell.locator('#new-tab').click();
    await shell.locator('#address').fill(`${base}/fixture`);
    await shell.locator('#address').press('Enter');
    await waitFor(() => hits.includes('/fixture'), 'local fixture navigation');
    await shell.locator('#show-settings').click();
    await shell.locator('#settings').waitFor({ state: 'visible' });
    await shell.locator('#ui-locale').selectOption('en');
    await waitFor(() => shell.locator('#settings-title').textContent().then(text => text === 'Settings'), 'English settings labels');
    await shell.locator('#search-template').fill(`${base}/search?q={query}`);
    await shell.locator('#settings-form button[type="submit"]').click();
    await waitFor(() => shell.locator('#settings').evaluate(dialog => !dialog.open), 'settings save');
    const profiles = await request('/profiles');
    assert.equal(profiles.profiles.find(profile => profile.id === 'default').searchTemplate, `${base}/search?q={query}`);
    await shell.locator('#address').fill('hello world');
    await shell.locator('#address').press('Enter');
    await waitFor(() => hits.includes('/search?q=hello%20world'), 'saved search template navigation');
    console.log('PASS packaged Windows UI starts from app.asar, navigates a local fixture, saves localized search settings, and uses the saved search template');
  } finally {
    if (app) await app.close().catch(() => {});
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
