const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const arch = process.argv[2] ?? 'arm64';
if (!['arm64', 'x64'].includes(arch)) {
  throw new Error(`Unsupported macOS architecture: ${arch}`);
}

const appPath = path.join(__dirname, '..', 'dist', `mac-${arch}`, 'Corvid.app');
fs.rmSync(appPath, { recursive: true, force: true });

const result = spawnSync('electron-builder', ['--mac', `--${arch}`, '--dir'], {
  cwd: path.join(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
});

if (result.error || result.status !== 0) {
  fs.rmSync(appPath, { recursive: true, force: true });
  if (result.error) console.error(result.error);
  process.exitCode = result.status ?? 1;
}
