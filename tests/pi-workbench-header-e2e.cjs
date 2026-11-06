const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchElectron, waitForControl } = require('./electron-test-startup.cjs');
const { createAgentTaskStore } = require('../desktop/agent-task-store.cjs');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-workbench-header-'));
  const qaDir = process.env.CORVID_ISSUE217_QA_DIR;
  if (qaDir) fs.mkdirSync(qaDir, { recursive: true });
  let app;
  try {
    const launched = await launchElectron(_electron, {
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1' },
    }, { label: 'pi-workbench-header-e2e', dataDir });
    app = launched.app;
    const shell = launched.shell;
    await waitForControl(app, dataDir, { label: 'pi-workbench-header-e2e' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(704, 568));
    const initialState = await shell.evaluate(async () => window.browserShell.invoke('state', {}));
    const fixtureRoom = initialState.rooms.find(room => room.id === initialState.activeRoomId);
    assert.ok(fixtureRoom?.tabs?.[0]?.id, 'the isolated fixture has an active Room and Tab');
    const now = new Date().toISOString();
    const longHistory = Array.from({ length: 18 }, (_, index) => ({
      id: `header-overflow-fixture-${index}`,
      profileId: fixtureRoom.profileId,
      roomId: fixtureRoom.id,
      tabId: fixtureRoom.tabs[0].id,
      status: 'completed',
      prompt: `历史会话 ${index}：验证工作台任务历史滚动区域布局。${'补充可见历史记录。'.repeat(24)}`,
      page: { title: `Fixture history ${index}`, url: 'http://127.0.0.1/fixture' },
      conversation: [{ role: 'user', text: `历史会话 ${index}：验证工作台任务历史滚动区域布局。${'补充可见历史记录。'.repeat(24)}`, at: now }],
      events: [],
      createdAt: now,
      updatedAt: new Date(Date.now() + index).toISOString(),
    }));
    createAgentTaskStore(dataDir).save(longHistory);
    await app.close();
    app = null;
    const relaunched = await launchElectron(_electron, {
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_PORT: '0', CORVID_TEST_MODE: '1' },
    }, { label: 'pi-workbench-header-e2e-history', dataDir });
    app = relaunched.app;
    const historyShell = relaunched.shell;
    await waitForControl(app, dataDir, { label: 'pi-workbench-header-e2e-history' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(704, 568));
    await historyShell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
    await historyShell.locator('.pi-chat-toolbar').waitFor({ state: 'visible' });
    await historyShell.locator('#pi-task-list .pi-task-entry').first().waitFor({ state: 'visible', timeout: 10_000 });

    for (const locale of ['zh-CN', 'en']) {
      await historyShell.evaluate(value => window.corvidI18n.setLocale(value), locale);
      await delay(180);
      const geometry = await historyShell.evaluate(() => {
        const panel = document.querySelector('#library');
        const workspace = document.querySelector('#pi-workbench-content');
        const list = document.querySelector('#pi-task-list');
        const toolbar = document.querySelector('.pi-chat-toolbar');
        const button = toolbar?.querySelector('.pi-new-chat');
        const historyButton = toolbar?.querySelector('button[aria-label]');
        if (!panel || !workspace || !list || !toolbar || !button || !historyButton) return null;
        const rect = element => {
          const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
          return { left, right, top, bottom, width, height };
        };
        list.scrollTop = 0;
        const toolbarTopBeforeScroll = toolbar.getBoundingClientRect().top;
        list.scrollTop = list.scrollHeight;
        const listScrollTop = list.scrollTop;
        const toolbarTopAfterScroll = toolbar.getBoundingClientRect().top;
        const buttonRect = button.getBoundingClientRect();
        const historyButtonRect = historyButton.getBoundingClientRect();
        const workspaceRect = workspace.getBoundingClientRect();
        const clipLeft = workspaceRect.left + workspace.clientLeft;
        const clipRight = clipLeft + workspace.clientWidth;
        return {
          viewportWidth: innerWidth,
          panel: rect(panel),
          list: { ...rect(list), clientWidth: list.clientWidth, scrollWidth: list.scrollWidth },
          listScrollHeight: list.scrollHeight,
          listClientHeight: list.clientHeight,
          listScrollTop,
          toolbarTopBeforeScroll,
          toolbarTopAfterScroll,
          toolbar: rect(toolbar),
          toolbarScrollWidth: toolbar.scrollWidth,
          toolbarClientWidth: toolbar.clientWidth,
          manageInModelRow: Boolean(document.querySelector('.pi-model-controls .pi-model-manage')),
          manageInToolbar: Boolean(toolbar.querySelector('.pi-model-manage')),
          toolbarIsOutsideList: !list.contains(toolbar),
          toolbarParentIsWorkspace: toolbar.parentElement === workspace,
          button: rect(button),
          historyButton: rect(historyButton),
          visibleHistoryButtonWidth: Math.max(0, Math.min(historyButtonRect.right, clipRight) - Math.max(historyButtonRect.left, clipLeft)),
          visibleButtonWidth: Math.max(0, Math.min(buttonRect.right, clipRight) - Math.max(buttonRect.left, clipLeft)),
        };
      });
      assert.ok(geometry, 'the new-conversation action is rendered in the workbench toolbar');
      assert.equal(geometry.toolbarIsOutsideList, true, `${locale} toolbar must not share the task-list scrollbar layer`);
      assert.equal(geometry.toolbarParentIsWorkspace, true, `${locale} toolbar remains fixed in the workbench content`);
      assert.ok(geometry.listScrollHeight > geometry.listClientHeight, `${locale} fixture must exercise an overflowing task list: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.listScrollTop > 0, `${locale} fixture actually scrolls the task list: ${JSON.stringify(geometry)}`);
      assert.equal(geometry.toolbarTopAfterScroll, geometry.toolbarTopBeforeScroll, `${locale} toolbar stays fixed while the task list scrolls`);
      assert.ok(
        geometry.toolbarScrollWidth <= geometry.toolbarClientWidth + 1,
        `${locale} toolbar keeps both actions inside the panel without horizontal clipping: ${geometry.toolbarScrollWidth}/${geometry.toolbarClientWidth}`
      );
      assert.equal(geometry.manageInModelRow, true, `${locale} manage-models lives in the model controls as a secondary action`);
      assert.equal(geometry.manageInToolbar, false, `${locale} header toolbar carries no orphan manage-models button`);
      assert.ok(
        geometry.button.width > 0 && geometry.visibleButtonWidth >= geometry.button.width - 1,
        `${locale} new-conversation action remains fully visible outside the 704px task-list scrollport: ${JSON.stringify(geometry)}`
      );
      assert.ok(
        geometry.historyButton.width > 0 && geometry.visibleHistoryButtonWidth >= geometry.historyButton.width - 1,
        `${locale} conversation-history action remains fully visible outside the 704px task-list scrollport: ${JSON.stringify(geometry)}`
      );
      if (qaDir) {
        const panel = await historyShell.locator('#library').boundingBox();
        await historyShell.screenshot({
          path: path.join(qaDir, `issue-217-workbench-${locale}-704x568.png`),
          clip: { x: panel.x - 2, y: panel.y - 2, width: panel.width + 4, height: 220 },
        });
      }
      console.log(`PASS ${locale} new-conversation button fits the 704px workbench: ${JSON.stringify(geometry)}`);
    }
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
