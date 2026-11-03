const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { launchPackagedApp } = require('./packaged-app-launcher.cjs');
const { assertDeveloperIdSignature } = require('./packaged-app-signature.cjs');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeStorageTimeoutMs = 15_000;

async function assertSafeStorageAvailable(app, phase) {
  let timer;
  try {
    const available = await Promise.race([
      app.evaluate(({ safeStorage }) => safeStorage.isAsyncEncryptionAvailable()),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`Electron safeStorage availability did not resolve during ${phase} within ${safeStorageTimeoutMs} ms`);
          error.code = 'CORVID_SAFE_STORAGE_TIMEOUT';
          reject(error);
        }, safeStorageTimeoutMs);
      }),
    ]);
    assert.equal(available, true,
      `the running Electron build reports asynchronous OS credential protection available during ${phase}`);
  } catch (error) {
    if (error.code === 'CORVID_SAFE_STORAGE_TIMEOUT') {
      // A native credential prompt can leave the Electron main thread blocked; terminate it so this test cannot hang.
      app.process()?.kill('SIGKILL');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function launch(dataDir) {
  const extraArgs = String(process.env.CORVID_ELECTRON_EXTRA_ARGS || '').split(/\s+/).filter(Boolean);
  const packagedAppPath = process.env.CORVID_PACKAGED_APP_PATH ? path.resolve(process.env.CORVID_PACKAGED_APP_PATH) : null;
  if (packagedAppPath && process.env.CORVID_REQUIRE_PACKAGED_SIGNATURE === '1') assertDeveloperIdSignature(packagedAppPath);
  const executablePath = packagedAppPath ? path.join(packagedAppPath, 'Contents', 'MacOS', 'Corvid') : electronPath;
  const env = {
    ...process.env,
    CORVID_DATA_DIR: dataDir,
    CORVID_PORT: '0',
    CORVID_TEST_MODE: '1',
  };
  if (packagedAppPath) return launchPackagedApp({ executablePath, dataDir, args: extraArgs, env });
  const app = await _electron.launch({ executablePath, args: packagedAppPath ? extraArgs : [...extraArgs, project], env: {
    ...env,
  } });
  for (let i = 0; i < 200 && !fs.existsSync(path.join(dataDir, 'control.json')); i++) await delay(25);
  assert.ok(fs.existsSync(path.join(dataDir, 'control.json')), 'the isolated Corvid control service starts');
  return app;
}

async function waitForSafeStorageFlow(app, button, phase) {
  try {
    await button.waitFor({ timeout: safeStorageTimeoutMs });
  } catch (cause) {
    const error = new Error(`Corvid credential state did not become available during ${phase} within ${safeStorageTimeoutMs} ms`, { cause });
    error.code = 'CORVID_SAFE_STORAGE_TIMEOUT';
    app.process()?.kill('SIGKILL');
    throw error;
  }
}

async function waitForPage(dataDir, url) {
  const controlPath = path.join(dataDir, 'control.json');
  for (let attempt = 0; attempt < 200; attempt++) {
    const control = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
    const response = await fetch(`${control.baseUrl}/rooms`, { headers: { authorization: `Bearer ${control.token}` } });
    const state = await response.json();
    if (state.rooms.flatMap(room => room.tabs).some(tab => tab.url === url)) return;
    await delay(25);
  }
  throw new Error('The local credential test page did not navigate');
}

async function openApiKeyProvider(app) {
  const shell = await app.firstWindow();
  await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
  const select = shell.locator('.pi-model-select');
  await select.waitFor();
  const option = await select.locator('option').evaluateAll(options => options.find(item => {
    try { return JSON.parse(item.value).providerId === 'anthropic'; } catch { return false; }
  })?.value);
  assert.ok(option, 'the catalog contains an API Key provider');
  await select.selectOption(option);
  return shell;
}

(async () => {
  if (!['darwin', 'win32', 'linux'].includes(process.platform)) {
    console.log(`SKIP safeStorage integration test on unsupported platform ${process.platform}`);
    return;
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-credential-os-store-'));
  const site = http.createServer((_request, response) => response.end('<!doctype html><title>Credential Store Fixture</title><h1>Local test page</h1>'));
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const credentialPath = path.join(dataDir, 'agent-credentials.json');
  const secret = `sk-test-${process.platform}-os-store-roundtrip`;
  let app;
  try {
    app = await launch(dataDir);
    const initialShell = await app.firstWindow();
    if (process.env.CORVID_PACKAGED_APP_PATH) assert.match(initialShell.url(), /\.app\/Contents\/Resources\/app\.asar\/desktop\/index\.html$/,
      'the credential flow runs from the packaged Corvid app archive');
    const pageUrl = `http://127.0.0.1:${site.address().port}/`;
    await initialShell.getByLabel(/地址或搜索|Address or search/i).fill(pageUrl);
    await initialShell.getByLabel(/地址或搜索|Address or search/i).press('Enter');
    await waitForPage(dataDir, pageUrl);
    if (typeof app.evaluate === 'function') await assertSafeStorageAvailable(app, 'initial credential-store check');
    let shell = await openApiKeyProvider(app);
    await shell.locator('.pi-model-key').fill(secret);
    await shell.getByRole('button', { name: /连接 Key|Connect key/i }).click();
    await waitForSafeStorageFlow(app, shell.getByRole('button', { name: /退出|Sign out/i }), 'credential encryption and connection');

    const persisted = fs.readFileSync(credentialPath, 'utf8');
    const document = JSON.parse(persisted);
    assert.equal(document.schemaVersion, 2);
    assert.deepEqual(Object.keys(document.providers.anthropic).sort(), ['encryptedCredential', 'kind']);
    assert.equal(persisted.includes(secret), false, 'the isolated credential file contains no plaintext API Key');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(credentialPath).mode & 0o777, 0o600, 'the credential file is owner-only');
    }
    if (process.platform === 'linux') {
      const tag = Buffer.from(document.providers.anthropic.encryptedCredential, 'base64').subarray(0, 3).toString('latin1');
      assert.ok(['v11', 'v12'].includes(tag), `Linux credentials use a supported OS provider tag, received ${JSON.stringify(tag)}`);
    }

    await app.close();
    app = await launch(dataDir);
    if (typeof app.evaluate === 'function') await assertSafeStorageAvailable(app, 'post-restart credential-store check');
    shell = await openApiKeyProvider(app);
    await waitForSafeStorageFlow(app, shell.getByRole('button', { name: /退出|Sign out/i }), 'credential decryption after restart');
    assert.equal(await shell.locator('.pi-model-key').count(), 0,
      'the persisted credential is readable by the OS-protected store after an Electron restart');
    await shell.getByRole('button', { name: /退出|Sign out/i }).click();
    await waitForSafeStorageFlow(app, shell.getByRole('button', { name: /连接 Key|Connect key/i }), 'credential logout');
    const afterLogout = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    assert.equal(afterLogout.providers.anthropic, undefined, 'logout removes the credential from Corvid persistence');
    console.log(`PASS ${process.platform} Electron safeStorage availability, encrypted persistence, restart read, and logout deletion`);
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => site.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
