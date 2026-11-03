function isFullscreenShortcut(input, platform) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat || input.alt || input.shift) return false;
  const key = String(input.key || '').toLowerCase();
  if (platform === 'darwin') return key === 'f' && input.control === true && input.meta === true;
  return key === 'f11' && !input.control && !input.meta;
}

module.exports = { isFullscreenShortcut };
