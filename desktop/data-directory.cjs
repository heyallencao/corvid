const path = require('node:path');

function resolveDataDirectory({ override = process.env.CORVID_DATA_DIR, homeDir, pathImpl = path } = {}) {
  if (override) return override;
  if (typeof homeDir !== 'string' || !homeDir) throw new TypeError('homeDir must be a non-empty string');
  return pathImpl.join(homeDir, '.corvid');
}

module.exports = { resolveDataDirectory };
