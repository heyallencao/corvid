const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidenceDirectory = process.env.CORVID_MODEL_PICKER_EVIDENCE_DIR;

async function saveScreenshot(page, name) {
  if (!evidenceDirectory) return;
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDirectory, name) });
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-model-picker-ui-'));
  let app;
  try {
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: {
      ...process.env,
      CORVID_DATA_DIR: dataDir,
      CORVID_TEST_MODE: '1',
      CORVID_PORT: '0',
    } });
    const shell = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 850));
    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();

    let trigger = shell.getByRole('button', { name: 'Corvid Agent 模型' });
    await trigger.waitFor();
    await trigger.click();
    let search = shell.getByRole('combobox', { name: '搜索模型' });
    const catalogSize = await shell.locator('[role="option"]').count();
    assert.ok(catalogSize > 50, `the searchable picker exposes the full catalog (${catalogSize} models)`);
    await saveScreenshot(shell, 'issue-208-model-picker-zh-CN-1280x850.png');

    await search.fill('gpt-6-luna');
    const codexLuna = shell.locator('[role="option"][data-provider-id="openai-codex"][data-model-id="gpt-6-luna"]');
    assert.equal(await codexLuna.count(), 1, 'the filtered results retain the provider/model pair');
    const visibleOptions = await shell.locator('[role="option"]').count();
    assert.ok(visibleOptions < catalogSize, 'search reduces the displayed catalog');
    const targetIndex = await codexLuna.evaluate(option => [...option.parentElement.children].indexOf(option));
    const activeIndex = await search.evaluate(input => {
      const active = document.getElementById(input.getAttribute('aria-activedescendant'));
      return active ? [...active.parentElement.children].indexOf(active) : 0;
    });
    const steps = (targetIndex - activeIndex + visibleOptions) % visibleOptions;
    for (let index = 0; index < steps; index++) await search.press('ArrowDown');
    await search.press('ArrowUp');
    await search.press('ArrowDown');
    assert.equal(await search.evaluate(input => document.getElementById(input.getAttribute('aria-activedescendant'))?.dataset.modelId), 'gpt-6-luna', 'both arrow keys move the active option');
    await search.press('Enter');
    await shell.waitForFunction(() => document.querySelector('.pi-model-select')?.textContent === '当前选择尚未连接');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-model.json'), 'utf8')),
      { providerId: 'openai-codex', modelId: 'gpt-6-luna' }, 'keyboard selection persists the expected model');

    await trigger.click();
    search = shell.getByRole('combobox', { name: '搜索模型' });
    await search.fill('corvid-no-such-model');
    assert.equal(await shell.getByText('没有匹配的模型', { exact: true }).count(), 1, 'Chinese empty results are explicit');
    await saveScreenshot(shell, 'issue-208-model-picker-no-results-zh-CN-1280x850.png');
    await search.press('Escape');
    assert.equal(await shell.locator('.pi-model-picker-panel').isVisible(), false, 'Escape closes the picker');
    assert.equal(await shell.evaluate(() => document.activeElement.className), 'pi-model-select', 'Escape returns focus to the trigger');

    await shell.evaluate(() => window.browserShell.invoke('setUiLocale', { locale: 'en' }));
    trigger = shell.getByRole('button', { name: 'Corvid Agent model' });
    assert.equal(await trigger.innerText(), 'Current selection is not connected', 'the unconnected selection remains private in English');
    await trigger.click();
    search = shell.getByRole('combobox', { name: 'Search models' });
    await search.fill('corvid-no-such-model');
    assert.equal(await shell.getByText('No matching models', { exact: true }).count(), 1, 'English empty results are explicit');
    await saveScreenshot(shell, 'issue-208-model-picker-no-results-en-1280x850.png');
    await search.press('Tab');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false', 'Tab closes the picker');
    assert.equal(await shell.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Manage models', 'Tab continues to the next control');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(704, 420));
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    search = shell.getByRole('combobox', { name: 'Search models' });
    await search.fill('gpt-6-luna');
    await shell.locator('[role="option"][data-provider-id="openai-codex"][data-model-id="gpt-6-luna"]').waitFor();
    const menuInsideViewport = await shell.locator('.pi-model-picker-panel').evaluate(panel => {
      const bounds = panel.getBoundingClientRect();
      return bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight
        && bounds.left >= 0 && bounds.right <= innerWidth;
    });
    assert.ok(menuInsideViewport, 'the open menu remains within a narrow, short viewport');
    await saveScreenshot(shell, 'issue-208-model-picker-narrow-en-704x420.png');
    await search.press('Escape');

    console.log(`PASS searchable model picker: ${catalogSize} models, search, arrow/Enter, Escape, Tab, zh-CN/en, and 704x420 viewport`);
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
