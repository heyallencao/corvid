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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-native-controls-'));
  fs.writeFileSync(path.join(dataDir, 'ui-preferences.json'), JSON.stringify({ schemaVersion: 1, uiLocale: 'zh-CN' }), { mode: 0o600 });
  let app;

  async function probeStyle(shell, selector, probeCss) {
    return shell.evaluate(({ selector, probeCss }) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const probe = document.createElement('span');
      probe.style.cssText = probeCss;
      document.body.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const style = getComputedStyle(element);
      return { expected, background: style.backgroundColor, appearance: style.appearance, backgroundImage: style.backgroundImage, minHeight: style.minHeight, height: element.getBoundingClientRect().height };
    }, { selector, probeCss });
  }

  // focus 伪类断言依赖窗口持有 OS 焦点；先显式前置窗口并等待 hasFocus。
  async function ensureWindowFocus(app, shell) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await shell.waitForFunction(() => document.hasFocus(), undefined, { timeout: 5000 }).catch(() => {});
    return shell.evaluate(() => document.hasFocus());
  }

  try {
    const launched = await launchElectron(_electron, {
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1', CORVID_TEST_CHROME_IMPORT: '1' },
    }, { label: 'native-controls-e2e', dataDir });
    app = launched.app;
    const shell = launched.shell;
    await waitForControl(app, dataDir, { label: 'native-controls-e2e' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 100, y: 100, width: 1024, height: 700 }));

    const qaDir = process.env.CORVID_NATIVE_CONTROLS_QA_DIR;
    const capture = async name => {
      if (!qaDir) return;
      fs.mkdirSync(qaDir, { recursive: true });
      await shell.screenshot({ path: path.join(qaDir, name) });
    };

    for (const locale of ['zh-CN', 'en']) {
      for (const colorScheme of ['light', 'dark']) {
        if (locale === 'en' || colorScheme === 'dark') {
          await shell.locator('html').evaluate((element, next) => window.browserShell.invoke('setUiLocale', { locale: next }), locale);
          await shell.waitForFunction(expected => document.documentElement.lang === expected, locale);
          await shell.emulateMedia({ colorScheme });
          await delay(120);
        }
        const caretStroke = colorScheme === 'dark' ? '%23a4afbf' : '%236e7786';

        // 1. onboarding 仅首启出现：主按钮依赖 class 而非 DOM 末位，并保持 accent 表面。
        const onboarding = shell.locator('#chrome-import-onboarding');
        if (await onboarding.isVisible()) {
          assert.equal(await shell.locator('#begin-chrome-import').getAttribute('class'), 'primary-action', `${locale}: onboarding primary action is marked by class`);
          const primary = await probeStyle(shell, '#begin-chrome-import', 'background:var(--accent-solid)');
          assert.equal(primary.background, primary.expected, `${locale}: onboarding primary keeps the accent surface`);
          await capture(`issue-208-onboarding-${locale}-${colorScheme}.png`);
          // showModal 使对话框外文档 inert，先走「稍后」再验证外部控件焦点。
          await shell.locator('#skip-chrome-import').click();
          await onboarding.waitFor({ state: 'hidden', timeout: 5000 });
        }

        // 2. 身份下拉：appearance none + 自绘 caret + 包装层 focus-within 可见。
        const profile = await probeStyle(shell, '#profile-select', '');
        assert.equal(profile.appearance, 'none', `${locale}: profile select unloads the native appearance`);
        assert.ok(profile.backgroundImage.includes('data:image/svg+xml'), `${locale}: profile select draws its own caret`);
        assert.ok(profile.backgroundImage.includes(caretStroke), `${locale}: caret artwork follows the color scheme`);
        assert.ok(Math.abs(profile.height - 28) <= 2, `${locale}: profile select sits on the 28px input tier (observed ${profile.height.toFixed(1)})`);
        assert.equal(await ensureWindowFocus(app, shell), true, `${locale}: test window holds OS focus for focus-visible contracts`);
        await shell.locator('#profile-select').evaluate(element => element.focus());
        const switcherFocus = await shell.evaluate(() => {
          const switcher = document.querySelector('.profile-switcher');
          const style = getComputedStyle(switcher);
          return { within: switcher.matches(':focus-within'), shadow: style.boxShadow, border: style.borderColor };
        });
        assert.equal(switcherFocus.within, true, `${locale}: focusing the select lights up the switcher`);
        assert.notEqual(switcherFocus.shadow, 'none', `${locale}: keyboard focus on the profile select is visible`);

        // 3. 设置中心验证 select/checkbox 契约。
        await shell.locator('#show-settings').click();
        await shell.locator('#settings[open]').waitFor({ timeout: 5000 });
        const localeSelect = await probeStyle(shell, '#ui-locale', '');
        assert.equal(localeSelect.appearance, 'none', `${locale}: settings selects use the unified appearance`);
        assert.ok(localeSelect.backgroundImage.includes(caretStroke), `${locale}: settings select caret follows the scheme`);
        assert.ok(Math.abs(localeSelect.height - 36) <= 2, `${locale}: dialog selects stay on the 36px tier (observed ${localeSelect.height.toFixed(1)})`);
        // 同一 JS 轮内完成点击与取样式，避免异步 draw 重置草稿（applySettingsDraft）；恢复初始勾选态。
        const checked = await shell.evaluate(() => {
          const element = document.querySelector('#ask-where-to-save');
          const probe = document.createElement('span');
          probe.style.cssText = 'background:var(--accent-solid)';
          document.body.append(probe);
          const expected = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const original = element.checked;
          element.checked = false;
          element.click();
          const style = getComputedStyle(element);
          const result = { checked: element.checked, appearance: style.appearance, background: style.backgroundColor, expected };
          element.checked = original;
          return result;
        });
        assert.equal(checked.checked, true, `${locale}: toggling the checkbox marks it checked`);
        assert.equal(checked.appearance, 'none', `${locale}: checkboxes use the drawn box`);
        assert.equal(checked.background, checked.expected, `${locale}: checked checkbox adopts the accent surface`);
        await shell.locator('#settings-nav-appearance').click();
        await shell.locator('#theme-preference').waitFor({ state: 'visible', timeout: 10_000 });
        const themeSelect = await probeStyle(shell, '#theme-preference', '');
        assert.ok(Math.abs(themeSelect.height - 36) <= 2, `${locale}: appearance selects stay on the 36px tier`);
        await capture(`issue-208-settings-${locale}-${colorScheme}.png`);
        await shell.keyboard.press('Escape');
        await delay(120);

        // 4. Agent 工作台模型选择器触发器收敛到 32px。
        await shell.locator('#show-pi-workbench').click();
        await shell.locator('#library[data-kind="pi-workbench"]').waitFor({ timeout: 5000 });
        await shell.locator('#pi-task-form .pi-model-select').waitFor({ state: 'visible', timeout: 10_000 });
        const modelTrigger = await probeStyle(shell, '#pi-task-form .pi-model-select', '');
        assert.ok(Math.abs(modelTrigger.height - 32) <= 2, `${locale}: model picker trigger sits on the 32px tier (observed ${modelTrigger.height.toFixed(1)})`);
        await shell.locator('#close-library').click();
        await delay(100);
      }
    }
    await shell.emulateMedia({ colorScheme: 'light' });
    console.log('PASS unified native control surfaces: select caret, checkbox drawing, focus-within switcher, 28/32/36 input tiers');
  } finally {
    if (app) await closeElectron(app).catch(error => { console.error(error); process.exitCode = 1; });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
