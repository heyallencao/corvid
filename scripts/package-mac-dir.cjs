const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.join(__dirname, '..', 'dist', 'mac-arm64', 'Corvid.app');
fs.rmSync(appPath, { recursive: true, force: true });

const result = spawnSync('electron-builder', ['--mac', '--arm64', '--dir'], {
  cwd: path.join(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
});

if (result.error || result.status !== 0) {
  fs.rmSync(appPath, { recursive: true, force: true });
  if (result.error) console.error(result.error);
  process.exitCode = result.status ?? 1;
}
