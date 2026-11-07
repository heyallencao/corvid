// corvid connect/disconnect/doctor 定向 E2E：隔离沙箱 HOME，不触碰真实 agent 配置。
// 覆盖：四种 host 的 MCP 注册与 skill 分发、显式确认合同、可撤销还原、无关字段保护、doctor 诊断。
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const cliPath = path.join(project, 'cli', 'corvid.mjs');
const skillSource = path.join(project, 'skills', 'corvid-browser', 'SKILL.md');
const TOKEN = 'corvid_agent_e2e_token';
const SERVER_ENTRY = path.join(project, 'mcp', 'corvid.mjs');

function cli(args, home, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, HOME: home, CORVID_AGENT_TOKEN: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => resolve({ code, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

function assertOk(result, label) {
  assert.equal(result.code, 0, `${label} failed: ${result.stderr}`);
  return result;
}

function skillInstalled(home, host) {
  const targets = {
    'claude-code': path.join(home, '.claude', 'skills', 'corvid-browser', 'SKILL.md'),
    'codex': path.join(home, '.codex', 'skills', 'corvid-browser', 'SKILL.md'),
    'cursor': path.join(home, '.cursor', 'skills', 'corvid-browser', 'SKILL.md'),
    'dsh': path.join(home, '.dsh', 'skills', 'corvid-browser', 'SKILL.md'),
  };
  return fs.existsSync(targets[host]) && fs.readFileSync(targets[host], 'utf8') === fs.readFileSync(skillSource, 'utf8');
}

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-connect-e2e-'));
}

async function testClaudeCode() {
  const home = sandbox();
  const configPath = path.join(home, '.claude.json');
  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: { 'other-server': { type: 'stdio', command: 'npx', args: ['-y', 'other'] } },
    projects: { '/some/project': { allowedTools: ['Bash'] } },
    numStartups: 7,
  }));
  const connect = assertOk(await cli(['connect', 'claude-code', '--token', TOKEN, '--yes'], home), 'connect claude-code');
  assert.match(connect.stdout, /\.claude\.json/);
  assert.ok(connect.stdout.includes('确认写入') === false || connect.stdout.includes('--yes') === false);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(config.mcpServers['corvid-browser'], { type: 'stdio', command: 'node', args: [SERVER_ENTRY], env: { CORVID_AGENT_TOKEN: TOKEN } });
  assert.deepEqual(config.mcpServers['other-server'], { type: 'stdio', command: 'npx', args: ['-y', 'other'] });
  assert.deepEqual(config.projects, { '/some/project': { allowedTools: ['Bash'] } });
  assert.equal(config.numStartups, 7);
  assert.ok(skillInstalled(home, 'claude-code'));

  // doctor：host 作用域通过
  const doctor = assertOk(await cli(['doctor', 'claude-code'], home), 'doctor claude-code');
  assert.match(doctor.stdout, /✓ Claude Code MCP 注册/);
  assert.match(doctor.stdout, /MCP initialize 握手成功/);
  assert.match(doctor.stdout, /✓ Claude Code skill/);

  // 幂等：重复 connect 不再写入
  const again = assertOk(await cli(['connect', 'claude-code', '--token', TOKEN, '--yes'], home), 'reconnect claude-code');
  assert.match(again.stdout, /已是最新，未做任何写入/);

  // 撤销还原
  assertOk(await cli(['disconnect', 'claude-code'], home), 'disconnect claude-code');
  const reverted = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(reverted.mcpServers['corvid-browser'], undefined);
  assert.deepEqual(reverted.mcpServers['other-server'], { type: 'stdio', command: 'npx', args: ['-y', 'other'] });
  assert.deepEqual(reverted.projects, { '/some/project': { allowedTools: ['Bash'] } });
  assert.equal(reverted.numStartups, 7);
  assert.equal(skillInstalled(home, 'claude-code'), false);
  // 再次 disconnect 优雅处理
  assertOk(await cli(['disconnect', 'claude-code'], home), 're-disconnect claude-code');
  // doctor 报告未注册并退出非零
  const missing = await cli(['doctor', 'claude-code'], home);
  assert.notEqual(missing.code, 0);
  assert.match(missing.stdout, /✗ Claude Code MCP 注册/);
  fs.rmSync(home, { recursive: true, force: true });
  console.log('PASS connect claude-code: 注册/无关字段/幂等/撤销/doctor');
}

async function testCursor() {
  const home = sandbox();
  const configPath = path.join(home, '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { legacy: { command: 'npx', args: ['-y', 'x'] } } }));
  assertOk(await cli(['connect', 'cursor', '--yes'], home), 'connect cursor');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(config.mcpServers['corvid-browser'], { command: 'node', args: [SERVER_ENTRY] });
  assert.deepEqual(config.mcpServers.legacy, { command: 'npx', args: ['-y', 'x'] });
  assert.ok(skillInstalled(home, 'cursor'));
  assertOk(await cli(['disconnect', 'cursor'], home), 'disconnect cursor');
  const reverted = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(reverted, { mcpServers: { legacy: { command: 'npx', args: ['-y', 'x'] } } });
  assert.equal(skillInstalled(home, 'cursor'), false);
  fs.rmSync(home, { recursive: true, force: true });
  console.log('PASS connect cursor: 无 token 注册（env 缺失时由环境变量提供）/撤销');
}

async function testCodex() {
  const home = sandbox();
  const configPath = path.join(home, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = [
    '# user comment',
    'model = "gpt-x"',
    '',
    '[projects."/work"]',
    'trust_level = "trusted"',
    '',
    '[mcp_servers.other]',
    'command = "npx"',
    'args = ["-y", "other"]',
    '',
  ].join('\n');
  fs.writeFileSync(configPath, original);
  assertOk(await cli(['connect', 'codex', '--token', TOKEN, '--yes'], home), 'connect codex');
  const text = fs.readFileSync(configPath, 'utf8');
  assert.match(text, /\[mcp_servers\.corvid-browser\]/);
  assert.ok(text.includes(`args = ["${SERVER_ENTRY}"]`));
  assert.ok(text.includes(`env = { CORVID_AGENT_TOKEN = "${TOKEN}" }`));
  assert.match(text, /# user comment/);
  assert.match(text, /\[projects\."\/work"\]/);
  assert.match(text, /\[mcp_servers\.other\]/);
  assert.ok(skillInstalled(home, 'codex'));
  assertOk(await cli(['disconnect', 'codex'], home), 'disconnect codex');
  const reverted = fs.readFileSync(configPath, 'utf8');
  assert.ok(!reverted.includes('corvid-browser'));
  assert.match(reverted, /# user comment/);
  assert.match(reverted, /\[projects\."\/work"\]/);
  assert.match(reverted, /\[mcp_servers\.other\]/);
  fs.rmSync(home, { recursive: true, force: true });
  console.log('PASS connect codex: TOML 节插入/原有节与注释保留/撤销');
}

async function testDsh() {
  const home = sandbox();
  const configPath = path.join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = [
    '# personal configuration',
    '- id: locale',
    '  name: "@deepseek-ai/dsh-client-locale"',
    '  config:',
    '    preference: zh',
    '- id: ui-theme',
    '  config:',
    '    preference: dark',
  ].join('\n');
  fs.writeFileSync(configPath, original);
  assertOk(await cli(['connect', 'dsh', '--token', TOKEN, '--yes'], home), 'connect dsh');
  const text = fs.readFileSync(configPath, 'utf8');
  assert.match(text, /- insert:/);
  assert.match(text, /name: "@deepseek-ai\/dsh-mcp-client"/);
  assert.match(text, /serverName: corvid-browser/);
  assert.ok(text.includes(`- ${SERVER_ENTRY}`));
  assert.ok(text.includes('CORVID_AGENT_TOKEN: corvid_agent_e2e_token'));
  assert.match(text, /# personal configuration/);
  assert.match(text, /preference: dark/);
  assert.ok(skillInstalled(home, 'dsh'));
  assertOk(await cli(['disconnect', 'dsh'], home), 'disconnect dsh');
  const reverted = fs.readFileSync(configPath, 'utf8');
  assert.ok(!reverted.includes('corvid'));
  assert.match(reverted, /# personal configuration/);
  assert.match(reverted, /preference: dark/);
  assert.equal(skillInstalled(home, 'dsh'), false);
  fs.rmSync(home, { recursive: true, force: true });
  console.log('PASS connect dsh: patch 插入/用户条目与注释保留/撤销');
}

async function testConfirmationContract() {
  const home = sandbox();
  const configPath = path.join(home, '.claude.json');
  // 非交互且无 --yes：拒绝写入
  const refused = await cli(['connect', 'claude-code', '--token', TOKEN], home);
  assert.notEqual(refused.code, 0);
  assert.match(refused.stderr, /--yes/);
  assert.equal(fs.existsSync(configPath), false);
  assert.equal(skillInstalled(home, 'claude-code'), false);
  fs.rmSync(home, { recursive: true, force: true });
  console.log('PASS confirmation: 非交互无 --yes 不写入');
}

async function testDriftProtection() {
  const home = sandbox();
  const configPath = path.join(home, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  assertOk(await cli(['connect', 'codex', '--token', TOKEN, '--yes'], home), 'connect codex (drift)');
  // 用户改动我们管理的条目后再 disconnect：仍移除但报告漂移（结构形状变化才算漂移，token 轮转不算）
  fs.writeFileSync(configPath, [
    '[mcp_servers.corvid-browser]',
    'command = "node"',
    `args = ["${SERVER_ENTRY}"]`,
    'env = { CORVID_AGENT_TOKEN = "hand-edited" }',
    'startup_timeout_ms = 5000',
    '',
  ].join('\n'));
  const disconnect = assertOk(await cli(['disconnect', 'codex'], home), 'disconnect drifted codex');
  assert.match(disconnect.stdout, /不一致/);
  assert.ok(!fs.readFileSync(configPath, 'utf8').includes('corvid-browser'));
  // 用户轮转 token（形状不变）：disconnect 正常移除、不报漂移
  assertOk(await cli(['connect', 'codex', '--token', TOKEN, '--yes'], home), 'reconnect codex (rotation)');
  fs.writeFileSync(configPath, [
    '[mcp_servers.corvid-browser]',
    'command = "node"',
    `args = ["${SERVER_ENTRY}"]`,
    'env = { CORVID_AGENT_TOKEN = "rotated" }',
    '',
  ].join('\n'));
  const rotation = assertOk(await cli(['disconnect', 'codex'], home), 'disconnect rotated codex');
  assert.doesNotMatch(rotation.stdout, /不一致/);
  assert.ok(!fs.readFileSync(configPath, 'utf8').includes('corvid-browser'));
  // 用户改坏的 TOML：connect 拒绝执行
  fs.writeFileSync(configPath, '[mcp_servers.corvid-browser\ncommand = "broken');
  const broken = await cli(['connect', 'codex', '--token', TOKEN, '--yes'], home);
  assert.notEqual(broken.code, 0);
  assert.match(broken.stderr, /TOML/);
  fs.rmSync(home, { recursive: true, force: true });
  console.log('PASS drift: 手改条目报告/损坏配置拒绝写入');
}

(async () => {
  await testClaudeCode();
  await testCursor();
  await testCodex();
  await testDsh();
  await testConfirmationContract();
  await testDriftProtection();
  console.log('PASS corvid connect E2E');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
