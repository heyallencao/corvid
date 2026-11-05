export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

export function asPngImageContent(image) {
  if (!Buffer.isBuffer(image)) throw new TypeError('Screenshot result must be a PNG Buffer');
  if (image.length > MAX_SCREENSHOT_BYTES) {
    throw Object.assign(new Error(`Screenshot exceeds the ${MAX_SCREENSHOT_BYTES}-byte Browser MCP image limit`), { code: 'CORVID_OUTPUT_TOO_LARGE' });
  }
  return { type: 'image', data: image.toString('base64'), mimeType: 'image/png' };
}
