const assert = require('node:assert/strict');
const path = require('node:path');
const { getCurrentFuseWire } = require('@electron/fuses');

const appBundle = path.resolve(__dirname, '..', 'dist', 'mac-arm64', 'Corvid.app');
const expected = {
  '0': 48, // RunAsNode: disabled
  '1': 48, // EnableCookieEncryption: disabled; cookie migration is not part of this slice
  '2': 48, // EnableNodeOptionsEnvironmentVariable: disabled
  '3': 48, // EnableNodeCliInspectArguments: disabled
  '4': 49, // EnableEmbeddedAsarIntegrityValidation: enabled
  '5': 49, // OnlyLoadAppFromAsar: enabled
  '6': 48, // LoadBrowserProcessSpecificV8Snapshot: disabled; Corvid ships no browser snapshot
  '7': 49, // GrantFileProtocolExtraPrivileges: enabled; the packaged file:// app.asar shell fails to load when disabled
  '8': 49, // WasmTrapHandlers: retained from the Electron binary
};

(async () => {
  const wire = await getCurrentFuseWire(appBundle);
  assert.equal(wire.version, '1', 'the packaged Electron Framework uses the reviewed Fuse V1 wire format');
  const actualIndexes = Object.keys(wire).filter(key => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
  const expectedIndexes = Object.keys(expected).sort((a, b) => Number(a) - Number(b));
  assert.deepEqual(actualIndexes, expectedIndexes,
    'a newly added Electron fuse requires an explicit package-security decision');
  for (const [index, byte] of Object.entries(expected)) {
    assert.equal(wire[index], byte, `Electron Fuse ${index} has the reviewed state`);
  }
  console.log('PASS packaged Electron fuses match the reviewed production profile');
})().catch(error => { console.error(error); process.exitCode = 1; });
