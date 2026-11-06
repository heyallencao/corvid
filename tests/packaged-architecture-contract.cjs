const assert = require('node:assert/strict');
const { normalizeMacArchitecture } = require('./packaged-architecture.cjs');

assert.equal(normalizeMacArchitecture('x86_64'), 'x64');
assert.equal(normalizeMacArchitecture('x64'), 'x64');
assert.equal(normalizeMacArchitecture('arm64'), 'arm64');
console.log('PASS macOS lipo architecture labels normalize to Node architecture identifiers');
