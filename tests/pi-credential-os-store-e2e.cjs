const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { assertDeveloperIdSignature } = require('./packaged-app-signature.cjs');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await predicate();
    if (value) return value;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function launch(dataDir) {
  const extraArgs = String(process.env.CORVID_ELECTRON_EXTRA_ARGS || '').split(/\s+/).filter(Boolean);
  const packagedAppPath = process.env.CORVID_PACKAGED_APP_PATH ? path.resolve(process.env.CORVID_PACKAGED_APP_PATH) : null;
  if (packagedAppPath && process.env.CORVID_REQUIRE_PACKAGED_SIGNATURE === '1') assertDeveloperIdSignature(packagedAppPath);
  const executablePath = packagedAppPath ? path.join(packagedAppPath, 'Contents', 'MacOS', 'Corvid') : electronPath;
  const app = await _electron.launch({ executablePath, args: packagedAppPath ? extraArgs : [...extraArgs, project], env: {
    ...process.env,
    CORVID_DATA_DIR: dataDir,
    CORVID_PORT: '0',
    CORVID_TEST_MODE: '1',
  } });
  for (let i = 0; i < 200 && !fs.existsSync(path.join(dataDir, 'control.json')); i++) await delay(25);
  assert.ok(fs.existsSync(path.join(dataDir, 'control.json')), 'the isolated Corvid control service starts');
  return app;
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
  const select = shell.locator('.pi-model-select:visible').first();
  const status = shell.locator('.pi-model-status');
  // 连接状态只在模型弹出层展开时可见；这里先等徽标，失败时再读状态文案判断是不是安全存储恢复态。
  try { await select.waitFor({ state: 'visible', timeout: 20_000 }); }
  catch (error) {
    const message = await status.innerText().catch(() => '');
    if (/系统安全存储|secure system storage/i.test(message)) {
      const screenshotDir = process.env.CORVID_CREDENTIAL_OS_STORE_QA_DIR;
      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await shell.screenshot({ path: path.join(screenshotDir, 'issue-110-secure-storage-timeout.png') }).catch(() => {});
      }
      throw new Error(`The model catalog surfaced its credential-store recovery status before the provider list became available: ${message}`, { cause: error });
    }
    throw error;
  }
  const catalog = await shell.evaluate(() => window.browserShell.invoke('piModels'));
  const provider = catalog.providers.find(item => item.id === 'anthropic' && item.supportsApiKey);
  assert.ok(provider?.models.length, 'the catalog contains an API Key provider');
  const model = provider.models[0];
  await select.click();
  const search = shell.locator('.pi-model-search:visible');
  await search.fill(model.id);
  const option = shell.locator(`[role="option"][data-provider-id="anthropic"][data-model-id="${model.id}"]`);
  await option.waitFor();
  const targetIndex = await option.evaluate(element => [...element.parentElement.children].indexOf(element));
  const activeIndex = await search.evaluate(input => {
    const active = document.getElementById(input.getAttribute('aria-activedescendant'));
    return active ? [...active.parentElement.children].indexOf(active) : 0;
  });
  const optionCount = await shell.locator('[role="option"]').count();
  for (let step = 0; step < (targetIndex - activeIndex + optionCount) % optionCount; step++) await search.press('ArrowDown');
  await search.press('Enter');
  await shell.waitForFunction(() => document.querySelector('.pi-model-select[aria-expanded="false"]'));
  // 连接状态与凭据控件都在模型弹出层里：重新展开，调用方才能操作它们。
  await shell.locator('.pi-model-select:visible').first().click();
  await shell.waitForFunction(() => document.querySelector('.pi-model-select')?.getAttribute('aria-expanded') === 'true');
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
    if (process.env.CORVID_PACKAGED_APP_PATH) assert.equal(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged), true,
      'the credential flow runs inside the packaged Corvid app');
    const initialShell = await app.firstWindow();
    const pageUrl = `http://127.0.0.1:${site.address().port}/`;
    await initialShell.getByLabel(/地址或搜索|Address or search/i).fill(pageUrl);
    await initialShell.getByLabel(/地址或搜索|Address or search/i).press('Enter');
    await waitForPage(dataDir, pageUrl);
    let shell = await openApiKeyProvider(app);
    await shell.locator('.pi-model-key').fill(secret);
    await shell.getByRole('button', { name: /连接 Key|Connect key/i }).click();
    const persisted = await waitFor(() => {
      try {
        const text = fs.readFileSync(credentialPath, 'utf8');
        return JSON.parse(text).providers?.anthropic ? text : null;
      } catch { return null; }
    }, 'the API Key to be stored through the OS credential store');
    const document = JSON.parse(persisted);
    // 连接成功后弹出层会重建并关闭，重新展开才能看到“退出”。
    await shell.waitForFunction(() => document.querySelector('.pi-model-controls')?.dataset.connected === 'true');
    await shell.locator('.pi-model-select:visible').first().click();
    await shell.getByRole('button', { name: /退出|Sign out/i }).waitFor();
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
    shell = await openApiKeyProvider(app);
    await shell.getByRole('button', { name: /退出|Sign out/i }).waitFor();
    assert.equal(await shell.locator('.pi-model-key').count(), 0,
      'the persisted credential is readable by the OS-protected store after an Electron restart');
    await shell.getByRole('button', { name: /退出|Sign out/i }).click();
    await shell.waitForFunction(() => document.querySelector('.pi-model-controls')?.dataset.connected === 'false');
    await shell.locator('.pi-model-select:visible').first().click();
    await shell.getByRole('button', { name: /连接 Key|Connect key/i }).waitFor();
    const afterLogout = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    assert.equal(afterLogout.providers.anthropic, undefined, 'logout removes the credential from Corvid persistence');
    console.log(`PASS ${process.platform} Electron safeStorage availability, encrypted persistence, restart read, and logout deletion`);
  } finally {
    if (app) {
      let appProcess;
      try { appProcess = app.process(); } catch {}
      let closeTimer;
      await Promise.race([
        app.close().catch(() => {}),
        new Promise(resolve => { closeTimer = setTimeout(resolve, 3_000); }),
      ]);
      clearTimeout(closeTimer);
      if (appProcess?.exitCode === null) {
        appProcess.kill('SIGTERM');
        await Promise.race([
          new Promise(resolve => appProcess.once('exit', resolve)),
          new Promise(resolve => setTimeout(resolve, 2_000)),
        ]);
      }
    }
    await new Promise(resolve => {
      let closeTimer;
      site.close(() => { clearTimeout(closeTimer); resolve(); });
      site.closeAllConnections?.();
      closeTimer = setTimeout(resolve, 2_000);
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
