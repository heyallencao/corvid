const crypto = require('node:crypto');

const testKey = crypto.createHash('sha256').update('corvid-test-only-safe-storage-key').digest();

function createFakeSafeStorage({ available = true, backend = 'test-secret-store', encryptError = null, decryptError = null, shouldReEncryptCount = 0 } = {}) {
  let reEncryptRemaining=shouldReEncryptCount;
  return {
    async isAsyncEncryptionAvailable() { return available; },
    getSelectedStorageBackend() { return backend; },
    async encryptStringAsync(value) {
      if (encryptError) throw encryptError;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', testKey, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    async decryptStringAsync(value) {
      if (decryptError) throw decryptError;
      const bytes = Buffer.from(value);
      const decipher = crypto.createDecipheriv('aes-256-gcm', testKey, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const shouldReEncrypt=reEncryptRemaining>0;
      if(shouldReEncrypt)reEncryptRemaining--;
      return { result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'), shouldReEncrypt };
    },
  };
}

module.exports = { createFakeSafeStorage };
