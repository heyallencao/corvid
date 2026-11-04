import test from 'node:test';
import assert from 'node:assert/strict';
import mainLocale from '../desktop/main-locales.cjs';
import pageContextMenu from '../desktop/page-context-menu.cjs';

const { createMainLocale } = mainLocale;
const { createPageContextMenuTemplate, safePageUrl } = pageContextMenu;

const byId = (items, id) => items.find(item => item.id === id) || null;

test('page context menu localizes navigation and link actions', () => {
  const zh = createPageContextMenuTemplate({
    t: createMainLocale('zh-CN').t,
    context: { canGoBack: true, canGoForward: false, linkURL: 'https://example.test/path?q=1' },
    handlers: { back() {}, openLink() {}, copyText() {} },
  });
  const en = createPageContextMenuTemplate({
    t: createMainLocale('en').t,
    context: { canGoBack: true, canGoForward: false, linkURL: 'https://example.test/path?q=1' },
    handlers: { back() {}, openLink() {}, copyText() {} },
  });

  assert.equal(byId(zh, 'corvid-page-back').label, '后退');
  assert.equal(byId(zh, 'corvid-page-forward').enabled, false);
  assert.equal(byId(zh, 'corvid-page-open-link').label, '在新标签页中打开链接');
  assert.equal(byId(zh, 'corvid-page-copy-link').label, '复制链接地址');
  assert.equal(byId(en, 'corvid-page-back').label, 'Back');
  assert.equal(byId(en, 'corvid-page-open-link').label, 'Open Link in New Tab');
  assert.equal(zh.some(item => /Developer|开发者|Electron|Inspect|检查元素/i.test(item.label || '')), false);
});

test('link and image actions only accept HTTP(S) URLs and invoke Corvid handlers', () => {
  const actions = [];
  const items = createPageContextMenuTemplate({
    t: createMainLocale('en').t,
    context: { linkURL: 'javascript:alert(1)', hasImageContents: true, srcURL: 'https://example.test/image.png' },
    handlers: { openLink: value => actions.push(['open', value]), copyText: value => actions.push(['copy', value]) },
  });
  assert.equal(byId(items, 'corvid-page-open-link'), null, 'script URLs are never offered as a navigation action');
  byId(items, 'corvid-page-open-image').click();
  byId(items, 'corvid-page-copy-image').click();
  assert.deepEqual(actions, [
    ['open', 'https://example.test/image.png'],
    ['copy', 'https://example.test/image.png'],
  ]);
  assert.equal(safePageUrl('data:text/html,hello'), null);
  assert.equal(safePageUrl('file:///tmp/private.html'), null);
  assert.equal(safePageUrl('https://example.test'), 'https://example.test/');
});

test('editable page context exposes only applicable editing roles', () => {
  const items = createPageContextMenuTemplate({
    t: createMainLocale('zh-CN').t,
    context: { isEditable: true, editFlags: { canUndo: false, canRedo: true, canCut: true, canCopy: true, canPaste: false, canDelete: false, canSelectAll: true } },
  });
  assert.equal(byId(items, 'corvid-page-redo').role, 'redo');
  assert.equal(byId(items, 'corvid-page-redo').enabled, true);
  assert.equal(byId(items, 'corvid-page-cut').enabled, true);
  assert.equal(byId(items, 'corvid-page-paste').enabled, false);
  assert.equal(byId(items, 'corvid-page-select-all').role, 'selectAll');
  assert.equal(byId(items, 'corvid-page-reload'), null, 'editable fields keep text editing commands instead of page actions');
});
