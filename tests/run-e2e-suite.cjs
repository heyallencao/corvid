const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { acquireSuiteLock, getSharedLockDir } = require('./e2e-suite-lock.cjs');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const testScript = packageJson.scripts['test:serial'];
let child;
let receivedSignal = null;
let releaseLock;

function signalExitCode(signal) {
  return signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1;
}

function forwardSignal(signal) {
  if (receivedSignal) return;
  receivedSignal = signal;
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function main() {
  if (!testScript) throw new Error('package.json is missing the test:serial script');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => forwardSignal(signal));

  try {
    releaseLock = await acquireSuiteLock({
      lockDir: getSharedLockDir(projectRoot),
      shouldCancel: () => Boolean(receivedSignal),
      onWait: owner => {
        const detail = owner?.pid ? ' (当前运行 PID ' + owner.pid + ')' : '';
        console.log('等待同一仓库的另一条全量 E2E 链结束' + detail + '。');
      },
    });
    console.log('全量 E2E 互斥锁已取得。');

    const exitCode = await new Promise((resolve, reject) => {
      child = spawn(testScript, {
        cwd: projectRoot,
        env: process.env,
        shell: true,
        detached: process.platform !== 'win32',
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('close', (code, signal) => resolve(signal ? signalExitCode(signal) : code ?? 1));
    });
    process.exitCode = receivedSignal ? signalExitCode(receivedSignal) : exitCode;
  } finally {
    releaseLock?.();
  }
}

main().catch(error => {
  if (!receivedSignal) console.error(error);
  process.exitCode = receivedSignal ? signalExitCode(receivedSignal) : 1;
});
