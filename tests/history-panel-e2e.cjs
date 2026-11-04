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
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-history-panel-'));
  const qaDir = process.env.CORVID_HISTORY_QA_DIR;
  if (qaDir) fs.mkdirSync(qaDir, { recursive: true });
  const fixture = http.createServer((request, response) => {
    const title = request.url.startsWith('/today-one') ? 'Alpha Today' : 'Beta Today';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><p>${title}</p>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fixture.address().port}`;
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(16, 20, 0, 0);
  const older = new Date(yesterday); older.setDate(older.getDate() - 5);
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
    schemaVersion: 1,
    history: [
      { id: 'seed-older', profileId: 'default', url: 'https://older.example.test/archive', title: 'Older Fixture', visitedAt: older.toISOString() },
      { id: 'seed-yesterday', profileId: 'default', url: 'https://yesterday.example.test/article', title: 'Yesterday Fixture', visitedAt: yesterday.toISOString() },
    ],
    bookmarks: [],
    downloads: [],
  }));
  let app;

  async function until(fn, label) {
    for (let index = 0; index < 240; index += 1) {
      const value = await fn();
      if (value) return value;
      await delay(25);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  try {
    const launched = await launchElectron(_electron, {
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1' },
    }, { label: 'history-panel-e2e', dataDir });
    app = launched.app;
    const shell = launched.shell;
    const control = await waitForControl(app, dataDir, { label: 'history-panel-e2e' });
    const readHistory = async () => {
      const response = await fetch(`${control.baseUrl}/history`, { headers: { Authorization: `Bearer ${control.token}` } });
      assert.equal(response.status, 200);
      return (await response.json()).history;
    };

    const firstUrl = `${base}/today-one?privateToken=fixture-only#section`;
    await shell.locator('#address').fill(firstUrl);
    await shell.locator('#address').press('Enter');
    await shell.getByRole('button', { name: 'Alpha Today', exact: true }).waitFor();
    await shell.locator('#address').fill(`${base}/today-two`);
    await shell.locator('#address').press('Enter');
    await shell.getByRole('button', { name: 'Beta Today', exact: true }).waitFor();
    const visits = await until(async () => {
      const history = await readHistory();
      return history.some(item => item.url === firstUrl) && history.some(item => item.url === `${base}/today-two`) ? history : false;
    }, 'both local fixture visits in history');
    const firstVisit = visits.find(item => item.url === firstUrl);
    await shell.locator('#show-history').click();

    const items = shell.locator('#library-items');
    const todayGroup = items.locator('.history-group[data-history-group="today"]');
    const yesterdayGroup = items.locator('.history-group[data-history-group="yesterday"]');
    const olderGroup = items.locator(`.history-group[data-history-group="${dayKey(older)}"]`);
    await todayGroup.getByRole('link', { name: 'Beta Today' }).waitFor();
    assert.equal(await items.locator('.history-group').count(), 3, 'history is separated into local-day groups');
    assert.deepEqual(await items.locator('.history-group').evaluateAll(groups => groups.map(group => group.dataset.historyGroup)), ['today', 'yesterday', dayKey(older)], 'groups are ordered from newest to oldest');
    assert.equal(await todayGroup.locator('.history-entry').count(), 2, 'both visited pages appear under today');
    assert.equal(await todayGroup.locator('.history-group-title').textContent(), '今天');
    assert.equal(await yesterdayGroup.locator('.history-group-title').textContent(), '昨天');
    assert.equal(await olderGroup.locator('.history-group-title').textContent(), await shell.evaluate(date => window.corvidI18n.formatDate(date, { dateStyle: 'full' }), older.toISOString()));

    const firstEntry = todayGroup.locator('.history-entry').filter({ hasText: 'Alpha Today' });
    assert.equal(await firstEntry.locator('.history-url').textContent(), new URL(firstUrl).host + '/today-one', 'visible URL omits query and fragment values');
    assert.equal(await firstEntry.locator('.history-url').getAttribute('title'), new URL(firstUrl).host + '/today-one', 'URL tooltip also omits query and fragment values');
    assert.equal(await firstEntry.getByRole('link').getAttribute('title'), new URL(firstUrl).host + '/today-one');
    assert.doesNotMatch(await firstEntry.innerText(), /privateToken|fixture-only|section/, 'query and fragment values are not rendered in the history row');
    assert.equal(await firstEntry.locator('.history-time').getAttribute('datetime'), firstVisit.visitedAt);
    assert.equal(await firstEntry.locator('.history-time').textContent(), await shell.evaluate(date => window.corvidI18n.formatDate(date, { hour: 'numeric', minute: '2-digit' }), firstVisit.visitedAt));

    await shell.evaluate(async () => window.browserShell.invoke('setUiLocale', { locale: 'en' }));
    await todayGroup.locator('.history-group-title').getByText('Today', { exact: true }).waitFor();
    await yesterdayGroup.locator('.history-group-title').getByText('Yesterday', { exact: true }).waitFor();
    assert.equal(await firstEntry.locator('.history-time').textContent(), await shell.evaluate(date => window.corvidI18n.formatDate(date, { hour: 'numeric', minute: '2-digit' }), firstVisit.visitedAt));

    const search = shell.locator('#library-search');
    await search.fill('/today-one');
    await todayGroup.getByRole('link', { name: 'Alpha Today' }).waitFor();
    assert.equal(await todayGroup.getByRole('link', { name: 'Beta Today' }).count(), 0, 'search still matches the stored full URL');
    await search.fill('');
    await todayGroup.getByRole('button', { name: 'Delete Beta Today' }).click();
    assert.equal(await todayGroup.locator('.history-entry').count(), 1, 'deleting one history row leaves the other visit');
    await search.fill('no-such-history-entry');
    await items.getByText('No matching results', { exact: true }).waitFor();

    await search.fill('');
    await shell.evaluate(async () => window.browserShell.invoke('setUiLocale', { locale: 'zh-CN' }));
    await todayGroup.locator('.history-group-title').getByText('今天', { exact: true }).waitFor();
    await shell.locator('#library-search').evaluate(input => input.blur());
    if (qaDir) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 700));
      await items.evaluate(element => { element.scrollTop = 0; });
      await shell.screenshot({ path: path.join(qaDir, 'issue-196-history-zh-CN-1024x700.png') });
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 420));
    await items.evaluate(element => { element.scrollTop = 0; });
    await items.getByRole('button', { name: '删除 Alpha Today' }).waitFor();
    const geometry = await todayGroup.locator('.history-entry').evaluate(row => {
      const url = row.querySelector('.history-url').getBoundingClientRect();
      const time = row.querySelector('.history-time').getBoundingClientRect();
      const remove = row.querySelector('button').getBoundingClientRect();
      const bounds = row.getBoundingClientRect();
      return { width: bounds.width, scrollWidth: row.scrollWidth, urlWidth: url.width, timeRight: time.right, removeRight: remove.right, rowRight: bounds.right };
    });
    assert.ok(geometry.width > 0 && geometry.urlWidth > 0, `narrow layout keeps the URL and time visible: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.scrollWidth <= geometry.width + 1 && geometry.timeRight <= geometry.rowRight + 1 && geometry.removeRight <= geometry.rowRight + 1, `narrow layout does not overflow: ${JSON.stringify(geometry)}`);
    if (qaDir) await shell.screenshot({ path: path.join(qaDir, 'issue-196-history-zh-CN-700x420.png') });

    console.log('PASS history dates, local-time groups, sanitized URLs, bilingual labels, search, deletion and narrow layout');
  } finally {
    if (app) await closeElectron(app);
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
