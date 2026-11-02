const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');
const assert = require('node:assert/strict');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-data-directory-'));
  const dataDir = path.join(parent, 'read-only-data');
  fs.mkdirSync(dataDir);
  fs.chmodSync(dataDir, 0o500);
  let child;
  try {
    child = spawn(electron, ['.'], {
      cwd: project,
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exit = once(child, 'exit');
    const result = await Promise.race([
      exit.then(([code, signal]) => ({ code, signal })),
      delay(5_000).then(() => ({ timeout: true })),
    ]);
    if (result.timeout) {
      child.kill('SIGKILL');
      await exit;
      throw new Error(`Corvid did not fail promptly for a read-only data directory: ${stderr}`);
    }
    assert.equal(result.code, 1, stderr);
    assert.equal(result.signal, null);
    assert.match(stderr, /Corvid 无法使用数据目录/);
    assert.match(stderr, new RegExp(dataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(stderr, /EACCES|permission denied/i);
    assert.deepEqual(fs.readdirSync(dataDir), [], 'startup leaves no partial state or write-check file');
    console.log('PASS read-only Corvid data directory fails promptly with a path-specific diagnostic and no partial files');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    fs.chmodSync(dataDir, 0o700);
    fs.rmSync(parent, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
