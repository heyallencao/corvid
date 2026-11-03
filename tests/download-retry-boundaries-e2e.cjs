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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-download-retry-boundaries-'));
  const dataDir = path.join(root, 'data');
  const downloadDir = path.join(root, 'downloads');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(downloadDir);
  const profiles = [{ id: 'default', name: '默认', isDefault: true }, { id: 'isolated', name: '隔离身份', isDefault: false }];
  fs.writeFileSync(path.join(dataDir, 'profiles.json'), JSON.stringify(profiles));
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({
    schemaVersion: 1,
    history: [],
    bookmarks: [],
    downloads: [
      { id: 'default-failed', profileId: 'default', url: 'http://127.0.0.1/pending', filename: 'default.bin', path: null, status: 'failed', error: '测试网络错误', receivedBytes: 0, totalBytes: 0, createdAt: new Date().toISOString() },
      { id: 'isolated-failed', profileId: 'isolated', url: 'http://127.0.0.1/pending', filename: 'isolated.bin', path: null, status: 'failed', receivedBytes: 0, totalBytes: 0, createdAt: new Date().toISOString() },
      { id: 'isolated-race', profileId: 'isolated', url: 'http://127.0.0.1/pending', filename: 'race.bin', path: null, status: 'failed', receivedBytes: 0, totalBytes: 0, createdAt: new Date().toISOString() },
      { id: 'unsafe-failed', profileId: 'default', url: 'file:///etc/passwd', filename: 'passwd', path: null, status: 'failed', receivedBytes: 0, totalBytes: 0, createdAt: new Date().toISOString() }
    ]
  }));

  const server = http.createServer((request, response) => {
    const isRace = new URL(request.url, 'http://127.0.0.1').searchParams.has('race');
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${isRace ? 'race.bin' : 'isolated.bin'}"` });
    response.end(isRace ? 'single retry despite concurrent clicks' : 'download belongs to isolated identity');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const downloadUrl = `http://127.0.0.1:${server.address().port}/file`;
  const library = JSON.parse(fs.readFileSync(path.join(dataDir, 'library.json')));
  library.downloads.find(item => item.id === 'isolated-failed').url = downloadUrl;
  library.downloads.find(item => item.id === 'isolated-race').url = `${downloadUrl}?race=1`;
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify(library));

  let app;
  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1', CORVID_TEST_DOWNLOAD_DIR: downloadDir }
    });
    const shell = await app.firstWindow();
    let control;
    for (let index = 0; index < 200; index++) {
      try { control = JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'))); break; }
      catch { await delay(50); }
    }
    assert.ok(control, 'Corvid should publish its temporary control endpoint');
    const listDownloads = async () => {
      const response = await fetch(`${control.baseUrl}/downloads`, { headers: { Authorization: `Bearer ${control.token}` } });
      assert.equal(response.status, 200);
      return (await response.json()).downloads;
    };
    const invoke = async id => shell.evaluate(async downloadId => {
      try { return { value: await window.browserShell.invoke('retryDownload', { id: downloadId }) }; }
      catch (error) { return { error: error.message }; }
    }, id);

    await shell.locator('#show-downloads').click();
    await shell.getByText('default.bin — 失败：测试网络错误', { exact: true }).waitFor();
    assert.equal(await shell.getByText('isolated.bin — 失败', { exact: true }).count(), 0, 'downloads from another Profile must not appear in the current list');
    assert.match((await invoke('isolated-failed')).error, /当前浏览身份/, 'renderer retry must reject a record owned by another Profile');
    assert.match((await invoke('unsafe-failed')).error, /HTTP 或 HTTPS/, 'retry must reject non-web schemes');

    const externalRetry = await fetch(`${control.baseUrl}/downloads/isolated-failed/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${control.token}`, 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(externalRetry.status, 404, 'the external control API must not expose a retry action');

    await shell.locator('#profile-select').selectOption('isolated');
    for (let index = 0; index < 100 && await shell.locator('#profile-select').inputValue() !== 'isolated'; index++) await delay(25);
    await shell.getByText('isolated.bin — 失败', { exact: true }).waitFor();
    await shell.locator('.entry').filter({ hasText: 'isolated.bin — 失败' }).getByRole('button', { name: '重试', exact: true }).click();
    let result;
    for (let index = 0; index < 200; index++) {
      result = await listDownloads();
      if (result.some(item => item.retryOf === 'isolated-failed' && item.status === 'completed')) break;
      await delay(50);
    }
    const retry = result.find(item => item.retryOf === 'isolated-failed');
    assert.equal(retry?.status, 'completed', 'retry should complete within the source Profile Session');
    assert.equal(retry?.profileId, 'isolated');
    assert.equal(fs.readFileSync(path.join(downloadDir, 'isolated.bin'), 'utf8'), 'download belongs to isolated identity');
    assert.equal(result.find(item => item.id === 'isolated-failed')?.status, 'failed', 'the original record must remain unchanged');

    const concurrentCalls = await Promise.all([invoke('isolated-race'), invoke('isolated-race')]);
    assert.equal(concurrentCalls.filter(item => item.value).length, 1, 'only one concurrent retry request should start');
    assert.match(concurrentCalls.find(item => item.error)?.error || '', /已有重试正在进行/, 'the main process should reject the duplicate request');
    for (let index = 0; index < 200; index++) {
      result = await listDownloads();
      if (result.some(item => item.retryOf === 'isolated-race' && item.status === 'completed')) break;
      await delay(50);
    }
    assert.equal(result.find(item => item.retryOf === 'isolated-race')?.status, 'completed');
    assert.equal(fs.readFileSync(path.join(downloadDir, 'race.bin'), 'utf8'), 'single retry despite concurrent clicks');
    await shell.locator('#profile-select').selectOption('default');
    for (let index = 0; index < 100 && await shell.locator('#profile-select').inputValue() !== 'default'; index++) await delay(25);
    assert.equal((await listDownloads()).some(item => item.id === 'isolated-failed'), false, 'another Profile’s download history must remain isolated');
    console.log('PASS download retry boundaries: Profile ownership, HTTP(S)-only URLs, visible errors, concurrent retry lock, no external retry route, source Profile Session');
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
