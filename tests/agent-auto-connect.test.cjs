// agent-auto-connect 服务单元测试：纯 Node，fake 凭据签发/撤销 + 沙箱 home。
// 覆盖：三 host 接线与收据、冲突保护（非托管条目不覆盖）、失败隔离（损坏配置）、
// 断开三清与撤销失败保收据、总开关、启动自愈（同 token 重写旧条目）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const autoConnect = require('../desktop/agent-auto-connect.cjs');
const adapters = require('../desktop/agent-host-adapters.cjs');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-auto-connect-test-'));
  const home = path.join(root, 'home');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  let grantSeq = 0;
  const revoked = [];
  const createGrant = ({ name, roomIds, openRoomGrant }) => {
    assert.equal(openRoomGrant, true, '自动签发必须是 openRoomGrant 客户端');
    assert.deepEqual(roomIds, [], '自动签发初始授权范围必须为空');
    grantSeq += 1;
    return { id: `grant-${grantSeq}`, name, token: `corvid_agent_test_${grantSeq}` };
  };
  const revokeClient = clientId => {
    if (clientId === 'grant-gone') { const e = new Error('not found'); e.code = 'CORVID_NOT_FOUND'; throw e; }
    if (clientId === 'grant-broken') throw new Error('revoke service exploded');
    revoked.push(clientId);
  };
  const ctx = { home, dataDir, createGrant, revokeClient };

  // —— 检测与初始状态 ——
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.dsh'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  const initial = await autoConnect.status(ctx);
  assert.equal(initial.enabled, true, '总开关默认开启');
  assert.deepEqual(initial.hosts.map(host => host.host), ['claude-code', 'codex', 'dsh'], '第一版只暴露三个 host');
  assert.ok(initial.hosts.every(host => host.detected && !host.connected));

  // —— runStartup 全量接线 ——
  const results = await autoConnect.runStartup(ctx);
  assert.deepEqual(Object.keys(results.results).sort(), ['claude-code', 'codex', 'dsh']);
  assert.ok(Object.values(results.results).every(item => item.ok), '三个 host 全部接线成功');
  assert.equal(grantSeq, 3, '恰好签发三个客户端');
  for (const host of ['claude-code', 'codex', 'dsh']) {
    const adapter = adapters.createHostAdapter(host, home);
    const inspect = await adapter.inspect();
    assert.equal(inspect.registered, true, `${host} MCP 注册已写入`);
    if (host === 'dsh') {
      // dsh 适配器的 inspect 不含 hasToken（原版合同），按其结构断言。
      const env = inspect.current?.insert?.[0]?.config?.env || {};
      assert.ok(typeof env[adapters.TOKEN_ENV_KEY] === 'string' && env[adapters.TOKEN_ENV_KEY].length > 0, `${host} token 已写入`);
    } else {
      assert.equal(inspect.hasToken, true, `${host} token 已写入`);
    }
    assert.ok(fs.existsSync(path.join(adapters.skillTargetDir(host, home), 'SKILL.md')), `${host} skill 已安装`);
  }
  const receipts = adapters.readReceipts(dataDir);
  assert.deepEqual(Object.keys(receipts.hosts).sort(), ['claude-code', 'codex', 'dsh']);
  assert.ok(Object.values(receipts.hosts).every(record => record.issued && record.clientId));
  const state = JSON.parse(fs.readFileSync(path.join(dataDir, autoConnect.STATE_FILE), 'utf8'));
  assert.ok(Object.values(state.hosts).every(record => record.status === 'connected'));
  assert.equal(fs.statSync(path.join(dataDir, autoConnect.STATE_FILE)).mode & 0o777, 0o600, '状态文件 owner-only');

  // —— runStartup 幂等：已接入的不再重签 ——
  await autoConnect.runStartup(ctx);
  assert.equal(grantSeq, 3, '已接入 host 不轮转凭据');

  // —— 冲突保护：非托管条目绝不覆盖（即使收据仍在） ——
  const codexConfig = path.join(home, '.codex', 'config.toml');
  fs.writeFileSync(codexConfig, fs.readFileSync(codexConfig, 'utf8').replace(/CORVID_AGENT_TOKEN = "[^"]+"/, 'CORVID_AGENT_TOKEN = "hand-edited", extra = "drift"'));
  const conflicted = await autoConnect.connectNow(ctx, 'codex');
  assert.equal(conflicted.ok, false, '手改条目拒绝自动重写');
  assert.equal(conflicted.code, 'CORVID_AUTO_CONNECT_CONFLICT');
  assert.ok(fs.readFileSync(codexConfig, 'utf8').includes('hand-edited'), '用户手改内容保留');
  assert.equal(grantSeq, 3, '冲突路径不签发凭据');

  // —— 失败隔离：损坏配置只影响该 host ——
  fs.writeFileSync(codexConfig, '[mcp_servers.corvid-browser\ncommand = "broken');
  const broken = await autoConnect.connectNow(ctx, 'codex');
  assert.equal(broken.ok, false);
  const claudeInspect = await adapters.createHostAdapter('claude-code', home).inspect();
  assert.equal(claudeInspect.registered, true, '损坏配置不影响其他 host 的既有接入');
  assert.equal(grantSeq, 3, '损坏配置在签发前即失败，不产生凭据');
  const stateAfterFailure = JSON.parse(fs.readFileSync(path.join(dataDir, autoConnect.STATE_FILE), 'utf8'));
  assert.equal(stateAfterFailure.hosts.codex.status, 'failed');
  assert.ok(stateAfterFailure.hosts.codex.error.includes('TOML'));

  // —— 断开：三清 ——
  const disconnected = await autoConnect.disconnectNow(ctx, 'claude-code');
  assert.equal(disconnected.configRemoved, true);
  assert.equal(disconnected.skillRemoved, true);
  assert.equal(disconnected.revoked, 'grant-1');
  assert.equal((adapters.readReceipts(dataDir).hosts['claude-code']), undefined, '收据已删除');
  assert.ok(!fs.existsSync(path.join(adapters.skillTargetDir('claude-code', home), 'SKILL.md')), 'skill 已移除');
  const claudeAfter = await adapters.createHostAdapter('claude-code', home).inspect();
  assert.equal(claudeAfter.registered, false, 'MCP 注册已移除');

  // —— 撤销失败：保留收据 + 报错 ——
  const receiptsNow = adapters.readReceipts(dataDir);
  receiptsNow.hosts.codex = { label: 'Codex', configFile: codexConfig, kind: 'toml', skillDir: adapters.skillTargetDir('codex', home), issued: true, clientId: 'grant-broken', connectedAt: new Date().toISOString() };
  await adapters.writeReceipts(receiptsNow, dataDir);
  await assert.rejects(() => autoConnect.disconnectNow(ctx, 'codex'), error => error.code === 'CORVID_AUTO_CONNECT_REVOKE_FAILED');
  assert.ok(adapters.readReceipts(dataDir).hosts.codex, '撤销失败时收据保留（防孤儿凭据）');

  // —— 总开关 ——
  await autoConnect.setEnabled(ctx, false);
  const disabled = await autoConnect.status(ctx);
  assert.equal(disabled.enabled, false);
  const skipped = await autoConnect.runStartup(ctx);
  assert.deepEqual(skipped, { skipped: 'disabled' });

  // —— CORVID_NOT_FOUND 视为已撤销，正常清理 ——
  const stale = adapters.readReceipts(dataDir);
  stale.hosts.dsh = { ...stale.hosts.dsh, clientId: 'grant-gone' };
  await adapters.writeReceipts(stale, dataDir);
  const staleDisconnect = await autoConnect.disconnectNow(ctx, 'dsh');
  assert.equal(staleDisconnect.revoked, 'grant-gone');
  assert.equal(adapters.readReceipts(dataDir).hosts.dsh, undefined);

  // —— 自愈：条目路径漂移时用现有 token 重写，不轮转凭据 ——
  await autoConnect.setEnabled(ctx, true);
  const dshHome = path.join(root, 'home2');
  fs.mkdirSync(dshHome, { recursive: true });
  fs.mkdirSync(path.join(dshHome, '.dsh', 'profiles', 'desktop'), { recursive: true });
  const ctx2 = { ...ctx, home: dshHome };
  await autoConnect.connectNow(ctx2, 'dsh');
  const before = grantSeq;
  const dshConfig = path.join(dshHome, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
  fs.writeFileSync(dshConfig, fs.readFileSync(dshConfig, 'utf8').replace(/- \/[^\n]+corvid\.mjs/, '- /old/install/path/corvid.mjs'));
  await autoConnect.runStartup(ctx2);
  const healed = fs.readFileSync(dshConfig, 'utf8');
  assert.ok(!healed.includes('/old/install/path/corvid.mjs'), '旧条目路径已被重写');
  assert.equal(grantSeq, before, '自愈不签发新凭据');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS agent-auto-connect unit: 接线/冲突/隔离/三清/开关/自愈');
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
