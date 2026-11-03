const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launch(dataDir) {
  const extraArgs = String(process.env.CORVID_ELECTRON_EXTRA_ARGS || '').split(/\s+/).filter(Boolean);
  const app = await _electron.launch({ executablePath: electronPath, args: [...extraArgs, project], env: {
    ...process.env,
    CORVID_DATA_DIR: dataDir,
    CORVID_PORT: '0',
    CORVID_TEST_MODE: '1',
  } });
  for (let i = 0; i < 200 && !fs.existsSync(path.join(dataDir, 'control.json')); i++) await delay(25);
  assert.ok(fs.existsSync(path.join(dataDir, 'control.json')), 'the isolated Corvid control service starts');
  return app;
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
  const credentialPath = path.join(dataDir, 'agent-credentials.json');
  const secret = `sk-test-${process.platform}-os-store-roundtrip`;
  let app;
  try {
    app = await launch(dataDir);
    assert.equal(await app.evaluate(({ safeStorage }) => safeStorage.isAsyncEncryptionAvailable()), true,
      'the running Electron build reports asynchronous OS credential protection available');
    let shell = await openApiKeyProvider(app);
    await shell.locator('.pi-model-key').fill(secret);
    await shell.getByRole('button', { name: /连接 Key|Connect key/i }).click();
    await shell.getByRole('button', { name: /退出|Sign out/i }).waitFor();

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
    assert.equal(await app.evaluate(({ safeStorage }) => safeStorage.isAsyncEncryptionAvailable()), true);
    shell = await openApiKeyProvider(app);
    await shell.getByRole('button', { name: /退出|Sign out/i }).waitFor();
    assert.equal(await shell.locator('.pi-model-key').count(), 0,
      'the persisted credential is readable by the OS-protected store after an Electron restart');
    await shell.getByRole('button', { name: /退出|Sign out/i }).click();
    await shell.getByRole('button', { name: /连接 Key|Connect key/i }).waitFor();
    const afterLogout = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    assert.equal(afterLogout.providers.anthropic, undefined, 'logout removes the credential from Corvid persistence');
    console.log(`PASS ${process.platform} Electron safeStorage availability, encrypted persistence, restart read, and logout deletion`);
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
