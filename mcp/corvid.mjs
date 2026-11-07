#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connect } from '../sdk/index.js';
import { asPngImageContent } from './image-content.mjs';
import capabilityCore from '../desktop/agent-browser-capabilities.cjs';

const { listAgentBrowserCapabilities, assertAgentReadable, resolveAgentPage, executeAgentBrowserCapability } = capabilityCore;
const SHARED_CAPABILITIES = new Map(listAgentBrowserCapabilities().map(capability => [capability.id, capability]));

const SERVER_NAME = 'corvid-browser';
const SERVER_VERSION = '0.1.0';
const MAX_ITEMS = 100;
const MAX_OUTPUT_BYTES = 32 * 1024;

function asToolResult(value) {
  let encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > MAX_OUTPUT_BYTES) {
    const preview = encoded.slice(0, 12_000);
    encoded = JSON.stringify({ truncated: true, maxBytes: MAX_OUTPUT_BYTES, preview });
  }
  return { content: [{ type: 'text', text: encoded }] };
}

function asToolError(error) {
  const code = typeof error?.code === 'string' && error.code.startsWith('CORVID_')
    ? error.code
    : 'CORVID_DESKTOP_ERROR';
  return { content: [{ type: 'text', text: JSON.stringify({ error: error?.message || 'Corvid request failed', code }) }], isError: true };
}

function registerReadTool(server, name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }, async args => {
    try { return asToolResult(await handler(args)); }
    catch (error) { return asToolError(error); }
  });
}

function registerActionTool(server, name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } }, async args => {
    try { return asToolResult(await handler(args)); }
    catch (error) { return asToolError(error); }
  });
}

function registerScreenshotTool(server, handler) {
  server.registerTool('page_screenshot', {
    description: 'Capture the current viewport of one explicitly selected managed page and return a PNG image. This does not navigate, activate its Room, or save the image to disk.',
    inputSchema: pageScopeSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async args => {
    try {
      const image = await handler(args);
      return { content: [asPngImageContent(image)] };
    } catch (error) { return asToolError(error); }
  });
}

async function connectAgent() {
  const token=process.env.CORVID_AGENT_TOKEN;
  if(!token)throw Object.assign(new Error('请先在 Corvid 设置中创建授权客户端，并在 MCP 主机配置 CORVID_AGENT_TOKEN'),{code:'CORVID_UNAUTHORIZED'});
  return connect({token});
}

const pageScopeSchema = z.object({ roomId: z.string().min(1), tabId: z.string().min(1) });
const pageWaitTimeoutSchema = z.number().int().min(100).max(60_000).default(10_000);
const selectChoiceSchema = z.union([
  z.string().max(2048),
  z.strictObject({ value: z.string().max(2048).optional(), label: z.string().max(2048).optional(), index: z.number().int().min(0).optional() }).refine(choice => Object.keys(choice).length > 0),
]);
const selectChoicesSchema = z.union([selectChoiceSchema, z.array(selectChoiceSchema).max(100), z.null()]);
const locatorSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('ref'), value: z.string().regex(/^@\d+$/) }),
  z.object({ by: z.enum(['css', 'text', 'href']), value: z.string().min(1).max(2048) }),
  z.object({ by: z.literal('role'), value: z.string().regex(/^[a-zA-Z][\w-]*$/), name: z.string().max(2048).optional(), exact: z.boolean().optional() }),
]);

async function withManagedPage(roomId, tabId, operation) {
  const client = await connectAgent();
  try {
    const room = await client.room(roomId);
    const { page, tab } = await resolveAgentPage(room, tabId);
    return await operation(page, tab);
  } finally { await client.disconnect(); }
}

async function withAgentRoom(roomId, operation) {
  const client = await connectAgent();
  try {
    const room = await client.room(roomId);
    assertAgentReadable(room);
    return await operation(room);
  } finally { await client.disconnect(); }
}

async function runSharedCapability(id, roomId, tabId, args = {}) {
  return withAgentRoom(roomId, async room => executeAgentBrowserCapability(id, { room, tabId, args }));
}

function createServer() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerReadTool(server, 'list_profiles', 'List Corvid Profiles. Choose a profile explicitly before listing its Rooms.', z.object({}), async () => {
    const client = await connectAgent();
    try { return (await client.profiles()).slice(0, MAX_ITEMS).map(({ id, name }) => ({ id, name })); }
    finally { await client.disconnect(); }
  });

  registerReadTool(server, 'list_rooms', 'List Rooms in one explicitly selected Profile.', z.object({ profileId: z.string().min(1) }), async ({ profileId }) => {
    const client = await connectAgent();
    try {
      const profile = (await client.profiles()).find(item => item.id === profileId);
      if (!profile) throw Object.assign(new Error(`Profile not found: ${profileId}`), { code: 'CORVID_NOT_FOUND' });
      const rooms = (await client.rooms()).filter(room => room.info.profileId === profileId);
      return { profileId, rooms: rooms.slice(0, MAX_ITEMS).map(room => ({
        id: room.id, name: room.name, ownership: room.ownership,
        finished: Boolean(room.info.finished), yielded: Boolean(room.info.yielded),
        userResumePending: Boolean(room.info.userResumePending),
        executionRisk: Boolean(room.info.executionRisk),
        tabs: room.info.tabs.length,
      })), truncated: rooms.length > MAX_ITEMS };
    } finally { await client.disconnect(); }
  });

  registerReadTool(server, 'list_tabs', 'List tabs in one explicitly selected Room. Page contents are not returned.', z.object({ roomId: z.string().min(1) }), async ({ roomId }) => {
    const client = await connectAgent();
    try {
      const room = await client.room(roomId);
      const tabs = await room.tabs();
      return { roomId, ownership: room.ownership, tabs: tabs.slice(0, MAX_ITEMS).map(tab => ({
        id: tab.id, label: tab.label ?? null, title: tab.title, url: tab.url,
        active: Boolean(tab.active), openedBy: tab.openedBy ?? 'unknown', ready: Boolean(tab.ready),
      })), truncated: tabs.length > MAX_ITEMS };
    } finally { await client.disconnect(); }
  });

  const pageInfoCapability = SHARED_CAPABILITIES.get('page_info');
  registerReadTool(server, pageInfoCapability.mcpName, pageInfoCapability.description, pageInfoCapability.mcpParameters(z, pageScopeSchema), async ({ roomId, tabId }) => runSharedCapability('page_info', roomId, tabId));

  const pageSnapshotCapability = SHARED_CAPABILITIES.get('page_snapshot');
  registerReadTool(server, pageSnapshotCapability.mcpName, pageSnapshotCapability.description, pageSnapshotCapability.mcpParameters(z, pageScopeSchema), async ({ roomId, tabId, scope }) => runSharedCapability('page_snapshot', roomId, tabId, { scope }));

  registerReadTool(server, 'page_wait_for_url', 'Wait until the explicitly selected managed page reaches this exact URL, then return its current page info. This only observes navigation; it does not navigate the page.', pageScopeSchema.extend({ url: z.string().min(1).max(8192), timeoutMs: pageWaitTimeoutSchema }), async ({ roomId, tabId, url, timeoutMs }) => withManagedPage(roomId, tabId, async page => {
    await page.waitForURL(url, { timeout: timeoutMs });
    return await page.info();
  }));

  registerReadTool(server, 'page_wait_for_load', 'Wait for the selected page document to reach domcontentloaded or load, then return its current page info. networkidle is not supported.', pageScopeSchema.extend({ state: z.enum(['domcontentloaded', 'load']).default('load'), timeoutMs: pageWaitTimeoutSchema }), async ({ roomId, tabId, state, timeoutMs }) => withManagedPage(roomId, tabId, async page => {
    await page.waitForLoadState(state, { timeout: timeoutMs });
    return await page.info();
  }));

  const pageWaitCapability = SHARED_CAPABILITIES.get('page_wait_for_selector');
  registerReadTool(server, pageWaitCapability.mcpName, pageWaitCapability.description, pageWaitCapability.mcpParameters(z, pageScopeSchema, locatorSchema, pageWaitTimeoutSchema), async ({ roomId, tabId, target, state, timeoutMs }) => runSharedCapability('page_wait_for_selector', roomId, tabId, {
    target: target.by === 'ref' ? target.value : target,
    state,
    timeoutMs,
  }));

  registerScreenshotTool(server, async ({ roomId, tabId }) => withManagedPage(roomId, tabId, page => page.screenshot()));

  registerActionTool(server, 'page_new', 'Create a new blank, Agent-owned managed page in the explicitly selected Room. This adds a tab but does not navigate it or activate the Room.', z.object({ roomId: z.string().min(1) }), async ({ roomId }) => withAgentRoom(roomId, async room => {
    const page = await room.newPage();
    return await page.info();
  }));

  registerActionTool(server, 'page_close', 'Close one explicitly selected managed page only when it was created by the Agent. Pages with user or unknown origin cannot be closed. A site beforeunload prompt may require user confirmation.', pageScopeSchema, async ({ roomId, tabId }) => withAgentRoom(roomId, async room => {
    const tab = (await room.tabs()).find(item => item.id === tabId);
    if (!tab) throw Object.assign(new Error(`Tab not found: ${tabId}`), { code: 'CORVID_NOT_FOUND' });
    if (tab.openedBy !== 'agent') throw Object.assign(new Error('Only Agent-created pages can be closed through Browser MCP'), { code: 'CORVID_FORBIDDEN' });
    if (!tab.label) throw Object.assign(new Error('Tab is unmanaged; adopt it in Corvid before closing it'), { code: 'CORVID_CONTROL_LOST' });
    return await room.page(tabId).close();
  }));

  const pageNavigateCapability = SHARED_CAPABILITIES.get('page_navigate');
  registerActionTool(server, pageNavigateCapability.mcpName, pageNavigateCapability.description, pageNavigateCapability.mcpParameters(z, pageScopeSchema), async ({ roomId, tabId, url }) => runSharedCapability('page_navigate', roomId, tabId, { url }));

  registerActionTool(server, 'page_back', 'Move back one entry in the navigation history of the explicitly selected managed page. If no prior entry exists, the browser does not navigate. Inspect page_info or page_snapshot after acting.', pageScopeSchema, async ({ roomId, tabId }) => withManagedPage(roomId, tabId, page => page.back()));
  registerActionTool(server, 'page_forward', 'Move forward one entry in the navigation history of the explicitly selected managed page. If no forward entry exists, the browser does not navigate. Inspect page_info or page_snapshot after acting.', pageScopeSchema, async ({ roomId, tabId }) => withManagedPage(roomId, tabId, page => page.forward()));
  registerActionTool(server, 'page_reload', 'Reload the current document in the explicitly selected managed page. This repeats the site request; inspect page_info or page_snapshot after acting.', pageScopeSchema, async ({ roomId, tabId }) => withManagedPage(roomId, tabId, page => page.reload()));

  registerActionTool(server, 'page_click', 'Click one explicit snapshot reference or a unique CSS, text, role, or href locator in a managed page. This may submit forms or trigger other site actions; inspect the page afterwards.', pageScopeSchema.extend({ target: locatorSchema }), async ({ roomId, tabId, target }) => withManagedPage(roomId, tabId, async page => page.click(target.by === 'ref' ? target.value : target)));
  registerActionTool(server, 'page_hover', 'Move the pointer over one explicit locator in a managed page. This may reveal hover menus or tooltips; inspect the page afterwards.', pageScopeSchema.extend({ target: locatorSchema }), async ({ roomId, tabId, target }) => withManagedPage(roomId, tabId, async page => page.hover(target.by === 'ref' ? target.value : target)));

  registerActionTool(server, 'page_scroll', 'Send one bounded mouse-source scroll gesture to an explicitly selected managed page. Coordinates are CSS pixels in the main viewport; positive deltas scroll right/down. Omit both coordinates to use its center. This changes page state and may load more content; inspect the page afterwards.', pageScopeSchema.extend({ deltaX: z.number().finite().min(-2000).max(2000), deltaY: z.number().finite().min(-2000).max(2000), x: z.number().finite().optional(), y: z.number().finite().optional() }).refine(args => (args.deltaX !== 0 || args.deltaY !== 0) && (args.x === undefined) === (args.y === undefined), 'Provide a nonzero scroll delta and both coordinates or neither'), async ({ roomId, tabId, deltaX, deltaY, x, y }) => withManagedPage(roomId, tabId, page => page.scroll(deltaX, deltaY, { ...(x === undefined ? {} : { x, y }) })));
  registerActionTool(server, 'page_fill', 'Fill one editable input, textarea, or contenteditable host identified by an explicit snapshot reference or a unique CSS, text, role, or href locator in a managed page. Contenteditable values are inserted as literal text, not HTML. Use only when you intend to enter this value into the site.', pageScopeSchema.extend({ target: locatorSchema, value: z.string().max(20_000) }), async ({ roomId, tabId, target, value }) => withManagedPage(roomId, tabId, async page => page.fill(target.by === 'ref' ? target.value : target, value)));
  registerActionTool(server, 'page_press', 'Press one supported key on an explicitly selected managed page target. This may submit forms or trigger site actions; inspect the page afterwards.', pageScopeSchema.extend({ target: locatorSchema, key: z.string().min(1).max(32) }), async ({ roomId, tabId, target, key }) => withManagedPage(roomId, tabId, async page => page.press(target.by === 'ref' ? target.value : target, key)));
  registerActionTool(server, 'page_select_option', 'Select one or more values, labels, or option indexes in a managed page select control. Use null or an empty array to clear selection; inspect the selected values afterwards.', pageScopeSchema.extend({ target: locatorSchema, choices: selectChoicesSchema }), async ({ roomId, tabId, target, choices }) => withManagedPage(roomId, tabId, page => page.selectOption(target.by === 'ref' ? target.value : target, choices)));

  function describeRoomSummary(room) {
    return {
      id: room.id, name: room.name, ownership: room.ownership,
      finished: Boolean(room.info.finished), yielded: Boolean(room.info.yielded),
      userResumePending: Boolean(room.info.userResumePending), executionRisk: Boolean(room.info.executionRisk),
      tabs: room.info.tabs.length,
    };
  }

  registerActionTool(server, 'room_open', 'Open an Agent task Room by name or ID: a matching Room is reused when it is available for Agent control, otherwise a new Room is created. Rooms isolate your pages from the user\'s browsing; work only inside the Room this returns.', z.object({ identifier: z.string().min(1).max(256), profileId: z.string().min(1).optional() }), async ({ identifier, profileId }) => {
    const client = await connectAgent();
    try { return describeRoomSummary(await client.openRoom(identifier, profileId === undefined ? {} : { profileId })); }
    finally { await client.disconnect(); }
  });

  registerActionTool(server, 'room_claim', 'Request the user\'s approval to resume a Room that is currently under user control. Wait for the returned ownership to become "agent" before acting; do not retry other write actions while approval is pending.', z.object({ roomId: z.string().min(1) }), async ({ roomId }) => {
    const client = await connectAgent();
    try {
      const room = await client.room(roomId);
      if (room.ownership === 'agent') return { ...describeRoomSummary(room), claimed: false, note: 'Room is already under Agent control' };
      const claimed = await client.claimRoom(room.id);
      return { ...describeRoomSummary(claimed), claimed: claimed.ownership === 'agent' };
    } finally { await client.disconnect(); }
  });

  registerActionTool(server, 'room_yield', 'Hand the Room back to the user so they can inspect or take over the pages. Finish the Room with room_finish when the task is complete instead of only yielding.', z.object({ roomId: z.string().min(1) }), async ({ roomId }) => withAgentRoom(roomId, async room => {
    await room.yieldControl();
    return describeRoomSummary(await room.client.room(room.id));
  }));

  registerActionTool(server, 'room_finish', 'Finish the task Room: Agent-created pages are closed unless kept. Pass keep:"all" to keep every Agent page for the user, or an array of page labels to keep. User and unknown-origin pages are never touched. Returns the closing report (closed / kept / preserved) to relay to the user verbatim.', z.object({ roomId: z.string().min(1), keep: z.union([z.literal('all'), z.array(z.string().min(1)).max(100)]) }), async ({ roomId, keep }) => withAgentRoom(roomId, async room => {
    const report = await room.finish({ keep });
    const current = await room.client.room(room.id).catch(() => null);
    return current ? { ...report, room: describeRoomSummary(current) } : { ...report, closedRoom: true };
  }));

  const waitStateSchema = z.enum(['load', 'domcontentloaded']).default('load');
  registerActionTool(server, 'page_navigate_and_snapshot', 'Navigate the explicitly selected managed page to an HTTP(S) URL, wait for the requested document state, and return the post-navigation semantic snapshot in the same call — one round trip instead of navigate plus wait plus snapshot. Same Room/Tab gates as page_navigate; inspect the returned snapshot for @ref targets.', pageScopeSchema.extend({
    url: z.string().url().max(8192),
    waitState: waitStateSchema,
    timeoutMs: pageWaitTimeoutSchema,
    scope: z.enum(['page', 'viewport']).default('page'),
  }), async ({ roomId, tabId, url, waitState, timeoutMs, scope }) => withManagedPage(roomId, tabId, async page => {
    const info = await page.navigate(url);
    await page.waitForLoadState(waitState, { timeout: timeoutMs });
    const current = await page.info();
    const snapshot = await page.snapshot({ scope });
    return { navigated: { url: current.url, title: current.title, requestedUrl: info?.url ?? url }, waitState, snapshot };
  }));

  const postActionLocator = locatorSchema;
  const pageActionSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('click'), target: postActionLocator }),
    z.object({ kind: z.literal('fill'), target: postActionLocator, value: z.string().max(20_000) }),
    z.object({ kind: z.literal('press'), target: postActionLocator, key: z.string().min(1).max(32) }),
    z.object({ kind: z.literal('hover'), target: postActionLocator }),
    z.object({ kind: z.literal('select_option'), target: postActionLocator, choices: selectChoicesSchema }),
  ]);
  registerActionTool(server, 'page_act_and_snapshot', 'Perform exactly one action (click, fill, press, hover, or select_option) on an explicitly selected managed page, optionally wait for a document state or a selector, and return the post-action semantic snapshot in the same call — one round trip instead of action plus wait plus snapshot. Same Room/Tab gates and locator rules as the single-step tools; use page_snapshot alone when no action is needed.', pageScopeSchema.extend({
    action: pageActionSchema,
    waitState: waitStateSchema,
    waitSelector: z.object({ target: locatorSchema, state: z.enum(['attached', 'detached', 'visible', 'hidden']).default('visible') }).optional(),
    timeoutMs: pageWaitTimeoutSchema,
    scope: z.enum(['page', 'viewport']).default('page'),
  }), async ({ roomId, tabId, action, waitState, waitSelector, timeoutMs, scope }) => withManagedPage(roomId, tabId, async page => {
    const target = action.target.by === 'ref' ? action.target.value : action.target;
    switch (action.kind) {
      case 'click': await page.click(target); break;
      case 'fill': await page.fill(target, action.value); break;
      case 'press': await page.press(target, action.key); break;
      case 'hover': await page.hover(target); break;
      case 'select_option': await page.selectOption(target, action.choices); break;
    }
    if (waitSelector) await page.waitForSelector(waitSelector.target.by === 'ref' ? waitSelector.target.value : waitSelector.target, { state: waitSelector.state || 'visible', timeout: timeoutMs });
    else await page.waitForLoadState(waitState, { timeout: timeoutMs });
    const snapshot = await page.snapshot({ scope });
    return { performed: action.kind, target, snapshot };
  }));

  registerReadTool(server, 'page_get_dialog', 'Read the currently pending dialog (alert, confirm, prompt, beforeunload) on the explicitly selected managed page, or null when none is pending. Pending dialogs block further page actions on that page until answered.', pageScopeSchema, async ({ roomId, tabId }) => withManagedPage(roomId, tabId, async page => ({ dialog: await page.dialog() })));

  registerActionTool(server, 'page_handle_dialog', 'Answer the currently pending dialog on the explicitly selected managed page: accept or dismiss it, optionally providing the prompt text for a prompt dialog. Pending dialogs block further page actions on that page until answered; inspect page_get_dialog first to see what is being asked.', pageScopeSchema.extend({
    accept: z.boolean(),
    promptText: z.string().max(2000).optional(),
  }), async ({ roomId, tabId, accept, promptText }) => withManagedPage(roomId, tabId, async page => {
    if (accept) await page.acceptDialog(promptText);
    else await page.dismissDialog();
    return { answered: { accept, promptText: promptText ?? null }, dialog: await page.dialog() };
  }));

  registerActionTool(server, 'page_act_and_wait', 'Perform exactly one action (click, fill, press, hover, or select_option) on an explicitly selected managed page and wait for the resulting popup, download, or dialog in the same call. The event wait is armed BEFORE the action runs, matching the SDK ordering. Popup returns the newly observed managed page; download returns the agent download receipt (the desktop saves it to a temp location; use the returned path/filename in your report). Same Room/Tab gates as the single-step tools.', pageScopeSchema.extend({
    action: pageActionSchema,
    event: z.enum(['popup', 'download', 'dialog']),
    timeoutMs: z.number().int().min(500).max(60_000).default(30_000),
  }), async ({ roomId, tabId, action, event, timeoutMs }) => withManagedPage(roomId, tabId, async page => {
    const target = action.target.by === 'ref' ? action.target.value : action.target;
    const perform = async () => {
      switch (action.kind) {
        case 'click': return page.click(target);
        case 'fill': return page.fill(target, action.value);
        case 'press': return page.press(target, action.key);
        case 'hover': return page.hover(target);
        case 'select_option': return page.selectOption(target, action.choices);
      }
    };
    if (event === 'dialog') {
      // 打开对话框的动作会一直挂起直到应答：动作后台发射，这里轮询到对话框出现即返回。
      const actionPromise = perform();
      actionPromise.catch(() => {});
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const dialog = await page.dialog();
        if (dialog) return { event, dialog };
        if (Date.now() >= deadline) throw Object.assign(new Error(`page_act_and_wait timed out after ${timeoutMs}ms waiting for a dialog; it may never open — check the action target`), { code: 'CORVID_TIMEOUT' });
        await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
      }
    }
    if (event === 'popup') {
      const popupPromise = page.waitForEvent('popup', { timeout: timeoutMs });
      popupPromise.catch(() => {});
      await perform();
      const popup = await popupPromise;
      const info = await popup.info();
      return { event, page: { roomId: info.roomId, tabId: info.targetId, label: info.label, openedBy: info.openedBy, url: info.url, title: info.title } };
    }
    const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs });
    downloadPromise.catch(() => {});
    await perform();
    const download = await downloadPromise;
    const state = await download.settled();
    return {
      event,
      download: {
        status: state.status, suggestedFilename: download.suggestedFilename(), url: download.url(),
        ...(state.path === undefined ? {} : { path: state.path }),
        ...(state.error === undefined ? {} : { error: state.error }),
      },
    };
  }));

  if (process.env.CORVID_BROWSER_SCRIPT === '1') {
    const SCRIPT_RUNNER = fileURLToPath(new URL('./script-runner.mjs', import.meta.url));
    const SCRIPT_OUTPUT_BYTES = 32 * 1024;
    function truncateReceipt(receipt) {
      let encoded = JSON.stringify(receipt);
      if (Buffer.byteLength(encoded) <= SCRIPT_OUTPUT_BYTES) return { value: receipt };
      return { value: { truncated: true, maxBytes: SCRIPT_OUTPUT_BYTES, preview: encoded.slice(0, 12_000) } };
    }
    function runBrowserScript({ roomId, script, timeoutMs }) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SCRIPT_RUNNER], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
        let buffer = '', settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill('SIGKILL');
          reject(Object.assign(new Error(`browser_script timed out after ${timeoutMs}ms and was cancelled; the Room and its pages are untouched (the script talks to the desktop over stateless HTTP, so its in-flight steps may have landed — inspect page_info or page_snapshot). Re-run with a shorter script or a larger timeoutMs.`), { code: 'CORVID_TIMEOUT' }));
        }, timeoutMs);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => { buffer += chunk; });
        child.stderr.setEncoding('utf8');
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(Object.assign(new Error(`browser_script runner failed to start: ${error.message}`), { code: 'CORVID_DESKTOP_ERROR' })); } });
        child.on('exit', (code, signal) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const line = buffer.split('\n').find(candidate => candidate.trim().startsWith('{'));
          if (!line) { reject(Object.assign(new Error(`browser_script runner produced no receipt (exit code ${code}, signal ${signal})${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`), { code: 'CORVID_DESKTOP_ERROR' })); return; }
          try { resolve(JSON.parse(line)); }
          catch (error) { reject(Object.assign(new Error(`browser_script receipt was not valid JSON: ${error.message}`), { code: 'CORVID_DESKTOP_ERROR' })); }
        });
        child.stdin.end(`${JSON.stringify({ roomId, script })}\n`);
      });
    }
    server.registerTool('browser_script', {
      description: 'Run a batch of JavaScript against one explicitly selected Room in a single call instead of one tool call per step. The script executes locally with full Node.js permissions — it is NOT sandboxed; never run untrusted page content as code. Available bindings: room (the Corvid SDK Room handle: room.newPage(), page.goto/url/snapshot/fill/click/press/selectOption/scroll, page.evaluate for in-page JS), client (SDK client: rooms(), profiles()). Use console.log for progress; the last awaited expression (or return value) becomes the receipt result. Returns { ok, result, logs, room tabs, durationMs }; a timed-out script is killed and the Room stays intact.',
      inputSchema: z.object({
        roomId: z.string().min(1),
        script: z.string().min(1).max(100_000),
        timeoutMs: z.number().int().min(500).max(120_000).default(30_000),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    }, async ({ roomId, script, timeoutMs }) => {
      try {
        const receipt = await runBrowserScript({ roomId, script, timeoutMs });
        if (!receipt.ok) return { content: [{ type: 'text', text: JSON.stringify({ error: receipt.error, code: receipt.code || 'CORVID_SCRIPT_ERROR', logs: receipt.logs, durationMs: receipt.durationMs }) }], isError: true };
        const { value } = truncateReceipt(receipt);
        return asToolResult(value);
      } catch (error) { return asToolError(error); }
    });
  }

  return server;
}

serveStdio(createServer);
