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
const selectedTextContrast = {};
const contrastRatio = (foreground, background) => {
  const luminance = color => {
    const channels = color.match(/\d+/g).slice(0, 3).map(value => Number(value) / 255);
    const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

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
    await shell.locator('#new-tab').waitFor({ state: 'visible' });
    const viewport = await shell.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));

    for (const colorScheme of ['light', 'dark']) {
      await shell.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });

      const designTokens = await shell.evaluate(() => {
        const styleOf = (selector, pseudo) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Missing tokenized component: ${selector}`);
          const style = getComputedStyle(element, pseudo);
          return { radius: style.borderRadius, shadow: style.boxShadow };
        };
        const root = getComputedStyle(document.documentElement);
        const shadowFromToken = token => {
          const probe = document.createElement('span');
          probe.style.boxShadow = `var(${token})`;
          document.body.append(probe);
          const value = getComputedStyle(probe).boxShadow;
          probe.remove();
          return value;
        };
        return {
          radius: Object.fromEntries(['xs', 'sm', 'md', 'lg', 'xl', 'circle'].map(key => [key, root.getPropertyValue(`--radius-${key}`).trim()])),
          elevation: Object.fromEntries(['card', 'raised', 'popover', 'panel', 'menu', 'dialog'].map(key => [key, shadowFromToken(`--elevation-${key}`)])),
          dock: styleOf('#room-dock'),
          roomTile: styleOf('#room-strip button', '::after'),
          address: styleOf('#address-form'),
          newTab: styleOf('#tab-strip > #new-tab'),
          profileMenu: styleOf('#profile-menu'),
          siteTools: styleOf('#site-tools'),
          findbar: styleOf('#findbar'),
          library: styleOf('#library'),
        };
      });
      assert.deepEqual(designTokens.radius, { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '20px', circle: '50%' }, `${colorScheme}: radius scale is shared and increments by 4px`);
      for (const [key, geometry] of Object.entries({
        card: '0px 1px 2px 0px',
        raised: '0px 3px 12px 0px',
        popover: '0px 12px 32px 0px',
        panel: '0px 12px 36px 0px',
        menu: '0px 14px 38px 0px',
        dialog: '0px 24px 80px 0px',
      })) {
        assert.match(designTokens.elevation[key], /^rgba?\(.+\) /, `${colorScheme}: ${key} elevation resolves to a theme color`);
        assert.ok(designTokens.elevation[key].endsWith(geometry), `${colorScheme}: ${key} elevation keeps its semantic geometry`);
      }
      assert.equal(designTokens.roomTile.radius, '9px');
      assert.equal(designTokens.dock.radius, '22px');
      assert.equal(designTokens.address.radius, '20px');
      assert.equal(designTokens.newTab.radius, '8px');
      assert.equal(designTokens.profileMenu.radius, '12px');
      assert.equal(designTokens.siteTools.radius, '12px');
      assert.equal(designTokens.findbar.radius, '12px');
      assert.equal(designTokens.library.radius, '16px');
      assert.match(designTokens.roomTile.shadow, /^rgba?\(.+\) 0px 0px 0px 2px/, `${colorScheme}: the Room tile selection chip keeps its layered ring`);
      assert.match(designTokens.profileMenu.shadow, /^rgba?\(.+\) 0px 14px 38px 0px$/);
      assert.match(designTokens.siteTools.shadow, /^rgba?\(.+\) 0px 14px 38px 0px$/);
      assert.match(designTokens.findbar.shadow, /^rgba?\(.+\) 0px 12px 32px 0px$/);
      assert.match(designTokens.library.shadow, /^rgba?\(.+\) 0px 12px 36px 0px$/);

      const surfaces = await shell.evaluate(() => {
        const dockStrip = document.querySelector('#room-strip');
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
          dockStripWidth: getComputedStyle(dockStrip).scrollbarWidth,
          dockStripColor: getComputedStyle(dockStrip).scrollbarColor,
          scrollbarThumbColor: colorFromToken('color', '--line-strong'),
          accentSelectionBackground: colorFromToken('backgroundColor', '--accent-soft'),
          accentSelectionColor: colorFromToken('color', '--accent-ink'),
          tabScrollbarWidth: getComputedStyle(tabs).scrollbarWidth,
          motionFast: getComputedStyle(document.documentElement).getPropertyValue('--motion-fast').trim(),
        };
      });
      assert.equal(surfaces.dockStripWidth, 'none', `${colorScheme}: the Room dock strip intentionally hides its scrollbar like the tab strip`);
      assert.ok(surfaces.dockStripColor.includes(surfaces.scrollbarThumbColor), `${colorScheme}: scrollbar thumb color follows the theme`);
      assert.equal(surfaces.tabScrollbarWidth, 'none', 'the horizontally scrollable tab strip keeps its intentional hidden scrollbar');
      assert.equal(surfaces.motionFast, '120ms');
      assert.equal(surfaces.selectionBackground, surfaces.accentSelectionBackground, `${colorScheme}: text selection uses the accent surface`);
      assert.equal(surfaces.selectionColor, surfaces.accentSelectionColor, `${colorScheme}: selected text uses the theme accent ink`);

      // 空间 dock 取代旧侧栏导航后，“当前项”选中态由活动空间磁贴的 accent 描边表达。
      const activeRoom = shell.locator('#room-strip button[aria-current="page"]');
      assert.equal(await activeRoom.count(), 1, `${colorScheme}: exactly one Room is announced as current`);
      await shell.mouse.move(0, 0);
      const roomSelection = await activeRoom.evaluate(element => {
        const chip = getComputedStyle(element, '::after');
        return { color: chip.color, background: chip.backgroundColor, boxShadow: chip.boxShadow };
      });
      assert.match(roomSelection.boxShadow, /0px 0px 0px 3.5px/, `${colorScheme}: current Room keeps the accent selection ring`);
      selectedTextContrast[colorScheme] = contrastRatio(roomSelection.color, roomSelection.background).toFixed(2);
      assert.ok(Number(selectedTextContrast[colorScheme]) >= 4.5, `${colorScheme}: current Room chip text meets WCAG AA`);
      const dockRevealPoint = await shell.evaluate(() => ({ x: Math.round(innerWidth / 2), y: innerHeight - 2 }));
      await shell.mouse.move(dockRevealPoint.x, dockRevealPoint.y, { steps: 4 });
      await activeRoom.hover();
      await shell.waitForTimeout(220);
      const roomHovered = await activeRoom.evaluate(element => {
        const chip = getComputedStyle(element, '::after');
        return { color: chip.color, boxShadow: chip.boxShadow };
      });
      assert.equal(roomHovered.color, roomSelection.color, `${colorScheme}: current Room selection text remains stable on hover`);
      assert.equal(roomHovered.boxShadow, roomSelection.boxShadow, `${colorScheme}: current Room keeps its selection ring on hover`);
      await shell.mouse.move(0, 0);

      await shell.mouse.move(dockRevealPoint.x, dockRevealPoint.y, { steps: 4 });
      await shell.locator('#create-room-trigger').click();
      const dialogTokens = await shell.locator('#new-room').evaluate(element => ({ radius: getComputedStyle(element).borderRadius, shadow: getComputedStyle(element).boxShadow }));
      assert.equal(dialogTokens.radius, '16px', `${colorScheme}: dialogs use the large radius token`);
      assert.match(dialogTokens.shadow, /^rgba?\(.+\) 0px 24px 80px 0px$/);
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

      // 旧侧栏已由空间 dock 取代，按压反馈改在常驻的 #new-tab 控件上验证。
      const nav = shell.locator('#new-tab');
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

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(719, 452));
    await shell.waitForFunction(() => window.innerWidth === 719);
    for (const colorScheme of ['light', 'dark']) {
      await shell.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      const compactSelection = await shell.evaluate(() => {
        const room = document.querySelector('#room-strip button[aria-current="page"]');
        const chip = getComputedStyle(room, '::after');
        return { width: window.innerWidth, height: window.innerHeight, marker: chip.boxShadow, color: chip.color };
      });
      assert.match(compactSelection.marker, /0px 0px 0px 3.5px/, `${colorScheme}: compact Room selection keeps the accent ring`);
      assert.equal(compactSelection.width, 719);
    }

    console.log(`PASS interaction states at ${viewport.width}x${viewport.height} plus 704x420 compact mode: Room dock selection matches across light/dark themes and survives hover (contrast ${JSON.stringify(selectedTextContrast)}), dialog submit keeps its accent on hover, press feedback is visible, and themed scrollbars/selection respect reduced motion`);
  } finally {
    if (app) await closeElectron(app).catch(error => { console.error(error); process.exitCode = 1; });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
