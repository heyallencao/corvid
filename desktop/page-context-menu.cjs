function safePageUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function createPageContextMenuTemplate({ context = {}, handlers = {}, t = key => key } = {}) {
  const items = [];
  const command = (id, key, click, enabled = true) => ({ id, label: t(key), click, enabled });
  const role = (id, key, roleName, enabled = true) => ({ id, label: t(key), role: roleName, enabled });
  const separator = () => items.length && items.push({ type: 'separator' });
  const flags = context.editFlags || {};

  if (context.isEditable) {
    items.push(
      role('corvid-page-undo', 'pageContextUndo', 'undo', Boolean(flags.canUndo)),
      role('corvid-page-redo', 'pageContextRedo', 'redo', Boolean(flags.canRedo)),
    );
    separator();
    items.push(
      role('corvid-page-cut', 'pageContextCut', 'cut', Boolean(flags.canCut)),
      role('corvid-page-copy', 'pageContextCopy', 'copy', Boolean(flags.canCopy)),
      role('corvid-page-paste', 'pageContextPaste', 'paste', Boolean(flags.canPaste)),
      role('corvid-page-delete', 'pageContextDelete', 'delete', Boolean(flags.canDelete)),
    );
    separator();
    items.push(role('corvid-page-select-all', 'pageContextSelectAll', 'selectAll', Boolean(flags.canSelectAll)));
    return items;
  }

  items.push(
    command('corvid-page-back', 'pageContextBack', handlers.back, Boolean(context.canGoBack)),
    command('corvid-page-forward', 'pageContextForward', handlers.forward, Boolean(context.canGoForward)),
    command('corvid-page-reload', 'pageContextReload', handlers.reload),
  );

  const linkUrl = safePageUrl(context.linkURL);
  const imageUrl = context.hasImageContents ? safePageUrl(context.srcURL) : null;
  if (linkUrl || imageUrl || context.editFlags?.canCopy) separator();
  if (linkUrl) {
    items.push(
      command('corvid-page-open-link', 'pageContextOpenLink', () => handlers.openLink?.(linkUrl)),
      command('corvid-page-copy-link', 'pageContextCopyLink', () => handlers.copyText?.(linkUrl)),
    );
  }
  if (imageUrl) {
    items.push(
      command('corvid-page-open-image', 'pageContextOpenImage', () => handlers.openLink?.(imageUrl)),
      command('corvid-page-copy-image', 'pageContextCopyImage', () => handlers.copyText?.(imageUrl)),
    );
  }
  if (context.editFlags?.canCopy) {
    items.push(role('corvid-page-copy', 'pageContextCopy', 'copy', true));
  }
  separator();
  items.push(role('corvid-page-select-all', 'pageContextSelectAll', 'selectAll', true));
  return items;
}

module.exports = { safePageUrl, createPageContextMenuTemplate };
