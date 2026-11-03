const COPY = Object.freeze({
  'zh-CN': Object.freeze({
    file:'文件',edit:'编辑',view:'视图',window:'窗口',help:'帮助',about:'关于 Corvid',
    hide:'隐藏 Corvid',hideOthers:'隐藏其他应用',showAll:'显示全部',quit:'退出 Corvid',
    newTab:'新建标签页',newWindow:'新建窗口',closeTab:'关闭标签页',closeWindow:'关闭窗口',exit:'退出 Corvid',
    undo:'撤销',redo:'重做',cut:'剪切',copy:'复制',paste:'粘贴',selectAll:'全选',
    back:'后退',forward:'前进',reload:'重新加载',find:'查找网页…',print:'打印网页…',
    zoomIn:'放大',zoomOut:'缩小',resetZoom:'重置缩放',fullscreen:'全屏模式',
    minimize:'最小化',zoomWindow:'缩放窗口',windowNumber:'窗口 {number}',shortcuts:'键盘快捷键',
    actionUnavailable:'此浏览器操作当前不可用，请重试。',shortcutsTitle:'Corvid 键盘快捷键',
    shortcutsDetail:'新建标签页：Cmd/Ctrl+T\n新建窗口：Cmd/Ctrl+N\n关闭标签页：Cmd/Ctrl+W\n查找网页：Cmd/Ctrl+F\n打印：Cmd/Ctrl+P\n全屏：macOS 使用 Control+Command+F，Windows/Linux 使用 F11\n显示应用菜单：Windows/Linux 按 Alt',
  }),
  en: Object.freeze({
    file:'File',edit:'Edit',view:'View',window:'Window',help:'Help',about:'About Corvid',
    hide:'Hide Corvid',hideOthers:'Hide Others',showAll:'Show All',quit:'Quit Corvid',
    newTab:'New Tab',newWindow:'New Window',closeTab:'Close Tab',closeWindow:'Close Window',exit:'Quit Corvid',
    undo:'Undo',redo:'Redo',cut:'Cut',copy:'Copy',paste:'Paste',selectAll:'Select All',
    back:'Back',forward:'Forward',reload:'Reload',find:'Find on Page…',print:'Print Page…',
    zoomIn:'Zoom In',zoomOut:'Zoom Out',resetZoom:'Reset Zoom',fullscreen:'Full Screen',
    minimize:'Minimize',zoomWindow:'Zoom Window',windowNumber:'Window {number}',shortcuts:'Keyboard Shortcuts',
    actionUnavailable:'This browser action is no longer available. Try again.',shortcutsTitle:'Corvid Keyboard Shortcuts',
    shortcutsDetail:'New tab: Cmd/Ctrl+T\nNew window: Cmd/Ctrl+N\nClose tab: Cmd/Ctrl+W\nFind on page: Cmd/Ctrl+F\nPrint: Cmd/Ctrl+P\nFull screen: Control+Command+F on macOS, F11 on Windows/Linux\nShow the application menu: Press Alt on Windows/Linux',
  }),
});

function normalizeLocale(locale) {
  return locale === 'en' ? 'en' : 'zh-CN';
}

function applicationMenuText(locale) {
  return COPY[normalizeLocale(locale)];
}

function createApplicationMenuTemplate({locale='zh-CN',platform=process.platform,handlers={},windows=[]}={}) {
  const text=COPY[normalizeLocale(locale)],isMac=platform==='darwin';
  const command=(id,key,handler,accelerator,enabled=true)=>({id,label:text[key],click:handler||(()=>{}),...(accelerator?{accelerator}:{}),enabled});
  const role=(id,key,roleName,accelerator)=>({id,label:text[key],role:roleName,...(accelerator?{accelerator}:{})});
  const template=[];

  if(isMac)template.push({id:'corvid-app-menu',label:'Corvid',submenu:[
    role('corvid-about','about','about'),
    {type:'separator'},
    role('corvid-services','services','services'),
    {type:'separator'},
    role('corvid-hide','hide','hide'),
    role('corvid-hide-others','hideOthers','hideOthers'),
    role('corvid-show-all','showAll','unhide'),
    {type:'separator'},
    role('corvid-quit','quit','quit'),
  ]});

  template.push({id:'corvid-file-menu',label:text.file,submenu:[
    command('corvid-new-tab','newTab',handlers.newTab,'CmdOrCtrl+T',Boolean(handlers.canCreateTab?.())),
    command('corvid-new-window','newWindow',handlers.newWindow,'CmdOrCtrl+N'),
    {type:'separator'},
    command('corvid-close-tab','closeTab',handlers.closeTab,'CmdOrCtrl+W',Boolean(handlers.canCloseTab?.())),
    command('corvid-close-window','closeWindow',handlers.closeWindow,'CmdOrCtrl+Shift+W'),
    ...(!isMac?[{type:'separator'},role('corvid-quit','exit','quit')]:[]),
  ]});

  template.push({id:'corvid-edit-menu',label:text.edit,submenu:[
    role('corvid-edit-undo','undo','undo','CmdOrCtrl+Z'),
    role('corvid-edit-redo','redo','redo',isMac?'Cmd+Shift+Z':'Ctrl+Y'),
    {type:'separator'},
    role('corvid-edit-cut','cut','cut','CmdOrCtrl+X'),
    role('corvid-edit-copy','copy','copy','CmdOrCtrl+C'),
    role('corvid-edit-paste','paste','paste','CmdOrCtrl+V'),
    {type:'separator'},
    role('corvid-edit-select-all','selectAll','selectAll','CmdOrCtrl+A'),
  ]});

  template.push({id:'corvid-view-menu',label:text.view,submenu:[
    command('corvid-back','back',handlers.back,isMac?'Cmd+[':'Alt+Left',Boolean(handlers.canGoBack?.())),
    command('corvid-forward','forward',handlers.forward,isMac?'Cmd+]':'Alt+Right',Boolean(handlers.canGoForward?.())),
    command('corvid-reload','reload',handlers.reload,'CmdOrCtrl+R',Boolean(handlers.canUseActiveTab?.())),
    {type:'separator'},
    command('corvid-find','find',handlers.find,'CmdOrCtrl+F',Boolean(handlers.canUseActiveTab?.())),
    command('corvid-print','print',handlers.print,'CmdOrCtrl+P',Boolean(handlers.canUseActiveTab?.())),
    {type:'separator'},
    command('corvid-zoom-in','zoomIn',handlers.zoomIn,'CmdOrCtrl+Plus'),
    command('corvid-zoom-out','zoomOut',handlers.zoomOut,'CmdOrCtrl+-'),
    command('corvid-reset-zoom','resetZoom',handlers.resetZoom,'CmdOrCtrl+0'),
    {type:'separator'},
    {...command('corvid-toggle-fullscreen','fullscreen',handlers.fullscreen,isMac?'Control+Command+F':'F11',true),type:'checkbox',checked:Boolean(handlers.isFullscreen?.())},
  ]});

  template.push({id:'corvid-window-menu',label:text.window,submenu:[
    role('corvid-window-minimize','minimize','minimize'),
    role('corvid-window-zoom','zoomWindow','zoom'),
    {type:'separator'},
    ...windows.map((item,index)=>({id:`corvid-window-${item.id}`,label:text.windowNumber.replace('{number}',String(index+1)),type:'radio',checked:Boolean(item.focused),click:()=>handlers.focusWindow?.(item.id)})),
  ]});

  template.push({id:'corvid-help-menu',label:text.help,submenu:[
    command('corvid-shortcuts','shortcuts',handlers.showShortcuts),
    ...(!isMac?[{type:'separator'},role('corvid-about','about','about')]:[]),
  ]});
  return template;
}

function syncApplicationMenuState(menu,{canCreateTab=false,canCloseTab=false,canUseActiveTab=false,canGoBack=false,canGoForward=false,fullscreen=false,focusedWindowId=null}={}) {
  if(!menu)return;
  const enabled={
    'corvid-new-tab':canCreateTab,
    'corvid-close-tab':canCloseTab,
    'corvid-back':canUseActiveTab&&canGoBack,
    'corvid-forward':canUseActiveTab&&canGoForward,
    'corvid-reload':canUseActiveTab,
    'corvid-find':canUseActiveTab,
    'corvid-print':canUseActiveTab,
    'corvid-zoom-in':canUseActiveTab,
    'corvid-zoom-out':canUseActiveTab,
    'corvid-reset-zoom':canUseActiveTab,
  };
  for(const [id,value] of Object.entries(enabled)){const item=menu.getMenuItemById(id);if(item)item.enabled=value;}
  const fullScreenItem=menu.getMenuItemById('corvid-toggle-fullscreen');
  if(fullScreenItem)fullScreenItem.checked=Boolean(fullscreen);
  for(const item of menu.items||[]){
    if(item.id!=='corvid-window-menu')continue;
    for(const windowItem of item.submenu?.items||[])if(windowItem.id?.startsWith('corvid-window-'))windowItem.checked=windowItem.id===`corvid-window-${focusedWindowId}`;
  }
}

module.exports={applicationMenuText,createApplicationMenuTemplate,syncApplicationMenuState};
