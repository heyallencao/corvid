const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-rooms-'));
  let app;

  async function until(fn) {
    for (let i = 0; i < 200; i++) {
      const value = await fn();
      if (value) return value;
      await delay(25);
    }
    throw new Error('Timed out waiting for Agent Room panel state');
  }

  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const shell = await app.firstWindow();
    const control = await until(() => {
      try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); }
      catch { return null; }
    });
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(control.baseUrl + route, {
        method,
        headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      return result;
    };

    const bookmarksTrigger=shell.locator('#show-bookmarks');
    await bookmarksTrigger.click();
    await shell.locator('#library[data-kind="bookmarks"]').waitFor();
    await shell.locator('#close-library').focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.evaluate(() => document.activeElement.id),'show-bookmarks','closing Bookmarks restores focus to the sidebar control that opened it');

    for(const [kind,triggerId] of [['history','show-history'],['downloads','show-downloads']]){
      await shell.locator(`#${triggerId}`).click();
      await shell.locator(`#library[data-kind="${kind}"]`).waitFor();
      await shell.locator('#close-library').focus();
      await shell.keyboard.press('Enter');
      await shell.locator('#library').waitFor({ state: 'hidden' });
      assert.equal(await shell.evaluate(() => document.activeElement.id),triggerId,`closing ${kind} restores focus to its sidebar control`);
    }

    const agentRoomsTrigger=shell.getByRole('button', { name: 'Agent 工作区' });
    await agentRoomsTrigger.click();
    await shell.getByText('当前 Profile 暂无 Agent Room。通过 SDK/CLI 启动的工作区会显示在这里。').waitFor();
    assert.equal(await shell.locator('#library-search').isVisible(), false);
    await shell.locator('#close-library').focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.getByRole('button', { name: 'Agent 工作区' }).getAttribute('aria-expanded'), 'false');
    assert.equal(await shell.evaluate(() => document.activeElement.id),'show-agent-rooms','closing Agent Rooms restores focus to its sidebar control');
    await shell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    await shell.locator('#library[data-kind="pi-workbench"]').waitFor();
    await agentRoomsTrigger.click();
    await shell.locator('#library[data-kind="agent-rooms"]').waitFor();
    await shell.locator('#close-library').focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.evaluate(() => document.activeElement.id),'show-agent-rooms','switching panels updates the focus restoration target');
    await shell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    await shell.locator('#library[data-kind="pi-workbench"]').waitFor();
    await shell.locator('#close-library').focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.evaluate(() => document.activeElement.id),'show-pi-workbench','closing Pi workbench restores focus to its sidebar control');
    await agentRoomsTrigger.click();
    await shell.getByText('当前 Profile 暂无 Agent Room。通过 SDK/CLI 启动的工作区会显示在这里。').waitFor();

    const defaultRoom = await call('/rooms', 'POST', { name: 'Default agent room' });
    await shell.getByRole('button', { name: '查看 Default agent room' }).waitFor();
    assert.equal(await shell.getByText('Agent 控制中 · 1 个标签').isVisible(), true);
    await call('/rooms', 'POST', { name: 'Parallel agent room' });
    await shell.getByRole('button', { name: '查看 Parallel agent room' }).waitFor();

    const otherProfile = await call('/profiles', 'POST', { name: 'Work profile' });
    const otherRoom = await call('/rooms', 'POST', { name: 'Work agent room', profileId: otherProfile.id });
    await shell.getByRole('button', { name: '查看 Default agent room' }).waitFor();
    assert.equal(await shell.getByText('Work agent room', { exact: true }).count(), 0);

    await shell.getByLabel('Profile', { exact: true }).selectOption(otherProfile.id);
    await shell.getByRole('button', { name: '查看 Work agent room' }).waitFor();
    assert.equal(await shell.getByText('Default agent room', { exact: true }).count(), 0);
    assert.equal(await shell.getByText('Parallel agent room', { exact: true }).count(), 0);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow().setSize(640, 600));
    await shell.waitForFunction(() => window.innerWidth <= 700);
    const panelLayout = await shell.locator('#library').evaluate(panel => {
      const row = panel.querySelector('.agent-room-entry');
      return { width: panel.clientWidth, scrollWidth: row.scrollWidth, rowWidth: row.clientWidth };
    });
    assert.ok(panelLayout.width > 0);
    assert.ok(panelLayout.scrollWidth <= panelLayout.rowWidth, JSON.stringify(panelLayout));

    const view = shell.getByRole('button', { name: '查看 Work agent room' });
    await view.focus();
    await shell.keyboard.press('Tab');
    assert.equal(await shell.evaluate(() => document.activeElement.getAttribute('aria-label')), '接管 Work agent room');
    await shell.keyboard.press('Enter');
    await until(async () => (await call('/rooms')).rooms.find(room => room.id === otherRoom.id)?.ownership === 'user');
    await shell.getByRole('button', { name: '交还 Agent：Work agent room' }).focus();
    await shell.keyboard.press('Enter');
    await until(async () => (await call('/rooms')).rooms.find(room => room.id === otherRoom.id)?.ownership === 'agent');

    const risky = await call('/tabs/' + otherRoom.tabs[0].id + '/action', 'POST', {
      operation: 'evaluate',
      args: { expression: 'new Promise(() => {})', timeoutMs: 100 },
    });
    assert.equal(risky.status, 'timed_out');
    await shell.getByRole('button', { name: '复核 Work agent room 的执行状态' }).waitFor();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
    await shell.getByRole('button', { name: '复核 Work agent room 的执行状态' }).click();
    const reviewed = (await call('/rooms')).rooms.find(room => room.id === otherRoom.id);
    assert.equal(reviewed.ownership, 'user');
    assert.ok(reviewed.executionRisk);
    await shell.getByText('页面执行状态未知 · 1 个标签').waitFor();

    await shell.getByRole('button', { name: '查看 Work agent room' }).click();
    await shell.locator('#library').waitFor({ state: 'hidden' });
    const active = await call('/rooms');
    assert.equal(active.activeRoomId, otherRoom.id);
    assert.equal(await shell.getByRole('button', { name: 'Work agent room' }).getAttribute('class').then(value => value.includes('selected')), true);

    console.log('PASS Agent Room panel empty state, parallel rooms, Profile filtering, narrow layout, keyboard handoff and Room activation');
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
