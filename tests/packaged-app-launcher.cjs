const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode) return true;
  return new Promise(resolve => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onExit = () => finish(true);
    function finish(exited) {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    }
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode) finish(true);
  });
}

async function launchPackagedApp({ executablePath, dataDir, args = [], env = process.env, timeoutMs = 20_000 }) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-packaged-profile-'));
  let browser;
  let child;
  try {
    const port = await reserveLoopbackPort();
    child = spawn(executablePath, [...args, `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let childOutput = '';
    for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { childOutput = `${childOutput}${chunk}`.slice(-16_384); });
    child.on('error', error => { childOutput = `${childOutput}\n${error.message}`.slice(-16_384); });
    const endpoint = `http://127.0.0.1:${port}`;
    const startedAt = Date.now();
    let version;
    while (Date.now() - startedAt < timeoutMs) {
      if (child.exitCode !== null || child.signalCode) throw new Error(`packaged Corvid exited before CDP became available (code=${child.exitCode}, signal=${child.signalCode}); output=${childOutput}`);
      try {
        const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { version = await response.json(); break; }
      } catch {}
      await delay(50);
    }
    if (!version) throw new Error(`packaged Corvid did not expose its loopback renderer endpoint within ${timeoutMs} ms; output=${childOutput}`);

    browser = await chromium.connectOverCDP(endpoint);
    const contexts = browser.contexts();
    let page;
    while (Date.now() - startedAt < timeoutMs) {
      page = contexts.flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('file://'));
      if (page) break;
      if (child.exitCode !== null || child.signalCode) throw new Error(`packaged Corvid exited before opening its desktop page (code=${child.exitCode}, signal=${child.signalCode}); output=${childOutput}`);
      await delay(50);
    }
    if (!page) throw new Error(`packaged Corvid did not open a desktop page within ${timeoutMs} ms; output=${childOutput}`);
    await page.locator('#room-dock').waitFor({ timeout: Math.max(1, timeoutMs - (Date.now() - startedAt)) });

    const controlPath = path.join(dataDir, 'control.json');
    let control;
    while (Date.now() - startedAt < timeoutMs) {
      try {
        control = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
        if (control.baseUrl && control.token) break;
      } catch {}
      await delay(50);
    }
    if (!control?.baseUrl || !control?.token) throw new Error(`packaged Corvid did not create a valid isolated control file within ${timeoutMs} ms; output=${childOutput}`);

    let closed = false;
    const app = {
      page,
      control,
      process: () => child,
      evaluate: fn => page.evaluate(fn),
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await fetch(`${control.baseUrl}/shutdown`, {
            method: 'POST',
            headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
            body: '{}',
            signal: AbortSignal.timeout(1_000),
          });
        } catch {}
        if (!(await waitForChildExit(child, 5_000))) {
          child.kill('SIGTERM');
          if (!(await waitForChildExit(child, 1_500)) && process.platform !== 'win32') {
            child.kill('SIGKILL');
            await waitForChildExit(child, 1_500);
          }
        }
        await browser.close().catch(() => {});
        fs.rmSync(profileDir, { recursive: true, force: true });
      },
    };
    return app;
  } catch (error) {
    if (child && child.exitCode === null && !child.signalCode) {
      child.kill('SIGTERM');
      if (!(await waitForChildExit(child, 1_500)) && process.platform !== 'win32') {
        child.kill('SIGKILL');
        await waitForChildExit(child, 1_500);
      }
    }
    await browser?.close().catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { launchPackagedApp };
