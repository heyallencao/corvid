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
  constructor(dataDir, agentToken) {
    const env={...process.env,CORVID_DATA_DIR:dataDir};
    if(agentToken)env.CORVID_AGENT_TOKEN=agentToken;else delete env.CORVID_AGENT_TOKEN;
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
  let app, mcp, fixture;
  try {
    fixture = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>MCP fixture</title><form id="form"><label>Query <input aria-label="Query"></label><button type="submit">Search</button></form><button id="toggle" type="button">Toggle</button><p id="result" role="status">Ready</p><script>document.querySelector("#form").addEventListener("submit",event=>{event.preventDefault();document.querySelector("#result").textContent="Searched: "+document.querySelector("input").value});document.querySelector("#toggle").addEventListener("click",()=>{document.querySelector("#result").textContent="Clicked"})</script>');
    });
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/`;
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

    const hiddenProfile = await call('/profiles', 'POST', { name: 'MCP 隐藏浏览身份' });
    const ungrantedCreated = await call('/rooms', 'POST', { name: 'MCP ungranted fixture', profileId: hiddenProfile.id });
    const ungrantedRoom = ungrantedCreated.room || ungrantedCreated;
    const created = await call('/rooms', 'POST', { name: 'MCP read-only fixture' });
    const room = created.room || created;
    const authorization = await call('/agent-clients', 'POST', { name: 'MCP E2E 客户端', roomIds: [room.id] });
    const roomCountBefore = (await call('/rooms')).rooms.length;
    const foregroundRoomId = (await call('/rooms')).activeRoomId;
    assert.notEqual(foregroundRoomId, room.id, 'the authorized Agent Room must remain in the background');
    const currentBrowserHome = async () => {
      const state=await call('/rooms');
      const activeTabId=state.rooms.find(item=>item.id===state.activeRoomId)?.tabs.find(item=>item.active)?.id;
      return app.evaluate(async ({ webContents },{activeTabId}) => {
      for (const contents of webContents.getAllWebContents()) {
        try {
          const matches = await contents.executeJavaScript(`document.querySelector('[data-corvid-home-surface]')?.dataset.tabId===${JSON.stringify(activeTabId)}`);
          if (matches) return {id:contents.id,url:contents.getURL(),visible:await contents.executeJavaScript("document.visibilityState==='visible'")};
        } catch {}
      }
      return null;
      },{activeTabId});
    };
    let home = null;
    for (let i=0;i<200&&!home;i++) {home=await currentBrowserHome();if(!home)await delay(25);}
    const contentsSummary=await app.evaluate(({webContents})=>webContents.getAllWebContents().map(contents=>({id:contents.id,url:contents.getURL(),type:contents.getType()})));
    assert.ok(home?.visible,JSON.stringify(contentsSummary));
    assert.equal(home.url,'about:blank','the foreground remains on the browser start page');
    mcp = new McpProcess(dataDir, authorization.token);
    await mcp.connect();

    const listed = await mcp.request('tools/list');
    const names = listed.tools.map(tool => tool.name).sort();
    assert.deepEqual(names, ['list_profiles', 'list_rooms', 'list_tabs', 'page_click', 'page_fill', 'page_info', 'page_navigate', 'page_press', 'page_snapshot']);
    assert.ok(listed.tools.filter(tool => tool.name.startsWith('list_') || ['page_info', 'page_snapshot'].includes(tool.name)).every(tool => tool.annotations?.readOnlyHint === true));
    assert.ok(listed.tools.filter(tool => ['page_click', 'page_fill', 'page_navigate', 'page_press'].includes(tool.name)).every(tool => tool.annotations?.readOnlyHint === false && tool.annotations?.openWorldHint === true));

    const profiles = await mcp.callTool('list_profiles', {});
    const profileId = profiles.value.find(profile => profile.id === 'default').id;
    const rooms = await mcp.callTool('list_rooms', { profileId });
    assert.ok(rooms.value.rooms.some(item => item.id === room.id));
    assert.equal(rooms.value.rooms.some(item => item.id === ungrantedRoom.id), false, 'MCP lists only Rooms granted to its client identity');
    assert.deepEqual(profiles.value.map(profile => profile.id), ['default'], 'MCP profile discovery is limited to granted Room Profiles');
    const hiddenProfileRooms = await mcp.callTool('list_rooms', { profileId: hiddenProfile.id });
    assert.equal(hiddenProfileRooms.result.isError, true, 'MCP cannot enumerate a Profile with no granted Room');
    const tabs = await mcp.callTool('list_tabs', { roomId: room.id });
    const tab = tabs.value.tabs[0];
    assert.ok(tab?.id);
    const info = await mcp.callTool('page_info', { roomId: room.id, tabId: tab.id });
    assert.equal(info.value.roomId, room.id);
    assert.equal(info.value.targetId, tab.id);
    const snapshot = await mcp.callTool('page_snapshot', { roomId: room.id, tabId: tab.id, scope: 'page' });
    assert.ok(snapshot.value && typeof snapshot.value === 'object');

    const { connect } = await import('../sdk/index.js');
    const scopedSdk = await connect({ dataDir, token: authorization.token });
    try {
      const hiddenRoom = await scopedSdk.room(room.id);
      assert.ok(tab.label, 'the Agent-owned page has a stable label for SDK access');
      const hiddenPage = hiddenRoom.page(tab.label);
      const screenshot = await hiddenPage.screenshot();
      assert.ok(screenshot.length > 100, 'SDK captures the background page while Corvid home remains visible');
      assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'background SDK screenshot is a PNG');
      if (process.env.CORVID_BACKGROUND_SCREENSHOT_PATH) await hiddenPage.screenshot({ path: process.env.CORVID_BACKGROUND_SCREENSHOT_PATH });
    } finally { await scopedSdk.disconnect(); }

    const navigated = await mcp.callTool('page_navigate', { roomId: room.id, tabId: tab.id, url: fixtureUrl });
    assert.equal(navigated.result.isError, undefined);
    assert.equal(new URL(navigated.value.url).origin, new URL(fixtureUrl).origin);
    const filled = await mcp.callTool('page_fill', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'textbox', name: 'Query' }, value: 'corvid mcp' });
    assert.equal(filled.result.isError, undefined, JSON.stringify(filled.value));
    const searched = await mcp.callTool('page_click', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'button', name: 'Search' } });
    assert.equal(searched.result.isError, undefined);
    const afterSubmit = await mcp.callTool('page_snapshot', { roomId: room.id, tabId: tab.id, scope: 'page' });
    assert.match(JSON.stringify(afterSubmit.value), /Searched: corvid mcp/);
    const pressed = await mcp.callTool('page_press', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'textbox', name: 'Query' }, key: 'x' });
    assert.equal(pressed.result.isError, undefined);
    await mcp.callTool('page_click', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'button', name: 'Search' } });
    const afterClick = await mcp.callTool('page_snapshot', { roomId: room.id, tabId: tab.id, scope: 'page' });
    assert.match(JSON.stringify(afterClick.value), /Searched: corvid mcpx/);
    await mcp.callTool('page_click', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'button', name: 'Toggle' } });
    const afterToggle = await mcp.callTool('page_snapshot', { roomId: room.id, tabId: tab.id, scope: 'page' });
    assert.match(JSON.stringify(afterToggle.value), /Clicked/);
    assert.equal((await call('/rooms')).activeRoomId, foregroundRoomId, 'background Agent actions never activate or steal the foreground Room');
    home = await currentBrowserHome();
    assert.ok(home?.visible,'the home surface remains visible after background Agent actions');
    const unsafeUrl = await mcp.callTool('page_navigate', { roomId: room.id, tabId: tab.id, url: 'javascript:alert(1)' });
    assert.equal(unsafeUrl.result.isError, true);
    assert.equal(unsafeUrl.value.code, 'CORVID_INVALID_INPUT');
    const credentialUrl = await mcp.callTool('page_navigate', { roomId: room.id, tabId: tab.id, url: 'https://user:secret@example.test/' });
    assert.equal(credentialUrl.result.isError, true);
    assert.equal(credentialUrl.value.code, 'CORVID_INVALID_INPUT');

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
    const deniedAction = await mcp.callTool('page_click', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'button', name: 'Toggle' } });
    assert.equal(deniedAction.result.isError, true);
    assert.equal(deniedAction.value.code, 'CORVID_CONTROL_LOST');
    await call(`/rooms/${room.id}/resumeControl`, 'POST', {});
    assert.equal((await call('/rooms')).rooms.length, roomCountBefore);
    console.log('PASS stdio MCP read and scoped page actions, explicit Profile/Room/Tab scope, HTTP(S)-only navigation, post-action verification, user-control denial, bounded responses');
  } finally {
    if (mcp) await mcp.close();
    if (app) await app.close().catch(() => {});
    if (fixture) await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const missingDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-mcp-missing-'));
  const disconnected = new McpProcess(missingDataDir);
  const missingCredential = new McpProcess(missingDataDir, 'corvid_agent_test_missing');
  try {
    await disconnected.connect();
    const result = await disconnected.callTool('list_profiles', {});
    assert.equal(result.result.isError, true);
    assert.equal(result.value.code, 'CORVID_UNAUTHORIZED');
    console.log('PASS stdio MCP refuses to fall back to administrator credentials when no scoped identity is configured');
    await missingCredential.connect();
    const missing = await missingCredential.callTool('list_profiles', {});
    assert.equal(missing.result.isError, true);
    assert.equal(missing.value.code, 'CORVID_DESKTOP_ERROR');
    console.log('PASS stdio MCP returns protocol-valid tool errors when Corvid is unavailable');
  } finally {
    await disconnected.close();
    await missingCredential.close();
    fs.rmSync(missingDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
