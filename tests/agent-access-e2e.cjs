const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-access-'));
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

    const listA = await request(grantA.token, '/rooms');
    assert.equal(listA.status, 200);
    assert.deepEqual(listA.payload.rooms.map(room => room.id), [roomA.id]);
    assert.equal(Object.hasOwn(listA.payload, 'activeProfileId'), false, 'scoped room listing does not expose global Profile state');
    assert.equal((await request(grantB.token, '/rooms')).payload.rooms[0].id, roomB.id);
    const roomBDetails = await request(grantB.token, `/rooms/${roomB.id}`);
    assert.equal(roomBDetails.status, 200);
    const tabBId = roomBDetails.payload.tabs[0].id;
    const createTabA = await request(grantA.token, `/rooms/${roomA.id}/tabs`, 'POST', { url: 'about:blank' });
    assert.equal(createTabA.status, 200, 'a scoped client can operate inside its granted Room');
    assert.equal((await request(grantA.token, `/tabs/${tabBId}/activate`, 'POST', {})).status, 403, 'a guessed tab ID from another Room remains forbidden');
    const { connect } = await import('../sdk/index.js');
    await assert.rejects(() => connect({ token: grantB.token }), /provided together/, 'a partial scoped credential must not fall back to the administrator control file');
    await assert.rejects(() => connect({ baseUrl: 'https://example.com', token: grantB.token }), /127\.0\.0\.1/, 'explicit credentials cannot be sent to a nonlocal host');
    const adminSdk = await connect({ baseUrl: control.baseUrl, token: control.token });
    const sdkGrant = await adminSdk.createAgentClient('SDK issued', [roomA.id]);
    assert.ok(sdkGrant.id && sdkGrant.token);
    assert.equal((await adminSdk.agentClients()).find(client => client.id === sdkGrant.id).token, undefined, 'grant listing never returns a stored credential');
    await adminSdk.revokeAgentClient(sdkGrant.id);
    assert.equal((await request(sdkGrant.token, '/rooms')).status, 401, 'SDK revocation takes effect immediately');
    await adminSdk.disconnect();
    const scopedSdk = await connect({ baseUrl: control.baseUrl, token: grantB.token });
    assert.deepEqual((await scopedSdk.rooms()).map(room => room.id), [roomB.id], 'SDK accepts a scoped Corvid credential directly');
    await scopedSdk.disconnect();

    const crossRoom = await request(grantA.token, `/rooms/${roomB.id}`);
    assert.equal(crossRoom.status, 403);
    assert.equal(crossRoom.payload.code, 'CORVID_FORBIDDEN');
    assert.equal((await request(grantA.token, '/profiles')).status, 403);
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
    if (app) await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
