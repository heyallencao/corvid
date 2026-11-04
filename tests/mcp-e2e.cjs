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
  const { asPngImageContent, MAX_SCREENSHOT_BYTES } = await import('../mcp/image-content.mjs');
  assert.throws(() => asPngImageContent(Buffer.alloc(MAX_SCREENSHOT_BYTES + 1)), error => error.code === 'CORVID_OUTPUT_TOO_LARGE');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-mcp-'));
  let app, mcp, fixture;
  try {
    const fixtureRequestCounts = new Map();
    fixture = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://fixture.local').pathname;
      const requestCount = (fixtureRequestCounts.get(pathname) || 0) + 1;
      fixtureRequestCounts.set(pathname, requestCount);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (pathname === '/slow') {
        response.write('<!doctype html><title>Slow MCP fixture</title><h1>Slow destination</h1>');
        setTimeout(() => response.end('<p>Document finished</p>'), 500);
        return;
      }
      if (pathname === '/dynamic') {
        response.end('<!doctype html><title>Dynamic MCP fixture</title><body><p>Single-page fixture</p><script>const target=document.createElement("button");target.id="dynamic-target";target.textContent="Dynamic result";target.hidden=true;document.body.append(target);setTimeout(()=>target.hidden=false,180);setTimeout(()=>target.hidden=true,480);setTimeout(()=>target.remove(),780)</script></body>');
        return;
      }
      if (pathname === '/scroll') {
        response.end('<!doctype html><title>Scroll MCP fixture</title><style>html,body{margin:0}body{height:2600px}#panel{position:fixed;left:24px;top:24px;width:240px;height:140px;overflow:auto;background:#eee}#panel-content{height:1000px}</style><main><h1>Long page</h1><div id="panel"><div id="panel-content">Nested scroll area</div></div></main>');
        return;
      }
      response.end(`<!doctype html><title>MCP fixture</title><button id="request-count" type="button">Request ${requestCount} ${pathname}</button><a href="/slow">Open slow page</a><button id="open-popup" type="button" onclick="window.open('/popup','_blank')">Open popup</button><form id="form"><label>Query <input aria-label="Query"></label><label>Category <select id="category" aria-label="Category"><option value="books">Books</option><option value="music">Music</option></select></label><label>Theme <select id="theme" aria-label="Theme"><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Tags <select id="tags" aria-label="Tags" multiple><option value="red">Red</option><option value="blue">Blue</option><option value="green">Green</option></select></label><button type="submit">Search</button></form><button id="hover-target" type="button">Hover menu</button><button id="hover-menu" type="button" hidden>Hover menu revealed</button><button id="toggle" type="button">Toggle</button><p id="result" role="status">Ready</p><script>document.querySelector("#form").addEventListener("submit",event=>{event.preventDefault();document.querySelector("#result").textContent="Searched: "+document.querySelector("input").value});document.querySelector("#toggle").addEventListener("click",()=>{document.querySelector("#result").textContent="Clicked"});document.querySelector("#hover-target").addEventListener("mouseenter",()=>{document.querySelector("#hover-menu").hidden=false})</script>`);
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
    assert.deepEqual(names, ['list_profiles', 'list_rooms', 'list_tabs', 'page_back', 'page_click', 'page_close', 'page_fill', 'page_forward', 'page_hover', 'page_info', 'page_navigate', 'page_new', 'page_press', 'page_reload', 'page_screenshot', 'page_scroll', 'page_select_option', 'page_snapshot', 'page_wait_for_load', 'page_wait_for_selector', 'page_wait_for_url']);
    assert.ok(listed.tools.filter(tool => tool.name.startsWith('list_') || ['page_info', 'page_screenshot', 'page_snapshot', 'page_wait_for_load', 'page_wait_for_selector', 'page_wait_for_url'].includes(tool.name)).every(tool => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false));
    assert.ok(listed.tools.filter(tool => ['page_back', 'page_click', 'page_close', 'page_fill', 'page_forward', 'page_hover', 'page_navigate', 'page_new', 'page_press', 'page_reload', 'page_scroll', 'page_select_option'].includes(tool.name)).every(tool => tool.annotations?.readOnlyHint === false && tool.annotations?.openWorldHint === true));

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
    const foregroundBeforeScreenshot = (await call('/rooms')).activeRoomId;
    const screenshotResult = await mcp.request('tools/call', { name: 'page_screenshot', arguments: { roomId: room.id, tabId: tab.id } });
    assert.equal(screenshotResult.isError, undefined, JSON.stringify(screenshotResult));
    const screenshotImage = screenshotResult.content.find(item => item.type === 'image');
    assert.ok(screenshotImage, 'page_screenshot returns an MCP image content item');
    assert.equal(screenshotResult.content.length, 1, 'the screenshot is returned as image content instead of a base64 text result');
    assert.equal(screenshotImage?.mimeType, 'image/png');
    const screenshotBytes = Buffer.from(screenshotImage.data, 'base64');
    assert.ok(screenshotBytes.length > 100 && screenshotBytes.length <= MAX_SCREENSHOT_BYTES);
    assert.deepEqual([...screenshotBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal((await call('/rooms')).activeRoomId, foregroundBeforeScreenshot, 'a screenshot of a background Room does not activate it');
    home = await currentBrowserHome();
    assert.ok(home?.visible, 'the foreground browser home remains visible after the screenshot');
    const snapshot = await mcp.callTool('page_snapshot', { roomId: room.id, tabId: tab.id, scope: 'page' });
    assert.ok(snapshot.value && typeof snapshot.value === 'object');
    const waitPage = await mcp.callTool('page_new', { roomId: room.id });
    const waitTabId = waitPage.value.targetId;
    await mcp.callTool('page_navigate', { roomId: room.id, tabId: waitTabId, url: `${fixtureUrl}dynamic` });
    const attachedWait = await mcp.callTool('page_wait_for_selector', { roomId: room.id, tabId: waitTabId, target: { by: 'css', value: '#dynamic-target' }, state: 'attached', timeoutMs: 3000 });
    assert.equal(attachedWait.value.waitedFor.state, 'attached');
    const visibleWait = await mcp.callTool('page_wait_for_selector', { roomId: room.id, tabId: waitTabId, target: { by: 'css', value: '#dynamic-target' }, timeoutMs: 3000 });
    assert.equal(visibleWait.value.waitedFor.state, 'visible', 'visible is the default selector state');
    const hiddenWait = await mcp.callTool('page_wait_for_selector', { roomId: room.id, tabId: waitTabId, target: { by: 'css', value: '#dynamic-target' }, state: 'hidden', timeoutMs: 3000 });
    assert.equal(hiddenWait.value.waitedFor.state, 'hidden');
    const detachedWait = await mcp.callTool('page_wait_for_selector', { roomId: room.id, tabId: waitTabId, target: { by: 'css', value: '#dynamic-target' }, state: 'detached', timeoutMs: 3000 });
    assert.equal(detachedWait.value.waitedFor.state, 'detached');
    const selectorTimeout = await mcp.callTool('page_wait_for_selector', { roomId: room.id, tabId: waitTabId, target: { by: 'css', value: '#never-present' }, state: 'visible', timeoutMs: 150 });
    assert.equal(selectorTimeout.result.isError, true);
    assert.equal(selectorTimeout.value.code, 'CORVID_TIMEOUT');
    assert.equal((await mcp.callTool('page_close', { roomId: room.id, tabId: waitTabId })).result.isError, undefined);
    assert.equal((await call('/rooms')).activeRoomId, foregroundRoomId, 'selector waits on a background page do not activate its Room');

    const scrollPage = await mcp.callTool('page_new', { roomId: room.id });
    const scrollTabId = scrollPage.value.targetId;
    await mcp.callTool('page_navigate', { roomId: room.id, tabId: scrollTabId, url: `${fixtureUrl}scroll` });
    const scrollView = id => app.evaluate(async ({ webContents }, targetId) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL().endsWith('/scroll'));
      if (!contents) throw new Error(`Scroll fixture WebContents missing for ${targetId}`);
      return contents.executeJavaScript('({page:window.scrollY,panel:document.querySelector("#panel").scrollTop,viewport:{width:innerWidth,height:innerHeight}})');
    }, id);
    const centerScroll = await mcp.callTool('page_scroll', { roomId: room.id, tabId: scrollTabId, deltaX: 0, deltaY: 360 });
    assert.equal(centerScroll.result.isError, undefined, JSON.stringify(centerScroll.result));
    assert.ok(centerScroll.value.point.x > 0 && centerScroll.value.point.y > 0, 'omitted coordinates choose a viewport point');
    const afterCenterScroll = await scrollView(scrollTabId);
    assert.ok(afterCenterScroll.page > 0, `scroll gesture at viewport center scrolls the long document: ${JSON.stringify(afterCenterScroll)}`);
    const nestedScroll = await mcp.callTool('page_scroll', { roomId: room.id, tabId: scrollTabId, deltaX: 0, deltaY: 280, x: 80, y: 80 });
    assert.deepEqual(nestedScroll.value.point, { x: 80, y: 80 });
    assert.ok((await scrollView(scrollTabId)).panel > 0, 'explicit viewport coordinates target a nested scroll container');
    assert.equal((await call('/rooms')).activeRoomId, foregroundRoomId, 'scrolling a background page leaves the foreground Room unchanged');
    const badScrollPoint = await mcp.callTool('page_scroll', { roomId: room.id, tabId: scrollTabId, deltaX: 0, deltaY: 100, x: 100000, y: 80 });
    assert.equal(badScrollPoint.result.isError, true);
    assert.match(badScrollPoint.value.error, /outside the viewport/);

    const emptyBack = await mcp.callTool('page_back', { roomId: room.id, tabId: tab.id });
    const emptyForward = await mcp.callTool('page_forward', { roomId: room.id, tabId: tab.id });
    assert.equal(emptyBack.result.isError, undefined);
    assert.equal(emptyForward.result.isError, undefined);
    assert.equal((await mcp.callTool('page_info', { roomId: room.id, tabId: tab.id })).value.url, 'about:blank', 'history actions with no entries leave the managed page unchanged');

    const { connect } = await import('../sdk/index.js');
    const scopedSdk = await connect({ dataDir, token: authorization.token });
    try {
      const scrollRoom = await scopedSdk.room(room.id);
      const sdkScrollPage = scrollRoom.page(scrollRoom.info.tabs.find(item => item.id === scrollTabId).label);
      await assert.rejects(sdkScrollPage.scroll(0, 0), /not both zero/);
      await assert.rejects(sdkScrollPage.scroll(0, 2001), /-2000..2000/);
      await assert.rejects(sdkScrollPage.scroll(0, 50, { x: 40 }), /together/);
      const panelBeforeSdk = (await scrollView(scrollTabId)).panel;
      await sdkScrollPage.scroll(0, 180, { x: 80, y: 80 });
      assert.ok((await scrollView(scrollTabId)).panel > panelBeforeSdk, 'SDK scroll uses the same explicit-coordinate action');
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
    const slowUrl = `${fixtureUrl}slow`;
    await mcp.callTool('page_click', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'link', name: 'Open slow page' } });
    const urlWait = await mcp.callTool('page_wait_for_url', { roomId: room.id, tabId: tab.id, url: slowUrl, timeoutMs: 5000 });
    assert.equal(urlWait.result.isError, undefined);
    assert.equal(urlWait.value.url, slowUrl, 'URL wait returns info for the page reached by the link');
    const waitStartedAt = Date.now();
    const loadWait = await mcp.callTool('page_wait_for_load', { roomId: room.id, tabId: tab.id, state: 'load', timeoutMs: 5000 });
    assert.equal(loadWait.result.isError, undefined);
    assert.equal(loadWait.value.loadComplete, true, 'load wait resolves only after the delayed document finishes');
    assert.ok(Date.now() - waitStartedAt >= 200, 'load wait observes the delayed response rather than returning immediately');
    const timedOutWait = await mcp.callTool('page_wait_for_url', { roomId: room.id, tabId: tab.id, url: `${fixtureUrl}never`, timeoutMs: 150 });
    assert.equal(timedOutWait.result.isError, true);
    assert.equal(timedOutWait.value.code, 'CORVID_TIMEOUT');
    await mcp.callTool('page_navigate', { roomId: room.id, tabId: tab.id, url: fixtureUrl });
    const secondUrl = `${fixtureUrl}second`;
    await mcp.callTool('page_navigate', { roomId: room.id, tabId: tab.id, url: secondUrl });
    await mcp.callTool('page_back', { roomId: room.id, tabId: tab.id });
    let currentInfo;
    for (let i = 0; i < 100; i++) {
      currentInfo = (await mcp.callTool('page_info', { roomId: room.id, tabId: tab.id })).value;
      if (currentInfo.url === fixtureUrl) break;
      await delay(25);
    }
    assert.equal(currentInfo.url, fixtureUrl, 'page_back navigates only the explicitly selected tab to its prior URL');
    await mcp.callTool('page_forward', { roomId: room.id, tabId: tab.id });
    for (let i = 0; i < 100; i++) {
      currentInfo = (await mcp.callTool('page_info', { roomId: room.id, tabId: tab.id })).value;
      if (currentInfo.url === secondUrl) break;
      await delay(25);
    }
    assert.equal(currentInfo.url, secondUrl, 'page_forward restores the next URL in the same tab history');
    const priorRequestCount = fixtureRequestCounts.get('/second');
    const reloaded = await mcp.callTool('page_reload', { roomId: room.id, tabId: tab.id });
    assert.equal(reloaded.result.isError, undefined);
    for (let i = 0; i < 100 && fixtureRequestCounts.get('/second') <= priorRequestCount; i++) await delay(25);
    assert.ok(fixtureRequestCounts.get('/second') > priorRequestCount, 'page_reload requests the selected page again');
    const reloadSnapshot = await mcp.callTool('page_snapshot', { roomId: room.id, tabId: tab.id, scope: 'page' });
    assert.equal(new URL((await mcp.callTool('page_info', { roomId: room.id, tabId: tab.id })).value.url).pathname, '/second');
    assert.match(JSON.stringify(reloadSnapshot.value), /Request 2 \/second/);
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
    const selectedCategory = await mcp.callTool('page_select_option', { roomId: room.id, tabId: tab.id, target: { by: 'css', value: '#category' }, choices: 'books' });
    assert.deepEqual(selectedCategory.value, ['books']);
    const selectedByLabel = await mcp.callTool('page_select_option', { roomId: room.id, tabId: tab.id, target: { by: 'css', value: '#category' }, choices: { label: 'Music' } });
    assert.deepEqual(selectedByLabel.value, ['music']);
    const clearedCategory = await mcp.callTool('page_select_option', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'combobox', name: 'Category' }, choices: null });
    assert.deepEqual(clearedCategory.value, []);
    const selectedTags = await mcp.callTool('page_select_option', { roomId: room.id, tabId: tab.id, target: { by: 'css', value: '#tags' }, choices: ['red', { index: 1 }] });
    assert.deepEqual(selectedTags.value, ['red', 'blue']);
    const missingOption = await mcp.callTool('page_select_option', { roomId: room.id, tabId: tab.id, target: { by: 'css', value: '#category' }, choices: 'missing' });
    assert.equal(missingOption.result.isError, true);
    assert.match(missingOption.value.error, /Select option not found/);
    const ambiguousSelect = await mcp.callTool('page_select_option', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'combobox' }, choices: 'books' });
    assert.equal(ambiguousSelect.result.isError, true);
    assert.match(ambiguousSelect.value.error, /Locator matched [2-9] elements/);
    const hovered = await mcp.callTool('page_hover', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'button', name: 'Hover menu' } });
    assert.equal(hovered.result.isError, undefined, JSON.stringify(hovered.value));
    const afterHover = await mcp.callTool('page_snapshot', { roomId: room.id, tabId: tab.id, scope: 'page' });
    assert.match(JSON.stringify(afterHover.value), /Hover menu revealed/);
    await mcp.callTool('page_click', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'button', name: 'Toggle' } });
    const afterToggle = await mcp.callTool('page_snapshot', { roomId: room.id, tabId: tab.id, scope: 'page' });
    assert.match(JSON.stringify(afterToggle.value), /Clicked/);
    const popupOpened = await mcp.callTool('page_click', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'button', name: 'Open popup' } });
    assert.equal(popupOpened.result.isError, undefined, JSON.stringify(popupOpened.value));
    let popupTab;
    for (let i = 0; i < 100; i++) {
      popupTab = (await mcp.callTool('list_tabs', { roomId: room.id })).value.tabs.find(item => item.openedBy === 'unknown');
      if (popupTab) break;
      await delay(25);
    }
    assert.ok(popupTab, `the window.open popup is listed with unknown origin; action=${JSON.stringify(popupOpened.value)}`);
    assert.equal(popupTab.label, null, 'unknown-origin popup remains unmanaged until the user adopts it');
    const deniedPopupClose = await mcp.callTool('page_close', { roomId: room.id, tabId: popupTab.id });
    assert.equal(deniedPopupClose.result.isError, true);
    assert.equal(deniedPopupClose.value.code, 'CORVID_FORBIDDEN');
    const deniedPopupScreenshot = await mcp.callTool('page_screenshot', { roomId: room.id, tabId: popupTab.id });
    assert.equal(deniedPopupScreenshot.result.isError, true);
    assert.equal(deniedPopupScreenshot.value.code, 'CORVID_CONTROL_LOST');
    const createdPage = await mcp.callTool('page_new', { roomId: room.id });
    assert.equal(createdPage.result.isError, undefined);
    assert.equal(createdPage.value.openedBy, 'agent');
    assert.equal(createdPage.value.url, 'about:blank');
    assert.ok(createdPage.value.label && createdPage.value.targetId);
    const closedPage = await mcp.callTool('page_close', { roomId: room.id, tabId: createdPage.value.targetId });
    assert.equal(closedPage.result.isError, undefined);
    assert.equal((await mcp.callTool('list_tabs', { roomId: room.id })).value.tabs.some(item => item.id === createdPage.value.targetId), false, 'closed Agent page disappears from Room tabs');
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

    const waitingDuringHandoff = mcp.callTool('page_wait_for_url', { roomId: room.id, tabId: tab.id, url: `${fixtureUrl}never`, timeoutMs: 5000 });
    const waitingForSelectorDuringHandoff = mcp.callTool('page_wait_for_selector', { roomId: room.id, tabId: tab.id, target: { by: 'css', value: '#never-present' }, state: 'visible', timeoutMs: 5000 });
    await delay(150);
    await call(`/rooms/${room.id}/yieldControl`, 'POST', {});
    const interruptedWait = await waitingDuringHandoff;
    assert.equal(interruptedWait.result.isError, true, 'an in-flight wait stops when the user takes Room control');
    assert.equal(interruptedWait.value.code, 'CORVID_CONTROL_LOST');
    const interruptedSelectorWait = await waitingForSelectorDuringHandoff;
    assert.equal(interruptedSelectorWait.result.isError, true, 'an in-flight selector wait stops when the user takes Room control');
    assert.equal(interruptedSelectorWait.value.code, 'CORVID_CONTROL_LOST');
    const denied = await mcp.callTool('page_info', { roomId: room.id, tabId: tab.id });
    assert.equal(denied.result.isError, true);
    assert.equal(denied.value.code, 'CORVID_CONTROL_LOST');
    const deniedAction = await mcp.callTool('page_click', { roomId: room.id, tabId: tab.id, target: { by: 'role', value: 'button', name: 'Toggle' } });
    assert.equal(deniedAction.result.isError, true);
    assert.equal(deniedAction.value.code, 'CORVID_CONTROL_LOST');
    for (const name of ['page_back', 'page_forward', 'page_hover', 'page_reload', 'page_screenshot', 'page_scroll', 'page_select_option', 'page_wait_for_selector', 'page_wait_for_url', 'page_wait_for_load', 'page_close', 'page_new']) {
      const args = { roomId: room.id, tabId: tab.id };
      if (name === 'page_scroll') Object.assign(args, { deltaX: 0, deltaY: 100 });
      if (name === 'page_hover') Object.assign(args, { target: { by: 'role', value: 'button', name: 'Hover menu' } });
      if (name === 'page_select_option') Object.assign(args, { target: { by: 'css', value: '#category' }, choices: 'books' });
      if (name === 'page_wait_for_selector') Object.assign(args, { target: { by: 'css', value: '#never-present' }, state: 'visible', timeoutMs: 100 });
      if (name === 'page_wait_for_url') Object.assign(args, { url: fixtureUrl, timeoutMs: 100 });
      if (name === 'page_wait_for_load') Object.assign(args, { state: 'load', timeoutMs: 100 });
      if (name === 'page_new') delete args.tabId;
      const deniedNavigation = await mcp.callTool(name, args);
      assert.equal(deniedNavigation.result.isError, true, `${name} is denied while the user owns the Room`);
      assert.equal(deniedNavigation.value.code, 'CORVID_CONTROL_LOST');
    }
    await call(`/rooms/${room.id}/resumeControl`, 'POST', {});
    assert.equal((await call('/rooms')).rooms.length, roomCountBefore);
    console.log('PASS stdio MCP read and scoped page actions, explicit Profile/Room/Tab scope, HTTP(S)-only navigation, page scrolling, post-action verification, user-control denial, bounded responses');
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
