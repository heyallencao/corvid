// browser_script（P1.1）定向 E2E：开关合同、一次调用完成批量任务、越权 Room 拒绝、
// 超时强杀后页面状态一致、输出截断、脚本错误收据。真实 Electron + 隔离数据目录。
const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const project = path.resolve(__dirname, '..');
const serverPath = path.join(project, 'mcp', 'corvid.mjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class McpProcess {
  constructor(dataDir, agentToken, { browserScript = false } = {}) {
    const env = { ...process.env, CORVID_DATA_DIR: dataDir };
    if (agentToken) env.CORVID_AGENT_TOKEN = agentToken; else delete env.CORVID_AGENT_TOKEN;
    if (browserScript) env.CORVID_BROWSER_SCRIPT = '1'; else delete env.CORVID_BROWSER_SCRIPT;
    this.child = spawn(process.execPath, [serverPath], { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = '';
    this.pending = new Map();
    this.stderr = '';
    this.nextId = 1;
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
        let message;
        try { message = JSON.parse(line); }
        catch (error) { for (const waiter of this.pending.values()) waiter.reject(new Error(`Invalid JSON-RPC stdout: ${line}: ${error.message}`)); continue; }
        if (message.id !== undefined && this.pending.has(message.id)) {
          const waiter = this.pending.get(message.id);
          this.pending.delete(message.id);
          waiter.resolve(message);
        }
      }
    });
    this.child.stderr.on('data', chunk => { this.stderr += chunk; });
  }
  async request(method, params = {}) {
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const message = await Promise.race([response, delay(10000).then(() => { throw new Error(`MCP request timed out: ${method}; stderr=${this.stderr}`); })]);
    if (message.error) throw new Error(`${method}: ${JSON.stringify(message.error)}`);
    return message.result;
  }
  notify(method, params = {}) { this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); }
  async connect() {
    const result = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'corvid-e2e', version: '1.0.0' } });
    assert.equal(result.serverInfo.name, 'corvid-browser');
    this.notify('notifications/initialized');
    return result;
  }
  async callTool(name, args) {
    const result = await this.request('tools/call', { name, arguments: args });
    const text = result.content.find(item => item.type === 'text')?.text;
    assert.ok(text, `${name} returned no text content`);
    return { result, value: JSON.parse(text) };
  }
  async close() {
    if (this.child.exitCode !== null) return;
    this.child.stdin.end();
    await Promise.race([once(this.child, 'exit'), delay(1000)]);
    if (this.child.exitCode === null) this.child.kill('SIGTERM');
  }
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-browser-script-'));
  const fixture = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<title>script fixture</title><input id="name"><button onclick="document.querySelector(\'#out\').textContent=document.querySelector(\'#name\').value + \' saved\'"><output id="out"></output>');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/`;
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
    const grant = await request(control.token, '/agent-clients', 'POST', { name: 'browser-script E2E', roomIds: [], openRoomGrant: true });
    assert.equal(grant.status, 200);
    const agentToken = grant.payload.token;

    process.stderr.write("1. ...\n");
    // 1. 开关合同：未启用时不注册 browser_script
    const plain = new McpProcess(dataDir, agentToken);
    await plain.connect();
    const plainNames = (await plain.request('tools/list')).tools.map(tool => tool.name).sort();
    assert.equal(plainNames.includes('browser_script'), false, 'browser_script is not registered without the switch');
    await plain.close();

    process.stderr.write("2. ...\n");
    // 2. 启用后注册，且 annotations 为动作类
    const mcp = new McpProcess(dataDir, agentToken, { browserScript: true });
    await mcp.connect();
    const listed = (await mcp.request('tools/list')).tools;
    const scriptTool = listed.find(tool => tool.name === 'browser_script');
    assert.ok(scriptTool, 'browser_script registered with the switch');
    assert.equal(scriptTool.annotations.readOnlyHint, false);
    assert.equal(scriptTool.annotations.destructiveHint, true);

    process.stderr.write("3. ...\n");
    // 3. 一次调用完成批量任务：建页/导航/填表/点击/等终态/快照/返回收据
    const opened = await mcp.callTool('room_open', { identifier: 'browser-script-room' });
    assert.equal(opened.result.isError, undefined);
    const roomId = opened.value.id;
    const batch = await mcp.callTool('browser_script', {
      roomId,
      script: `
        const page = await room.newPage();
        await page.goto(${JSON.stringify(fixtureUrl)});
        await page.fill('#name', 'from script');
        await page.click('button');
        await page.waitForFunction(() => document.querySelector('#out').textContent.includes('saved'));
        const title = await page.evaluate(() => document.title);
        const out = await page.text('#out');
        console.log('batch steps done');
        return { title, out };
      `,
    });
    assert.equal(batch.result.isError, undefined, JSON.stringify(batch.value));
        assert.equal(batch.value.ok, true);
    assert.equal(batch.value.result.title, 'script fixture');
    assert.equal(batch.value.result.out, 'from script saved');
    assert.deepEqual(batch.value.logs, ['batch steps done']);
    assert.equal(batch.value.room.id, roomId);
    assert.ok(batch.value.room.tabs.some(tab => tab.url === fixtureUrl), 'receipt carries the final Room tab state');
    assert.ok(Number.isFinite(batch.value.durationMs));

    process.stderr.write("4. ...\n");
    // 4. 越权 Room 拒绝
    const foreign = await mcp.callTool('browser_script', { roomId: '00000000-0000-4000-8000-000000000000', script: 'return 1;' });
    assert.equal(foreign.result.isError, true);
    assert.equal(foreign.value.code, 'CORVID_NOT_FOUND');

    process.stderr.write("5. ...\n");
    // 5. 脚本错误返回收据（含 logs）
    const failing = await mcp.callTool('browser_script', { roomId, script: "console.log('before fail'); throw new Error('script exploded');" });
    assert.equal(failing.result.isError, true);
    assert.equal(failing.value.code, 'CORVID_SCRIPT_ERROR');
    assert.match(failing.value.error, /script exploded/);
    assert.deepEqual(failing.value.logs, ['before fail']);

    process.stderr.write("6. ...\n");
    // 6. 超时强杀：Room 与页面状态一致，服务继续可用
    const pagesBefore = (await request(control.token, '/rooms')).payload.rooms.find(room => room.id === roomId).tabs.length;
    const timedOut = await mcp.callTool('browser_script', { roomId, script: 'await new Promise(() => {});', timeoutMs: 500 });
        assert.equal(timedOut.result.isError, true);
    assert.equal(timedOut.value.code, 'CORVID_TIMEOUT');
    assert.match(timedOut.value.error, /Room and its pages are untouched|untouched/);
    const state = await request(control.token, '/rooms');
    const roomAfter = state.payload.rooms.find(room => room.id === roomId);
    assert.ok(roomAfter, 'the Room survives a killed script');
    assert.equal(roomAfter.tabs.length, pagesBefore, 'page state is unchanged after timeout cancellation');
    const afterTimeout = await mcp.callTool('browser_script', { roomId, script: `const page = await room.newPage(); await page.goto(${JSON.stringify(fixtureUrl)}); return (await page.info()).url;` });
    assert.equal(afterTimeout.result.isError, undefined, 'the server keeps serving after a killed script');
    assert.equal(afterTimeout.value.result, fixtureUrl);

    process.stderr.write("7. ...\n");
    // 7. 输出上限：超大收据被截断
    const huge = await mcp.callTool('browser_script', { roomId, script: `return { blob: 'x'.repeat(200000) };` });
    assert.equal(huge.result.isError, undefined);
    assert.equal(huge.value.truncated, true, 'oversized receipt is truncated');
    assert.ok(Buffer.byteLength(huge.result.content[0].text) <= 40 * 1024, 'truncated response stays bounded');

    process.stderr.write("8. ...\n");
    // 8. Room 生命周期收尾
    const finish = await mcp.callTool('room_finish', { roomId, keep: [] });
    assert.equal(finish.result.isError, undefined);
    assert.equal(finish.value.closedRoom, true);
    await mcp.close();
    console.log('PASS browser_script switch contract, one-call batch task, grant refusal, script error receipt, timeout cancellation leaves state consistent, output truncation');
  } finally {
    if (app) await app.close().catch(() => {});
    fixture.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
