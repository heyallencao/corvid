const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-access-'));
  let releaseSlowNavigation;
  let slowNavigationStarted;
  const slowNavigationGate = new Promise(resolve => { releaseSlowNavigation = resolve; });
  const slowNavigationSignal = new Promise(resolve => { slowNavigationStarted = resolve; });
  const fixture = http.createServer(async (request, response) => {
    if (request.url === '/slow') {
      slowNavigationStarted();
      await slowNavigationGate;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<title>${request.url}</title><p>Agent Room fixture</p>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
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
      const payload = await response.json();
      return { status: response.status, payload };
    };
    const admin = async (route, method = 'GET', body) => {
      const result = await request(control.token, route, method, body);
      assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result));
      return result.payload;
    };

    const roomA = await admin('/rooms', 'POST', { name: '授权空间 A' });
    const roomB = await admin('/rooms', 'POST', { name: '授权空间 B' });
    const grantA = await admin('/agent-clients', 'POST', { name: 'Agent A', roomIds: [roomA.id] });
    const grantB = await admin('/agent-clients', 'POST', { name: 'Agent B', roomIds: [roomB.id] });
    assert.ok(grantA.id && grantA.token, 'new scoped client receives an opaque credential once');
    assert.ok(grantB.id && grantB.token, 'second scoped client receives an independent credential');

    const [listA, listB] = await Promise.all([
      request(grantA.token, '/rooms'),
      request(grantB.token, '/rooms')
    ]);
    assert.equal(listA.status, 200);
    assert.equal(listB.status, 200);
    assert.deepEqual(listA.payload.rooms.map(room => room.id), [roomA.id]);
    assert.deepEqual(listB.payload.rooms.map(room => room.id), [roomB.id]);
    assert.equal(Object.hasOwn(listA.payload, 'activeProfileId'), false, 'scoped room listing does not expose global Profile state');

    const [roomADetails, roomBDetails] = await Promise.all([
      request(grantA.token, `/rooms/${roomA.id}`),
      request(grantB.token, `/rooms/${roomB.id}`)
    ]);
    assert.equal(roomADetails.status, 200);
    assert.equal(roomBDetails.status, 200);
    const tabAId = roomADetails.payload.tabs[0].id;
    const tabBId = roomBDetails.payload.tabs[0].id;

    let slowNavigationSettled = false;
    const slowNavigation = request(grantA.token, `/tabs/${tabAId}/navigate`, 'POST', { url: `${fixtureOrigin}/slow` }).then(result => {
      slowNavigationSettled = true;
      return result;
    }, error => {
      slowNavigationSettled = true;
      return { error };
    });
    await Promise.race([slowNavigationSignal, delay(5_000).then(() => { throw new Error('Room A navigation did not reach the gated local page'); })]);
    assert.equal(slowNavigationSettled, false, 'Room A navigation remains pending while the fixture holds its response');
    const fastNavigation = await Promise.race([
      request(grantB.token, `/tabs/${tabBId}/navigate`, 'POST', { url: `${fixtureOrigin}/fast` }),
      delay(3_000).then(() => { throw new Error('Room A navigation blocked the independent Room B operation'); }),
    ]);
    assert.equal(fastNavigation.status, 200, 'Room B navigation completes while the authorized Room A request remains blocked');
    assert.equal(slowNavigationSettled, false, 'Room B completion does not depend on releasing Room A navigation');
    releaseSlowNavigation();
    const slowNavigationResult = await slowNavigation;
    assert.equal(slowNavigationResult.status, 200, 'Room A navigation completes when its own response is released');

    const [createTabA, createTabB] = await Promise.all([
      request(grantA.token, `/rooms/${roomA.id}/tabs`, 'POST', { url: 'about:blank' }),
      request(grantB.token, `/rooms/${roomB.id}/tabs`, 'POST', { url: 'about:blank' })
    ]);
    assert.equal(createTabA.status, 200, 'Agent A can operate in its granted Room while Agent B acts in another Room');
    assert.equal(createTabB.status, 200, 'Agent B can operate in its granted Room while Agent A acts in another Room');

    const [crossRoomA, crossRoomB, crossTabA, crossTabB, crossWriteA, crossWriteB] = await Promise.all([
      request(grantA.token, `/rooms/${roomB.id}`),
      request(grantB.token, `/rooms/${roomA.id}`),
      request(grantA.token, `/tabs/${tabBId}/activate`, 'POST', {}),
      request(grantB.token, `/tabs/${tabAId}/activate`, 'POST', {}),
      request(grantA.token, `/rooms/${roomB.id}/tabs`, 'POST', { url: 'about:blank' }),
      request(grantB.token, `/rooms/${roomA.id}/tabs`, 'POST', { url: 'about:blank' })
    ]);
    for (const result of [crossRoomA, crossRoomB, crossTabA, crossTabB, crossWriteA, crossWriteB]) {
      assert.equal(result.status, 403, 'concurrent cross-Room reads and mutations remain forbidden');
      assert.equal(result.payload.code, 'CORVID_FORBIDDEN');
    }

    const [stateA, stateB] = await Promise.all([
      request(grantA.token, '/rooms'),
      request(grantB.token, '/rooms')
    ]);
    assert.deepEqual(stateA.payload.rooms.map(room => room.id), [roomA.id], 'Agent A never discovers Agent B Room after concurrent operations');
    assert.deepEqual(stateB.payload.rooms.map(room => room.id), [roomB.id], 'Agent B never discovers Agent A Room after concurrent operations');
    const { connect } = await import('../sdk/index.js');
    await assert.rejects(() => connect({ dataDir, baseUrl: control.baseUrl }), /provided together/, 'a base URL without an explicit token must not fall back to the administrator control file');
    await assert.rejects(() => connect({ baseUrl: 'https://example.com', token: grantB.token }), /127\.0\.0\.1/, 'explicit credentials cannot be sent to a nonlocal host');
    const untrustedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-access-untrusted-endpoint-'));
    try {
      fs.writeFileSync(path.join(untrustedDataDir, 'control.json'), JSON.stringify({ baseUrl: 'http://example.com:43123', token: 'administrator-placeholder' }), { mode: 0o600 });
      await assert.rejects(() => connect({ dataDir: untrustedDataDir, token: grantB.token }), /127\.0\.0\.1/, 'a scoped token is never sent to an untrusted endpoint read from control.json');
    } finally { fs.rmSync(untrustedDataDir, { recursive: true, force: true }); }
    const adminSdk = await connect({ baseUrl: control.baseUrl, token: control.token });
    const sdkGrant = await adminSdk.createAgentClient('SDK issued', [roomA.id]);
    assert.ok(sdkGrant.id && sdkGrant.token);
    assert.equal((await adminSdk.agentClients()).find(client => client.id === sdkGrant.id).token, undefined, 'grant listing never returns a stored credential');
    await adminSdk.revokeAgentClient(sdkGrant.id);
    assert.equal((await request(sdkGrant.token, '/rooms')).status, 401, 'SDK revocation takes effect immediately');
    await adminSdk.disconnect();
    const tokenOnlySdk = await connect({ dataDir, token: grantB.token });
    assert.deepEqual((await tokenOnlySdk.rooms()).map(room => room.id), [roomB.id], 'token-only SDK connection uses the local endpoint without falling back to admin credentials');
    assert.deepEqual((await tokenOnlySdk.profiles()).map(profile => profile.id), ['default'], 'scoped clients see only Profiles represented by granted Rooms');
    await tokenOnlySdk.disconnect();
    const scopedSdk = await connect({ baseUrl: control.baseUrl, token: grantB.token });
    assert.deepEqual((await scopedSdk.rooms()).map(room => room.id), [roomB.id], 'SDK accepts a scoped Corvid credential directly');
    await scopedSdk.disconnect();

    const crossRoom = await request(grantA.token, `/rooms/${roomB.id}`);
    assert.equal(crossRoom.status, 403);
    assert.equal(crossRoom.payload.code, 'CORVID_FORBIDDEN');
    assert.deepEqual((await request(grantA.token, '/profiles')).payload.profiles.map(profile => profile.id), ['default'], 'scoped clients see only Profiles used by granted Rooms');
    assert.equal((await request(grantA.token, '/history')).status, 403);
    assert.equal((await request(grantA.token, '/downloads')).status, 403);
    assert.equal((await request(grantA.token, '/windows')).status, 403);

    const revoked = await admin(`/agent-clients/${grantA.id}`, 'DELETE');
    assert.equal(revoked.revoked, true);
    assert.equal((await request(grantA.token, '/rooms')).status, 401, 'revocation immediately invalidates the client credential');
    const grants = await admin('/agent-clients');
    assert.equal(grants.clients.find(client => client.id === grantA.id).revoked, true);
    const grantStore = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-clients.json'), 'utf8'));
    assert.equal(grantStore.clients.some(client => client.tokenHash === grantA.token), false, 'plaintext credential is never persisted');
    assert.equal((fs.statSync(path.join(dataDir, 'agent-clients.json')).mode & 0o777), 0o600);
    await app.close();
    app = await _electron.launch({ executablePath: electronPath, args: [project], env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' } });
    await app.firstWindow();
    control = null;
    for (let i = 0; i < 200; i++) {
      try { control = JSON.parse(fs.readFileSync(controlPath, 'utf8')); break; } catch { await delay(25); }
    }
    assert.ok(control?.token, 'desktop restarts with a fresh administrator credential');
    assert.equal((await request(grantB.token, '/rooms')).payload.rooms[0].id, roomB.id, 'an unrevoked scoped credential survives desktop restart');
    assert.equal((await request(grantA.token, '/rooms')).status, 401, 'a revoked credential stays invalid after restart');
    console.log('Agent access authorization E2E passed');
  } finally {
    releaseSlowNavigation();
    if (app) await app.close().catch(() => {});
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
