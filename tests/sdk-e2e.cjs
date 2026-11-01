const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const electron = require('electron');

const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function exited(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}
async function deadline(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'corvid-sdk-e2e-'));
  const env = { ...process.env, CORVID_DATA_DIR: dir, CORVID_PORT: '0', CORVID_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electron, [root], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const appExit = exited(app);
  let appOutput = '';
  app.stdout.on('data', chunk => { appOutput += chunk; });
  app.stderr.on('data', chunk => { appOutput += chunk; });
  let config, sdk, sdkExit, cleanupError;
  try {
    config = await deadline((async () => {
      for (;;) {
        try { return JSON.parse(await fs.readFile(path.join(dir, 'control.json'), 'utf8')); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          if (app.exitCode !== null || app.signalCode !== null) throw new Error(`Electron exited before ready: ${appOutput}`);
          await delay(50);
        }
      }
    })(), 15000, `Electron did not become ready: ${dir}`);
    sdk = spawn(process.execPath, [path.join(root, 'sdk/e2e.js')], { cwd: root, env, stdio: 'inherit' });
    sdkExit = exited(sdk);
    const result = await deadline(sdkExit, 30000, 'SDK end-to-end test timed out');
    assert.equal(result.code, 0, `SDK test exited with code ${result.code}, signal ${result.signal}`);
  } finally {
    if (sdk && sdk.exitCode === null && sdk.signalCode === null) {
      sdk.kill('SIGTERM');
      try { await deadline(sdkExit, 3000, 'SDK process did not exit'); }
      catch { sdk.kill('SIGKILL'); await sdkExit.catch(() => {}); }
    }
    if (app.exitCode === null && app.signalCode === null && config) {
      try {
        const response = await fetch(`${config.baseUrl}/shutdown`, {
          method: 'POST', headers: { authorization: `Bearer ${config.token}` },
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error(`shutdown returned ${response.status}`);
      } catch (error) { cleanupError = error; app.kill('SIGTERM'); }
    }
    if (app.exitCode === null && app.signalCode === null && !config) app.kill('SIGTERM');
    try { await deadline(appExit, 5000, 'Electron did not exit'); }
    catch (error) { cleanupError ||= error; app.kill('SIGKILL'); await appExit.catch(() => {}); }
    if (config && !cleanupError) {
      try { await fs.access(path.join(dir, 'control.json')); cleanupError = new Error('Control file remained after shutdown'); }
      catch (error) { if (error.code !== 'ENOENT') cleanupError = error; }
    }
    await fs.rm(dir, { recursive: true, force: true });
    if (cleanupError) throw cleanupError;
  }
  console.log('PASS isolated SDK end-to-end');
})().catch(error => { console.error(error); process.exitCode = 1; });
