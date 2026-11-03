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
    assert.equal(zhLayout.text.description, '提问、总结或让 Agent 协助浏览。分享前先检查页面内容。', 'Chinese welcome copy remains complete');
    assert.ok(zhLayout.headingVisible && zhLayout.descriptionVisible && zhLayout.noOverlap, 'Chinese welcome heading and full description remain visible above the composer: ' + JSON.stringify(zhLayout));

    await shell.evaluate(() => window.corvidI18n.setLocale('en'));
    await shell.locator('.pi-chat-toolbar .pi-new-chat').click();
    await shell.getByText('Ask Corvid Agent to help you understand a page', { exact: true }).waitFor();
    const enLayout = await readWelcomeLayout();
    assert.equal(enLayout.text.description, 'Ask, summarize, or browse with help. Review page content before sharing.', 'English welcome copy remains complete');
    assert.ok(enLayout && enLayout.headingVisible && enLayout.descriptionVisible && enLayout.noOverlap, 'English welcome heading and full description remain visible above the composer: ' + JSON.stringify(enLayout));

    const composerAccess = await shell.locator('#pi-task-form').evaluate(form => {
      const fullyVisible = selector => {
        const element = form.querySelector(selector);
        element.scrollIntoView({ block: 'nearest' });
        const rect = element.getBoundingClientRect();
        const viewport = form.getBoundingClientRect();
        return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
      };
      return {
        scrollable: form.scrollHeight > form.clientHeight,
        modelSelectorVisible: fullyVisible('.pi-model-select'),
        promptVisible: fullyVisible('textarea'),
        pageReviewVisible: fullyVisible('.pi-secondary-action'),
      };
    });
    assert.ok(composerAccess.scrollable && composerAccess.modelSelectorVisible && composerAccess.promptVisible && composerAccess.pageReviewVisible,
      'model, prompt, and page-review controls remain reachable by scrolling the composer: ' + JSON.stringify(composerAccess));

    console.log('PASS Corvid Agent welcome remains readable in zh-CN/en at short window height: ' + JSON.stringify({ zh: zhLayout, en: enLayout }));
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => site.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
