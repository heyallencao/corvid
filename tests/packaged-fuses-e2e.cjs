const assert = require('node:assert/strict');
const path = require('node:path');
const { getCurrentFuseWire } = require('@electron/fuses');

const expectedArch = process.env.CORVID_PACKAGED_ARCH ?? process.arch;
const appDir = `mac-${expectedArch}`;
if (!['arm64', 'x64'].includes(expectedArch)) throw new Error(`Unsupported macOS package architecture: ${expectedArch}`);
const appBundle = path.resolve(__dirname, '..', 'dist', appDir, 'Corvid.app');
const expected = {
  '0': 48, // RunAsNode: disabled
  '1': 48, // EnableCookieEncryption: inherited Electron default; no migration behavior is enabled
  '2': 48, // EnableNodeOptionsEnvironmentVariable: disabled
  '3': 48, // EnableNodeCliInspectArguments: disabled
  '4': 49, // EnableEmbeddedAsarIntegrityValidation: enabled
  '5': 49, // OnlyLoadAppFromAsar: enabled
  '6': 48, // LoadBrowserProcessSpecificV8Snapshot: disabled; Corvid ships no browser snapshot
  '7': 49, // GrantFileProtocolExtraPrivileges: enabled; the packaged file:// app.asar shell fails to load when disabled
  '8': 49, // Electron 45 adds WasmTrapHandlers as enabled; @electron/fuses 1.8.0 preserves it as an unconfigured trailing wire byte
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
