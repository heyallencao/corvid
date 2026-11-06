#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
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

  return server;
}

serveStdio(createServer);
