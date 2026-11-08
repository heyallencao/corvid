// Issue #431：首启三步引导（导入→模型→Agent）+ 新标签页设置待办/开始使用区 + 设置重放入口。
// 覆盖：全新安装向导流与跳过组合、onboarding.json 持久化、NTP 待办卡收敛与收起、开始使用区收起、设置重放、老用户零打扰、全程不创建授权客户端。
const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { closeElectron, launchElectron, waitForControl } = require('./electron-test-startup.cjs');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-first-run-'));
  const freshDir = path.join(root, 'fresh');
  const existingDir = path.join(root, 'existing');
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(freshDir); fs.mkdirSync(existingDir); fs.mkdirSync(homeDir);
  fs.writeFileSync(path.join(existingDir, 'profiles.json'), JSON.stringify([{ id: 'default', name: 'Existing', isDefault: true }]), { mode: 0o600 });
  let app;
  const readOnboarding = dataDir => JSON.parse(fs.readFileSync(path.join(dataDir, 'onboarding.json'), 'utf8'));

  // 本测试不依赖 OS 焦点（无原生对话框交互），直启 + control.json 轮询，避开 macOS 焦点检查的环境敏感族。
  async function boot(dataDir) {
    const app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, HOME: homeDir, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1', CORVID_TEST_CHROME_IMPORT: '1' },
    });
    await waitForControl(app, dataDir, { label: 'first-run-onboarding-e2e' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 100, y: 100, width: 1280, height: 850 }));
    return { app };
  }

  // 起始页渲染在 about:blank WebContentsView 的 closed shadow DOM 里：状态走 host dataset 镜像，动作走 browserHome.action（与按钮点击同一代码路径）。
  let config;
  const homeEval = async source => {
    const snapshot = await (await fetch(`${config.baseUrl}/rooms`, { headers: { authorization: `Bearer ${config.token}` } })).json();
    const tabId = snapshot.rooms.find(room => room.id === snapshot.activeRoomId)?.tabs.find(tab => tab.active)?.id;
    return app.evaluate(async ({ webContents }, { source, tabId }) => {
      for (const contents of webContents.getAllWebContents()) {
        let matches = false;
        try { matches = await contents.executeJavaScript(`document.querySelector('[data-corvid-home-surface]')?.dataset.tabId===${JSON.stringify(tabId)}`); } catch {}
        if (matches) return contents.executeJavaScript(source);
      }
      return null;
    }, { source, tabId });
  };
  const homeDataset = async name => homeEval(`document.querySelector('[data-corvid-home-surface]').dataset[${JSON.stringify(name)}]`);
  const until = async (fn, label, timeout = 15000) => { for (let i = 0; i < timeout / 50; i++) { const value = await fn(); if (value) return value; await delay(50); } throw new Error(`Timed out waiting for ${label}`); };
  const adminClients = async () => (await (await fetch(`${config.baseUrl}/agent-clients`, { headers: { authorization: `Bearer ${config.token}` } })).json()).clients;

  try {
    ({ app } = await boot(freshDir));
    const shell = await app.firstWindow();
    for (let i = 0; i < 200; i++) { try { config = JSON.parse(fs.readFileSync(path.join(freshDir, 'control.json'), 'utf8')); break; } catch { await delay(25); } }
    assert.ok(config?.token, 'isolated data directory publishes the administrator credential');

    // 1. 全新安装：欢迎对话框（导入步）→ 稍后不弹向导；从起始页待办卡「继续设置」进入向导：模型稍后 → Agent 稍后 → 完成。
    await shell.locator('#chrome-import-onboarding').waitFor({ state: 'visible' });
    assert.equal(await shell.locator('#first-run-onboarding').evaluate(element => element.open), false, 'wizard waits behind the import welcome');
    await shell.locator('#skip-chrome-import').click();
    await until(async () => (await homeDataset('homeSetup')) === 'import,model,agent', 'start page setup checklist');
    assert.equal(await shell.locator('#first-run-onboarding').evaluate(element => element.open), false, 'skipping the welcome does not pop the wizard modal');
    await homeEval(`window.browserHome.action('setupWizard')`);
    await shell.locator('#first-run-onboarding').waitFor({ state: 'visible' });
    assert.equal(await shell.locator('#first-run-step-model').isVisible(), true, 'wizard starts at the model step');
    await until(async () => (await shell.locator('#first-run-progress').textContent()).includes('1'), 'wizard progress line');
    await shell.locator('#later-first-run-model').click();
    await until(async () => !(await shell.locator('#first-run-step-model').isVisible()), 'postponing the model step advances the wizard');
    assert.equal(await shell.locator('#first-run-step-agent').isVisible(), true, 'agent step follows the model step');
    await shell.locator('#later-first-run-agent').click();
    await until(async () => await shell.locator('#first-run-step-done').isVisible(), 'wizard reaches the done state');
    await shell.locator('#close-first-run').click();
    await until(() => { try { const saved = readOnboarding(freshDir); return saved.steps.model === 'skipped' && saved.steps.agent === 'skipped'; } catch { return false; } }, 'onboarding.json records the skipped steps');

    // 2. 起始页设置待办卡：三个未完成项，逐条点击打开对应设置面并标记完成。
    await until(async () => (await homeDataset('homeSetup')) === 'import,model,agent', 'start page setup checklist');
    await homeEval(`window.browserHome.action('setup','model')`);
    await shell.locator('#pi-model-settings').waitFor({ state: 'visible' });
    await shell.locator('#close-pi-model-settings').click();
    await shell.locator('#pi-model-settings').waitFor({ state: 'hidden' });
    await until(() => { try { return readOnboarding(freshDir).steps.model === 'done'; } catch { return false; } }, 'model step completes from the checklist');
    await until(async () => (await homeDataset('homeSetup')) === 'import,agent', 'model item leaves the checklist');
    await homeEval(`window.browserHome.action('setup','agent')`);
    await shell.locator('#agent-access-dialog').waitFor({ state: 'visible' });
    await shell.locator('#close-agent-access').click();
    await shell.locator('#agent-access-dialog').waitFor({ state: 'hidden' });
    await until(() => { try { return readOnboarding(freshDir).steps.agent === 'done'; } catch { return false; } }, 'agent step completes from the checklist');
    await until(async () => (await homeDataset('homeSetup')) === 'import', 'agent item leaves the checklist');
    await homeEval(`window.browserHome.action('setup','import')`);
    await shell.locator('#chrome-import').waitFor({ state: 'visible' });
    await shell.locator('#cancel-chrome-import').click();

    // 3. 开始使用区：示例任务与快捷键可见，收起后持久化。
    assert.equal(await homeDataset('welcomeDismissed'), 'false', 'getting-started section starts visible');
    await homeEval(`window.browserHome.action('dismissWelcome')`);
    await until(async () => (await homeDataset('welcomeDismissed')) === 'true', 'welcomeDismissed persists');

    // 4. 收起设置待办并重启：向导与欢迎对话框都不再自动出现，待办卡保持收起。
    await homeEval(`window.browserHome.action('dismissSetup')`);
    await until(async () => (await homeDataset('setupDismissed')) === 'true', 'setupDismissed persists');
    await closeElectron(app, { label: 'first-run-onboarding-e2e' }); app = undefined;
    ({ app } = await boot(freshDir));
    const restartedShell = await app.firstWindow();
    for (let i = 0; i < 200; i++) { try { config = JSON.parse(fs.readFileSync(path.join(freshDir, 'control.json'), 'utf8')); break; } catch { await delay(25); } }
    assert.ok(config?.token, 'relaunched install republishes the administrator credential');
    await delay(800);
    assert.equal(await restartedShell.locator('#chrome-import-onboarding').evaluate(element => element.open), false, 'welcome dialog does not reappear after completion');
    assert.equal(await restartedShell.locator('#first-run-onboarding').evaluate(element => element.open), false, 'postponed steps do not re-open the wizard on relaunch');
    await until(async () => (await homeDataset('setupDismissed')) === 'true', 'setup checklist stays dismissed after relaunch');
    assert.equal(await homeDataset('welcomeDismissed'), 'true', 'getting-started section stays dismissed after relaunch');

    // 5. 设置重放入口：完整状态走「一切就绪」收尾。
    await restartedShell.locator('#library-trigger').click();
    await restartedShell.locator('#show-settings').click();
    await restartedShell.locator('#settings').waitFor({ state: 'visible' });
    await restartedShell.locator('#reopen-first-run').click();
    await restartedShell.locator('#first-run-onboarding').waitFor({ state: 'visible' });
    assert.equal(await restartedShell.locator('#first-run-step-done').isVisible(), true, 'replaying a finished setup lands on the done state');
    await restartedShell.locator('#close-first-run').click();
    await restartedShell.locator('#settings [data-i18n="save"]').click().catch(() => {});
    await restartedShell.locator('#cancel-settings').click().catch(() => {});
    await closeElectron(app, { label: 'first-run-onboarding-e2e' }); app = undefined;

    // 6. 老用户（已有 Corvid 数据）：欢迎与向导零打扰；开始使用区可见、可收起。
    ({ app } = await boot(existingDir));
    const existingShell = await app.firstWindow();
    config = JSON.parse(fs.readFileSync(path.join(existingDir, 'control.json'), 'utf8'));
    await delay(800);
    assert.equal(await existingShell.locator('#chrome-import-onboarding').evaluate(element => element.open), false, 'existing installs never see the import welcome');
    assert.equal(await existingShell.locator('#first-run-onboarding').evaluate(element => element.open), false, 'existing installs never see the setup wizard');
    await until(async () => (await homeDataset('welcomeDismissed')) === 'false', 'existing installs still see the getting-started section');
    assert.notEqual(await homeDataset('homeSetup'), 'import,model,agent', 'existing installs have no setup checklist');
    await existingShell.locator('#library-trigger').click();
    await existingShell.locator('#show-settings').click();
    await existingShell.locator('#settings').waitFor({ state: 'visible' });
    await existingShell.locator('#reopen-first-run').click();
    await existingShell.locator('#first-run-onboarding').waitFor({ state: 'visible' });
    await existingShell.locator('#close-first-run').click();

    // 7. 全程 fail-closed：没有创建任何外部 Agent 授权客户端，也没有写模型凭据。
    assert.equal((await adminClients()).length, 0, 'onboarding flows never create Agent clients');

    console.log('PASS first-run onboarding: welcome→wizard sequencing, skipped/done persistence, start-page checklist convergence and dismissal, getting-started dismissal, settings replay, existing-install zero disturbance, no side effects');
  } finally {
    if (app) await closeElectron(app, { label: 'first-run-onboarding-e2e' }).catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
