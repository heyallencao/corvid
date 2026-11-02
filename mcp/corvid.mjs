#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { connect } from '../sdk/index.js';

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

const pageScopeSchema = z.object({ roomId: z.string().min(1), tabId: z.string().min(1) });
const locatorSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('ref'), value: z.string().regex(/^@\d+$/) }),
  z.object({ by: z.enum(['css', 'text', 'href']), value: z.string().min(1).max(2048) }),
  z.object({ by: z.literal('role'), value: z.string().regex(/^[a-zA-Z][\w-]*$/), name: z.string().max(2048).optional(), exact: z.boolean().optional() }),
]);

async function withManagedPage(roomId, tabId, operation) {
  const client = await connect();
  try {
    const room = await client.room(roomId);
    assertAgentReadable(room);
    const tab = (await room.tabs()).find(item => item.id === tabId);
    if (!tab) throw Object.assign(new Error(`Tab not found: ${tabId}`), { code: 'CORVID_NOT_FOUND' });
    if (!tab.label) throw Object.assign(new Error('Tab is unmanaged; adopt it in Corvid before operating it'), { code: 'CORVID_CONTROL_LOST' });
    const page = room.page(tabId);
    await page.currentTab();
    return await operation(page, tab);
  } finally { await client.disconnect(); }
}

function createServer() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerReadTool(server, 'list_profiles', 'List Corvid Profiles. Choose a profile explicitly before listing its Rooms.', z.object({}), async () => {
    const client = await connect();
    try { return (await client.profiles()).slice(0, MAX_ITEMS).map(({ id, name }) => ({ id, name })); }
    finally { await client.disconnect(); }
  });

  registerReadTool(server, 'list_rooms', 'List Rooms in one explicitly selected Profile.', z.object({ profileId: z.string().min(1) }), async ({ profileId }) => {
    const client = await connect();
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
    const client = await connect();
    try {
      const room = await client.room(roomId);
      const tabs = await room.tabs();
      return { roomId, ownership: room.ownership, tabs: tabs.slice(0, MAX_ITEMS).map(tab => ({
        id: tab.id, label: tab.label ?? null, title: tab.title, url: tab.url,
        active: Boolean(tab.active), openedBy: tab.openedBy ?? 'unknown', ready: Boolean(tab.ready),
      })), truncated: tabs.length > MAX_ITEMS };
    } finally { await client.disconnect(); }
  });

  registerReadTool(server, 'page_info', 'Read metadata for a tab in an explicitly selected, Agent-owned Room. User-controlled or risky Rooms are not readable through page tools.', z.object({ roomId: z.string().min(1), tabId: z.string().min(1) }), async ({ roomId, tabId }) => {
    const client = await connect();
    try {
      const room = await client.room(roomId);
      assertAgentReadable(room);
      const tab = (await room.tabs()).find(item => item.id === tabId);
      if (!tab) throw Object.assign(new Error(`Tab not found: ${tabId}`), { code: 'CORVID_NOT_FOUND' });
      if (!tab.label) throw Object.assign(new Error('Tab is unmanaged; adopt it in Corvid before requesting page data'), { code: 'CORVID_CONTROL_LOST' });
      return await room.page(tabId).info();
    } finally { await client.disconnect(); }
  });

  registerReadTool(server, 'page_snapshot', 'Read a bounded semantic snapshot of a tab in an explicitly selected, Agent-owned Room.', z.object({
    roomId: z.string().min(1), tabId: z.string().min(1),
    scope: z.enum(['page', 'viewport']).default('page'),
  }), async ({ roomId, tabId, scope }) => {
    const client = await connect();
    try {
      const room = await client.room(roomId);
      assertAgentReadable(room);
      const tab = (await room.tabs()).find(item => item.id === tabId);
      if (!tab) throw Object.assign(new Error(`Tab not found: ${tabId}`), { code: 'CORVID_NOT_FOUND' });
      if (!tab.label) throw Object.assign(new Error('Tab is unmanaged; adopt it in Corvid before requesting page data'), { code: 'CORVID_CONTROL_LOST' });
      return await room.page(tabId).snapshot({ scope });
    } finally { await client.disconnect(); }
  });

  registerActionTool(server, 'page_navigate', 'Navigate an explicitly selected managed page to an HTTP or HTTPS URL. This can change site state; inspect the result after acting.', pageScopeSchema.extend({ url: z.string().url().max(8192) }), async ({ roomId, tabId, url }) => {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw Object.assign(new Error('Only HTTP and HTTPS navigation without embedded credentials is supported'), { code: 'CORVID_INVALID_INPUT' });
    return withManagedPage(roomId, tabId, async page => { await page.navigate(parsed.href); return await page.info(); });
  });

  registerActionTool(server, 'page_click', 'Click one explicit snapshot reference or a unique CSS, text, role, or href locator in a managed page. This may submit forms or trigger other site actions; inspect the page afterwards.', pageScopeSchema.extend({ target: locatorSchema }), async ({ roomId, tabId, target }) => withManagedPage(roomId, tabId, async page => page.click(target.by === 'ref' ? target.value : target)));
  registerActionTool(server, 'page_fill', 'Fill one explicit snapshot reference or a unique CSS, text, role, or href locator in a managed page. Use only when you intend to enter this value into the site.', pageScopeSchema.extend({ target: locatorSchema, value: z.string().max(20_000) }), async ({ roomId, tabId, target, value }) => withManagedPage(roomId, tabId, async page => page.fill(target.by === 'ref' ? target.value : target, value)));
  registerActionTool(server, 'page_press', 'Press one supported key on an explicitly selected managed page target. This may submit forms or trigger site actions; inspect the page afterwards.', pageScopeSchema.extend({ target: locatorSchema, key: z.string().min(1).max(32) }), async ({ roomId, tabId, target, key }) => withManagedPage(roomId, tabId, async page => page.press(target.by === 'ref' ? target.value : target, key)));

  return server;
}

function assertAgentReadable(room) {
  if (room.ownership !== 'agent' || room.info.userResumePending) {
    throw Object.assign(new Error('Room is under user control; return control to the Agent in Corvid before reading page data'), { code: 'CORVID_CONTROL_LOST' });
  }
  if (room.info.executionRisk) {
    throw Object.assign(new Error('Room has an unresolved execution risk; review it in Corvid before reading page data'), { code: 'CORVID_EXECUTION_RISK' });
  }
}

serveStdio(createServer);
