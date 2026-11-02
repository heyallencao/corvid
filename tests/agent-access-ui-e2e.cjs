const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-access-ui-'));
  let app;
  try {
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' } });
    const shell = await app.firstWindow();
    const controlPath = path.join(dataDir, 'control.json');
    let control;
    for (let i = 0; i < 200; i++) {
      try { control = JSON.parse(fs.readFileSync(controlPath, 'utf8')); break; } catch { await delay(25); }
    }
    assert.ok(control?.token);
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(control.baseUrl + route, { method, headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      return payload;
    };

    const room = await call('/rooms', 'POST', { name: 'Browser MCP 工作空间' });
    await app.evaluate(({ clipboard }) => { clipboard.writeText = text => { globalThis.__copiedAgentClientToken = text; }; });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(704, 568));
    await shell.getByRole('button', { name: '设置', exact: true }).click();
    await shell.getByRole('dialog').filter({ has: shell.getByText('搜索引擎') }).waitFor();
    await shell.getByRole('button', { name: '管理 Agent 访问' }).click();
    const accessDialog = shell.getByRole('dialog', { name: '外部 Agent 访问' });
    await accessDialog.waitFor();
    await accessDialog.getByRole('textbox', { name: '客户端名称' }).fill('Browser MCP 测试客户端');
    await accessDialog.getByRole('checkbox', { name: /Browser MCP 工作空间/ }).check();
    await accessDialog.getByRole('button', { name: '创建访问密钥' }).click();
    const tokenField = accessDialog.getByRole('textbox', { name: '一次性 Agent 访问密钥' });
    await tokenField.waitFor();
    const token = await tokenField.inputValue();
    assert.match(token, /^corvid_agent_/);
    await accessDialog.getByRole('button', { name: '复制访问密钥' }).click();
    await accessDialog.getByText('已复制到剪贴板').waitFor();
    assert.equal(await app.evaluate(() => globalThis.__copiedAgentClientToken), token, 'the explicit copy action writes the one-time token');
    await accessDialog.getByText('Browser MCP 测试客户端', { exact: true }).waitFor();
    if (process.env.CORVID_UI_REVIEW_PATH) {
      await accessDialog.locator('#agent-client-token-panel').evaluate(panel => { panel.hidden = true; });
      await accessDialog.evaluate(dialog => { dialog.scrollTop = 0; });
      await shell.screenshot({ path: process.env.CORVID_UI_REVIEW_PATH });
    }
    const storePath = path.join(dataDir, 'agent-clients.json');
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    assert.equal(store.clients.some(client => JSON.stringify(client).includes(token)), false, 'the visible one-time token is not persisted');
    assert.equal((fs.statSync(storePath).mode & 0o777), 0o600);

    await accessDialog.getByRole('button', { name: '关闭授权管理' }).click();
    await accessDialog.waitFor({ state: 'hidden' });
    await shell.waitForFunction(() => document.querySelector('#agent-client-token').value === '');
    await shell.evaluate(() => { window.confirm = () => true; });
    await shell.getByRole('button', { name: '设置', exact: true }).click();
    await shell.getByRole('button', { name: '管理 Agent 访问' }).click();
    const reopened = shell.getByRole('dialog', { name: '外部 Agent 访问' });
    await reopened.getByRole('button', { name: '撤销 Browser MCP 测试客户端 的访问权限' }).click();
    await reopened.getByText('已撤销 · Browser MCP 工作空间').waitFor();
    assert.equal((await call('/rooms', 'GET')).rooms.some(item => item.id === room.id), true, 'administrator Room access remains available');
    const rejected = await fetch(control.baseUrl + '/rooms', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(rejected.status, 401, 'the UI revoke action immediately invalidates the copied token');
    console.log('Agent access management UI E2E passed');
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
