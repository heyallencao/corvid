(() => {
  const catalogs = {
    'zh-CN': {
      extensionToolbar: '扩展工具栏',
      extensionPopup: '打开扩展：{name}',
      extensionPopupUnavailable: '扩展弹窗当前不可用',
      extensionPopupFailed: '无法打开扩展弹窗，请检查扩展状态后重试。',
    },
    en: {
      extensionToolbar: 'Extensions',
      extensionPopup: 'Open extension: {name}',
      extensionPopupUnavailable: 'This extension popup is unavailable.',
      extensionPopupFailed: 'Could not open the extension popup. Check the extension and try again.',
    },
  };
  const locale = /^zh(?:-|$)/i.test(navigator.language) ? 'zh-CN' : 'en';
  const fallback = catalogs['zh-CN'];
  window.corvidI18n = {
    locale,
    catalogs: Object.freeze(Object.fromEntries(Object.entries(catalogs).map(([key,resource])=>[key,Object.freeze(resource)]))),
    t(key, values = {}) {
      const template = catalogs[locale][key] || fallback[key] || key;
      return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => String(values[name] ?? ''));
    },
  };
})();
