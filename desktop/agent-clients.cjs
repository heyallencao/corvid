const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createAgentClientsStore(filePath) {
  const internalClients = new Map();
  function read() {
    try {
      const store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!store || store.version !== 1 || !Array.isArray(store.clients) || store.clients.some(client => !client || typeof client.id !== 'string' || typeof client.tokenHash !== 'string' || !Array.isArray(client.roomIds) || typeof client.revoked !== 'boolean')) throw new Error('Corvid Agent 授权文件格式无效');
      return store;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, clients: [] };
      throw error;
    }
  }

  function write(store) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(store), { mode: 0o600, flag: 'wx' });
      fs.chmodSync(tempPath, 0o600);
      fs.renameSync(tempPath, filePath);
      fs.chmodSync(filePath, 0o600);
    } finally {
      try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  function hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

  function findByToken(token) {
    if (typeof token !== 'string' || !token) return null;
    const tokenHash = hash(token);
    const internal = internalClients.get(tokenHash);
    if (internal) return internal;
    const candidate = Buffer.from(tokenHash, 'hex');
    return read().clients.find(client => {
      const stored = Buffer.from(client.tokenHash, 'hex');
      return !client.revoked && stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
    }) || null;
  }

  function create({ name, roomIds }) {
    const token = `corvid_agent_${crypto.randomBytes(32).toString('base64url')}`;
    const now = new Date().toISOString();
    const client = { id: crypto.randomUUID(), name, roomIds: [...new Set(roomIds)], tokenHash: hash(token), createdAt: now, revoked: false, revokedAt: null };
    const store = read();
    store.clients.push(client);
    write(store);
    return { client: publicClient(client), token };
  }

  function createInternal({ id, name, roomIds }) {
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name || !Array.isArray(roomIds) || !roomIds.length || roomIds.some(roomId => typeof roomId !== 'string' || !roomId)) throw new TypeError('A built-in Agent identity requires an ID, name, and Room scope');
    if ([...internalClients.values()].some(client => client.id === id)) throw new Error('This built-in Agent task already has an active session identity');
    const token = `corvid_agent_${crypto.randomBytes(32).toString('base64url')}`;
    const client = { id, name, roomIds: [...new Set(roomIds)], tokenHash: hash(token), internal: true, createdAt: new Date().toISOString(), revoked: false, revokedAt: null };
    internalClients.set(client.tokenHash, client);
    return { client: publicClient(client), token };
  }

  function revokeInternal(id) {
    let revoked = false;
    for (const [tokenHash, client] of internalClients) if (client.id === id) { internalClients.delete(tokenHash); revoked = true; }
    return revoked;
  }

  function list() { return read().clients.map(publicClient); }

  function revoke(id) {
    const store = read();
    const client = store.clients.find(item => item.id === id);
    if (!client) return null;
    if (!client.revoked) { client.revoked = true; client.revokedAt = new Date().toISOString(); write(store); }
    return publicClient(client);
  }

  function grantRooms(id, roomIds) {
    if (typeof id !== 'string' || !id || !Array.isArray(roomIds) || !roomIds.length || roomIds.some(roomId => typeof roomId !== 'string' || !roomId)) throw new TypeError('grantRooms requires a client ID and at least one Room ID');
    const store = read();
    const client = store.clients.find(item => item.id === id);
    if (!client || client.revoked) return null;
    const merged = [...new Set([...client.roomIds, ...roomIds])];
    if (merged.length !== client.roomIds.length) { client.roomIds = merged; write(store); }
    return publicClient(client);
  }

  return { create, createInternal, list, revoke, revokeInternal, grantRooms, findByToken };
}

function publicClient(client) {
  const { tokenHash, ...safe } = client;
  return safe;
}

module.exports = { createAgentClientsStore };
