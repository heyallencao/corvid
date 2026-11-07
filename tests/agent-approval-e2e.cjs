// P1.2b / P1.5：本机文件逐次授权与外部 MCP confirm_action，共用真实桌面待授权卡。
// 覆盖 SDK、Browser MCP、chooser、文件身份/来源复核、单次取消与连接断开、页面/Room 变化、并发和客户端撤销。
const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter, once } = require('node:events');
const runAction = require('../desktop/actions.cjs');
const pageDebugger = require('../desktop/page-debugger.cjs');
const { createAgentClientsStore } = require('../desktop/agent-clients.cjs');

const project = path.resolve(__dirname, '..');
const serverPath = path.join(project, 'mcp', 'corvid.mjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fakePageContents() {
  const debuggerClient = new EventEmitter();
  let attached = false, fileSelections = 0;
  debuggerClient.attach = () => { attached = true; };
  debuggerClient.isAttached = () => attached;
  debuggerClient.detach = () => { attached = false; debuggerClient.emit('detach'); };
  debuggerClient.sendCommand = async (method, params = {}) => {
    if (method === 'Runtime.enable') debuggerClient.emit('message', {}, 'Runtime.executionContextCreated', { context: { id: 1 } });
    if (method === 'Runtime.evaluate' && params.expression?.startsWith('globalThis.__corvidUploadContext===')) return { result: { value: true } };
    if (method === 'Runtime.evaluate' && params.expression?.includes('__corvidRegistry')) return { result: { objectId: 'file-input' } };
    if (method === 'DOM.resolveNode') return { object: { objectId: 'file-input' } };
    if (method === 'Runtime.callFunctionOn') return { result: { value: true } };
    if (method === 'DOM.setFileInputFiles') fileSelections++;
    if (method === 'Page.setInterceptFileChooserDialog' && params.enabled) debuggerClient.emit('message', {}, 'Page.fileChooserOpened', { mode: 'selectSingle', backendNodeId: 1 });
    return {};
  };
  return {
    debugger: debuggerClient,
    getURL: () => 'https://approval-fixture.test/',
    fileSelections: () => fileSelections,
    executeJavaScriptInIsolatedWorld: async (_worldId, [{ code }]) => ({
      ok: true,
      result: code.includes('"file-validate"') ? { ok: true } : { ref: '@1' },
    }),
  };
}

async function assertFileSelectionGuardStopsBeforeCDP(file) {
  const denied = () => { throw Object.assign(new Error('authorization changed'), { code: 'CORVID_CONTROL_LOST' }); };
  const actionContents = fakePageContents();
  await assert.rejects(
    runAction(actionContents, 'setInputFiles', { files: [file] }, { preparedFileTarget: '@1', beforeFileSelection: denied }),
    error => error.code === 'CORVID_CONTROL_LOST',
  );
  assert.equal(actionContents.fileSelections(), 0, 'the setInputFiles guard runs before the CDP setter');
  await pageDebugger.prepareClose(actionContents);

  const chooserContents = fakePageContents();
  const chooser = await pageDebugger.armChooser(chooserContents, 5000);
  await pageDebugger.validateChooser(chooserContents, chooser.id, [file]);
  await assert.rejects(pageDebugger.chooseFiles(chooserContents, chooser.id, [file], denied), error => error.code === 'CORVID_CONTROL_LOST');
  assert.equal(chooserContents.fileSelections(), 0, 'the chooser guard runs before the CDP setter');
  await pageDebugger.cancelChooser(chooserContents, chooser.id);
  await pageDebugger.prepareClose(chooserContents);
}

function assertAgentClientLookupTracksRevocation(dataDir) {
  const store = createAgentClientsStore(path.join(dataDir, 'approval-client-lookup.json'));
  const external = store.create({ name: 'approval-lookup-e2e', roomIds: ['room-1'] });
  assert.equal(store.findById(external.client.id).revoked, false);
  assert.equal(store.revoke(external.client.id).revoked, true);
  assert.equal(store.findById(external.client.id).revoked, true, 'approval revalidation can observe a persisted revoke');
  const internal = store.createInternal({ id: 'builtin:approval-lookup', name: 'Corvid Agent', roomIds: ['room-1'] });
  assert.equal(store.findById(internal.client.id).revoked, false);
  assert.equal(store.revokeInternal(internal.client.id), true);
  assert.equal(store.findById(internal.client.id), null, 'approval revalidation treats a retired internal identity as unavailable');
}

class McpProcess {
  constructor(dataDir, agentToken, { browserScript = false, homeDir } = {}) {
    const env = { ...process.env, HOME: homeDir, CORVID_DATA_DIR: dataDir, CORVID_AGENT_TOKEN: agentToken };
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
        catch (error) {
          for (const waiter of this.pending.values()) waiter.reject(new Error(`Invalid JSON-RPC stdout: ${line}: ${error.message}`));
          continue;
        }
        if (message.id !== undefined && this.pending.has(message.id)) {
          const waiter = this.pending.get(message.id);
          this.pending.delete(message.id);
          waiter.resolve(message);
        }
      }
    });
    this.child.stderr.on('data', chunk => { this.stderr += chunk; });
    this.child.once('exit', (code, signal) => {
      for (const waiter of this.pending.values()) waiter.reject(new Error(`MCP exited (${code ?? signal}); stderr=${this.stderr}`));
      this.pending.clear();
    });
  }
  waitFor(id, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${id} timed out; stderr=${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: message => { clearTimeout(timer); resolve(message); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    const response = this.waitFor(id);
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return response;
  }
  notify(method, params = {}) { this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); }
  async connect() {
    const message = await this.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'corvid-approval-e2e', version: '1.0.0' } });
    assert.equal(message.result.serverInfo.name, 'corvid-browser');
    this.notify('notifications/initialized');
  }
  startTool(name, args) {
    const id = this.nextId++;
    const response = this.waitFor(id).then(message => {
      if (message.error) throw new Error(`${name}: ${JSON.stringify(message.error)}`);
      const result = message.result;
      const text = result.content.find(item => item.type === 'text')?.text;
      assert.ok(text, `${name} returned no text content`);
      return { result, value: JSON.parse(text) };
    });
    response.catch(() => {});
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
    return { id, response };
  }
  async callTool(name, args) { return this.startTool(name, args).response; }
  cancel(id) { this.notify('notifications/cancelled', { requestId: id, reason: 'approval e2e cancelled one tool call' }); }
  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const exited = once(this.child, 'exit');
    this.child.stdin.end();
    await Promise.race([exited, delay(1000)]);
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGTERM');
  }
}

async function until(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await delay(25);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function assertToolError(call, code) {
  assert.equal(call.result.isError, true, JSON.stringify(call.value));
  assert.equal(call.value.code, code, JSON.stringify(call.value));
}

(async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-approval-home-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-approval-'));
  assertAgentClientLookupTracksRevocation(dataDir);
  const fileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-approval-files-'));
  const fileAPath = path.join(fileRoot, 'reports-a');
  const fileBPath = path.join(fileRoot, 'reports-b');
  fs.mkdirSync(fileAPath);
  fs.mkdirSync(fileBPath);
  const duplicateA = path.join(fileAPath, 'report.csv');
  const duplicateB = path.join(fileBPath, 'report.csv');
  const chooserDenied = path.join(fileRoot, 'chooser-denied.txt');
  const chooserApproved = path.join(fileRoot, 'chooser-approved.txt');
  const staleDirectFile = path.join(fileRoot, 'stale-direct.txt');
  const staleChooserFile = path.join(fileRoot, 'stale-chooser.txt');
  const symlinkFile = path.join(fileRoot, 'harmless-name.txt');
  const replaceFileAtSamePath = (file, contents) => { fs.renameSync(file, `${file}.original`); fs.writeFileSync(file, contents); };
  for (const [file, contents] of [[duplicateA, 'report A'], [duplicateB, 'report B'], [chooserDenied, 'chooser denied'], [chooserApproved, 'chooser approved'], [staleDirectFile, 'original direct file'], [staleChooserFile, 'original chooser file']]) fs.writeFileSync(file, contents);
  fs.symlinkSync(chooserApproved, symlinkFile);
  await assertFileSelectionGuardStopsBeforeCDP(chooserApproved);

  let app, mcp, otherMcp, disconnectMcp, revokeUploadMcp, sdkClient, fixture, crossOriginFixture;
  let uploadCount = 0, crossOriginUploadCount = 0;
  crossOriginFixture = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://cross-origin-fixture.local').pathname;
    if (pathname === '/upload') {
      request.resume();
      request.on('end', () => { crossOriginUploadCount++; response.writeHead(204); response.end(); });
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>Cross-origin chooser</title><input id="file" type="file" style="position:absolute;left:0;top:0;width:260px;height:40px"><script>const input=document.querySelector('#file');for(const type of ['pointerdown','mousedown','click'])input.addEventListener(type,event=>window.parent.postMessage({type:'input-event',eventType:type,trusted:event.isTrusted},'*'));input.addEventListener('change',()=>{window.parent.postMessage('file-selected','*');const data=new FormData();data.append('file',input.files[0]);fetch('/upload',{method:'POST',body:data})});const hit=document.elementFromPoint(20,20);window.parent.postMessage({type:'ready',hit:hit?.id||hit?.tagName||null},'*');</script>`);
  });
  await new Promise(resolve => crossOriginFixture.listen(0, '127.0.0.1', resolve));
  const crossOriginUrl = `http://localhost:${crossOriginFixture.address().port}/`;
  fixture = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://fixture.local').pathname;
    if (pathname === '/upload') {
      request.resume();
      request.on('end', () => { uploadCount++; response.writeHead(204); response.end(); });
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (pathname === '/cross-origin') {
      response.end(`<!doctype html><title>Cross-origin parent</title><style>body{margin:0}iframe{position:absolute;left:10px;top:10px;width:300px;height:120px;border:0}</style><iframe id="picker" src="${crossOriginUrl}"></iframe><script>window.__crossOriginReady=false;window.__crossOriginChildHit=null;window.__crossOriginInputEvents=[];window.__crossOriginSelectionEvents=0;window.addEventListener('message',event=>{if(event.source!==document.querySelector('#picker').contentWindow)return;if(event.data?.type==='ready'){window.__crossOriginReady=true;window.__crossOriginChildHit=event.data.hit}if(event.data?.type==='input-event')window.__crossOriginInputEvents.push({eventType:event.data.eventType,trusted:event.data.trusted});if(event.data==='file-selected')window.__crossOriginSelectionEvents++});</script>`);
      return;
    }
    const navigationScript = pathname === '/auto-navigate' ? "setTimeout(()=>location.href='/?after-auto-navigation',1500);" : '';
    response.end(`<!doctype html><title>Approval fixture</title><input id="file" type="file" multiple><button id="choose" type="button">Choose file</button><script>window.events=[];const input=document.querySelector('#file');for(const type of ['input','change'])input.addEventListener(type,event=>window.events.push({type,trusted:event.isTrusted}));input.addEventListener('change',()=>{const form=new FormData();for(const file of input.files)form.append('file',file);fetch('/upload',{method:'POST',body:form})});document.querySelector('#choose').onclick=()=>input.click();${navigationScript}</script>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/`;

  try {
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: { ...process.env, HOME: homeDir, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' } });
    const shell = await app.firstWindow();
    let control;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { control = JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); break; }
      catch { await delay(25); }
    }
    assert.ok(control?.token, 'Corvid publishes an administrator credential in the isolated data directory');
    const admin = async (route, method = 'GET', body) => {
      const response = await fetch(control.baseUrl + route, {
        method,
        headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, payload: await response.json().catch(() => null) };
    };
    const grantResponse = await admin('/agent-clients', 'POST', { name: 'approval-e2e-agent', roomIds: [], openRoomGrant: true });
    assert.equal(grantResponse.status, 200, JSON.stringify(grantResponse.payload));
    const grant = grantResponse.payload;
    mcp = new McpProcess(dataDir, grant.token, { browserScript: true, homeDir });
    await mcp.connect();
    const opened = await mcp.callTool('room_open', { identifier: 'approval-e2e-room' });
    assert.equal(opened.result.isError, undefined, JSON.stringify(opened.value));
    const roomId = opened.value.id;
    const pageCreated = await mcp.callTool('page_new', { roomId });
    const tabId = pageCreated.value.targetId;
    const pageLabel = pageCreated.value.label;
    await mcp.callTool('page_navigate_and_snapshot', { roomId, tabId, url: fixtureUrl, waitState: 'load', timeoutMs: 5000, scope: 'page' });

    const dialog = shell.locator('#agent-approval-dialog');
    const dialogText = async () => dialog.textContent();
    const waitForDialogText = async text => {
      await dialog.waitFor({ state: 'visible', timeout: 10000 });
      return until(async () => {
        const current = await dialogText();
        return current.includes(text) ? current : null;
      }, 5000).catch(async error => {
        throw new Error(`${error.message}; requested=${JSON.stringify(text)}; dialog=${JSON.stringify(await dialogText())}`);
      });
    };
    const closeDialog = () => dialog.waitFor({ state: 'hidden', timeout: 10000 });
    const pageState = async () => {
      const state = await admin(`/tabs/${encodeURIComponent(tabId)}/action`, 'POST', {
        operation: 'evaluate',
        args: { expression: `({files:Array.from(document.querySelector('#file').files).map(file=>file.name),events:window.events.slice()})` },
      });
      assert.equal(state.status, 200, JSON.stringify(state.payload));
      return state.payload.value;
    };

    // Denial leaves the file input untouched and produces no input/change or upload request.
    const deniedUpload = mcp.startTool('page_upload', { roomId, tabId, target: { by: 'css', value: '#file' }, files: [chooserDenied] });
    let text = await waitForDialogText('chooser-denied.txt');
    assert.ok(text.includes(path.basename(fileRoot)), 'the approval card identifies the immediate parent folder');
    assert.equal(text.includes(fileRoot), false, 'the approval card does not expose the full local path');
    assert.equal(uploadCount, 0, 'the page cannot submit files while approval is pending');
    await shell.locator('#agent-approval-deny').click();
    const deniedUploadResult = await deniedUpload.response;
    assertToolError(deniedUploadResult, 'CORVID_USER_DENIED');
    await closeDialog();
    assert.deepEqual(await pageState(), { files: [], events: [] }, 'denial has no input/change side effect');
    assert.equal(uploadCount, 0, 'denial sends no upload request');

    const beforeSymlink = await pageState();
    const symlinkUpload = await mcp.callTool('page_upload', { roomId, tabId, target: { by: 'css', value: '#file' }, files: [symlinkFile] });
    assertToolError(symlinkUpload, 'CORVID_FORBIDDEN');
    assert.equal(await dialog.isVisible(), false, 'symlink paths are rejected before showing an approval card');
    assert.deepEqual(await pageState(), beforeSymlink, 'a symlink cannot select a file under a different displayed path');
    assert.equal(uploadCount, 0, 'symlink rejection causes no upload');

    // Two same-named files stay distinguishable without sending absolute paths to the renderer.
    const approvedUpload = mcp.startTool('page_upload', { roomId, tabId, target: { by: 'css', value: '#file' }, files: [duplicateA, duplicateB] });
    text = await waitForDialogText('report.csv');
    assert.ok(text.includes('reports-a') && text.includes('reports-b'), 'duplicate file names include their immediate parent folders');
    assert.equal(text.includes(fileRoot), false, 'file approval still hides the absolute paths');
    assert.match(text, /2/);
    assert.equal(uploadCount, 0, 'approval does not submit files before the user responds');
    await shell.locator('#agent-approval-approve').click();
    const approvedUploadResult = await approvedUpload.response;
    assert.equal(approvedUploadResult.result.isError, undefined, JSON.stringify(approvedUploadResult.value));
    await closeDialog();
    await until(async () => uploadCount === 1);
    let selected = await pageState();
    assert.deepEqual(selected.files, ['report.csv', 'report.csv']);
    assert.deepEqual(selected.events.map(event => event.type), ['input', 'change']);
    assert.equal(uploadCount, 1, 'approved selection allows the local fixture upload');

    const beforeStaleDirect = await pageState();
    const staleDirectRequest = mcp.startTool('page_upload', { roomId, tabId, target: { by: 'css', value: '#file' }, files: [staleDirectFile] });
    await waitForDialogText('stale-direct.txt');
    replaceFileAtSamePath(staleDirectFile, 'replacement direct file');
    await shell.locator('#agent-approval-approve').click();
    assertToolError(await staleDirectRequest.response, 'CORVID_STALE_REFERENCE');
    await closeDialog();
    assert.deepEqual(await pageState(), beforeStaleDirect, 'replacing a file during approval leaves the input untouched');
    assert.equal(uploadCount, 1, 'a replaced direct-upload file is never submitted');

    // SDK Page.setInputFiles uses the same one-time approval gate.
    sdkClient = await import('../sdk/index.js').then(({ connect }) => connect({ dataDir, token: grant.token }));
    const sdkRoom = await sdkClient.room(roomId);
    const sdkPage = sdkRoom.page(pageLabel);
    const sdkDenied = sdkPage.setInputFiles('#file', [chooserDenied]);
    const sdkDeniedAssertion = assert.rejects(sdkDenied, /not approved/i);
    await waitForDialogText('chooser-denied.txt');
    await shell.locator('#agent-approval-deny').click();
    await sdkDeniedAssertion;
    await closeDialog();
    selected = await pageState();
    assert.deepEqual(selected.files, ['report.csv', 'report.csv'], 'SDK denial preserves the previous file selection');
    assert.deepEqual(selected.events.map(event => event.type), ['input', 'change'], 'SDK denial emits no extra input/change events');
    assert.equal(uploadCount, 1, 'SDK denial does not upload');

    // The SDK file chooser route is also gated, and denial cancels the chooser.
    const chooserWait = sdkPage.waitForFileChooser({ timeout: 5000 });
    await sdkPage.click('#choose');
    const chooser = await chooserWait;
    const chooserDeniedRequest = chooser.setFiles(chooserDenied);
    const chooserDeniedAssertion = assert.rejects(chooserDeniedRequest, /not approved/i);
    await waitForDialogText('chooser-denied.txt');
    await shell.locator('#agent-approval-deny').click();
    await chooserDeniedAssertion;
    await closeDialog();
    selected = await pageState();
    assert.deepEqual(selected.files, ['report.csv', 'report.csv'], 'chooser denial leaves the prior selection untouched');
    assert.equal(uploadCount, 1, 'chooser denial triggers no upload');

    const chooserWaitApproved = sdkPage.waitForFileChooser({ timeout: 5000 });
    await sdkPage.click('#choose');
    const chooserApprovedHandle = await chooserWaitApproved;
    const chooserApprovedRequest = chooserApprovedHandle.setFiles(chooserApproved);
    await waitForDialogText('chooser-approved.txt');
    await shell.locator('#agent-approval-approve').click();
    await chooserApprovedRequest;
    await closeDialog();
    await until(async () => uploadCount === 2);
    selected = await pageState();
    assert.deepEqual(selected.files, ['chooser-approved.txt']);
    assert.deepEqual(selected.events.map(event => event.type), ['input', 'change', 'input', 'change']);
    assert.equal(uploadCount, 2, 'approved chooser selection reaches the local fixture');

    const beforeStaleChooser = await pageState();
    const chooserWaitStale = sdkPage.waitForFileChooser({ timeout: 5000 });
    await sdkPage.click('#choose');
    const chooserStaleHandle = await chooserWaitStale;
    const staleChooserRequest = chooserStaleHandle.setFiles(staleChooserFile);
    const staleChooserAssertion = assert.rejects(staleChooserRequest, error => error.code === 'CORVID_STALE_REFERENCE');
    await waitForDialogText('stale-chooser.txt');
    replaceFileAtSamePath(staleChooserFile, 'replacement chooser file');
    await shell.locator('#agent-approval-approve').click();
    await staleChooserAssertion;
    await closeDialog();
    assert.deepEqual(await pageState(), beforeStaleChooser, 'replacing a chooser file during approval leaves the input untouched');
    assert.equal(uploadCount, 2, 'a replaced chooser file is never submitted');

    // Cross-origin iframe choosers fail before an approval card is created.
    await shell.evaluate(() => {
      const approvalDialog = document.querySelector('#agent-approval-dialog');
      window.__approvalDialogShowCount = 0;
      const showModal = approvalDialog.showModal.bind(approvalDialog);
      approvalDialog.showModal = () => { window.__approvalDialogShowCount++; return showModal(); };
    });
    const crossOriginPageUrl = `${fixtureUrl}cross-origin`;
    await shell.evaluate(id => window.browserShell.invoke('activateRoom', { id }), roomId);
    const crossNavigation = await mcp.callTool('page_navigate_and_snapshot', { roomId, tabId, url: crossOriginPageUrl, waitState: 'load', timeoutMs: 5000, scope: 'page' });
    assert.equal(crossNavigation.result.isError, undefined, JSON.stringify(crossNavigation.value));
    const childReady = await until(async () => {
      const ready = await admin(`/tabs/${encodeURIComponent(tabId)}/action`, 'POST', { operation: 'evaluate', args: { expression: '({ready:window.__crossOriginReady,hit:window.__crossOriginChildHit})' } });
      return ready.status === 200 && ready.payload.value.ready ? ready.payload.value : null;
    });
    const frameDiagnostics = await app.evaluate(({ webContents, BrowserWindow }, url) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL() === url);
      if (!contents) return { found: false };
      const window = BrowserWindow.fromWebContents(contents);
      return {
        found: true,
        windowVisible: window?.isVisible() ?? null,
        mainProcessId: contents.mainFrame.processId,
        contentViews: window?.contentView.children.map(view => ({ webContentsId: view.webContents?.id ?? null, visible: view.visible ?? null, bounds: view.getBounds(), target: view.webContents?.id === contents.id })) ?? [],
        frontWebContentsId: window?.contentView.children.at(-1)?.webContents?.id ?? null,
        targetWebContentsId: contents.id,
        frames: contents.mainFrame.framesInSubtree.map(frame => ({
          url: frame.url,
          processId: frame.processId,
          routingId: frame.routingId,
          parentProcessId: frame.parent?.processId ?? null,
        })),
      };
    }, crossOriginPageUrl);
    assert.equal(childReady.hit, 'file', 'the child frame reports the file input at the dispatched local point');
    const oopifProbeSetup = await app.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL() === url);
      if (!contents) return { found: false };
      const probe = { targetSessions: [], chooserEvents: [] };
      const onMessage = (event, method, params) => {
        if (method === 'Target.attachedToTarget') probe.targetSessions.push({ sessionId: params.sessionId, targetId: params.targetInfo.targetId, type: params.targetInfo.type, url: params.targetInfo.url });
        if (method === 'Page.fileChooserOpened') probe.chooserEvents.push({ sessionId: event.sessionId ?? null, frameId: params.frameId, mode: params.mode });
      };
      contents.__agentApprovalOopifProbe = { probe, onMessage };
      contents.debugger.on('message', onMessage);
      return { found: true };
    }, crossOriginPageUrl);
    assert.equal(oopifProbeSetup.found, true);
    const crossChooserWait = sdkPage.waitForFileChooser({ timeout: 5000 });
    crossChooserWait.catch(() => {});
    const crossChooserArm = await sdkPage.chooserArm;
    const crossClickTarget = await admin(`/tabs/${encodeURIComponent(tabId)}/action`, 'POST', { operation: 'evaluate', args: { expression: '(()=>{const target=document.elementFromPoint(30,30);const rect=target?.getBoundingClientRect();return {tag:target?.tagName,id:target?.id,rect:rect&&{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}})()' } });
    assert.equal(crossClickTarget.payload.value.tag, 'IFRAME', JSON.stringify(crossClickTarget.payload));
    const oopifProbe = await app.evaluate(async ({ webContents, BrowserWindow }, url) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL() === url);
      const entry = contents?.__agentApprovalOopifProbe;
      if (!contents || !entry) return { found: false };
      const frameSessions = entry.probe.targetSessions.filter(target => target.type === 'iframe');
      const childTarget = frameSessions.find(target => target.url.startsWith('http://localhost:')) || frameSessions[0];
      if (!childTarget) return { found: true, targetSessions: entry.probe.targetSessions, chooserEvents: entry.probe.chooserEvents };
      const window = BrowserWindow.fromWebContents(contents);
      window?.focus();
      contents.focus();
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 20, button: 'none', buttons: 0 }, childTarget.sessionId);
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 20, button: 'left', buttons: 1, clickCount: 1 }, childTarget.sessionId);
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 20, y: 20, button: 'left', buttons: 0, clickCount: 1 }, childTarget.sessionId);
      await new Promise(resolve => setTimeout(resolve, 300));
      return { found: true, targetSessions: entry.probe.targetSessions, chooserEvents: entry.probe.chooserEvents, clickedSessionId: childTarget.sessionId };
    }, crossOriginPageUrl);
    const crossInputEvents = await until(async () => {
      const events = await admin(`/tabs/${encodeURIComponent(tabId)}/action`, 'POST', { operation: 'evaluate', args: { expression: 'window.__crossOriginInputEvents' } });
      return events.status === 200 && events.payload.value.some(event => event.eventType === 'click') ? events.payload.value : null;
    }, 1500).catch(async error => {
      const events = await admin(`/tabs/${encodeURIComponent(tabId)}/action`, 'POST', { operation: 'evaluate', args: { expression: 'window.__crossOriginInputEvents' } });
      const chooser = await admin(`/tabs/${encodeURIComponent(tabId)}/chooser?id=${encodeURIComponent(crossChooserArm.id)}&pageLabel=${encodeURIComponent(pageLabel)}`);
      throw new Error(`${error.message}; childHit=${JSON.stringify(childReady.hit)}; frameDiagnostics=${JSON.stringify(frameDiagnostics)}; oopifProbe=${JSON.stringify(oopifProbe)}; clickTarget=${JSON.stringify(crossClickTarget.payload)}; childEvents=${JSON.stringify(events.payload)}; chooser=${JSON.stringify(chooser.payload)}`);
    });
    assert.ok(crossInputEvents.some(event => event.eventType === 'click' && event.trusted), 'the child file input receives a trusted click');
    const crossChooser = await crossChooserWait.catch(async error => {
      const chooser = await admin(`/tabs/${encodeURIComponent(tabId)}/chooser?id=${encodeURIComponent(crossChooserArm.id)}&pageLabel=${encodeURIComponent(pageLabel)}`);
      throw new Error(`${error.message}; childEvents=${JSON.stringify(crossInputEvents)}; chooser=${JSON.stringify(chooser.payload)}`);
    });
    const crossChooserState = await admin(`/tabs/${encodeURIComponent(tabId)}/chooser?id=${encodeURIComponent(crossChooserArm.id)}&pageLabel=${encodeURIComponent(pageLabel)}`);
    assert.equal(crossChooserState.payload.status, 'open', JSON.stringify(crossChooserState.payload));
    const crossSetRequest = crossChooser.setFiles(chooserDenied);
    const crossSetAssertion = assert.rejects(crossSetRequest, error => {
      assert.equal(error.code, 'CORVID_FORBIDDEN', `${error.code}: ${error.message}; oopifProbe=${JSON.stringify(oopifProbe)}`);
      return true;
    });
    await crossSetAssertion;
    assert.equal(await dialog.isVisible(), false, 'cross-origin chooser is denied before showing an approval card');
    assert.equal(await shell.evaluate(() => window.__approvalDialogShowCount), 0, 'cross-origin chooser never opened the approval dialog');
    await delay(100);
    const crossSelection = await admin(`/tabs/${encodeURIComponent(tabId)}/action`, 'POST', { operation: 'evaluate', args: { expression: 'window.__crossOriginSelectionEvents' } });
    assert.equal(crossSelection.status, 200, JSON.stringify(crossSelection.payload));
    assert.equal(crossSelection.payload.value, 0, 'cross-origin chooser rejection leaves the iframe input unchanged');
    assert.equal(crossOriginUploadCount, 0, 'cross-origin chooser rejection submits no file');
    const previousCrossInputCount = crossInputEvents.length;
    const navigationChooserWait = sdkPage.waitForFileChooser({ timeout: 5000 });
    navigationChooserWait.catch(() => {});
    const navigationChooserArm = await sdkPage.chooserArm;
    const navigationOopifProbe = await app.evaluate(async ({ webContents, BrowserWindow }, url) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL() === url);
      const entry = contents?.__agentApprovalOopifProbe;
      if (!contents || !entry) return { found: false };
      const childTarget = entry.probe.targetSessions.filter(target => target.type === 'iframe' && target.url.startsWith('http://localhost:')).at(-1);
      if (!childTarget) return { found: true, targetSessions: entry.probe.targetSessions };
      BrowserWindow.fromWebContents(contents)?.focus();
      contents.focus();
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 20, button: 'none', buttons: 0 }, childTarget.sessionId);
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 20, button: 'left', buttons: 1, clickCount: 1 }, childTarget.sessionId);
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 20, y: 20, button: 'left', buttons: 0, clickCount: 1 }, childTarget.sessionId);
      return { found: true, sessionId: childTarget.sessionId };
    }, crossOriginPageUrl);
    assert.equal(navigationOopifProbe.found, true, JSON.stringify(navigationOopifProbe));
    await until(async () => {
      const events = await admin(`/tabs/${encodeURIComponent(tabId)}/action`, 'POST', { operation: 'evaluate', args: { expression: 'window.__crossOriginInputEvents' } });
      return events.status === 200 && events.payload.value.length > previousCrossInputCount ? events.payload.value : null;
    });
    const navigationChooser = await navigationChooserWait;
    const chooserBeforeNavigation = await admin(`/tabs/${encodeURIComponent(tabId)}/chooser?id=${encodeURIComponent(navigationChooserArm.id)}&pageLabel=${encodeURIComponent(pageLabel)}`);
    assert.equal(chooserBeforeNavigation.payload.status, 'open', JSON.stringify(chooserBeforeNavigation.payload));
    await app.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL() === url);
      const entry = contents?.__agentApprovalOopifProbe;
      if (entry) {
        contents.debugger.removeListener('message', entry.onMessage);
        delete contents.__agentApprovalOopifProbe;
      }
    }, crossOriginPageUrl);
    const returnToFixture = await mcp.callTool('page_navigate_and_snapshot', { roomId, tabId, url: fixtureUrl, waitState: 'load', timeoutMs: 5000, scope: 'page' });
    assert.equal(returnToFixture.result.isError, undefined, JSON.stringify(returnToFixture.value));
    await assert.rejects(navigationChooser.setFiles(chooserDenied), /file chooser is not open|expired|unavailable/i);
    assert.equal(await dialog.isVisible(), false, 'navigation cancels an open chooser before an approval card is created');
    assert.equal(await shell.evaluate(() => window.__approvalDialogShowCount), 0, 'navigation during chooser wait never opens the approval dialog');

    // Raw CDP cannot bypass the per-request file approval gate.
    await assert.rejects(
      sdkPage.cdp('DOM.setFileInputFiles', { nodeId: 1, files: [chooserDenied] }),
      error => error.code === 'CORVID_FORBIDDEN',
    );
    await assert.rejects(
      sdkPage.cdp('Target.attachToTarget', { targetId: 'page-target', flatten: false }),
      error => error.code === 'CORVID_FORBIDDEN',
    );
    await assert.rejects(
      sdkPage.cdp('Target.sendMessageToTarget', { sessionId: 'nested-session', message: JSON.stringify({ id: 1, method: 'DOM.setFileInputFiles', params: { files: [chooserDenied] } }) }),
      error => error.code === 'CORVID_FORBIDDEN',
    );
    await closeDialog();
    assert.equal(uploadCount, 2, 'raw CDP rejection causes no upload');

    // confirm_action only returns a decision; it does not perform a page action.
    const beforeConfirm = await pageState();
    const confirm = mcp.startTool('confirm_action', { roomId, tabId, summary: 'Submit the expense report', impact: 'The site will send it to the current account.' });
    text = await waitForDialogText('Submit the expense report');
    assert.ok(text.includes('The site will send it to the current account.'));
    await shell.locator('#agent-approval-approve').click();
    const confirmResult = await confirm.response;
    assert.deepEqual(confirmResult.value, { status: 'approved', reason: 'approved' });
    await closeDialog();
    assert.deepEqual(await pageState(), beforeConfirm, 'confirm_action approval does not change the page or select files');
    assert.equal(uploadCount, 2, 'confirm_action approval does not cause a network request');

    // Same-Room confirmation actions are handled in request order.
    const queuedFirst = mcp.startTool('confirm_action', { roomId, tabId, summary: 'Queued request one', impact: 'First impact.' });
    await waitForDialogText('Queued request one');
    const queuedSecond = mcp.startTool('confirm_action', { roomId, tabId, summary: 'Queued request two', impact: 'Second impact.' });
    await shell.locator('#agent-approval-deny').click();
    assert.deepEqual((await queuedFirst.response).value, { status: 'denied', reason: 'user_denied' });
    text = await waitForDialogText('Queued request two');
    await shell.locator('#agent-approval-approve').click();
    assert.deepEqual((await queuedSecond.response).value, { status: 'approved', reason: 'approved' });
    await closeDialog();
    assert.ok(text.includes('Second impact.'));

    const deniedConfirm = mcp.startTool('confirm_action', { roomId, tabId, summary: 'Denied request', impact: 'No action should follow denial.' });
    await waitForDialogText('Denied request');
    await shell.locator('#agent-approval-deny').click();
    assert.deepEqual((await deniedConfirm.response).value, { status: 'denied', reason: 'user_denied' });
    await closeDialog();

    const timedOutConfirm = mcp.startTool('confirm_action', { roomId, tabId, summary: 'Timed request', impact: 'Wait for the approval deadline.', timeoutMs: 700 });
    await waitForDialogText('Timed request');
    const timedOutResult = await timedOutConfirm.response;
    assert.deepEqual(timedOutResult.value, { status: 'denied', reason: 'timeout' });
    await closeDialog();

    // MCP cancellation is per request: it closes the approval and does not stop the MCP process.
    const beforeCancel = await pageState();
    const cancelledUpload = mcp.startTool('page_upload', { roomId, tabId, target: { by: 'css', value: '#file' }, files: [chooserDenied] });
    await waitForDialogText('chooser-denied.txt');
    assert.equal(uploadCount, 2, 'a pending upload does not submit files before approval');
    mcp.cancel(cancelledUpload.id);
    await closeDialog();
    await until(async () => {
      const current = await pageState();
      return JSON.stringify(current) === JSON.stringify(beforeCancel) ? current : null;
    });
    assert.equal(uploadCount, 2, 'cancelled MCP request cannot upload after a later approval');
    assert.equal((await mcp.callTool('page_info', { roomId, tabId })).result.isError, undefined, 'the MCP connection remains usable after one tool call is cancelled');

    // Closing the entire MCP transport also cancels its pending desktop approval.
    disconnectMcp = new McpProcess(dataDir, grant.token, { homeDir });
    await disconnectMcp.connect();
    const beforeDisconnect = await pageState();
    const disconnectedUpload = disconnectMcp.startTool('page_upload', { roomId, tabId, target: { by: 'css', value: '#file' }, files: [chooserDenied] });
    const disconnectedAssertion = assert.rejects(disconnectedUpload.response, /MCP exited/);
    await waitForDialogText('chooser-denied.txt');
    await disconnectMcp.close();
    await disconnectedAssertion;
    await closeDialog();
    await until(async () => {
      const current = await pageState();
      return JSON.stringify(current) === JSON.stringify(beforeDisconnect) ? current : null;
    });
    assert.equal(uploadCount, 2, 'disconnecting MCP cannot leave an upload running after approval is closed');

    // browser_script uses the same scoped identity and its child is killed on per-call cancellation.
    const otherGrantResponse = await admin('/agent-clients', 'POST', { name: 'approval-e2e-other-agent', roomIds: [], openRoomGrant: true });
    assert.equal(otherGrantResponse.status, 200);
    otherMcp = new McpProcess(dataDir, otherGrantResponse.payload.token, { browserScript: true, homeDir });
    await otherMcp.connect();
    const foreignRoom = await otherMcp.callTool('room_open', { identifier: 'approval-e2e-foreign-room' });
    const foreignScript = await mcp.callTool('browser_script', { roomId: foreignRoom.value.id, script: 'return (await room.tabs()).length;' });
    assertToolError(foreignScript, 'CORVID_NOT_FOUND');
    const beforeScriptCancel = await pageState();
    const scriptUpload = mcp.startTool('browser_script', {
      roomId,
      timeoutMs: 10000,
      script: `const page=room.page(${JSON.stringify(pageLabel)}); await page.setInputFiles('#file',[${JSON.stringify(chooserDenied)}]); return true;`,
    });
    await waitForDialogText('chooser-denied.txt');
    assert.equal(uploadCount, 2, 'browser_script cannot submit files while approval is pending');
    scriptUpload.response.catch(() => {});
    mcp.cancel(scriptUpload.id);
    await closeDialog();
    await until(async () => {
      const current = await pageState();
      return JSON.stringify(current) === JSON.stringify(beforeScriptCancel) ? current : null;
    });
    assert.equal(uploadCount, 2, 'cancelled browser_script cannot leave a file selection running');

    // A real page navigation cancels a pending file approval before selection.
    const autoNavigatePage = await mcp.callTool('page_navigate_and_snapshot', { roomId, tabId, url: `${fixtureUrl}auto-navigate`, waitState: 'load', timeoutMs: 5000, scope: 'page' });
    assert.equal(autoNavigatePage.result.isError, undefined, JSON.stringify(autoNavigatePage.value));
    const beforeAutoNavigate = await pageState();
    const navigationUpload = mcp.startTool('page_upload', { roomId, tabId, target: { by: 'css', value: '#file' }, files: [chooserDenied] });
    assertToolError(await navigationUpload.response, 'CORVID_CONTROL_LOST');
    await closeDialog();
    await until(async () => (await sdkPage.url()).includes('after-auto-navigation'));
    assert.deepEqual(await pageState(), { files: [], events: [] }, 'navigation leaves the replacement document without a selected file');
    assert.deepEqual(beforeAutoNavigate, { files: [], events: [] });
    assert.equal(uploadCount, 2, 'page navigation cancels the upload before a site request');

    // Navigation also cancels confirm_action before the page changes.
    const navPending = mcp.startTool('confirm_action', { roomId, tabId, summary: 'Cancel on navigation', impact: 'This approval is bound to the current page.' });
    await waitForDialogText('Cancel on navigation');
    const navigate = await mcp.callTool('page_navigate', { roomId, tabId, url: `${fixtureUrl}?changed=1` });
    assert.equal(navigate.result.isError, undefined, JSON.stringify(navigate.value));
    assert.deepEqual((await navPending.response).value, { status: 'denied', reason: 'page_changed' });
    await closeDialog();

    // Taking control cancels a waiting request; the user can resume the Room afterwards.
    const takeControlPending = mcp.startTool('confirm_action', { roomId, tabId, summary: 'Cancel on takeover', impact: 'The user is taking over this Room.' });
    await waitForDialogText('Cancel on takeover');
    await shell.locator('#agent-approval-take-control').click();
    assert.deepEqual((await takeControlPending.response).value, { status: 'denied', reason: 'control_lost' });
    await closeDialog();
    await shell.evaluate(id => window.browserShell.invoke('activateRoom', { id }), roomId);
    const returnControl = shell.getByRole('button', { name: '交还 Agent' });
    await returnControl.waitFor();
    await returnControl.click();
    await until(async () => (await admin(`/rooms/${encodeURIComponent(roomId)}`)).payload?.ownership === 'agent');

    const beforeUploadTakeover = await pageState();
    const uploadTakeoverPending = mcp.startTool('page_upload', { roomId, tabId, target: { by: 'css', value: '#file' }, files: [chooserDenied] });
    await waitForDialogText('chooser-denied.txt');
    await shell.locator('#agent-approval-take-control').click();
    assertToolError(await uploadTakeoverPending.response, 'CORVID_CONTROL_LOST');
    await closeDialog();
    await shell.evaluate(id => window.browserShell.invoke('activateRoom', { id }), roomId);
    const returnAfterUploadTakeover = shell.getByRole('button', { name: '交还 Agent' });
    await returnAfterUploadTakeover.waitFor();
    await returnAfterUploadTakeover.click();
    await until(async () => (await admin(`/rooms/${encodeURIComponent(roomId)}`)).payload?.ownership === 'agent');
    assert.deepEqual(await pageState(), beforeUploadTakeover, 'taking control while upload approval is pending leaves the input untouched');
    assert.equal(uploadCount, 2, 'taking control cancels the upload before a site request');

    // Revoking the client cancels its pending card immediately and fails closed,
    // and tears down an already-armed chooser from the same client.
    const revokeChooserWait = sdkPage.waitForFileChooser({ timeout: 5000 });
    revokeChooserWait.catch(() => {});
    const revokeChooserArm = await sdkPage.chooserArm;
    const chooserArmedBeforeRevoke = await admin(`/tabs/${encodeURIComponent(tabId)}/chooser?id=${encodeURIComponent(revokeChooserArm.id)}&pageLabel=${encodeURIComponent(pageLabel)}`);
    assert.equal(chooserArmedBeforeRevoke.payload.status, 'armed', JSON.stringify(chooserArmedBeforeRevoke.payload));
    const revokedPending = mcp.startTool('confirm_action', { roomId, tabId, summary: 'Cancel on revocation', impact: 'The client authorization is being removed.' });
    await waitForDialogText('Cancel on revocation');
    const revoked = await admin(`/agent-clients/${encodeURIComponent(grant.id)}`, 'DELETE');
    assert.equal(revoked.status, 200, JSON.stringify(revoked.payload));
    assert.deepEqual((await revokedPending.response).value, { status: 'denied', reason: 'authorization_revoked' });
    const chooserAfterRevoke = await admin(`/tabs/${encodeURIComponent(tabId)}/chooser?id=${encodeURIComponent(revokeChooserArm.id)}&pageLabel=${encodeURIComponent(pageLabel)}`);
    assert.equal(chooserAfterRevoke.status, 400, JSON.stringify(chooserAfterRevoke.payload));
    assert.equal(chooserAfterRevoke.payload.code, 'CORVID_STALE_REFERENCE', JSON.stringify(chooserAfterRevoke.payload));
    // The SDK wait also rejects: the poll fails on the revoked credential before
    // it can observe the stale chooser, so only the rejection itself is asserted.
    const revokeWaitFailure = await revokeChooserWait.then(() => null, error => error);
    assert.ok(revokeWaitFailure, 'revocation cancels the armed chooser instead of leaving the wait pending');
    console.log(`  chooser wait after revoke: ${revokeWaitFailure.code ?? revokeWaitFailure.name} ${revokeWaitFailure.message}`);
    await closeDialog();

    const uploadRevokeGrant = await admin('/agent-clients', 'POST', { name: 'approval-e2e-upload-revoke', roomIds: [roomId] });
    assert.equal(uploadRevokeGrant.status, 200, JSON.stringify(uploadRevokeGrant.payload));
    revokeUploadMcp = new McpProcess(dataDir, uploadRevokeGrant.payload.token, { homeDir });
    await revokeUploadMcp.connect();
    const beforeUploadRevoke = await pageState();
    const uploadRevokePending = revokeUploadMcp.startTool('page_upload', { roomId, tabId, target: { by: 'css', value: '#file' }, files: [chooserDenied] });
    await waitForDialogText('chooser-denied.txt');
    const uploadRevoked = await admin(`/agent-clients/${encodeURIComponent(uploadRevokeGrant.payload.id)}`, 'DELETE');
    assert.equal(uploadRevoked.status, 200, JSON.stringify(uploadRevoked.payload));
    assertToolError(await uploadRevokePending.response, 'CORVID_CONTROL_LOST');
    await closeDialog();
    assert.deepEqual(await pageState(), beforeUploadRevoke, 'revoking the upload client leaves the input untouched');
    assert.equal(uploadCount, 2, 'revoking the upload client prevents submission');

    console.log('PASS approval flow: SDK/MCP upload and chooser, symlink and file identity checks, cross-origin rejection, deny/approve/timeout, request cancellation/disconnect, page/handoff/revoke cancellation, confirm_action boundary, and browser_script scoped cancellation');
  } finally {
    if (sdkClient) await sdkClient.disconnect().catch(() => {});
    if (otherMcp) await otherMcp.close();
    if (disconnectMcp) await disconnectMcp.close();
    if (revokeUploadMcp) await revokeUploadMcp.close();
    if (mcp) await mcp.close();
    if (app) await app.close().catch(() => {});
    if (fixture) { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
    if (crossOriginFixture) { crossOriginFixture.closeAllConnections(); await new Promise(resolve => crossOriginFixture.close(resolve)); }
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(fileRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
