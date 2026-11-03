const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');
const { execFileSync } = require('node:child_process');
const { closeElectron, launchElectron, waitForControl } = require('./electron-test-startup.cjs');

const root = path.resolve(__dirname, '..');
const appBundle = path.join(root, 'dist', 'mac-arm64', 'Corvid.app');
const executablePath = path.join(appBundle, 'Contents', 'MacOS', 'Corvid');

(async () => {
  assert.equal(process.platform, 'darwin', 'packaged macOS smoke test requires macOS');
  assert.equal(process.arch, 'arm64', 'this build validates the native Apple Silicon package');
  assert.ok(fs.statSync(executablePath).isFile(), `packaged executable exists: ${executablePath}`);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-packaged-app-'));
  let app;
  let control;
  try {
    const launched = await launchElectron(_electron, {
      executablePath,
      args: [],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    }, { label: 'packaged-app-e2e', dataDir });
    app = launched.app;
    const shell = launched.shell;
    control = await waitForControl(app, dataDir, { label: 'packaged-app-e2e' });

    const info = await app.evaluate(({ app }) => ({
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      name: app.getName(),
      version: app.getVersion(),
    }));
    assert.equal(info.isPackaged, true, 'the process runs from an installed app bundle');
    const architectures = execFileSync('/usr/bin/lipo', ['-archs', executablePath], { encoding: 'utf8' }).trim().split(/\s+/);
    assert.deepEqual(architectures, ['arm64']);
    assert.match(info.appPath, /\.asar$/,'desktop assets resolve from the packaged application archive');

    await shell.locator('#rooms').waitFor();
    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).waitFor();
    const userAgent = await shell.evaluate(() => navigator.userAgent);
    const electronVersion = userAgent.match(/Electron\/([\d.]+)/)?.[1];
    assert.ok(electronVersion, `Electron version is present in the packaged renderer user agent: ${userAgent}`);
    const response = await fetch(`${control.baseUrl}/rooms`, { headers: { authorization: `Bearer ${control.token}` } });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.ok(state.rooms.some(room => room.id === state.activeRoomId), 'the first browser Room is available from the packaged app');
    assert.ok(fs.existsSync(path.join(dataDir, 'control.json')), 'the isolated control file is created inside the selected data directory');

    const shutdown = await fetch(`${control.baseUrl}/shutdown`, {
      method: 'POST',
      headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(shutdown.status, 200);
    const child = app.process();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('packaged app did not exit after graceful shutdown')), 5_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      if (child.exitCode !== null || child.signalCode) { clearTimeout(timer); resolve(); }
    });
    app = null;
    assert.equal(fs.existsSync(path.join(dataDir, 'control.json')), false, 'graceful shutdown removes the scoped control credential');
    console.log(`PASS packaged Corvid app starts and exits (macOS arm64, Electron ${electronVersion})`);
  } finally {
    if (app) await closeElectron(app);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
