const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { closeElectron, launchElectron } = require('./electron-test-startup.cjs');

const project = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-button-hover-contrast-'));
const qaDir = process.env.CORVID_BUTTON_HOVER_QA_DIR;
let app;

(async () => {
  try {
    const launched = await launchElectron(_electron, {
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1', CORVID_TEST_CHROME_IMPORT: '1' },
    }, { label: 'button-hover-contrast-e2e', dataDir });
    app = launched.app;
    const shell = launched.shell;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 732));
    await shell.waitForFunction(() => window.innerWidth === 1024);

    const onboarding = shell.locator('#chrome-import-onboarding');
    const primaryAction = shell.locator('#begin-chrome-import');
    const secondaryAction = shell.locator('#skip-chrome-import');
    await onboarding.waitFor({ state: 'visible' });

    const measurements = {};
    for (const colorScheme of ['light', 'dark']) {
      await shell.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
      await primaryAction.hover();
      await shell.waitForTimeout(220);

      const colors = await primaryAction.evaluate(element => {
        const style = getComputedStyle(element);
        const channels = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = value => {
          const linear = channels(value).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
          return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--accent-solid)';
        document.body.append(probe);
        const expectedBackground = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const foregroundLuminance = luminance(style.color);
        const backgroundLuminance = luminance(style.backgroundColor);
        const contrast = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
        return { background: style.backgroundColor, expectedBackground, foreground: style.color, contrast, hovered: element.matches(':hover') };
      });

      assert.equal(colors.hovered, true, `${colorScheme}: measure the actual hovered onboarding action`);
      assert.equal(colors.background, colors.expectedBackground, `${colorScheme}: primary action retains the accent surface on hover`);
      assert.ok(colors.contrast >= 4.5, `${colorScheme}: white primary-action text meets 4.5:1 on hover (observed ${colors.contrast.toFixed(2)}:1)`);
      measurements[colorScheme] = colors.contrast;

      if (qaDir) {
        fs.mkdirSync(qaDir, { recursive: true });
        await shell.screenshot({ path: path.join(qaDir, `issue-204-onboarding-hover-${colorScheme}-1024x700.png`) });
      }

      await secondaryAction.hover();
      await shell.waitForTimeout(220);
      const neutralHover = await secondaryAction.evaluate(element => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--surface-hover)';
        document.body.append(probe);
        const expectedBackground = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { background: getComputedStyle(element).backgroundColor, expectedBackground, hovered: element.matches(':hover') };
      });
      assert.equal(neutralHover.hovered, true, `${colorScheme}: measure the neutral secondary action hover`);
      assert.equal(neutralHover.background, neutralHover.expectedBackground, `${colorScheme}: neutral actions retain their shared hover surface`);
    }

    await shell.locator('#skip-chrome-import').click();
    await onboarding.waitFor({ state: 'hidden' });
    console.log(`PASS onboarding primary hover contrast at 1024x700: light=${measurements.light.toFixed(2)}:1, dark=${measurements.dark.toFixed(2)}:1`);
  } finally {
    if (app) await closeElectron(app).catch(error => { console.error(error); process.exitCode = 1; });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
