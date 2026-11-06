const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function readOwner(lockDir) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) return null;
    if (typeof owner.token !== 'string' || !Number.isFinite(owner.startedAt)) return null;
    return owner;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function moveStaleLock(lockDir, expectedToken) {
  const quarantine = lockDir + '.stale-' + crypto.randomUUID();
  try {
    fs.renameSync(lockDir, quarantine);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EEXIST') return false;
    throw error;
  }

  const movedOwner = readOwner(quarantine);
  if ((expectedToken && movedOwner?.token !== expectedToken) || (!expectedToken && movedOwner)) {
    try {
      if (!fs.existsSync(lockDir)) fs.renameSync(quarantine, lockDir);
    } catch {}
    return false;
  }

  fs.rmSync(quarantine, { recursive: true, force: true });
  return true;
}

async function acquireSuiteLock({
  lockDir,
  waitMs = 1000,
  staleOwnerMs = 6 * 60 * 60 * 1000,
  onWait = () => {},
  shouldCancel = () => false,
} = {}) {
  if (!lockDir) throw new TypeError('lockDir is required');
  const token = crypto.randomUUID();
  let lastNoticeAt = 0;

  while (true) {
    if (shouldCancel()) throw new Error('E2E suite lock acquisition cancelled');

    try {
      fs.mkdirSync(lockDir);
      try {
        fs.writeFileSync(
          path.join(lockDir, 'owner.json'),
          JSON.stringify({ pid: process.pid, token, startedAt: Date.now() }),
          { flag: 'wx', mode: 0o600 },
        );
      } catch (error) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        throw error;
      }

      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (readOwner(lockDir)?.token === token) {
          fs.rmSync(lockDir, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    const owner = readOwner(lockDir);
    if (owner && !isProcessAlive(owner.pid)) {
      if (moveStaleLock(lockDir, owner.token)) continue;
    } else if (owner && Date.now() - owner.startedAt > staleOwnerMs) {
      if (moveStaleLock(lockDir, owner.token)) continue;
    } else if (!owner) {
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > 30_000) {
          if (moveStaleLock(lockDir, null)) continue;
        }
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
    }

    if (Date.now() - lastNoticeAt >= 10_000) {
      lastNoticeAt = Date.now();
      onWait(owner);
    }
    await delay(waitMs);
  }
}

function getSharedLockDir(projectRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  let repositoryIdentity = packageJson.name;
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const origin = remote
      .replace(/^git@([^:]+):/i, '$1/')
      .replace(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?/i, '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    if (origin) repositoryIdentity += ':' + origin;
  } catch {
    repositoryIdentity += ':' + path.resolve(projectRoot);
  }
  const digest = crypto.createHash('sha256').update(repositoryIdentity).digest('hex').slice(0, 20);
  return path.join(os.tmpdir(), packageJson.name + '-e2e-suite-' + digest + '.lock');
}

module.exports = { acquireSuiteLock, getSharedLockDir };
