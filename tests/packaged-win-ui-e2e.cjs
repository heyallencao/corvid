const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const executablePath = path.join(root, 'dist', 'win-unpacked', 'Corvid.exe');
for (const testFile of ['single-instance-e2e.cjs', 'packaged-win-ui-smoke.cjs']) {
  console.log(`RUN packaged Windows UI: ${testFile}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, testFile)], {
    cwd: root,
    env: { ...process.env, CORVID_PACKAGED_APP_PATH: executablePath },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`FAIL packaged Windows UI: ${testFile} (status ${result.status ?? 'signal'})`);
    process.exit(result.status ?? 1);
  }
}
console.log('PASS packaged Windows browser shortcuts and settings UI');
