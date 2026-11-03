import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { isFullscreenShortcut } = require('../desktop/window-shortcuts.cjs');

test('macOS full-screen shortcut requires Control+Command+F without extra modifiers', () => {
  const input = { type: 'keyDown', key: 'f', control: true, meta: true };
  assert.equal(isFullscreenShortcut(input, 'darwin'), true);
  assert.equal(isFullscreenShortcut({ ...input, shift: true }, 'darwin'), false);
  assert.equal(isFullscreenShortcut({ ...input, alt: true }, 'darwin'), false);
  assert.equal(isFullscreenShortcut({ ...input, control: false }, 'darwin'), false);
  assert.equal(isFullscreenShortcut({ ...input, type: 'keyUp' }, 'darwin'), false);
});

test('Windows and Linux use unmodified F11 and ignore auto-repeat', () => {
  const input = { type: 'keyDown', key: 'F11' };
  for (const platform of ['win32', 'linux']) {
    assert.equal(isFullscreenShortcut(input, platform), true);
    assert.equal(isFullscreenShortcut({ ...input, control: true }, platform), false);
    assert.equal(isFullscreenShortcut({ ...input, meta: true }, platform), false);
    assert.equal(isFullscreenShortcut({ ...input, alt: true }, platform), false);
    assert.equal(isFullscreenShortcut({ ...input, shift: true }, platform), false);
    assert.equal(isFullscreenShortcut({ ...input, isAutoRepeat: true }, platform), false);
  }
});

test('unsupported platforms do not claim a browser key', () => {
  assert.equal(isFullscreenShortcut({ type: 'keyDown', key: 'f' }, 'freebsd'), false);
});
