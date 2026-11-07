// P1.4 外部 Agent 可见性定向 E2E：agent 空间的标签栏命名分组徽章（含外部客户端名）、
// 受管页 chip 标记、room_finish 收尾分报状态条。真实 Electron + 隔离数据目录。
const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class McpProcess {
  constructor(dataDir, agentToken) {
    this.child = spawn(process.execPath, [path.join(project, 'mcp', 'corvid.mjs')], { cwd: project, env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_AGENT_TOKEN: agentToken }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = ''; this.pending = new Map(); this.nextId = 1; this.stderr = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      for (;;) {
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) break;
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try { const message = JSON.parse(line); if (message.id !== undefined && this.pending.has(message.id)) { this.pending.get(message.id)(message); this.pending.delete(message.id); } } catch {}
      }
    });
    this.child.stderr.on('data', chunk => { this.stderr += chunk; });
  }
  async call(name, args) {
    const id = this.nextId++;
    const waiter = new Promise(resolve => this.pending.set(id, resolve));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
    const response = await Promise.race([waiter, delay(15000).then(() => { throw new Error(`MCP ${name} timed out; stderr=${this.stderr}`); })]);
    if (response.error) throw new Error(`${name}: ${JSON.stringify(response.error)}`);
    return JSON.parse(response.result.content.find(item => item.type === 'text')?.text);
  }
  async connect() {
    const id = this.nextId++;
    const waiter = new Promise(resolve => this.pending.set(id, resolve));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'visibility-e2e', version: '1.0.0' } } })}\n`);
    await waiter;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  }
  close() { this.child.kill(); }
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-visibility-'));
  const fixture = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<title>visibility fixture</title><p>agent visibility</p>');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  let app;
  try {
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' } });
    const shell = await app.firstWindow();
    let control;
    for (let i = 0; i < 200; i++) { try { control = JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); break; } catch { await delay(25); } }
    assert.ok(control?.token, 'desktop publishes its administrator credential');
    const admin = async (route, method = 'GET', body) => {
      const response = await fetch(control.baseUrl + route, { method, headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, payload: await response.json().catch(() => null) };
    };
    const grant = await admin('/agent-clients', 'POST', { name: 'visibility-agent', roomIds: [], openRoomGrant: true });
    assert.equal(grant.status, 200);
    const mcp = new McpProcess(dataDir, grant.payload.token);
    await mcp.connect();

    // 外部 agent 建空间并建两个受管页；agentClientName 随动作留在空间上
    const opened = await mcp.call('room_open', { identifier: 'visibility-room' });
    const roomId = opened.id;
    const p1 = await mcp.call('page_new', { roomId });
    const p2 = await mcp.call('page_new', { roomId });
    await mcp.call('page_navigate_and_snapshot', { roomId, tabId: p1.targetId, url: `http://127.0.0.1:${fixture.address().port}/` });
    await admin(`/rooms/${roomId}/activate`, 'POST', {});
    await delay(300);

    // 命名分组徽章：空间名 + 外部客户端名
    const badge = shell.locator('.tab-group-agent');
    await badge.waitFor({ state: 'visible', timeout: 10000 });
    const badgeText = await badge.textContent();
    assert.ok(badgeText.includes('visibility-agent'), `group badge names the external agent client: ${badgeText}`);
    assert.ok(badgeText.includes('visibility-room') === false, 'badge carries the agent identity');

    // 受管页 chip：p1/p2 有 Agent 标记
    const managedTabs = shell.locator('.tab[data-agent-managed="true"]');
    await managedTabs.first().waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await managedTabs.count(), 3, 'the seeded page and both new agent pages carry the managed marker');
    assert.equal((await shell.locator('.tab[data-agent-managed="true"] .tab-agent-chip').first().textContent()).trim(), 'p1');

    // 收尾分报：finish(keep p1) 后状态区展示分报
    const report = await mcp.call('room_finish', { roomId, keep: ['p1'] });
    assert.deepEqual(report.closedManagedLabels.sort(), ['p2', 'p3']);
    assert.deepEqual(report.keptManagedLabels, ['p1']);
    const notice = shell.locator('#status [role="status"]', { hasText: 'visibility-agent' });
    await notice.waitFor({ state: 'visible', timeout: 10000 });
    const noticeText = await notice.textContent();
    assert.ok(noticeText.includes('p2') && noticeText.includes('p1'), `finish report names closed and kept pages: ${noticeText}`);

    mcp.close();
    console.log('PASS agent visibility: named group badge with external client identity, managed-page chips, finish report notice');
  } finally {
    if (app) await app.close().catch(() => {});
    fixture.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
