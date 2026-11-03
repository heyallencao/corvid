const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const project = path.join(__dirname, '..');
const appPath = path.join(__dirname, '..', 'dist', 'mac-arm64', 'Corvid.app');
const signed = process.argv.includes('--signed');
const identity = process.env.CORVID_MAC_SIGNING_IDENTITY?.trim();
if (signed && (!identity || identity.startsWith('Developer ID Application:'))) {
  console.error('CORVID_MAC_SIGNING_IDENTITY must contain the certificate name without the "Developer ID Application:" prefix.');
  process.exitCode = 1;
} else {
  fs.rmSync(appPath, { recursive: true, force: true });

  const args = ['--mac', '--arm64', '--dir'];
  if (signed) args.push(`-c.mac.identity=${identity}`, '-c.mac.hardenedRuntime=true', '-c.mac.forceCodeSigning=true');
  const result = spawnSync('electron-builder', args, {
    cwd: project,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    fs.rmSync(appPath, { recursive: true, force: true });
    if (result.error) console.error(result.error);
    process.exitCode = result.status ?? 1;
  }
}
