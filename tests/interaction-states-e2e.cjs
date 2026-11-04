const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { closeElectron, launchElectron } = require('./electron-test-startup.cjs');

const project = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-interaction-states-'));
const qaDir = process.env.CORVID_INTERACTION_QA_DIR;
let app;

(async () => {
  try {
    const launched = await launchElectron(_electron, {
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1' },
    }, { label: 'interaction-states-e2e', dataDir });
    app = launched.app;
    const shell = launched.shell;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 732));
    await shell.waitForFunction(() => window.innerWidth === 1024);
    const viewport = await shell.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));

    for (const colorScheme of ['light', 'dark']) {
      await shell.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });

      const surfaces = await shell.evaluate(() => {
        const nav = document.querySelector('#show-bookmarks');
        const scrollArea = document.querySelector('#room-strip');
        const tabs = document.querySelector('#tabs');
        const selection = getComputedStyle(document.documentElement, '::selection');
        const colorFromToken = (property, token) => {
          const probe = document.createElement('span');
          probe.style[property] = `var(${token})`;
          document.body.append(probe);
          const value = getComputedStyle(probe)[property];
          probe.remove();
          return value;
        };
        return {
          selectionBackground: selection.backgroundColor,
          selectionColor: selection.color,
          scrollbarWidth: getComputedStyle(scrollArea).scrollbarWidth,
          scrollbarColor: getComputedStyle(scrollArea).scrollbarColor,
          scrollbarThumbColor: colorFromToken('color', '--line-strong'),
          accentSelectionBackground: colorFromToken('backgroundColor', '--accent-soft'),
          accentSelectionColor: colorFromToken('color', '--accent-ink'),
          tabScrollbarWidth: getComputedStyle(tabs).scrollbarWidth,
          motionFast: getComputedStyle(document.documentElement).getPropertyValue('--motion-fast').trim(),
        };
      });
      assert.equal(surfaces.scrollbarWidth, 'thin', `${colorScheme}: Corvid scroll areas use the themed thin scrollbar`);
      assert.ok(surfaces.scrollbarColor.includes(surfaces.scrollbarThumbColor), `${colorScheme}: scrollbar thumb color follows the theme`);
      assert.equal(surfaces.tabScrollbarWidth, 'none', 'the horizontally scrollable tab strip keeps its intentional hidden scrollbar');
      assert.equal(surfaces.motionFast, '120ms');
      assert.equal(surfaces.selectionBackground, surfaces.accentSelectionBackground, `${colorScheme}: text selection uses the accent surface`);
      assert.equal(surfaces.selectionColor, surfaces.accentSelectionColor, `${colorScheme}: selected text uses the theme accent ink`);

      const nav = shell.locator('#show-bookmarks');
      await nav.click();
      await nav.waitFor({ state: 'visible' });
      await shell.waitForFunction(() => document.querySelector('#show-bookmarks')?.getAttribute('aria-expanded') === 'true');
      await shell.mouse.move(0, 0);
      await shell.waitForTimeout(220);
      const selectedBeforeHover = await nav.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
      await nav.hover();
      await shell.waitForTimeout(220);
      const selected = await nav.evaluate(element => ({
        color: getComputedStyle(element).color,
        background: getComputedStyle(element).backgroundColor,
        boxShadow: getComputedStyle(element).boxShadow,
      }));
      assert.equal(selected.color, selectedBeforeHover.color, `${colorScheme}: selected navigation text remains stable on hover`);
      assert.equal(selected.background, selectedBeforeHover.background, `${colorScheme}: selected navigation surface remains stable on hover`);
      assert.match(selected.boxShadow, /2px 0px.*inset/, `${colorScheme}: selected navigation keeps its accent marker`);

      await shell.locator('#create-room-trigger').click();
      const createRoom = shell.locator('#new-room-form button[type="submit"]');
      await createRoom.waitFor({ state: 'visible' });
      const submitBeforeHover = await createRoom.evaluate(element => getComputedStyle(element).backgroundColor);
      await createRoom.hover();
      await shell.waitForFunction(() => document.querySelector('#new-room-form button[type="submit"]')?.matches(':hover'));
      await shell.waitForTimeout(140);
      const submitHover = await createRoom.evaluate(element => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--accent-solid)';
        document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { background: getComputedStyle(element).backgroundColor, expected, hovered: element.matches(':hover') };
      });
      assert.equal(submitHover.hovered, true, `${colorScheme}: the pointer is over the dialog submit button`);
      assert.equal(submitHover.background, submitBeforeHover, `${colorScheme}: dialog submit keeps its primary surface while hovered`);
      assert.equal(submitHover.background, submitHover.expected, `${colorScheme}: dialog submit surface follows the accent token`);
      if (qaDir) {
        fs.mkdirSync(qaDir, { recursive: true });
        await shell.screenshot({ path: path.join(qaDir, `issue-211-submit-hover-${colorScheme}-${viewport.width}x${viewport.height}.png`) });
      }
      await shell.locator('#cancel-room').click();

      if (qaDir) {
        fs.mkdirSync(qaDir, { recursive: true });
        await shell.screenshot({ path: path.join(qaDir, `issue-216-interaction-${colorScheme}-${viewport.width}x${viewport.height}.png`) });
      }

      const bounds = await nav.boundingBox();
      await shell.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await shell.mouse.down();
      const press = await nav.evaluate(element => ({
        transform: getComputedStyle(element).transform,
        filter: getComputedStyle(element).filter,
        motion: getComputedStyle(element).transitionDuration,
      }));
      assert.notEqual(press.transform, 'none', `${colorScheme}: press gives immediate positional feedback`);
      assert.notEqual(press.filter, 'none', `${colorScheme}: press gives immediate tonal feedback`);
      const transitionMs = press.motion.split(',').map(value => {
        const trimmed = value.trim();
        const amount = Number.parseFloat(trimmed);
        return trimmed.endsWith('ms') ? amount : amount * 1000;
      });
      assert.ok(transitionMs.every(value => value === 120), `${colorScheme}: control transitions use the shared fast token (${press.motion})`);
      await shell.mouse.up();

      await shell.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      const reduced = await nav.evaluate(element => ({ transition: getComputedStyle(element).transitionDuration, scroll: getComputedStyle(document.documentElement).scrollBehavior }));
      const duration = reduced.transition.split(',').map(value => {
        const trimmed = value.trim();
        const amount = Number.parseFloat(trimmed);
        return trimmed.endsWith('ms') ? amount : amount * 1000;
      });
      assert.ok(duration.every(value => value <= 0.02), `${colorScheme}: reduced motion removes animated delay (${reduced.transition})`);
      assert.equal(reduced.scroll, 'auto', `${colorScheme}: reduced motion disables smooth scrolling`);
    }

    console.log(`PASS interaction states at ${viewport.width}x${viewport.height}: selected navigation survives hover, dialog submit keeps its accent on hover, press feedback is visible, and themed scrollbars/selection respect reduced motion across light/dark themes`);
  } finally {
    if (app) await closeElectron(app).catch(error => { console.error(error); process.exitCode = 1; });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
