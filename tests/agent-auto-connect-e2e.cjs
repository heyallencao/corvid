// 外部 Agent 自动接入定向 E2E：真实 Electron + 沙箱 HOME + 隔离数据目录。
// 覆盖：启动自动接线（MCP 注册/skill/收据/授权客户端/状态文件）、总开关关闭时
// 新 host 不接入、开关重开后补接入、用户既有配置内容保全。
// 运行契约：CORVID_TEST_MODE=1 + CORVID_AGENT_AUTOCONNECT_TEST=1 显式开启自动接入；
// HOME 指向临时沙箱，绝不触碰真实 home。
const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const adapters = require('../desktop/agent-host-adapters.cjs');

async function launchApp({ home, dataDir }) {
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [project],
    env: {
      ...process.env,
      HOME: home,
      CORVID_DATA_DIR: dataDir,
      CORVID_TEST_MODE: '1',
      CORVID_AGENT_AUTOCONNECT_TEST: '1',
      CORVID_PORT: '0',
    },
  });
  await app.firstWindow();
  return app;
}

async function waitFor(predicate, { timeoutMs = 30000, step = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(step);
  }
  throw new Error(`等待超时：${label}`);
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-auto-connect-e2e-'));
  const home = path.join(root, 'home');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { 'user-server': { command: 'echo' } }, theme: 'dark' }));
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'model = "gpt-5"\n\n[mcp_servers.user_server]\ncommand = "echo"\n');
  const statePath = path.join(dataDir, 'agent-auto-connect.json');

  try {
    // —— 第一段：启动自动接线 ——
    let app = await launchApp({ home, dataDir });
    const claudeConfig = path.join(home, '.claude.json');
    await waitFor(() => {
      try { return JSON.parse(fs.readFileSync(claudeConfig, 'utf8')).mcpServers['corvid-browser']; }
      catch { return false; }
    }, { label: 'claude-code 自动接入' });
    await waitFor(() => adapters.readReceipts(dataDir)?.hosts?.codex, { label: 'codex 自动接入' });
    await app.close();

    const claudeState = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
    const entry = claudeState.mcpServers['corvid-browser'];
    assert.equal(entry.command, 'node');
    assert.deepEqual(entry.args, [path.join(project, 'mcp', 'corvid.mjs')]);
    assert.ok(typeof entry.env?.CORVID_AGENT_TOKEN === 'string' && entry.env.CORVID_AGENT_TOKEN.length > 0);
    assert.equal(claudeState.mcpServers['user-server'].command, 'echo', '用户既有 MCP 条目保留');
    assert.equal(claudeState.theme, 'dark', '用户既有字段保留');
    const codexText = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.ok(codexText.includes('model = "gpt-5"'), 'codex 用户既有内容保留');
    assert.ok(codexText.includes('[mcp_servers.corvid-browser]'));
    for (const host of ['claude-code', 'codex']) {
      assert.ok(fs.existsSync(path.join(adapters.skillTargetDir(host, home), 'SKILL.md')), `${host} skill 已安装`);
    }
    const receipts = adapters.readReceipts(dataDir);
    assert.ok(receipts.hosts['claude-code'].issued && receipts.hosts['claude-code'].clientId);
    const clients = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-clients.json'), 'utf8'));
    const autoClients = clients.clients.filter(client => /^corvid-(claude-code|codex)$/.test(client.name));
    assert.equal(autoClients.length, 2, '自动签发的授权客户端数量');
    assert.ok(autoClients.every(client => Array.isArray(client.roomIds) && client.roomIds.length === 0), '初始授权范围为空（注册 ≠ 授权）');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(state.hosts['claude-code'].status, 'connected');
    assert.equal(state.hosts['codex'].status, 'connected');
    console.log('PASS auto-connect: 启动接线/既有内容保全/收据与授权客户端');

    // —— 第二段：总开关关闭，新 host（dsh）不接入 ——
    fs.mkdirSync(path.join(home, '.dsh'), { recursive: true });
    state.enabled = false;
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    app = await launchApp({ home, dataDir });
    await delay(6000);
    const dshConfig = path.join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
    assert.ok(!fs.existsSync(dshConfig), '总开关关闭时新 host 不被写入');
    const receipts2 = adapters.readReceipts(dataDir);
    assert.equal(receipts2.hosts.dsh, undefined, '总开关关闭时不产生 dsh 收据');
    assert.ok(receipts2.hosts['claude-code'], '既有接入不受影响');
    await app.close();
    console.log('PASS auto-connect: 总开关关闭不接入新 host');

    // —— 第三段：开关重开后补接入 ——
    state.enabled = true;
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    app = await launchApp({ home, dataDir });
    await waitFor(() => adapters.readReceipts(dataDir)?.hosts?.dsh, { label: '开关重开后 dsh 补接入' });
    await app.close();
    assert.ok(fs.existsSync(dshConfig), 'dsh 配置已写入');
    assert.ok(fs.existsSync(path.join(adapters.skillTargetDir('dsh', home), 'SKILL.md')));
    console.log('PASS auto-connect: 开关重开后补接入');

    // —— 第四段：设置分区 UI（状态列表/总开关/断开/一键重接） ——
    app = await launchApp({ home, dataDir });
    const shell = await app.firstWindow();
    shell.on('dialog', dialog => { dialog.accept().catch(() => {}); });
    await shell.locator('#library-trigger').click();
    await shell.locator('#library-menu:not([hidden])').waitFor();
    await shell.locator('#show-settings').click();
    await waitFor(() => shell.locator('#settings').evaluate(dialog => dialog.open), { label: '设置打开' });
    await shell.locator('#settings-nav-agent').click();
    const rowFor = host => shell.locator(`#agent-auto-connect-list .agent-client-row[data-host="${host}"]`);
    const rowButton = async host => await rowFor(host).locator('button').textContent();
    const rowStatus = async host => await rowFor(host).locator('.agent-client-summary span').first().textContent();
    await waitFor(async () => (await rowButton('dsh')) === '断开', { label: '设置分区展示接入状态' });
    assert.equal(await shell.locator('#agent-auto-connect-toggle').isChecked(), true, '总开关默认开启');
    for (const [host, label] of [['claude-code', 'Claude Code'], ['codex', 'Codex'], ['dsh', 'DeepSeek Harness (dsh)']]) {
      assert.equal(await rowFor(host).locator('strong').textContent(), label, `${host} 行标签`);
      assert.ok((await rowStatus(host)).startsWith('已接入'), `${host} 显示已接入`);
    }
    // 总开关：关闭写状态文件并回显，重开恢复。
    await shell.locator('#agent-auto-connect-toggle').click();
    await waitFor(() => JSON.parse(fs.readFileSync(statePath, 'utf8')).enabled === false, { label: '总开关关闭写入状态文件' });
    assert.equal(await shell.locator('#agent-auto-connect-toggle').isChecked(), false);
    await shell.locator('#agent-auto-connect-toggle').click();
    await waitFor(() => JSON.parse(fs.readFileSync(statePath, 'utf8')).enabled === true, { label: '总开关重开写入状态文件' });
    // 断开 dsh（确认框自动接受）：行转为「检测到，未接入」+ 接入按钮，自动签发客户端被撤销。
    await rowFor('dsh').locator('button').click();
    await waitFor(async () => (await rowButton('dsh')) === '接入', { label: 'dsh 断开后转为待接入' });
    assert.equal(await rowStatus('dsh'), '检测到，未接入');
    assert.equal(await adapters.createHostAdapter('dsh', home).inspect().then(info => info.registered), false, '断开移除 dsh 托管注册');
    const clientsAfterDisconnect = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-clients.json'), 'utf8'));
    assert.equal(clientsAfterDisconnect.clients.find(client => client.name === 'corvid-dsh').revoked, true, 'UI 断开撤销自动签发客户端');
    // 一键重接：恢复配置、收据与已接入状态。
    await rowFor('dsh').locator('button').click();
    await waitFor(async () => (await rowButton('dsh')) === '断开', { label: 'dsh 一键重接' });
    assert.ok(fs.existsSync(dshConfig), '重接恢复 dsh 配置');
    assert.ok(adapters.readReceipts(dataDir)?.hosts?.dsh, '重接恢复收据');
    await app.close();
    console.log('PASS auto-connect: 设置分区 UI（状态/开关/断开/重接）');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('PASS corvid agent auto-connect E2E');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
