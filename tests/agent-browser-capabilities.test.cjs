const assert = require('node:assert/strict');
const {
  listAgentBrowserCapabilities,
  getAgentBrowserCapability,
  executeAgentBrowserCapability,
} = require('../desktop/agent-browser-capabilities.cjs');

async function main() {
  const capabilities = listAgentBrowserCapabilities();
  assert.deepEqual(capabilities.map(item => item.id), ['page_info', 'page_snapshot', 'page_wait_for_selector', 'page_navigate']);
  assert.equal(new Set(capabilities.map(item => item.piName)).size, capabilities.length);
  assert.equal(new Set(capabilities.map(item => item.mcpName)).size, capabilities.length);
  assert.ok(capabilities.every(item => typeof item.piParameters === 'function' && typeof item.mcpParameters === 'function'));
  assert.equal(capabilities.find(item => item.id === 'page_navigate').sideEffect, 'page-action');
  assert.ok(capabilities.filter(item => item.id !== 'page_navigate').every(item => item.sideEffect === 'read'));
  assert.throws(() => getAgentBrowserCapability('page_click'), /Unknown Corvid Agent browser capability/);

  const calls = [];
  const room = {
    info: { profileId: 'profile-1', userResumePending: false, executionRisk: false },
    ownership: 'agent',
    async tabs() { return [{ id: 'tab-1', label: 'p1' }]; },
    page(id) {
      assert.equal(id, 'tab-1');
      return {
        async currentTab() { calls.push(['currentTab']); },
        async info() { calls.push(['info']); return { url: 'https://fixture.test/', title: 'Fixture', roomId: 'room-1' }; },
        async snapshot(options) { calls.push(['snapshot', options]); return { items: [] }; },
        async waitForSelector(target, options) { calls.push(['waitForSelector', target, options]); },
        async navigate(url) { calls.push(['navigate', url]); },
      };
    },
  };
  const common = { room, tabId: 'tab-1', profileId: 'profile-1', expectedLabel: 'p1' };

  assert.deepEqual(await executeAgentBrowserCapability('page_info', common), { url: 'https://fixture.test/', title: 'Fixture', roomId: 'room-1' });
  assert.deepEqual(await executeAgentBrowserCapability('page_snapshot', { ...common, args: { scope: 'viewport' } }), { items: [] });
  assert.deepEqual(await executeAgentBrowserCapability('page_wait_for_selector', { ...common, args: { target: '#ready', state: 'attached', timeoutMs: 500 } }), {
    url: 'https://fixture.test/', title: 'Fixture', roomId: 'room-1', waitedFor: { state: 'attached' },
  });
  assert.deepEqual(await executeAgentBrowserCapability('page_navigate', { ...common, args: { url: 'https://fixture.test/next' } }), { url: 'https://fixture.test/', title: 'Fixture', roomId: 'room-1' });
  assert.deepEqual(calls.filter(call => call[0] === 'snapshot'), [['snapshot', { scope: 'viewport' }]]);
  assert.deepEqual(calls.find(call => call[0] === 'waitForSelector'), ['waitForSelector', '#ready', { state: 'attached', timeout: 500 }]);
  assert.deepEqual(calls.find(call => call[0] === 'navigate'), ['navigate', 'https://fixture.test/next']);

  await assert.rejects(executeAgentBrowserCapability('page_navigate', { ...common, args: { url: 'javascript:alert(1)' } }), error => error.code === 'CORVID_INVALID_INPUT');
  await assert.rejects(executeAgentBrowserCapability('page_navigate', { ...common, args: { url: 'https://user:secret@fixture.test/' } }), error => error.code === 'CORVID_INVALID_INPUT');
  await assert.rejects(executeAgentBrowserCapability('page_info', { ...common, profileId: 'other-profile' }), error => error.code === 'CORVID_NOT_FOUND');
  await assert.rejects(executeAgentBrowserCapability('page_info', { ...common, expectedLabel: 'p2' }), error => error.code === 'CORVID_STALE_REFERENCE');
  await assert.rejects(executeAgentBrowserCapability('page_info', { ...common, room: { ...room, ownership: 'user' } }), error => error.code === 'CORVID_CONTROL_LOST');
  await assert.rejects(executeAgentBrowserCapability('page_info', { ...common, room: { ...room, info: { ...room.info, executionRisk: true } } }), error => error.code === 'CORVID_EXECUTION_RISK');
  await assert.rejects(executeAgentBrowserCapability('page_info', { ...common, room: { ...room, async tabs() { return [{ id: 'tab-1', label: null }]; } } }), error => error.code === 'CORVID_CONTROL_LOST');

  console.log('PASS shared Agent browser capability metadata, operation handlers, and fail-closed Room/Page checks');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
