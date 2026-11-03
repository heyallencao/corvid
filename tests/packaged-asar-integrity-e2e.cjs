const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const asar = require('@electron/asar');

const appBundle = path.resolve(__dirname, '..', 'dist', 'mac-arm64', 'Corvid.app');
const appExecutable = appPath => path.join(appPath, 'Contents', 'MacOS', 'Corvid');
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

async function waitForExit(child, timeoutMs) {
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

(async () => {
  assert.equal(process.platform, 'darwin', 'packaged ASAR integrity test requires macOS');
  assert.equal(process.arch, 'arm64', 'this test validates the Apple Silicon package');
  if (process.env.CORVID_REQUIRE_PACKAGED_SIGNATURE === '1') {
    console.log('SKIP ASAR tamper launch on Developer ID package: modifying a signed copy invalidates its outer code signature');
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-asar-integrity-'));
  const tamperedBundle = path.join(tempRoot, 'Corvid-tampered.app');
  const dataDir = path.join(tempRoot, 'data');
  const profileDir = path.join(tempRoot, 'profile');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  let child;
  try {
    fs.cpSync(appBundle, tamperedBundle, { recursive: true, verbatimSymlinks: true });
    const asarPath = path.join(tamperedBundle, 'Contents', 'Resources', 'app.asar');
    const rawHeader = asar.getRawHeader(asarPath);
    const entry = rawHeader.header.files.desktop?.files?.['main.cjs'];
    assert.ok(entry && Number.isSafeInteger(Number(entry.offset)), 'the packaged main process has a readable ASAR entry');
    const payloadOffset = 8 + rawHeader.headerSize + Number(entry.offset);
    const fileDescriptor = fs.openSync(asarPath, 'r+');
    try {
      const firstByte = Buffer.alloc(1);
      assert.equal(fs.readSync(fileDescriptor, firstByte, 0, 1, payloadOffset), 1);
      fs.writeSync(fileDescriptor, Buffer.from([firstByte[0] ^ 1]), 0, 1, payloadOffset);
    } finally {
      fs.closeSync(fileDescriptor);
    }

    const port = await reserveLoopbackPort();
    child = spawn(appExecutable(tamperedBundle), [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
    ], {
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1' },
      stdio: 'ignore',
    });
    const startedAt = Date.now();
    let debugEndpoint;
    while (Date.now() - startedAt < 8_000) {
      if (child.exitCode !== null || child.signalCode) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(250) });
        if (response.ok) { debugEndpoint = true; break; }
      } catch {}
      await delay(50);
    }
    assert.equal(debugEndpoint, undefined, 'the tampered app.asar must be rejected before a desktop renderer starts');
    const exited = await waitForExit(child, Math.max(0, 8_000 - (Date.now() - startedAt)));
    assert.equal(exited, true, 'the tampered packaged app must terminate within the bounded integrity check');
    assert.notEqual(child.exitCode, 0, 'the integrity failure does not appear as a successful application exit');
    assert.equal(fs.existsSync(path.join(dataDir, 'control.json')), false, 'the rejected package did not start its Corvid control service');
    console.log('PASS tampered app.asar is rejected before packaged Corvid starts');
  } finally {
    if (child && child.exitCode === null && !child.signalCode) {
      child.kill('SIGTERM');
      if (!(await waitForExit(child, 1_500)) && process.platform !== 'win32') {
        child.kill('SIGKILL');
        await waitForExit(child, 1_500);
      }
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
