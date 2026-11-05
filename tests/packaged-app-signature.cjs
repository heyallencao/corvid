const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

function assertDeveloperIdSignature(appPath) {
  assert.equal(process.platform, 'darwin', 'Developer ID signature checks require macOS');
  const verification = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { encoding: 'utf8' });
  assert.ifError(verification.error);
  assert.equal(verification.status, 0, verification.stderr || 'codesign verification failed');

  const details = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
  assert.ifError(details.error);
  assert.equal(details.status, 0, details.stderr || 'codesign could not read the signature');
  const signature = `${details.stdout || ''}\n${details.stderr || ''}`;
  assert.match(signature, /Authority=Developer ID Application:/, 'the app is signed with a Developer ID Application certificate');
  assert.match(signature, /TeamIdentifier=[A-Z0-9]+/, 'the signature identifies its Apple Developer team');
  assert.match(signature, /CodeDirectory .*flags=.*\(runtime\)/, 'the app signature enables Hardened Runtime');
  return signature;
}

module.exports = { assertDeveloperIdSignature };
