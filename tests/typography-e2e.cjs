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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-typography-'));
  fs.writeFileSync(path.join(dataDir, 'ui-preferences.json'), JSON.stringify({ schemaVersion: 1, uiLocale: 'zh-CN' }), { mode: 0o600 });
  let app;

  async function inspectVisibleText(shell) {
    return shell.evaluate(() => {
      const text = [...document.querySelectorAll('body *')].filter(element => {
        if (element.children.length || !element.textContent.trim()) return false;
        const style = getComputedStyle(element), rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.fontSize) > 0 && rect.width > 0 && rect.height > 0;
      }).map(element => ({ text: element.textContent.trim(), fontSize: Number.parseFloat(getComputedStyle(element).fontSize) }));
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        locale: document.documentElement.lang,
        family: rootStyle.fontFamily,
        compact: rootStyle.getPropertyValue('--font-size-small').trim(),
        micro: rootStyle.getPropertyValue('--font-size-micro').trim(),
        text,
      };
    });
  }

  async function assertLocale(shell, locale) {
    await shell.locator('html').evaluate((element, nextLocale) => window.browserShell.invoke('setUiLocale', { locale: nextLocale }), locale);
    const state = await shell.waitForFunction(expected => document.documentElement.lang === expected, locale);
    assert.ok(state, `${locale} locale is applied`);
    await delay(80);
    const result = await inspectVisibleText(shell);
    assert.equal(result.locale, locale);
    assert.ok(!result.family.toLowerCase().includes('inter'), 'the shell does not depend on an unbundled Inter installation');
    if (locale === 'zh-CN') {
      assert.match(result.family, /PingFang SC.*Microsoft YaHei UI.*Noto Sans CJK SC/i);
      assert.equal(result.compact, '12px');
      assert.equal(result.micro, '12px');
      const undersized = result.text.filter(item => item.fontSize < 12);
      assert.deepEqual(undersized, [], `visible Chinese UI text is at least 12px: ${JSON.stringify(undersized)}`);
    } else {
      assert.match(result.family, /system-ui/i);
      assert.equal(result.compact, '11px');
      assert.equal(result.micro, '10px');
    }
    return result;
  }

  async function capture(shell, name) {
    const directory = process.env.CORVID_TYPOGRAPHY_QA_DIR;
    if (!directory) return;
    fs.mkdirSync(directory, { recursive: true });
    await shell.screenshot({ path: path.join(directory, name) });
  }

  try {
    const launched = await launchElectron(_electron, {
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1' },
    }, { label: 'typography-e2e', dataDir });
    app = launched.app;
    const shell = launched.shell;
    await waitForControl(app, dataDir, { label: 'typography-e2e' });
    await shell.locator('#tab-strip').waitFor();

    for (const locale of ['zh-CN', 'en']) {
      await assertLocale(shell, locale);
      await shell.locator('#show-bookmarks').click();
      await shell.locator('#library:not([hidden])').waitFor();
      const eyebrow = await shell.locator('#library .panel-eyebrow').count();
      assert.equal(eyebrow, 0, 'browser library header uses its page title without the unrelated Corvid Workspace eyebrow');
      assert.deepEqual((await inspectVisibleText(shell)).text.filter(item => /CORVID WORKSPACE|CORVID 工作区/i.test(item.text)), []);

      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 100, y: 100, width: 1024, height: 700 }));
      await delay(100);
      await capture(shell, `issue-212-${locale}-library-1024x700.png`);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 100, y: 100, width: 704, height: 420 }));
      await shell.waitForFunction(() => window.innerWidth === 704);
      await shell.locator('#show-pi-workbench').click();
      await shell.locator('#library:not([hidden])').waitFor();
      await delay(100);
      const geometry = await shell.locator('#library').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, right: element.getBoundingClientRect().right, viewportWidth: innerWidth }));
      assert.ok(geometry.scrollWidth <= geometry.width + 1, `${locale} compact workbench has no horizontal overflow`);
      assert.ok(geometry.right <= geometry.viewportWidth, `${locale} compact workbench stays inside the window`);
      const workbenchText = await inspectVisibleText(shell);
      if (locale === 'zh-CN') assert.deepEqual(workbenchText.text.filter(item => item.fontSize < 12), [], 'Chinese Agent workbench text keeps the 12px minimum');
      await capture(shell, `issue-212-${locale}-agent-704x420.png`);

      await shell.locator('#close-library').click();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 100, y: 100, width: 1024, height: 700 }));
      await shell.waitForFunction(() => window.innerWidth === 1024);
    }

    console.log('PASS system UI/CJK font stacks, locale-aware compact type sizes, library labeling, and 704x420 overflow');
  } finally {
    if (app) await closeElectron(app).catch(error => { console.error(error); process.exitCode = 1; });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
