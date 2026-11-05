const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launchPackagedApp } = require('./packaged-app-launcher.cjs');
const { assertDeveloperIdSignature } = require('./packaged-app-signature.cjs');

const root = path.resolve(__dirname, '..');
const expectedArch = process.env.CORVID_PACKAGED_ARCH ?? process.arch;
let appBundle;
let executablePath;
if (process.platform === 'darwin') {
  appBundle = path.join(root, 'dist', `mac-${expectedArch}`, 'Corvid.app');
  executablePath = path.join(appBundle, 'Contents', 'MacOS', 'Corvid');
} else if (process.platform === 'win32') {
  executablePath = path.join(root, 'dist', 'win-unpacked', 'Corvid.exe');
} else {
  throw new Error(`Unsupported packaged app test platform: ${process.platform}`);
}

(async () => {
  assert.ok(['arm64', 'x64'].includes(expectedArch), `supported packaged architecture: ${expectedArch}`);
  assert.equal(process.arch, expectedArch, `the runner must use the packaged ${expectedArch} architecture`);
  assert.ok(fs.statSync(executablePath).isFile(), `packaged executable exists: ${executablePath}`);
  if (process.env.CORVID_REQUIRE_PACKAGED_SIGNATURE === '1') assertDeveloperIdSignature(appBundle);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-packaged-app-'));
  let app;
  try {
    app = await launchPackagedApp({
      executablePath,
      dataDir,
      args: [],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const info = await app.page.evaluate(() => ({
      appPath: location.pathname,
      userAgent: navigator.userAgent,
    }));
    const architectures = process.platform === 'darwin'
      ? execFileSync('/usr/bin/lipo', ['-archs', executablePath], { encoding: 'utf8' }).trim().split(/\s+/)
      : [process.arch];
    assert.deepEqual(architectures, [expectedArch]);
    assert.match(info.appPath, /\.asar\//, 'desktop assets resolve from the packaged application archive');

    await app.page.getByRole('button', { name: 'Corvid Agent', exact: true }).waitFor();
    const userAgent = await app.page.evaluate(() => navigator.userAgent);
    const electronVersion = userAgent.match(/Electron\/([\d.]+)/)?.[1];
    assert.ok(electronVersion, `Electron version is present in the packaged renderer user agent: ${userAgent}`);
    const response = await fetch(`${app.control.baseUrl}/rooms`, { headers: { authorization: `Bearer ${app.control.token}` } });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.ok(state.rooms.some(room => room.id === state.activeRoomId), 'the first browser Room is available from the packaged app');
    assert.ok(fs.existsSync(path.join(dataDir, 'control.json')), 'the isolated control file is created inside the selected data directory');

    const shutdown = await fetch(`${app.control.baseUrl}/shutdown`, {
      method: 'POST',
      headers: { authorization: `Bearer ${app.control.token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(shutdown.status, 200);
    const child = app.process();
    const exited = await new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 5_000);
      child.once('exit', () => { clearTimeout(timer); resolve(true); });
      if (child.exitCode !== null || child.signalCode) { clearTimeout(timer); resolve(true); }
    });
    assert.equal(exited, true, 'packaged app exits after graceful shutdown');
    assert.equal(child.signalCode, null, 'packaged app exits normally, not by signal');
    assert.equal(child.exitCode, 0, 'packaged app exits successfully after graceful shutdown');
    app = null;
    assert.equal(fs.existsSync(path.join(dataDir, 'control.json')), false, 'graceful shutdown removes the scoped control credential');
    console.log(`PASS packaged Corvid app starts and exits (${process.platform} ${expectedArch}, Electron ${electronVersion})`);
  } finally {
    if (app) await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
