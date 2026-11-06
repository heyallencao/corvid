const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-short-height-'));
  const site = http.createServer((_request, response) => response.end('<!doctype html><title>Corvid Fixture Page</title><h1>Fixture page content</h1>'));
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  let app;
  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const shell = await app.firstWindow();
    const control = await (async () => {
      for (let attempt = 0; attempt < 200; attempt++) {
        try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); }
        catch { await delay(25); }
      }
      throw new Error('Corvid control service did not start');
    })();
    const sourceUrl = 'http://127.0.0.1:' + site.address().port + '/';
    await shell.getByLabel('地址或搜索').fill(sourceUrl);
    await shell.getByLabel('地址或搜索').press('Enter');
    await (async () => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const response = await fetch(control.baseUrl + '/rooms', { headers: { authorization: 'Bearer ' + control.token } });
        const state = await response.json();
        if (state.rooms.flatMap(room => room.tabs).some(tab => tab.url === sourceUrl)) return;
        await delay(25);
      }
      throw new Error('Fixture page did not navigate');
    })();

    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
    await shell.locator('.pi-chat-welcome h3').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(704, 420));
    await shell.waitForFunction(() => window.matchMedia('(max-height: 480px)').matches);

    const readWelcomeLayout = async () => shell.locator('#pi-task-list').evaluate(list => {
      const welcome = list.querySelector('.pi-chat-welcome');
      const heading = welcome?.querySelector('h3');
      const description = welcome?.querySelector('p');
      const composer = document.querySelector('#pi-task-form');
      const box = element => {
        const rect = element.getBoundingClientRect();
        return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), height: Math.round(rect.height) };
      };
      if (!welcome || !heading || !description || !composer) return null;
      const listBox = list.getBoundingClientRect();
      const welcomeBox = welcome.getBoundingClientRect();
      const headingBox = heading.getBoundingClientRect();
      const descriptionBox = description.getBoundingClientRect();
      const composerBox = composer.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        list: box(list), welcome: box(welcome), heading: box(heading), description: box(description), composer: box(composer),
        composerScroll: { client: composer.clientHeight, scroll: composer.scrollHeight, children: [...composer.children].map(element => ({ className: element.className, ...box(element) })) },
        headingVisible: headingBox.height > 0 && headingBox.top >= listBox.top && headingBox.bottom <= listBox.bottom && headingBox.right <= listBox.right,
        descriptionVisible: descriptionBox.height > 0 && descriptionBox.top >= listBox.top && descriptionBox.bottom <= listBox.bottom && descriptionBox.right <= listBox.right && description.scrollHeight <= description.clientHeight + 1,
        noOverlap: welcomeBox.bottom <= composerBox.top,
        text: { heading: heading.textContent, description: description.textContent },
      };
    });

    const zhLayout = await readWelcomeLayout();
    const evidencePath = process.env.CORVID_UI_EVIDENCE_PATH;
    if (evidencePath) {
      fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
      await shell.screenshot({ path: evidencePath });
    }
    assert.ok(zhLayout && zhLayout.viewport.height <= 480, 'test exercises the supported short-height layout: ' + JSON.stringify(zhLayout));
    assert.equal(zhLayout.text.description, '提问、总结或让 Agent 协助浏览。', 'Chinese welcome copy remains complete');
    assert.ok(zhLayout.headingVisible && zhLayout.descriptionVisible && zhLayout.noOverlap, 'Chinese welcome heading and full description remain visible above the composer: ' + JSON.stringify(zhLayout));
    const composerFirstViewport = async () => shell.locator('#pi-task-form').evaluate(form => {
      const visible = selector => {
        const element = form.querySelector(selector);
        const rect = element.getBoundingClientRect();
        const bounds = form.getBoundingClientRect();
        return rect.height > 0 && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      };
      return { pageBindingVisible: visible('.pi-page-binding'), promptVisible: visible('#pi-task-prompt') };
    });
    const zhComposerFirstViewport = await composerFirstViewport();
    assert.ok(zhComposerFirstViewport.pageBindingVisible && zhComposerFirstViewport.promptVisible, 'Chinese page binding and task prompt are visible without scrolling: ' + JSON.stringify(zhComposerFirstViewport));

    await shell.evaluate(() => window.corvidI18n.setLocale('en'));
    await shell.locator('.pi-chat-toolbar .pi-new-chat').click();
    await shell.getByText('Ask Corvid Agent about this page', { exact: true }).waitFor();
    const enLayout = await readWelcomeLayout();
    assert.equal(enLayout.text.description, 'Ask, summarize, or browse with the Agent.', 'English welcome copy remains complete');
    assert.ok(enLayout && enLayout.headingVisible && enLayout.descriptionVisible && enLayout.noOverlap, 'English welcome heading and full description remain visible above the composer: ' + JSON.stringify(enLayout));
    const enComposerFirstViewport = await composerFirstViewport();
    assert.ok(enComposerFirstViewport.pageBindingVisible && enComposerFirstViewport.promptVisible, 'English page binding and task prompt are visible without scrolling: ' + JSON.stringify(enComposerFirstViewport));

    const composerAccess = await shell.locator('#pi-task-form').evaluate(form => {
      const fullyVisible = selector => {
        const element = form.querySelector(selector);
        if (!element) return false;
        element.scrollIntoView({ block: 'nearest' });
        const rect = element.getBoundingClientRect();
        const viewport = form.getBoundingClientRect();
        return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
      };
      return {
        modelSelectorVisible: fullyVisible('.pi-model-select'),
        promptVisible: fullyVisible('textarea'),
        sendVisible: fullyVisible('.pi-send'),
        pageBadgeVisible: fullyVisible('.pi-page-binding'),
      };
    });
    assert.ok(composerAccess.modelSelectorVisible && composerAccess.promptVisible && composerAccess.sendVisible && composerAccess.pageBadgeVisible,
      'page badge, model choice, prompt, and send action remain visible in the compact composer: ' + JSON.stringify(composerAccess));

    const modelPickerTrigger = shell.getByRole('button', { name: 'Corvid Agent model' });
    await modelPickerTrigger.scrollIntoViewIfNeeded();
    await modelPickerTrigger.click();
    const modelSearch = shell.getByRole('combobox', { name: 'Search models' });
    await modelSearch.fill('gpt-6-luna');
    await shell.locator('[role="option"][data-provider-id="openai-codex"][data-model-id="gpt-6-luna"]').waitFor();
    const pickerSearchVisible = await modelSearch.evaluate(input => {
      const bounds = input.getBoundingClientRect();
      const panel = input.closest('.pi-model-picker-panel').getBoundingClientRect();
      return bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= window.innerHeight && bounds.left >= 0 && bounds.right <= window.innerWidth
        && panel.top >= 0 && panel.bottom <= window.innerHeight && panel.left >= 0 && panel.right <= window.innerWidth;
    });
    assert.ok(pickerSearchVisible, 'the model picker opens as a viewport-bounded menu at short height');
    const pickerEvidencePath = process.env.CORVID_MODEL_PICKER_EVIDENCE_PATH;
    if (pickerEvidencePath) {
      fs.mkdirSync(path.dirname(pickerEvidencePath), { recursive: true });
      await shell.screenshot({ path: pickerEvidencePath });
    }
    await modelSearch.press('Escape');

    console.log('PASS Corvid Agent welcome remains readable in zh-CN/en at short window height: ' + JSON.stringify({ zh: zhLayout, en: enLayout }));
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => site.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
