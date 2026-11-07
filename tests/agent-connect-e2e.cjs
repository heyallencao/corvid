// corvid connect 授权语义 E2E（真实 Electron）：自动签发 openRoomGrant 凭据、
// 自建 Room 自动授权、他人/用户 Room 403、凭据轮换撤销、finish 收据字段、
// 沙箱 HOME 四 host 写入/还原与无关字段保护。全程不触碰真实 agent 配置。
const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const cliPath = path.join(project, 'cli', 'corvid.mjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-connect-'));
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-connect-home-'));
  const fixture = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<title>${request.url}</title><p>connect fixture</p>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;

  // 沙箱 agent 配置文件，携带 connect/disconnect 必须原样保留的无关内容。
  const codexConfig = path.join(sandboxHome, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
  const codexFixture = [
    '# codex fixture',
    'model = "gpt-6"',
    '',
    '[mcp_servers.node_repl]',
    'command = "n"',
    'args = ["x"]',
    '',
    '[mcp_servers.node_repl.env]',
    'A = "1"',
    '',
    '[mcp_servers.rea]',
    'command = "rea"',
  ].join('\n');
  fs.writeFileSync(codexConfig, `${codexFixture}\n`);

  const claudeConfig = path.join(sandboxHome, '.claude.json');
  fs.writeFileSync(claudeConfig, JSON.stringify({ numStartups: 5, mcpServers: { other: { command: 'x' } }, projects: { '/a': { enabled: true } } }));

  const cursorConfig = path.join(sandboxHome, '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(cursorConfig), { recursive: true });
  fs.writeFileSync(cursorConfig, JSON.stringify({ mcpServers: { other: { command: 'y' } } }));

  const dshConfig = path.join(sandboxHome, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
  fs.mkdirSync(path.dirname(dshConfig), { recursive: true });
  const dshFixture = [
    '# personal configuration',
    '- id: locale',
    '  name: "@deepseek-ai/dsh-client-locale"',
    '  config:',
    '    preference: zh',
  ].join('\n');
  fs.writeFileSync(dshConfig, `${dshFixture}\n`);

  const sandboxEnv = { ...process.env, HOME: sandboxHome, USERPROFILE: sandboxHome, CORVID_DATA_DIR: dataDir, CORVID_AGENT_TOKEN: '' };

  const runCli = args => execFileSync('node', [cliPath, ...args], { encoding: 'utf8', env: sandboxEnv });
  const expectCliError = args => {
    try { execFileSync('node', [cliPath, ...args], { encoding: 'utf8', env: sandboxEnv }); }
    catch (error) { return error.stderr || error.stdout || String(error); }
    throw new Error(`corvid ${args.join(' ')} unexpectedly succeeded`);
  };

  let app;
  try {
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' } });
    await app.firstWindow();
    const controlPath = path.join(dataDir, 'control.json');
    let control;
    for (let i = 0; i < 200; i++) {
      try { control = JSON.parse(fs.readFileSync(controlPath, 'utf8')); break; } catch { await delay(25); }
    }
    assert.ok(control?.token, 'desktop publishes its administrator credential');

    const request = async (credential, route, method = 'GET', body) => {
      const response = await fetch(control.baseUrl + route, { method, headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      let payload = null;
      try { payload = await response.json(); } catch {}
      return { status: response.status, payload };
    };

    // 0. 非交互无 --yes 拒绝写入
    const refusal = expectCliError(['connect', 'codex']);
    assert.match(refusal, /--yes/, 'non-interactive connect requires --yes');
    assert.equal(fs.readFileSync(codexConfig, 'utf8'), `${codexFixture}\n`, 'a refused connect leaves the host config untouched');

    // 1. connect codex --yes（无 --token）：自动签发 openRoomGrant 凭据并写入
    const connectOutput = runCli(['connect', 'codex', '--yes']);
    assert.match(connectOutput, /openRoomGrant/, 'connect reports the automatic credential issuance');
    assert.match(connectOutput, /凭据：/, 'connect reports the issued client id');
    const codexAfterConnect = fs.readFileSync(codexConfig, 'utf8');
    assert.match(codexAfterConnect, /\[mcp_servers\.corvid-browser\]/, 'codex entry added');
    assert.match(codexAfterConnect, /command = "node"/, 'entry carries the node command');
    assert.match(codexAfterConnect, /CORVID_AGENT_TOKEN = "corvid_agent_/, 'entry carries a scoped token');
    assert.ok(codexAfterConnect.includes(path.join(project, 'mcp', 'corvid.mjs')), 'entry points at the repo MCP script');
    assert.ok(codexAfterConnect.includes('[mcp_servers.node_repl]'), 'unrelated codex entry survives');
    assert.ok(codexAfterConnect.startsWith('# codex fixture'), 'codex preamble preserved');
    assert.equal(fs.readFileSync(path.join(sandboxHome, '.codex', 'skills', 'corvid-browser', 'SKILL.md'), 'utf8').includes('# Corvid 浏览器自动化'), true, 'skill installed for codex');

    const codexToken = /CORVID_AGENT_TOKEN = "(corvid_agent_[^"]+)"/.exec(codexAfterConnect)[1];
    assert.equal((await request(codexToken, '/rooms')).status, 200, 'the written token authenticates');

    // 2. scoped 凭据可自建 Room 并自动获得授权
    const opened = await request(codexToken, '/rooms/open', 'POST', { identifier: 'connect-e2e-room' });
    assert.equal(opened.status, 200, 'a scoped openRoomGrant client opens a new agent room');
    const roomId = opened.payload.id;
    assert.equal(opened.payload.ownership, 'agent');
    const resumed = await request(codexToken, '/rooms/open', 'POST', { identifier: 'connect-e2e-room' });
    assert.equal(resumed.payload.id, roomId, 'opening the same name resumes the granted room');
    const state = await request(codexToken, '/rooms');
    assert.deepEqual(state.payload.rooms.map(room => room.id), [roomId], 'the opened room is granted to the client');

    const page = await request(codexToken, `/rooms/${roomId}/tabs`, 'POST', { url: fixtureOrigin });
    assert.equal(page.status, 200, 'the granted room accepts page operations');

    // 3. 授权范围外的他人/用户 Room 一律 403（撞名不建重名 Room）
    const adminRoom = await request(control.token, '/rooms/open', 'POST', { identifier: 'admin-owned-room' });
    assert.equal(adminRoom.status, 200);
    const otherGrant = await request(control.token, '/agent-clients', 'POST', { name: 'Other Agent', roomIds: [], openRoomGrant: true });
    assert.equal(otherGrant.status, 200, 'openRoomGrant credentials are issuable through the control API');
    const foreignOpen = await request(otherGrant.payload.token, '/rooms/open', 'POST', { identifier: 'admin-owned-room' });
    assert.equal(foreignOpen.status, 403, 'a scoped client cannot resume another principal\'s room by name');
    const userRoom = await request(control.token, '/rooms', 'POST', { name: 'connect-e2e-user-room' });
    assert.equal(userRoom.status, 200);
    const userOwned = await request(codexToken, '/rooms/open', 'POST', { identifier: 'connect-e2e-user-room' });
    assert.equal(userOwned.status, 403, 'user-owned rooms are refused to scoped clients (not silently taken over)');
    const roomsAfterClash = await request(control.token, '/rooms');
    assert.equal(roomsAfterClash.payload.rooms.filter(room => room.name === 'connect-e2e-user-room').length, 1, 'a refused clash does not create a duplicate-name room');

    // 4. finish 收据字段合同
    const finished = await request(codexToken, `/rooms/${roomId}/finish`, 'POST', { keep: [] });
    assert.equal(finished.status, 200, 'the scoped client can finish its own room');
    for (const key of ['closedManagedLabels', 'keptManagedLabels', 'preservedUnmanagedCount']) assert.ok(Object.hasOwn(finished.payload, key), `finish receipt carries ${key}`);
    assert.deepEqual(finished.payload.closedManagedLabels.sort(), ['p1', 'p2'], 'the seeded and test-created managed pages are reported closed');

    // 5. 重连轮换凭据并保持收据一致
    const firstClientId = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-connections.json'), 'utf8')).hosts.codex.clientId;
    runCli(['connect', 'codex', '--yes']);
    const codexAfterReconnect = fs.readFileSync(codexConfig, 'utf8');
    const newToken = /CORVID_AGENT_TOKEN = "(corvid_agent_[^"]+)"/.exec(codexAfterReconnect)[1];
    assert.notEqual(newToken, codexToken, 'reconnect issues a fresh token');
    assert.equal((await request(codexToken, '/rooms')).status, 401, 'the previous token is revoked');
    assert.equal((await request(newToken, '/rooms')).status, 200, 'the new token authenticates');
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-connections.json'), 'utf8')).hosts.codex.clientId, firstClientId, 'receipt tracks the new credential');

    // 6. claude-code、cursor、dsh 写入与无关字段保护
    runCli(['connect', 'claude-code', '--yes']);
    const claudeAfter = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
    assert.equal(claudeAfter.numStartups, 5, 'claude.json unrelated top-level keys survive');
    assert.equal(claudeAfter.mcpServers.other.command, 'x', 'other MCP servers survive');
    assert.equal(claudeAfter.mcpServers['corvid-browser'].command, 'node', 'claude entry uses node');
    assert.equal(claudeAfter.mcpServers['corvid-browser'].env.CORVID_AGENT_TOKEN.startsWith('corvid_agent_'), true, 'claude entry carries a scoped token');
    assert.equal(fs.existsSync(path.join(sandboxHome, '.claude', 'skills', 'corvid-browser', 'SKILL.md')), true, 'skill installed for claude-code');

    runCli(['connect', 'cursor', '--yes']);
    const cursorAfter = JSON.parse(fs.readFileSync(cursorConfig, 'utf8'));
    assert.equal(cursorAfter.mcpServers.other.command, 'y', 'cursor unrelated servers survive');
    assert.equal(cursorAfter.mcpServers['corvid-browser'].env.CORVID_AGENT_TOKEN.startsWith('corvid_agent_'), true, 'cursor entry written');
    assert.equal(fs.existsSync(path.join(sandboxHome, '.cursor', 'skills', 'corvid-browser', 'SKILL.md')), true, 'skill installed for cursor');

    runCli(['connect', 'dsh', '--yes']);
    const dshAfter = fs.readFileSync(dshConfig, 'utf8');
    assert.match(dshAfter, /- insert:/, 'dsh patch insert entry written');
    assert.match(dshAfter, /name: "@deepseek-ai\/dsh-mcp-client"/, 'dsh entry targets the mcp-client plugin');
    assert.ok(dshAfter.includes('# personal configuration'), 'dsh user comment preserved');
    assert.ok(dshAfter.includes('preference: zh'), 'dsh user entry preserved');
    assert.equal(fs.existsSync(path.join(sandboxHome, '.dsh', 'skills', 'corvid-browser', 'SKILL.md')), true, 'skill installed for dsh');

    // 7. doctor：四个已接入 host 全部通过
    const doctorOutput = runCli(['doctor']);
    assert.match(doctorOutput, /✓ Corvid 控制服务/, 'doctor reaches the desktop');
    assert.equal((doctorOutput.match(/✓ .* MCP 注册/g) || []).length, 4, 'all four hosts report ok');
    assert.equal((doctorOutput.match(/✗/g) || []).length, 0, 'no host reports failures');

    // 8. disconnect 还原 connect 写入的全部内容并撤销凭据
    runCli(['disconnect', 'codex']);
    const codexAfterDisconnect = fs.readFileSync(codexConfig, 'utf8');
    assert.equal(codexAfterDisconnect.includes('[mcp_servers.corvid-browser]'), false, 'codex entry removed');
    assert.equal(codexAfterDisconnect.includes('[mcp_servers.node_repl]'), true, 'unrelated codex entry survives disconnect');
    assert.ok(codexAfterDisconnect.includes('[mcp_servers.rea]'), 'trailing unrelated section survives disconnect');
    assert.equal(fs.existsSync(path.join(sandboxHome, '.codex', 'skills', 'corvid-browser')), false, 'codex skill removed');
    assert.equal((await request(newToken, '/rooms')).status, 401, 'disconnect revokes the credential');

    runCli(['disconnect', 'claude-code']);
    const claudeAfterDisconnect = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
    assert.equal(claudeAfterDisconnect.mcpServers['corvid-browser'], undefined, 'claude entry removed');
    assert.equal(claudeAfterDisconnect.mcpServers.other.command, 'x', 'other claude servers survive');
    assert.equal(fs.existsSync(path.join(sandboxHome, '.claude', 'skills', 'corvid-browser')), false, 'claude skill removed');

    runCli(['disconnect', 'cursor']);
    const cursorAfterDisconnect = JSON.parse(fs.readFileSync(cursorConfig, 'utf8'));
    assert.equal(cursorAfterDisconnect.mcpServers['corvid-browser'], undefined, 'cursor entry removed');
    assert.equal(cursorAfterDisconnect.mcpServers.other.command, 'y', 'other cursor servers survive');

    runCli(['disconnect', 'dsh']);
    assert.equal(fs.readFileSync(dshConfig, 'utf8'), `${dshFixture}\n`, 'dsh patch file restored byte-for-byte');
    assert.equal(fs.existsSync(path.join(sandboxHome, '.dsh', 'skills', 'corvid-browser')), false, 'dsh skill removed');

    const doctorAfterDisconnect = runCli(['doctor']);
    assert.equal((doctorAfterDisconnect.match(/✗/g) || []).length, 0, 'no failures after disconnect');
    assert.equal((doctorAfterDisconnect.match(/— .* MCP 注册/g) || []).length, 4, 'all hosts report not connected');

    // 9. disconnect 幂等
    const secondDisconnect = runCli(['disconnect', 'codex']);
    assert.match(secondDisconnect, /没有 connect 收据记录|没有 corvid 的 MCP 条目/, 'a second disconnect is a no-op');
  } finally {
    if (app) await app.close();
    fixture.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  }
  process.stdout.write('agent-connect-e2e: all assertions passed\n');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
