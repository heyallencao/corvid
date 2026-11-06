const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = fs;
const temp = mkdtempSync(path.join(os.tmpdir(), 'corvid-package-mac-dir-'));
try {
  const packageScripts = require('../package.json').scripts;
  for (const name of ['package:mac:release', 'package:mac:release:x64', 'package:win:release']) {
    assert.match(packageScripts[name], /--publish never(?:\s|$)/, `${name} must build artifacts without invoking a publisher`);
  }
  const project = path.join(temp, 'project');
  const scripts = path.join(project, 'scripts');
  const fakeBin = path.join(temp, 'bin');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(path.join(scripts, 'package-mac-dir.cjs'), fs.readFileSync(path.join(__dirname, '..', 'scripts', 'package-mac-dir.cjs')));
  const builder = path.join(fakeBin, 'electron-builder');
  writeFileSync(builder, '#!/bin/sh\nmkdir -p dist/mac/Corvid.app\nprintf "%s\\n" "$@" > dist/builder-args.txt\n');
  fs.chmodSync(builder, 0o755);
  for (const arch of ['x64', 'arm64']) {
    const result = spawnSync(process.execPath, [path.join(scripts, 'package-mac-dir.cjs'), arch], {
      cwd: project,
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(path.join(project, 'dist', `mac-${arch}`, 'Corvid.app')));
    assert.ok(!existsSync(path.join(project, 'dist', 'mac')));
  }
  console.log('PASS macOS package staging normalizes electron-builder dist/mac into architecture-specific output directories');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
