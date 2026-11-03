const crypto = require('node:crypto');

const testKey = crypto.createHash('sha256').update('corvid-test-only-safe-storage-key').digest();

function createFakeSafeStorage({ available = true, backend = 'test-secret-store', providerTag = 'v11', encryptError = null, decryptError = null, shouldReEncryptCount = 0 } = {}) {
  let reEncryptRemaining=shouldReEncryptCount;
  return {
    async isAsyncEncryptionAvailable() { return available; },
    getSelectedStorageBackend() { return backend; },
    async encryptStringAsync(value) {
      if (encryptError) throw encryptError;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', testKey, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from(providerTag), iv, cipher.getAuthTag(), encrypted]);
    },
    async decryptStringAsync(value) {
      if (decryptError) throw decryptError;
      const bytes = Buffer.from(value);
      const payload = bytes.subarray(3);
      const decipher = crypto.createDecipheriv('aes-256-gcm', testKey, payload.subarray(0, 12));
      decipher.setAuthTag(payload.subarray(12, 28));
      const shouldReEncrypt=reEncryptRemaining>0;
      if(shouldReEncrypt)reEncryptRemaining--;
      return { result: Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8'), shouldReEncrypt };
    },
  };
}

module.exports = { createFakeSafeStorage };
