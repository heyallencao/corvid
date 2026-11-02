const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createAgentClientsStore(filePath) {
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
    const candidate = Buffer.from(hash(token), 'hex');
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

  function list() { return read().clients.map(publicClient); }

  function revoke(id) {
    const store = read();
    const client = store.clients.find(item => item.id === id);
    if (!client) return null;
    if (!client.revoked) { client.revoked = true; client.revokedAt = new Date().toISOString(); write(store); }
    return publicClient(client);
  }

  return { create, list, revoke, findByToken };
}

function publicClient(client) {
  const { tokenHash, ...safe } = client;
  return safe;
}

module.exports = { createAgentClientsStore };
