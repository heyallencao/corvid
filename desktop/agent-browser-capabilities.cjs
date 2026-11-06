const CAPABILITIES = Object.freeze([
  Object.freeze({
    id: 'page_info',
    piName: 'corvid_page_info',
    mcpName: 'page_info',
    label: 'Read selected page information',
    description: 'Read the current URL, title, and load state of the page explicitly selected for this Corvid task.',
    sideEffect: 'read',
    piParameters: type => type.Object({}),
    mcpParameters: (_zod, pageScope) => pageScope,
  }),
  Object.freeze({
    id: 'page_snapshot',
    piName: 'corvid_page_snapshot',
    mcpName: 'page_snapshot',
    label: 'Read selected page',
    description: 'Read a semantic snapshot of the page explicitly selected for this Corvid task.',
    sideEffect: 'read',
    piParameters: type => type.Object({ scope: type.Optional(type.Union([type.Literal('page'), type.Literal('viewport')])) }),
    mcpParameters: (zod, pageScope) => pageScope.extend({ scope: zod.enum(['page', 'viewport']).default('page') }),
  }),
  Object.freeze({
    id: 'page_wait_for_selector',
    piName: 'corvid_wait_for_selector',
    mcpName: 'page_wait_for_selector',
    label: 'Wait for selected page state',
    description: 'Wait for one locator on the explicitly selected page to reach a requested state, then return current page information.',
    sideEffect: 'read',
    piParameters: type => type.Object({
      target: type.String({ minLength: 1, maxLength: 2048 }),
      state: type.Optional(type.Union([type.Literal('attached'), type.Literal('detached'), type.Literal('visible'), type.Literal('hidden')])),
      timeoutMs: type.Optional(type.Integer({ minimum: 100, maximum: 60_000 })),
    }),
    mcpParameters: (zod, pageScope, locatorSchema, timeoutSchema) => pageScope.extend({
      target: locatorSchema,
      state: zod.enum(['attached', 'detached', 'visible', 'hidden']).default('visible'),
      timeoutMs: timeoutSchema,
    }),
  }),
  Object.freeze({
    id: 'page_navigate',
    piName: 'corvid_navigate',
    mcpName: 'page_navigate',
    label: 'Navigate selected page',
    description: 'Navigate only the explicitly selected Corvid task page to an HTTP or HTTPS URL.',
    sideEffect: 'page-action',
    piParameters: type => type.Object({ url: type.String({ minLength: 1, maxLength: 4096 }) }),
    mcpParameters: (zod, pageScope) => pageScope.extend({ url: zod.string().url().max(8192) }),
  }),
]);

const CAPABILITY_BY_ID = new Map(CAPABILITIES.map(capability => [capability.id, capability]));

function listAgentBrowserCapabilities() {
  return CAPABILITIES.map(capability => ({ ...capability }));
}

function getAgentBrowserCapability(id) {
  const capability = CAPABILITY_BY_ID.get(id);
  if (!capability) throw new TypeError(`Unknown Corvid Agent browser capability: ${id}`);
  return capability;
}

function assertAgentReadable(room, profileId) {
  if (profileId && room.info.profileId !== profileId) {
    throw Object.assign(new Error('Room does not belong to the selected Profile'), { code: 'CORVID_NOT_FOUND' });
  }
  if (room.ownership !== 'agent' || room.info.userResumePending) {
    throw Object.assign(new Error('Room is under user control or takeover is pending'), { code: 'CORVID_CONTROL_LOST' });
  }
  if (room.info.executionRisk) {
    throw Object.assign(new Error('Room has an unresolved execution risk'), { code: 'CORVID_EXECUTION_RISK' });
  }
}

async function resolveAgentPage(room, tabId, { profileId, expectedLabel } = {}) {
  assertAgentReadable(room, profileId);
  const tab = (await room.tabs()).find(item => item.id === tabId);
  if (!tab) throw Object.assign(new Error(`Tab not found: ${tabId}`), { code: 'CORVID_NOT_FOUND' });
  if (!tab.label) throw Object.assign(new Error('Tab is unmanaged; manage it in Corvid before using Agent page tools'), { code: 'CORVID_CONTROL_LOST' });
  if (expectedLabel && tab.label !== expectedLabel) {
    throw Object.assign(new Error('Selected tab changed or is no longer managed'), { code: 'CORVID_STALE_REFERENCE' });
  }
  const page = room.page(tabId);
  await page.currentTab();
  return { page, tab };
}

function parseHttpUrl(value) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw Object.assign(new TypeError('url must be an absolute HTTP or HTTPS URL'), { code: 'CORVID_INVALID_INPUT' }); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw Object.assign(new Error('Only HTTP and HTTPS navigation without embedded credentials is supported'), { code: 'CORVID_INVALID_INPUT' });
  }
  return parsed.href;
}

async function executeAgentBrowserCapability(id, { room, tabId, profileId, expectedLabel, args = {} }) {
  const capability = getAgentBrowserCapability(id);
  const { page } = await resolveAgentPage(room, tabId, { profileId, expectedLabel });
  switch (capability.id) {
    case 'page_info':
      return await page.info();
    case 'page_snapshot':
      return await page.snapshot({ scope: args.scope || 'page' });
    case 'page_wait_for_selector': {
      await page.waitForSelector(args.target, { state: args.state || 'visible', timeout: args.timeoutMs || 10_000 });
      return { ...(await page.info()), waitedFor: { state: args.state || 'visible' } };
    }
    case 'page_navigate': {
      const url = parseHttpUrl(args.url);
      await page.navigate(url);
      return await page.info();
    }
    default:
      throw new TypeError(`Unhandled Corvid Agent browser capability: ${id}`);
  }
}

module.exports = {
  listAgentBrowserCapabilities,
  getAgentBrowserCapability,
  assertAgentReadable,
  resolveAgentPage,
  executeAgentBrowserCapability,
};
