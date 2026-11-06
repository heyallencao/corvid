const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { acquireSuiteLock } = require('./e2e-suite-lock.cjs');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('同一 checkout 的第二条全量链等待当前链释放互斥锁', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-e2e-suite-lock-'));
  const lockDir = path.join(root, 'suite.lock');
  try {
    const releaseFirst = await acquireSuiteLock({ lockDir, waitMs: 5 });
    let secondAcquired = false;
    const secondPromise = acquireSuiteLock({ lockDir, waitMs: 5 }).then(release => {
      secondAcquired = true;
      return release;
    });
    await delay(30);
    assert.equal(secondAcquired, false);

    releaseFirst();
    const releaseSecond = await secondPromise;
    assert.equal(secondAcquired, true);
    releaseSecond();
    assert.equal(fs.existsSync(lockDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('退出进程留下的锁会自动回收', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-e2e-suite-stale-'));
  const lockDir = path.join(root, 'suite.lock');
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({
    pid: 2_147_483_647,
    token: 'dead-process',
    startedAt: Date.now(),
  }));
  try {
    const release = await acquireSuiteLock({ lockDir, waitMs: 5 });
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8')).token, 'dead-process');
    release();
    assert.equal(fs.existsSync(lockDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
