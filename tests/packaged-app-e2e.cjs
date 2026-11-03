const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launchPackagedApp } = require('./packaged-app-launcher.cjs');
const { assertDeveloperIdSignature } = require('./packaged-app-signature.cjs');

const root = path.resolve(__dirname, '..');
const appBundle = path.join(root, 'dist', 'mac-arm64', 'Corvid.app');
const executablePath = path.join(appBundle, 'Contents', 'MacOS', 'Corvid');

(async () => {
  assert.equal(process.platform, 'darwin', 'packaged macOS smoke test requires macOS');
  assert.equal(process.arch, 'arm64', 'this build validates the native Apple Silicon package');
  assert.ok(fs.statSync(executablePath).isFile(), `packaged executable exists: ${executablePath}`);
  if (process.env.CORVID_REQUIRE_PACKAGED_SIGNATURE === '1') assertDeveloperIdSignature(appBundle);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-packaged-app-'));
  let app;
  try {
    app = await launchPackagedApp({
      executablePath,
      dataDir,
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const page = app.page;
    assert.match(page.url(), /\.app\/Contents\/Resources\/app\.asar\/desktop\/index\.html$/,
      'the visible desktop page is loaded from the packaged app.asar');
    const architectures = execFileSync('/usr/bin/lipo', ['-archs', executablePath], { encoding: 'utf8' }).trim().split(/\s+/);
    assert.deepEqual(architectures, ['arm64']);

    await page.getByRole('button', { name: 'Corvid Agent', exact: true }).waitFor();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const electronVersion = userAgent.match(/Electron\/([\d.]+)/)?.[1];
    assert.ok(electronVersion, `Electron version is present in the packaged renderer user agent: ${userAgent}`);
    const response = await fetch(`${app.control.baseUrl}/rooms`, { headers: { authorization: `Bearer ${app.control.token}` } });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.ok(state.rooms.some(room => room.id === state.activeRoomId), 'the first browser Room is available from the packaged app');
    assert.ok(fs.existsSync(path.join(dataDir, 'control.json')), 'the isolated control file is created inside the selected data directory');

    await app.close();
    app = null;
    assert.equal(fs.existsSync(path.join(dataDir, 'control.json')), false, 'graceful shutdown removes the scoped control credential');
    console.log(`PASS packaged Corvid app starts and exits without the Node Inspector (macOS arm64, Electron ${electronVersion})`);
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
