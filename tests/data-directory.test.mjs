import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { resolveDataDirectory } = require('../desktop/data-directory.cjs');

test('default Corvid data directory follows the platform home directory', () => {
  assert.equal(resolveDataDirectory({ override: '', homeDir: '/Users/Ada' }), '/Users/Ada/.corvid');
  assert.equal(resolveDataDirectory({ override: '', homeDir: 'C:\\Users\\Ada', pathImpl: path.win32 }), 'C:\\Users\\Ada\\.corvid');
});

test('CORVID_DATA_DIR overrides the platform default without path rewriting', () => {
  const override = 'D:\\Corvid Data\\profile';
  assert.equal(resolveDataDirectory({ override, homeDir: 'C:\\Users\\Ada', pathImpl: path.win32 }), override);
});

test('a missing home directory is rejected when no explicit directory is supplied', () => {
  assert.throws(() => resolveDataDirectory({ override: '', homeDir: '' }), /homeDir must be a non-empty string/);
});
