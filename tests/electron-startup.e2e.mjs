import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { closeElectron, launchElectron, processSnapshot, startupStage, waitForControl } = require('./electron-test-startup.cjs');
const { createStartupProgress } = require('../desktop/startup-progress.cjs');

test('主进程启动阶段仅在测试模式原子记录并限制文件权限', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-startup-progress-'));
  const progressPath = path.join(dataDir, 'startup-progress.json');
  try {
    createStartupProgress({ dataDir, enabled: false })('must-not-write');
    assert.equal(fs.existsSync(progressPath), false);
    const writeProgress = createStartupProgress({ dataDir, enabled: true });
    writeProgress('main-module-loaded');
    assert.equal(JSON.parse(fs.readFileSync(progressPath, 'utf8')).stage, 'main-module-loaded');
    writeProgress('control-file-written');
    assert.equal(JSON.parse(fs.readFileSync(progressPath, 'utf8')).stage, 'control-file-written');
    writeProgress('startup-complete');
    writeProgress('tab-profile-extensions');
    assert.equal(JSON.parse(fs.readFileSync(progressPath, 'utf8')).stage, 'startup-complete');
    assert.equal(fs.statSync(progressPath).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(dataDir), ['startup-progress.json']);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('启动超时诊断读取最后阶段且忽略损坏或缺失的阶段文件', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-startup-stage-'));
  try {
    assert.equal(startupStage(dataDir), '无阶段记录');
    fs.writeFileSync(path.join(dataDir, 'startup-progress.json'), JSON.stringify({ stage: 'tab-bootstrap-page-debugger', pid: 4321, token: 'secret' }));
    assert.equal(startupStage(dataDir), 'tab-bootstrap-page-debugger');
    assert.equal(startupStage(dataDir, 4322), '没有当前主进程的阶段记录');
    fs.writeFileSync(path.join(dataDir, 'startup-progress.json'), JSON.stringify({ stage: 'leak-secret\n', pid: 4321 }));
    assert.equal(startupStage(dataDir, 4321), '阶段不可用');
    fs.writeFileSync(path.join(dataDir, 'startup-progress.json'), '{');
    assert.equal(startupStage(dataDir), '阶段记录不可读取');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Electron 启动失败报告阶段和隔离数据诊断', async () => {
  await assert.rejects(
    () => launchElectron({ launch: async () => { throw new Error('fixture launch failure'); } }, {}, {
      label: 'startup-fixture', dataDir: os.tmpdir(), timeoutMs: 20,
    }),
    error => error.message.includes('阶段=Playwright Electron launch')
      && error.message.includes('fixture launch failure')
      && error.message.includes('control.json='),
  );
});

test('首个窗口等待失败单独标识并关闭已启动应用', async () => {
  let closed = false;
  const app = {
    on() {},
    process: () => null,
    windows: () => [],
    firstWindow: async options => {
      assert.equal(options.timeout, 25);
      throw new Error('fixture window timeout');
    },
    close: async () => { closed = true; },
  };
  await assert.rejects(
    () => launchElectron({ launch: async options => {
      assert.equal(options.timeout, 25);
      return app;
    } }, {}, { label: 'window-fixture', dataDir: os.tmpdir(), timeoutMs: 25 }),
    error => error.message.includes('阶段=首个桌面窗口') && error.message.includes('fixture window timeout'),
  );
  assert.equal(closed, true, '首个窗口等待失败后必须关闭应用');
});

test('启动失败在清理前记录操作系统进程快照且不包含命令行', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'fixture_process_secret'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const app = {
    on() {},
    process: () => child,
    windows: () => [],
    firstWindow: async () => { throw new Error('fixture window failure'); },
    close: async () => {
      if (child.exitCode !== null || child.signalCode) return;
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    },
  };
  try {
    await assert.rejects(
      () => launchElectron({ launch: async () => app }, {}, { label: 'snapshot-fixture', dataDir: os.tmpdir(), timeoutMs: 100 }),
      error => error.message.includes(`操作系统进程快照=pid=${child.pid}`)
        && (process.platform === 'win32'
          ? error.message.includes('tasklist=')
          : /ppid=\d+ state=\S+ cpu=\S+ elapsed=\S+/.test(error.message))
        && !error.message.includes('fixture_process_secret')
        && error.message.includes('fixture window failure'),
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

test('control.json 超时显示进程状态且不泄露凭据', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-startup-diagnostic-'));
  try {
    fs.writeFileSync(path.join(dataDir, 'control.json'), JSON.stringify({ token: 'stale-secret' }));
    fs.writeFileSync(path.join(dataDir, 'startup-progress.json'), JSON.stringify({ stage: 'restore-session-tab', pid: 4321, token: 'stage-secret' }));
    const app = { process: () => ({ exitCode: null, signalCode: null, pid: 4321, killed: false }) };
    await assert.rejects(
      () => waitForControl(app, dataDir, { label: 'control-fixture', previousToken: 'stale-secret', timeoutMs: 30 }),
      error => error.message.includes('阶段=等待 control.json')
        && error.message.includes('主进程启动位置=restore-session-tab')
        && error.message.includes('pid=4321 仍在运行')
        && !error.message.includes('stale-secret'),
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Electron 子进程退出时明确报告 control.json 尚未就绪', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-startup-exit-'));
  try {
    const app = { process: () => ({ exitCode: 7, signalCode: null, pid: 4322, killed: false }) };
    await assert.rejects(
      () => waitForControl(app, dataDir, { label: 'exit-fixture', timeoutMs: 1000 }),
      error => error.message.includes('主进程提前退出 (code=7')
        && error.message.includes('control.json=不存在'),
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('清理阶段超时会报告并结束挂起的 Electron 子进程', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const app = { process: () => child, windows: () => [], close: () => new Promise(() => {}) };
  try {
    await assert.rejects(
      () => closeElectron(app, { gracefulTimeoutMs: 20, terminateTimeoutMs: 1000 }),
      /app\.close\(\) 超过 20ms；已发送 SIGTERM/,
    );
    assert.ok(child.exitCode !== null || child.signalCode !== null, '清理后子进程必须退出');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

test('Electron 正常关闭后清除未使用的优雅关闭超时 timer', async () => {
  const child = new EventEmitter();
  Object.assign(child, { exitCode: null, signalCode: null, pid: 4323, killed: false });
  const app = {
    process: () => child,
    windows: () => [],
    close: async () => {
      child.exitCode = 0;
      child.emit('exit', 0, null);
    },
  };
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const created = new Set();
  const cleared = new Set();
  globalThis.setTimeout = (callback, delay, ...args) => {
    const timer = nativeSetTimeout(callback, delay, ...args);
    created.add(timer);
    return timer;
  };
  globalThis.clearTimeout = timer => {
    if (created.has(timer)) cleared.add(timer);
    return nativeClearTimeout(timer);
  };
  try {
    await closeElectron(app, { gracefulTimeoutMs: 1000, terminateTimeoutMs: 1000 });
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.clearTimeout = nativeClearTimeout;
  }
  assert.ok(created.size > 0, '测试必须观察到优雅关闭回退 timer');
  assert.equal(cleared.size, created.size, '正常关闭后不得留下未使用的回退 timer');
});
