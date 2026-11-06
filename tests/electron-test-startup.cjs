const fs = require('node:fs');
const path = require('node:path');

const diagnostics = new WeakMap();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`等待超过 ${timeoutMs}ms`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function processState(app) {
  let child;
  try { child = app?.process?.(); } catch (error) { return `读取进程失败：${error.message}`; }
  if (!child) return '进程信息不可用';
  if (child.exitCode !== null || child.signalCode) return `pid=${child.pid} 已退出(code=${child.exitCode}, signal=${child.signalCode}, killed=${child.killed})`;
  return `pid=${child.pid} 仍在运行(killed=${child.killed})`;
}

function appendLog(app, message) {
  const state = app && diagnostics.get(app);
  if (!state || !message) return;
  state.logs.push(String(message).slice(0, 500));
  if (state.logs.length > 40) state.logs.shift();
}

function windowState(app) {
  try {
    return app.windows().map((page, index) => {
      try { return `${index}:${page.isClosed() ? 'closed' : page.url()}`; }
      catch { return `${index}:状态不可用`; }
    }).join(', ') || '无窗口';
  } catch (error) {
    return `读取窗口状态失败：${error.message}`;
  }
}

function recentLogs(app) {
  const logs = (app && diagnostics.get(app)?.logs || []).slice(-12);
  return logs.length ? logs.join(' | ') : '无进程/页面日志';
}

function controlState(dataDir) {
  const controlPath = path.join(dataDir, 'control.json');
  try {
    const value = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
    return value.token ? '存在且格式有效' : '存在但缺少 token';
  } catch (error) {
    if (error.code === 'ENOENT') return '不存在';
    return `存在但无法读取或解析：${error.message}`;
  }
}

function startupStage(dataDir, expectedPid) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(dataDir, 'startup-progress.json'), 'utf8'));
    if (Number.isInteger(expectedPid) && value.pid !== expectedPid) return '没有当前主进程的阶段记录';
    return typeof value.stage === 'string' && /^[a-z0-9-]{1,80}$/.test(value.stage) ? value.stage : '阶段不可用';
  } catch (error) {
    return error.code === 'ENOENT' ? '无阶段记录' : '阶段记录不可读取';
  }
}

function startupError({ label, stage, app, dataDir, startedAt, cause, cleanupError }) {
  let child;
  try { child = app?.process?.(); } catch {}
  return new Error([
    `Electron E2E 启动失败：${label}`,
    `阶段=${stage}；耗时=${Date.now() - startedAt}ms；数据目录=${dataDir}`,
    `主进程启动位置=${startupStage(dataDir, child?.pid)}`,
    `control.json=${controlState(dataDir)}；主进程=${processState(app)}`,
    `窗口=${windowState(app)}；主进程最近日志：${recentLogs(app)}`,
    `原因：${cause?.message || cause}`,
    ...(cleanupError ? [`启动失败后的清理也未正常完成：${cleanupError.message}`] : []),
  ].join('\n'), { cause });
}

function observeApp(app, label) {
  const state = { label, logs: [] };
  diagnostics.set(app, state);
  app.on('console', message => appendLog(app, `[main:${message.type()}] ${message.text()}`));
  const attachPage = page => {
    page.on('console', message => appendLog(app, `[renderer:${message.type()}] ${message.text()}`));
    page.on('pageerror', error => appendLog(app, `[renderer:error] ${error.message}`));
    page.on('close', () => {
      let url = '未知页面';
      try { url = page.url(); } catch {}
      appendLog(app, `[window] closed ${url}`);
    });
    let url = '未知页面';
    try { url = page.url(); } catch {}
    appendLog(app, `[window] opened ${url}`);
  };
  try { for (const page of app.windows()) attachPage(page); } catch (error) { appendLog(app, `[window] 枚举失败：${error.message}`); }
  app.on('window', attachPage);
  let child;
  try { child = app.process(); } catch {}
  child?.stdout?.on('data', chunk => appendLog(app, `[stdout] ${chunk.toString()}`));
  child?.stderr?.on('data', chunk => appendLog(app, `[stderr] ${chunk.toString()}`));
}

async function focusElectronWindow(app, shell, { label = 'Electron E2E', timeoutMs = 5000 } = {}) {
  if (process.platform !== 'darwin') return;
  let nativeWindow;
  try {
    nativeWindow = await app.browserWindow(shell);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await app.evaluate(({ app: electronApp }) => electronApp.focus({ steal: true }));
      await nativeWindow.evaluate(window => { window.show(); window.focus(); });
      await shell.bringToFront();
      const [windowFocused, pageFocused] = await Promise.all([
        nativeWindow.evaluate(window => window.isFocused()),
        shell.evaluate(() => document.hasFocus()),
      ]);
      if (windowFocused && pageFocused) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('BrowserWindow 与 shell 页面未同时取得焦点');
  } catch (cause) {
    const focusState = await Promise.all([
      nativeWindow?.evaluate(window => ({ visible: window.isVisible(), focused: window.isFocused(), bounds: window.getBounds() })).catch(error => `读取目标窗口失败：${error.message}`) ?? Promise.resolve('目标窗口不可用'),
      shell.evaluate(() => document.hasFocus()).catch(() => false),
    ]);
    throw new Error(`macOS E2E 窗口未取得原生焦点（${label}）；目标窗口=${JSON.stringify(focusState[0])}；document.hasFocus=${focusState[1]}；原因=${cause.message}`, { cause });
  }
}

async function launchElectron(launcher, options, { label, dataDir, timeoutMs = 20000 }) {
  const startedAt = Date.now();
  let app;
  let stage = 'Playwright Electron launch';
  try {
    app = await launcher.launch({ ...options, timeout: timeoutMs });
    observeApp(app, label);
    stage = '首个桌面窗口';
    const shell = await app.firstWindow({ timeout: timeoutMs });
    stage = 'macOS 原生窗口焦点';
    const focusTimeoutMs = Number(process.env.CORVID_TEST_NATIVE_FOCUS_TIMEOUT_MS) || 15000;
    await focusElectronWindow(app, shell, { label, timeoutMs: Math.min(timeoutMs, focusTimeoutMs) });
    return { app, shell, startedAt };
  } catch (cause) {
    let cleanupError;
    if (app) await closeElectron(app).catch(error => { cleanupError = error; });
    throw startupError({ label, stage, app, dataDir, startedAt, cause, cleanupError });
  }
}

async function waitForControl(app, dataDir, { label, previousToken, timeoutMs = 10000 } = {}) {
  const startedAt = Date.now();
  const controlPath = path.join(dataDir, 'control.json');
  while (Date.now() - startedAt < timeoutMs) {
    const child = app.process();
    if (child && (child.exitCode !== null || child.signalCode)) {
      throw startupError({ label, stage: '等待 control.json', app, dataDir, startedAt, cause: new Error(`Electron 主进程提前退出 (code=${child.exitCode}, signal=${child.signalCode})`) });
    }
    try {
      const value = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
      if (value.token && value.token !== previousToken) return value;
    } catch {}
    await delay(50);
  }
  throw startupError({ label, stage: '等待 control.json', app, dataDir, startedAt, cause: new Error(`超过 ${timeoutMs}ms 未产生新的控制凭据`) });
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode) return true;
  return withTimeout(new Promise(resolve => {
    const onExit = () => resolve(true);
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode) {
      child.removeListener('exit', onExit);
      resolve(true);
    }
  }), timeoutMs).catch(() => false);
}

async function closeElectron(app, { gracefulTimeoutMs = 3000, terminateTimeoutMs = 1500 } = {}) {
  if (!app) return;
  let child;
  try { child = app.process(); } catch {}
  if (!child || child.exitCode !== null || child.signalCode) {
    await withTimeout(Promise.resolve().then(() => app.close()), Math.min(gracefulTimeoutMs, 500)).catch(() => {});
    return;
  }

  let closeError;
  let closeSettled = false;
  const graceful = Promise.resolve().then(() => app.close()).then(
    () => { closeSettled = true; },
    error => { closeError = error; closeSettled = true; },
  );
  let gracefulTimer;
  await Promise.race([graceful, new Promise(resolve => { gracefulTimer = setTimeout(resolve, gracefulTimeoutMs); })]);
  clearTimeout(gracefulTimer);
  const closeTimedOut = !closeSettled;
  if (!closeTimedOut && !closeError && await waitForExit(child, terminateTimeoutMs)) return;

  const reason = closeTimedOut
    ? `app.close() 超过 ${gracefulTimeoutMs}ms`
    : closeError ? `app.close() 失败：${closeError.message}` : `app.close() 返回后主进程超过 ${terminateTimeoutMs}ms 仍未退出`;
  const processBeforeTermination = processState(app);
  const windowsBeforeTermination = windowState(app);
  const logsBeforeTermination = recentLogs(app);
  child.kill();
  let termination = 'SIGTERM';
  if (!(await waitForExit(child, terminateTimeoutMs)) && process.platform !== 'win32') {
    child.kill('SIGKILL');
    termination = 'SIGKILL';
  }
  if (!(await waitForExit(child, terminateTimeoutMs))) throw new Error(`清理失败：${reason}；无法结束 Electron E2E 子进程 pid=${child.pid}；关闭前进程=${processBeforeTermination}；窗口=${windowsBeforeTermination}；日志=${logsBeforeTermination}`);
  throw new Error(`Electron E2E 清理异常：${reason}；已发送 ${termination} 结束 pid=${child.pid}；关闭前进程=${processBeforeTermination}；窗口=${windowsBeforeTermination}；日志=${logsBeforeTermination}`);
}

module.exports = { closeElectron, focusElectronWindow, launchElectron, startupStage, waitForControl };
