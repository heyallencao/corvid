import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationMenuText, createApplicationMenuTemplate, syncApplicationMenuState } from '../desktop/application-menu.cjs';

function item(template, id) {
  for (const top of template) {
    if (top.id === id) return top;
    for (const child of top.submenu || []) if (child.id === id) return child;
  }
  return null;
}

function menuLabels(template) {
  return template.flatMap(top => [top.label, ...(top.submenu || []).map(child => child.label)]).filter(Boolean);
}

test('native browser menu labels follow Corvid locale and expose the same supported actions', () => {
  const handlers = Object.fromEntries(['newTab','newWindow','closeTab','closeWindow','back','forward','reload','find','print','fullscreen','zoomIn','zoomOut','resetZoom','focusWindow'].map(name => [name, () => {}]));
  const zh = createApplicationMenuTemplate({locale:'zh-CN',platform:'darwin',handlers,windows:[{id:'one',focused:true},{id:'two',focused:false}]});
  const en = createApplicationMenuTemplate({locale:'en',platform:'darwin',handlers,windows:[{id:'one',focused:true},{id:'two',focused:false}]});

  assert.deepEqual(zh.map(entry => entry.label), ['Corvid','文件','编辑','视图','窗口','帮助']);
  assert.deepEqual(en.map(entry => entry.label), ['Corvid','File','Edit','View','Window','Help']);
  assert.ok(menuLabels(zh).includes('新建标签页'));
  assert.ok(menuLabels(en).includes('New Tab'));
  assert.equal(item(zh,'corvid-new-tab').accelerator, 'CmdOrCtrl+T');
  assert.equal(item(en,'corvid-new-window').accelerator, 'CmdOrCtrl+N');
  assert.equal(item(zh,'corvid-close-tab').accelerator, 'CmdOrCtrl+W');
  assert.equal(item(en,'corvid-find').accelerator, 'CmdOrCtrl+F');
  assert.equal(item(zh,'corvid-edit-copy').role, 'copy');
  assert.equal(item(en,'corvid-edit-paste').role, 'paste');
  assert.equal(item(zh,'corvid-toggle-fullscreen').type, 'checkbox');
  assert.equal(item(zh,'corvid-window-one').label, '窗口 1');
  assert.equal(item(en,'corvid-window-one').label, 'Window 1');
  assert.match(applicationMenuText('zh-CN').shortcutsDetail,/应用菜单：Windows\/Linux 按 Alt/);
  assert.match(applicationMenuText('en').shortcutsDetail,/Show the application menu: Press Alt/);
  assert.equal(item(zh,'corvid-devtools'), null);
  assert.equal(menuLabels(zh).some(label => /Electron|Pi|Developer Tools|开发者工具/i.test(label)), false);
});

test('application menu has a branded app menu only on macOS and window items select the requested window', () => {
  let focusedWindowId = null;
  const focusWindow = id => { focusedWindowId = id; };
  const handlers = {focusWindow,newTab:()=>{},newWindow:()=>{},closeTab:()=>{},closeWindow:()=>{},back:()=>{},forward:()=>{},reload:()=>{},find:()=>{},print:()=>{},fullscreen:()=>{},zoomIn:()=>{},zoomOut:()=>{},resetZoom:()=>{}};
  const mac = createApplicationMenuTemplate({locale:'en',platform:'darwin',handlers,windows:[{id:'one',label:'Window 1',focused:false}]});
  const linux = createApplicationMenuTemplate({locale:'en',platform:'linux',handlers,windows:[]});

  assert.equal(mac[0].id, 'corvid-app-menu');
  assert.equal(item(mac,'corvid-about').role, 'about');
  assert.equal(linux.some(entry => entry.id === 'corvid-app-menu'), false);
  assert.equal(item(linux,'corvid-quit').role, 'quit');
  const windowItem = item(mac,'corvid-window-one');
  assert.equal(windowItem.type, 'radio');
  assert.equal(windowItem.checked, false);
  windowItem.click();
  assert.equal(focusedWindowId, 'one');
});

test('menu enablement, full-screen state and focused-window check follow the current browser context', () => {
  const template=createApplicationMenuTemplate({locale:'en',platform:'linux',handlers:{newTab:()=>{},newWindow:()=>{},closeTab:()=>{},closeWindow:()=>{},back:()=>{},forward:()=>{},reload:()=>{},find:()=>{},print:()=>{},fullscreen:()=>{},zoomIn:()=>{},zoomOut:()=>{},resetZoom:()=>{},focusWindow:()=>{}},windows:[{id:'one',focused:true},{id:'two',focused:false}]});
  const makeMenu=items=>{
    const children=items.map(item=>({...item,submenu:Array.isArray(item.submenu)?makeMenu(item.submenu):item.submenu}));
    const radios=children.filter(item=>item.type==='radio').map(item=>({item,checked:Boolean(item.checked)}));
    for(const state of radios)Object.defineProperty(state.item,'checked',{enumerable:true,get:()=>state.checked,set:value=>{state.checked=Boolean(value);if(value)for(const sibling of radios)if(sibling!==state)sibling.checked=false;}});
    return {items:children};
  };
  const menu={...makeMenu(template),getMenuItemById(id){const find=items=>{for(const item of items){if(item.id===id)return item;const nested=item.submenu&&find(item.submenu.items||[]);if(nested)return nested;}return null;};return find(this.items);}};

  syncApplicationMenuState(menu,{canCreateTab:false,canCloseTab:false,canUseActiveTab:false,canGoBack:false,canGoForward:false,fullscreen:true,focusedWindowId:'two'});
  assert.equal(menu.getMenuItemById('corvid-new-tab').enabled,false);
  assert.equal(menu.getMenuItemById('corvid-close-tab').enabled,false);
  assert.equal(menu.getMenuItemById('corvid-reload').enabled,false);
  assert.equal(menu.getMenuItemById('corvid-zoom-in').enabled,false);
  assert.equal(menu.getMenuItemById('corvid-zoom-out').enabled,false);
  assert.equal(menu.getMenuItemById('corvid-reset-zoom').enabled,false);
  assert.equal(menu.getMenuItemById('corvid-toggle-fullscreen').checked,true);
  assert.equal(menu.getMenuItemById('corvid-window-one').checked,false);
  assert.equal(menu.getMenuItemById('corvid-window-two').checked,true);

  syncApplicationMenuState(menu,{canCreateTab:true,canCloseTab:true,canUseActiveTab:true,canGoBack:true,canGoForward:false,fullscreen:false,focusedWindowId:'one'});
  assert.equal(menu.getMenuItemById('corvid-new-tab').enabled,true);
  assert.equal(menu.getMenuItemById('corvid-back').enabled,true);
  assert.equal(menu.getMenuItemById('corvid-toggle-fullscreen').checked,false);
  assert.equal(menu.getMenuItemById('corvid-window-one').checked,true);
});
