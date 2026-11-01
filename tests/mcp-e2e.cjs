const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const project = path.resolve(__dirname, '..');
const serverPath = path.join(project, 'mcp', 'corvid.mjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class McpProcess {
  constructor(dataDir) {
    this.child = spawn(process.execPath, [serverPath], { cwd: project, env: { ...process.env, CORVID_DATA_DIR: dataDir }, stdio: ['pipe', 'pipe', 'pipe'] });
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
    const message = await Promise.race([response, delay(5000).then(() => { throw new Error(`MCP request timed out: ${method}; stderr=${this.stderr}`); })]);
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-mcp-'));
  let app, mcp;
  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const control = await (async () => {
      for (let i = 0; i < 200; i++) {
        try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); }
        catch { await delay(25); }
      }
      throw new Error('Corvid control service did not start');
    })();
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(control.baseUrl + route, {
        method, headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      return result;
    };

    const created = await call('/rooms', 'POST', { name: 'MCP read-only fixture' });
    const room = created.room || created;
    const roomCountBefore = (await call('/rooms')).rooms.length;
    mcp = new McpProcess(dataDir);
    await mcp.connect();

    const listed = await mcp.request('tools/list');
    const names = listed.tools.map(tool => tool.name).sort();
    assert.deepEqual(names, ['list_profiles', 'list_rooms', 'list_tabs', 'page_info', 'page_snapshot']);
    assert.ok(listed.tools.every(tool => tool.annotations?.readOnlyHint === true));

    const profiles = await mcp.callTool('list_profiles', {});
    const profileId = profiles.value.find(profile => profile.id === 'default').id;
    const rooms = await mcp.callTool('list_rooms', { profileId });
    assert.ok(rooms.value.rooms.some(item => item.id === room.id));
    const tabs = await mcp.callTool('list_tabs', { roomId: room.id });
    const tab = tabs.value.tabs[0];
    assert.ok(tab?.id);
    const info = await mcp.callTool('page_info', { roomId: room.id, tabId: tab.id });
    assert.equal(info.value.roomId, room.id);
    assert.equal(info.value.targetId, tab.id);
    const snapshot = await mcp.callTool('page_snapshot', { roomId: room.id, tabId: tab.id, scope: 'page' });
    assert.ok(snapshot.value && typeof snapshot.value === 'object');

    const invalid = await mcp.callTool('page_info', { roomId: room.id, tabId: 'missing-tab-id' });
    assert.equal(invalid.result.isError, true);
    assert.equal(invalid.value.code, 'CORVID_NOT_FOUND');
    const missingProfile = await mcp.callTool('list_rooms', { profileId: 'missing-profile-id' });
    assert.equal(missingProfile.result.isError, true);
    assert.equal(missingProfile.value.code, 'CORVID_NOT_FOUND');

    await call(`/rooms/${room.id}/yieldControl`, 'POST', {});
    const denied = await mcp.callTool('page_info', { roomId: room.id, tabId: tab.id });
    assert.equal(denied.result.isError, true);
    assert.equal(denied.value.code, 'CORVID_CONTROL_LOST');
    await call(`/rooms/${room.id}/resumeControl`, 'POST', {});
    assert.equal((await call('/rooms')).rooms.length, roomCountBefore);
    console.log('PASS stdio MCP initialize/list/read tools, explicit Profile and Room scope, stable errors, user-control denial, bounded read-only contract');
  } finally {
    if (mcp) await mcp.close();
    if (app) await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const missingDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-mcp-missing-'));
  const disconnected = new McpProcess(missingDataDir);
  try {
    await disconnected.connect();
    const result = await disconnected.callTool('list_profiles', {});
    assert.equal(result.result.isError, true);
    assert.equal(result.value.code, 'CORVID_DESKTOP_ERROR');
    console.log('PASS stdio MCP returns protocol-valid tool errors when Corvid is unavailable');
  } finally {
    await disconnected.close();
    fs.rmSync(missingDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
