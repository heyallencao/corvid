const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog, shell, screen } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dataDir = process.env.CORVID_DATA_DIR || path.join(app.getPath('home'), '.corvid');
fs.mkdirSync(dataDir,{recursive:true});
app.setPath('userData', dataDir);
const token = crypto.randomBytes(32).toString('hex');
const tabs = new Map();
const queues = new Map();
const roomResolutions = new Map();
const runAction = require('./actions.cjs');
const pageDebugger = require('./page-debugger.cjs');
const agentDownloads = require('./agent-downloads.cjs')(app.getPath('temp'));
let rooms = [], activeRoomId, activeProfileId = 'default', window, server, quitting = false, restoring = false, frontView = null;
const id = () => crypto.randomUUID();
const SCHEMA_VERSION = 1;
const dbPath = path.join(dataDir, 'rooms.json');
const legacyDbPath = path.join(dataDir, 'spaces.json');
const profilesPath = path.join(dataDir, 'profiles.json');
const connectionPath = path.join(dataDir, 'control.json');
const windowStatePath = path.join(dataDir, 'window-state.json');
function readWindowState() {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(windowStatePath, 'utf8')); } catch { return null; }
  if (!saved || typeof saved !== 'object') return null;
  const { x, y, width, height, maximized } = saved;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 600 || height < 400) return null;
  const size = { width: Math.round(width), height: Math.round(height), maximized: Boolean(maximized) };
  if (!Number.isFinite(x) || !Number.isFinite(y)) return size;
  const bounds = { x: Math.round(x), y: Math.round(y), ...size };
  // A saved position can belong to a monitor that is no longer attached; fall
  // back to the default centered window instead of opening it off-screen.
  const visible = screen.getAllDisplays().some(display => {
    const area = display.workArea;
    return bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y;
  });
  return visible ? bounds : size;
}
let windowStateTimer;
function saveWindowState() {
  if (!window || window.isDestroyed()) return;
  const bounds = window.getNormalBounds();
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = `${windowStatePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, maximized: window.isMaximized() }), { mode: 0o600 });
    fs.renameSync(temp, windowStatePath);
  } catch (error) { console.error('Unable to save window state:', error.message); }
}
function scheduleWindowStateSave() { clearTimeout(windowStateTimer); windowStateTimer = setTimeout(saveWindowState, 300); }
const library = require('./library.cjs')(dataDir);
const activeDownloads = new Map();
const downloadPartitions = new Set();
const permissionGrants = new Map();
let profiles;
try { profiles=JSON.parse(fs.readFileSync(profilesPath,'utf8')); }
catch(error) { if(error.code!=='ENOENT') throw error; profiles=[{id:'default',name:'默认',isDefault:true}]; }
if(!Array.isArray(profiles) || !profiles.some(p=>p.id==='default')) throw new Error('Invalid profile data');
let panelOpen = false;
const findProfile = profileId => { const profile=profiles.find(p=>p.id===profileId);if(!profile) throw new Error('Profile not found');return profile; };
const partitionFor = profileId => profileId==='default' ? 'persist:corvid' : `persist:corvid-profile-${profileId}`;
const defaultSearch='https://www.google.com/search?q={query}';
function profileSettings(profileId) { const profile=findProfile(profileId);return {zoom:profile.zoom ?? 1,searchTemplate:profile.searchTemplate ?? defaultSearch}; }
function saveSettings(profileId,settings) {
  findProfile(profileId);
  const next=profiles.map(p=>p.id===profileId ? {...p,...settings} : p);
  const tmp=`${profilesPath}.tmp`;fs.writeFileSync(tmp,JSON.stringify(next),{mode:0o600});fs.renameSync(tmp,profilesPath);profiles=next;
}
function validSearchTemplate(template) {
  if(typeof template!=='string' || !template.includes('{query}')) return false;
  try {const url=new URL(template.replaceAll('{query}','query'));return ['http:','https:'].includes(url.protocol);} catch {return false;}
}
function migrateLegacyRooms() {
  // Pre-rebrand data used spaces.json with activeSpaceId. Convert once, keep the
  // original file untouched so a failed migration can be inspected.
  if(fs.existsSync(dbPath) || !fs.existsSync(legacyDbPath)) return;
  let legacy;
  try { legacy=JSON.parse(fs.readFileSync(legacyDbPath,'utf8')); }
  catch(error) { if(error.code!=='ENOENT') throw new Error(`无法读取旧会话文件 ${legacyDbPath}；原文件未修改：${error.message}`); return; }
  if(!legacy || typeof legacy!=='object' || !Array.isArray(legacy.spaces)) return;
  const migrated={schemaVersion:SCHEMA_VERSION,activeRoomId:legacy.activeSpaceId ?? null,activeProfileId:legacy.activeProfileId ?? 'default',rooms:legacy.spaces};
  const temp=`${dbPath}.tmp`;fs.writeFileSync(temp,JSON.stringify(migrated),{mode:0o600});fs.renameSync(temp,dbPath);
}
function readSavedRooms() {
  migrateLegacyRooms();
  let saved;
  try { saved=JSON.parse(fs.readFileSync(dbPath,'utf8')); }
  catch(error) { if(error.code==='ENOENT') return null; throw new Error(`无法读取会话文件 ${dbPath}；原文件未修改：${error.message}`); }
  if(saved && typeof saved==='object' && saved.schemaVersion!==undefined && saved.schemaVersion!==SCHEMA_VERSION) throw new Error(`会话文件版本不受支持：${dbPath}（schemaVersion=${saved.schemaVersion}）；原文件未修改，请先备份并检查。`);
  const validString=value=>typeof value==='string' && value.length>0;
  if(!saved || typeof saved!=='object' || !Array.isArray(saved.rooms) || saved.rooms.some(room=>!room || !validString(room.id) || !validString(room.name) || !['agent','user'].includes(room.ownership) || !Array.isArray(room.tabs) || room.tabs.some(tab=>!tab || !validString(tab.id) || typeof tab.url!=='string'))) {
    throw new Error(`会话文件结构无效：${dbPath}；原文件未修改，请先备份并检查后再恢复。`);
  }
  const roomIds=saved.rooms.map(room=>room.id), tabIds=saved.rooms.flatMap(room=>room.tabs.map(tab=>tab.id));
  if(new Set(roomIds).size!==roomIds.length || new Set(tabIds).size!==tabIds.length) throw new Error(`会话文件包含重复标识：${dbPath}；原文件未修改，请先备份并检查后再恢复。`);
  for(const room of saved.rooms) {const labels=room.tabs.map(tab=>tab.label).filter(label=>label!==null && label!==undefined);if(labels.some(label=>!validString(label)) || new Set(labels).size!==labels.length || (room.usedLabels!==undefined && (!Array.isArray(room.usedLabels) || room.usedLabels.some(label=>!validString(label)) || new Set(room.usedLabels).size!==room.usedLabels.length)) || room.tabs.some(tab=>tab.openedBy!==undefined && !['agent','user','unknown'].includes(tab.openedBy)))throw new Error(`会话页面标识无效：${dbPath}；原文件未修改，请先备份并检查后再恢复。`);}
  return saved;
}
function applyZoom(profileId) {const zoom=profileSettings(profileId).zoom;for(const tab of tabs.values()) if(findRoom(tab.roomId).profileId===profileId) tab.view.webContents.setZoomFactor(zoom);}
const findRoom = roomId => { const room = rooms.find(s => s.id === roomId); if (!room) throw new Error('Room not found'); return room; };
const findTab = tabId => { const tab = tabs.get(tabId); if (!tab) throw new Error('Tab not found'); return tab; };
const describe = () => ({activeRoomId,activeProfileId,profiles, rooms: rooms.map(s => ({ id:s.id, name:s.name, profileId:s.profileId,ownership:s.ownership,finished:Boolean(s.finished),yielded:Boolean(s.yielded),manualControl:Boolean(s.manualControl),userResumePending:Boolean(s.userResumePending),executionRisk:s.executionRisk || null, tabs:s.tabIds.map(id => { const t = tabs.get(id); return {id:t.id,label:t.label,openedBy:t.openedBy,openerId:t.openerId,ready:t.ready,domReady:t.domReady,loadComplete:t.loadComplete,title:t.view.webContents.getTitle(),url:t.view.webContents.getURL() || 'about:blank',faviconUrl:t.faviconUrl || null,active:s.activeTabId===id,dialog:pageDebugger.get(t.view.webContents)}; }) }))});
function persist() {
  const state = {schemaVersion:SCHEMA_VERSION,activeRoomId,activeProfileId, rooms:rooms.map(s => ({...s, tabs:s.tabIds.map(id => {const t = tabs.get(id); return {id,label:t.label,openedBy:t.openedBy,url:t.pendingNavigationUrl || (!t.ready && t.restoreUrl) || t.view.webContents.getURL() || 'about:blank'};})}))};
  fs.mkdirSync(dataDir,{recursive:true});
  const temp = `${dbPath}.tmp`; fs.writeFileSync(temp, JSON.stringify(state), {mode:0o600}); fs.renameSync(temp,dbPath);
}
function update() { if (!window || window.isDestroyed()) return; layout(); window.webContents.send('shell-state',describe()); if (!restoring) persist(); }
function notifyDownloads() { if(window && !window.isDestroyed()) window.webContents.send('shell-state',describe()); }
function installDownloads(partition,profileId) {
  if(downloadPartitions.has(partition)) return;
  downloadPartitions.add(partition);
  const browserSession=session.fromPartition(partition);
  // Only permissions whose checks can be scoped to an origin and type are
  // remembered. Device/file/clipboard grants remain request-specific.
  const grants=new Set(),rememberable=new Set(['notifications','geolocation','geolocation-approximate']);permissionGrants.set(partition,grants);
  const grantKey=(origin,permission)=>JSON.stringify([origin,permission]);
  browserSession.setPermissionCheckHandler((_contents,permission,requestingOrigin,details)=>{
    if(!details.isMainFrame || !rememberable.has(permission))return false;
    try {const url=new URL(requestingOrigin);return ['http:','https:'].includes(url.protocol) && grants.has(grantKey(url.origin,permission));}catch{return false;}
  });
  browserSession.setPermissionRequestHandler((contents,permission,callback,details)=>{
    let origin;try {const url=new URL(details.requestingUrl);if(!['http:','https:'].includes(url.protocol)) throw new Error();origin=url.origin;} catch {callback(false);return;}
    const tab=[...tabs.values()].find(item=>item.view.webContents===contents);
    if(!tab || !details.isMainFrame || !window || window.isDestroyed()) {callback(false);return;}
    if(rememberable.has(permission) && grants.has(grantKey(origin,permission)) && contents.getURL()===details.requestingUrl) {callback(true);return;}
    const room=findRoom(tab.roomId);
    // Device and permission decisions belong to the user. Transfer ownership
    // before displaying the request so new automation cannot race the choice.
    if(room.ownership==='agent') {for(const tabId of room.tabIds){agentDownloads.cancelTab(tabId);pageDebugger.cancelChooser(findTab(tabId).view.webContents).catch(()=>{});}room.ownership='user';room.yielded=true;room.manualControl=Boolean(room.userResumePending);update();}
    const requestedUrl=details.requestingUrl;
    const media=Array.isArray(details.mediaTypes) && details.mediaTypes.length ? `（${details.mediaTypes.join('、')}）` : '';
    const scope=rememberable.has(permission) ? '允许后，本次运行期间此 Profile 的同来源页面可使用该权限。' : '此选择仅针对当前请求。';
    dialog.showMessageBox(window,{type:'question',buttons:['拒绝','允许'],defaultId:0,cancelId:0,title:'网站权限请求',message:`${origin} 请求 ${permission}${media} 权限`,detail:`Room：${room.name}。${scope}系统或设备限制仍可能阻止访问。`})
      .then(({response})=>{const allowed=response===1 && !contents.isDestroyed() && contents.getURL()===requestedUrl;if(allowed && rememberable.has(permission))grants.add(grantKey(origin,permission));callback(allowed);},()=>callback(false));
  });
  browserSession.on('will-download',(event,item,contents) => {
    const source=[...tabs.values()].find(tab=>tab.view.webContents===contents);
    if(source){const owner=findRoom(source.roomId);if(owner.ownership==='agent' && !owner.userResumePending && !owner.executionRisk){try{if(agentDownloads.capture(source.id,item))return;}catch(error){event.preventDefault();console.error('Agent download failed:',error.message);return;}}}
    const downloadId=id(); const filename=path.basename(item.getFilename()) || 'download';
    const record={id:downloadId,profileId,url:item.getURL(),filename,path:null,status:'progressing',receivedBytes:0,totalBytes:item.getTotalBytes(),createdAt:new Date().toISOString()};
    library.addDownload(record);
    let destination;
    try {
      if (process.env.CORVID_TEST_MODE==='1' && process.env.CORVID_TEST_DOWNLOAD_DIR) destination=path.join(process.env.CORVID_TEST_DOWNLOAD_DIR,filename);
      else destination=dialog.showSaveDialogSync(window,{title:'保存下载',defaultPath:path.join(app.getPath('downloads'),filename),properties:['createDirectory','showOverwriteConfirmation']});
      if (!destination) {event.preventDefault();library.updateDownload(downloadId,{status:'cancelled'});notifyDownloads();return;}
      let exists=false;try {fs.lstatSync(destination);exists=true;} catch(error) {if(error.code!=='ENOENT') throw error;}
      if (exists) {event.preventDefault();library.updateDownload(downloadId,{status:'failed',path:destination,error:'目标文件已存在，未覆盖'});notifyDownloads();return;}
      item.setSavePath(destination);library.updateDownload(downloadId,{path:destination});activeDownloads.set(downloadId,{item,profileId});
    } catch(error) {event.preventDefault();library.updateDownload(downloadId,{status:'failed',error:error.message});notifyDownloads();return;}
    let lastUpdate=0;
    item.on('updated',(_event,state)=>{
      const now=Date.now(); if(now-lastUpdate<250 && state==='progressing') return;lastUpdate=now;
      library.updateDownload(downloadId,{receivedBytes:item.getReceivedBytes(),totalBytes:item.getTotalBytes()},false);notifyDownloads();
    });
    item.once('done',(_event,state)=>{
      activeDownloads.delete(downloadId);
      library.updateDownload(downloadId,{status:state,receivedBytes:item.getReceivedBytes(),totalBytes:item.getTotalBytes(),finishedAt:new Date().toISOString()});notifyDownloads();
    });
    notifyDownloads();
  });
}
function layout() {
  if (!window || window.isDestroyed()) return;
  const s = rooms.find(x => x.id === activeRoomId); const tab = s && tabs.get(s.activeTabId);
  const [width,height] = window.getContentSize(); const top = panelOpen ? 352 : 112;
  for (const t of tabs.values()) { t.view.setBounds({x:0,y:top,width,height:Math.max(0,height-top)}); t.view.setVisible(Boolean(tab)); }
  if (tab && frontView !== tab.view) { window.contentView.removeChildView(tab.view); window.contentView.addChildView(tab.view); frontView = tab.view; }
}
function allocatePageLabel(room,requested) {
  if(requested!==undefined && (typeof requested!=='string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(requested)))throw new Error('Page label must start with a letter and contain letters, numbers, _ or -');
  let label=requested;if(label===undefined){do{label=`p${room.nextPageNumber++}`;}while(room.usedLabels.includes(label));}
  if(room.usedLabels.includes(label))throw new Error(`Page label already used: ${label}`);
  room.usedLabels.push(label);return label;
}
async function createTab(roomId, url = 'about:blank', tabId = id(), metadata = {}) {
  const s = findRoom(roomId);
  const partition=partitionFor(findProfile(s.profileId).id); installDownloads(partition,s.profileId);
  const view = new WebContentsView({webPreferences:{partition,sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'page-preload.cjs')}});
  const openedBy=metadata.openedBy ?? 'unknown';
  const label=metadata.label ?? (openedBy==='agent' && !metadata.restored ? allocatePageLabel(s) : null);
  const tab = {id:tabId,roomId,view,label,openedBy,openerId:metadata.openerId ?? null,ready:false,domReady:false,loadComplete:false,restoreUrl:metadata.restored?url:null,restoringInitial:Boolean(metadata.restored),popupSequence:0,popupEvents:[]};
  view.webContents.on('did-navigate',()=>{tab.domReady=false;tab.loadComplete=false;tab.faviconUrl=null;});
  view.webContents.on('dom-ready',()=>{tab.domReady=true;});
  view.webContents.on('did-finish-load',()=>{tab.domReady=true;tab.loadComplete=true;});
  view.webContents.on('will-prevent-unload',event=>{
    if(!tabs.has(tabId))return;
    if(s.ownership==='agent'){for(const id of s.tabIds)agentDownloads.cancelTab(id);s.ownership='user';s.yielded=true;s.manualControl=true;update();}
    const choice=dialog.showMessageBoxSync(window,{type:'warning',buttons:['留在页面','离开页面'],defaultId:0,cancelId:0,title:'离开此页面？',message:'此页面提示有未保存的更改。',detail:`Room：${s.name}。离开可能导致这些更改丢失。`});
    tab.beforeUnloadAllowed=choice===1;if(tab.beforeUnloadAllowed)event.preventDefault();
  });
  installShortcuts(view.webContents);
  tabs.set(tabId,tab); s.tabIds.push(tabId); s.activeTabId = tabId; window.contentView.addChildView(view); frontView=null; view.setVisible(false);
  if(url!=='about:blank') update();
  const changed = () => { if (!quitting && tabs.has(tabId)) update(); };
  tab.bootstrap=(async()=>{
  // A newly created WebContents does not answer Page.enable until its first
  // document exists. Bind the debugger before navigating to the requested URL.
  await view.webContents.loadURL('about:blank');
  await pageDebugger.ensure(view.webContents,changed);
  view.webContents.on('page-title-updated',(_event,title) => { if (tab.visitId) library.title(tab.visitId,title); changed(); });
  view.webContents.on('page-favicon-updated',(_event,favicons) => { if (!Array.isArray(favicons) || !favicons.length) return; tab.faviconUrl=favicons[0]; changed(); });
  view.webContents.on('found-in-page',(_event,result) => { if (window && !window.isDestroyed()) window.webContents.send('shell-find-result',{tabId,...result}); });
  view.webContents.on('did-navigate',() => { if (window && !window.isDestroyed()) window.webContents.send('shell-find-reset',{tabId}); });
  const recordVisit = (_event,url) => { view.webContents.setZoomFactor(profileSettings(s.profileId).zoom);if (!restoring && !tab.restoringInitial) tab.visitId=library.visit(url,url,s.profileId)?.id; changed(); };
  view.webContents.on('did-navigate',recordVisit);
  view.webContents.on('did-navigate-in-page',(_event,url,isMainFrame) => { if(isMainFrame) recordVisit(_event,url); });
  view.webContents.setWindowOpenHandler(({url: popupUrl}) => {const popupId=id();tab.popupEvents.push({sequence:++tab.popupSequence,tabId:popupId});if(tab.popupEvents.length>128)tab.popupEvents.shift();createTab(roomId,popupUrl,popupId,{openerId:tabId}).catch(error=>console.error('Popup initialization failed:',error));return {action:'deny'};});
  })();
  tab.initialization=(async()=>{try {
  await tab.bootstrap;
  if(url!=='about:blank') await view.webContents.loadURL(url).catch(() => {});if(!tabs.has(tabId) || view.webContents.isDestroyed())throw new Error('Tab closed during initialization');tab.restoringInitial=false;view.webContents.setZoomFactor(profileSettings(s.profileId).zoom);tab.ready=true;update(); return describe().rooms.find(x => x.id===roomId).tabs.find(x => x.id===tabId);
  } catch(error) {if(tabs.has(tabId)){window.contentView.removeChildView(view);tabs.delete(tabId);s.tabIds=s.tabIds.filter(value=>value!==tabId);if(s.activeTabId===tabId)s.activeTabId=s.tabIds[0] || null;if(!view.webContents.isDestroyed())view.webContents.close();update();}throw error;}})();
  if(metadata.restored){tab.initialization.catch(error=>console.error('Restored tab initialization failed:',error.message));await tab.bootstrap;return;}
  return tab.initialization;
}
async function createRoom(name, ownership = 'agent', profileId = 'default') {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Room name required');
  findProfile(profileId);
  const previousRoom=activeRoomId,previousProfile=activeProfileId;
  const room = {id:id(),name:name.trim(),profileId,ownership,yielded:false,nextPageNumber:1,usedLabels:[],tabIds:[],activeTabId:null}; rooms.push(room); if (ownership === 'user') {activeProfileId=profileId;activeRoomId=room.id;} else if(!activeRoomId && activeProfileId===profileId) activeRoomId=room.id;
  try {await createTab(room.id,'about:blank',id(),{openedBy:ownership==='agent'?'agent':'user'}); update(); return describe().rooms.find(s => s.id === room.id);}
  catch(error) {rooms=rooms.filter(item=>item!==room);if(activeRoomId===room.id){activeRoomId=previousRoom;activeProfileId=previousProfile;}update();throw error;}
}
async function navigateAgent(tab,url) {
  const sequence=tab.userNavigation=(tab.userNavigation || 0)+1;
  tab.pendingNavigationUrl=url;tab.restoringInitial=false;update();
  await tab.bootstrap;
  if(tabs.get(tab.id)!==tab || tab.userNavigation!==sequence)throw new Error('Tab closed or navigation superseded');
  try {await tab.view.webContents.loadURL(url);} catch(error) {if(tabs.get(tab.id)===tab && tab.userNavigation===sequence){tab.pendingNavigationUrl=null;update();}throw error;}
  if(tabs.get(tab.id)===tab && tab.userNavigation===sequence){tab.pendingNavigationUrl=null;update();}
  return {ok:true};
}
async function resolveRoom(identifier,profileId) {
  if(typeof identifier!=='string' || !identifier.trim())throw new Error('Task room name or ID is required');
  const key=identifier.trim();if(roomResolutions.has(key))return roomResolutions.get(key);
  const matches=rooms.filter(room=>room.id===key);const candidates=matches.length ? matches : rooms.filter(room=>room.name===key);
  if(candidates.length>1)throw new Error('Task room name is ambiguous; use its ID');
  if(candidates.length) {const room=candidates[0];if(room.ownership!=='agent' || room.userResumePending || room.executionRisk)throw new Error('Task room is not available for agent control');if(profileId!==undefined && room.profileId!==profileId)throw new Error('Existing task room uses a different Profile');return describe().rooms.find(item=>item.id===room.id);}
  if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))throw new Error('Task room ID not found');
  const pending=createRoom(key,'agent',profileId ?? 'default');roomResolutions.set(key,pending);
  try{return await pending;}finally{if(roomResolutions.get(key)===pending)roomResolutions.delete(key);}
}
async function closeTab(tabId) {
  const t=findTab(tabId),s=findRoom(t.roomId),contents=t.view.webContents;
  agentDownloads.cancelTab(tabId);
  await pageDebugger.prepareClose(contents);
  let closed;
  try {
    closed=await new Promise((resolve,reject)=>{
      const done=value=>{contents.removeListener('destroyed',destroyed);contents.removeListener('will-prevent-unload',blocked);resolve(value);};
      const destroyed=()=>done(true),blocked=()=>{if(!t.beforeUnloadAllowed)done(false);};
      contents.once('destroyed',destroyed);contents.once('will-prevent-unload',blocked);
      t.beforeUnloadAllowed=false;
      try {contents.close({waitForBeforeUnload:true});}catch(error){contents.removeListener('destroyed',destroyed);contents.removeListener('will-prevent-unload',blocked);reject(error);}
    });
  } catch(error) {if(!contents.isDestroyed())await pageDebugger.ensure(contents);throw error;}
  if(!closed){await pageDebugger.ensure(contents);throw new Error('页面取消关闭，未保存的内容仍保留');}
  window.contentView.removeChildView(t.view);if(frontView===t.view)frontView=null;tabs.delete(tabId);s.tabIds=s.tabIds.filter(x=>x!==tabId);
  if(s.activeTabId===tabId)s.activeTabId=s.tabIds[0] || null;update();
}
async function closeRoom(roomId) {
  const s=findRoom(roomId);let count=0;
  for(const tabId of [...s.tabIds]){try{await closeTab(tabId);count++;}catch(error){if(count)throw new Error(`${error.message}；已有 ${count} 个标签关闭`);throw error;}}
  if(s.tabIds.length)throw new Error(`关闭期间出现新标签；已有 ${count} 个标签关闭，请检查剩余页面`);
  rooms=rooms.filter(x=>x.id!==roomId);if(activeRoomId===roomId)activeRoomId=rooms.find(x=>x.profileId===activeProfileId)?.id || null;update();
}
function asUrl(value,profileId) { if (typeof value !== 'string' || !value.trim()) throw new Error('URL required'); const input = value.trim(); if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return input; if (/^[^\s.]+(?:\.[^\s.]+)+(?::\d+)?(?:[/?#]|$)/.test(input) || /^localhost(?::\d+)?(?:[/?#]|$)/.test(input)) return `https://${input}`; return profileSettings(profileId).searchTemplate.replaceAll('{query}',encodeURIComponent(input)); }
function installShortcuts(contents) {
  contents.on('before-input-event',(event,input)=>{
    if(input.type!=='keyDown') return;
    const primary=process.platform==='darwin' ? input.meta : input.control;
    if(input.alt || (process.platform==='darwin' && input.control && primary) || (process.platform!=='darwin' && input.meta)) return;
    const key=input.key.toLowerCase(); const room=rooms.find(s=>s.id===activeRoomId),tab=room && tabs.get(room.activeTabId);
    const cycle=input.control && !input.meta && key==='tab';let action;
    if(cycle && room?.tabIds.length){const index=room.tabIds.indexOf(room.activeTabId),step=input.shift?-1:1;action=()=>dispatchQueued('activateTab',{id:room.tabIds[(index+step+room.tabIds.length)%room.tabIds.length]});}
    else if(primary && key==='t' && !input.shift && room) action=()=>dispatchQueued('createTab',{id:room.id});
    else if(primary && key==='w' && !input.shift && tab) action=()=>dispatchQueued('closeTab',{id:tab.id});
    else if(primary && key==='l' && !input.shift) action=()=>{window.webContents.focus();void window.webContents.executeJavaScript("document.querySelector('#address').focus();document.querySelector('#address').select()");};
    else if(primary && key==='r' && !input.shift && tab) action=()=>dispatchQueued('reload',{id:tab.id});
    else if(primary && key==='f' && !input.shift) action=()=>{window.webContents.focus();window.webContents.send('shell-find-open');};
    else if(primary && key==='g' && !input.shift) action=()=>{window.webContents.focus();window.webContents.send('shell-find-next',{backward:false});};
    else if(primary && key==='g' && input.shift) action=()=>{window.webContents.focus();window.webContents.send('shell-find-next',{backward:true});};
    else if(primary && !input.shift && ['[',']'].includes(key) && tab) action=()=>dispatchQueued(key==='['?'back':'forward',{id:tab.id});
    else if(primary && !input.shift && /^[1-9]$/.test(key) && room?.tabIds.length) {const index=key==='9'?room.tabIds.length-1:Number(key)-1;const target=room.tabIds[index];if(target) action=()=>dispatchQueued('activateTab',{id:target});}
    else if(primary && ['+','=','-','0'].includes(key)) action=()=>{const current=profileSettings(activeProfileId).zoom;const zoom=key==='0'?1:Math.round(Math.min(3,Math.max(0.5,current+(key==='-'?-0.1:0.1)))*10)/10;saveSettings(activeProfileId,{zoom});applyZoom(activeProfileId);update();};
    if(action){event.preventDefault();Promise.resolve(action()).catch(error=>console.error('Shortcut failed:',error));}
  });
}
async function dispatch(method, args = {}, fromApi = false) {
  const {id:target} = args;
  if(fromApi && ['closeTab','navigate','back','forward','reload','action','getDialog','handleDialog','armChooser','getChooser','chooseFiles','cancelChooser','getPopupEvents','armDownload','getAgentDownload','cancelAgentDownload','deleteAgentDownload'].includes(method) && args.pageLabel!==undefined && findTab(target).label!==args.pageLabel)throw new Error('Page label is stale or no longer manages this tab');
  if (fromApi && ['createTab','closeRoom','closeTab','navigate','back','forward','reload','action','yieldControl','resumeControl','armChooser','getChooser','chooseFiles','adoptTab','releasePage','finishRoom','claimRoom'].includes(method)) {const s=['createTab','closeRoom','yieldControl','resumeControl','adoptTab','releasePage','finishRoom','claimRoom'].includes(method)?findRoom(target):findRoom(findTab(target).roomId);if(s.userResumePending)throw new Error('User resumeControl is pending');}
  if (fromApi && ['getDialog','handleDialog','armChooser','getChooser','chooseFiles','cancelChooser','getPopupEvents','armDownload','getAgentDownload','cancelAgentDownload','deleteAgentDownload'].includes(method)) {const s=findRoom(findTab(target).roomId);if(s.ownership!=='agent' || (['getPopupEvents','armDownload','getAgentDownload','cancelAgentDownload','deleteAgentDownload'].includes(method) && s.userResumePending)) throw new Error('Room is under user control or resumeControl is pending');if(s.executionRisk && !['getDialog','handleDialog','cancelChooser'].includes(method)) throw new Error('Room has an unresolved timed-out execution; user review is required');}
  if (fromApi && ['createTab','closeRoom','closeTab','navigate','back','forward','reload','action','adoptTab','releasePage','finishRoom'].includes(method)) { const s = ['createTab','closeRoom','adoptTab','releasePage','finishRoom'].includes(method) ? findRoom(target) : findRoom(findTab(target).roomId); if (s.ownership !== 'agent') throw new Error('Room is under user control'); }
  if(fromApi && method==='closeTab' && findTab(target).openedBy!=='agent')throw new Error('Cannot close a user-owned or unknown-origin tab');
  if(fromApi && method==='closeRoom' && findRoom(target).tabIds.some(tabId=>findTab(tabId).openedBy!=='agent'))throw new Error('Room contains user-owned or unknown-origin tabs');
  if(fromApi && ['closeTab','navigate','back','forward','reload','action','getDialog','handleDialog','armChooser','getChooser','chooseFiles','getPopupEvents','armDownload','getAgentDownload','cancelAgentDownload','deleteAgentDownload'].includes(method) && !findTab(target).label)throw new Error('Tab is unmanaged; adopt it before agent operations');
  if (fromApi && ['createTab','closeRoom','closeTab','navigate','back','forward','reload','action','resumeControl','adoptTab','releasePage','finishRoom'].includes(method)) { const s = ['createTab','closeRoom','resumeControl','adoptTab','releasePage','finishRoom'].includes(method) ? findRoom(target) : findRoom(findTab(target).roomId); if (s.executionRisk) throw new Error('Room has an unresolved timed-out execution; user review is required'); }
  switch (method) {
    case 'state': return describe();
    case 'profiles': return {profiles};
    case 'settings': return profileSettings(args.profileId ?? activeProfileId);
    case 'saveSettings': {const profileId=args.profileId ?? activeProfileId;findProfile(profileId);if(!validSearchTemplate(args.searchTemplate)) throw new Error('搜索模板必须是包含 {query} 的 HTTP(S) 地址');saveSettings(profileId,{searchTemplate:args.searchTemplate});update();return profileSettings(profileId);}
    case 'createProfile': {if(typeof args.name!=='string' || !args.name.trim()) throw new Error('Profile name required');const profile={id:id(),name:args.name.trim(),isDefault:false};const next=[...profiles,profile];const tmp=`${profilesPath}.tmp`;fs.writeFileSync(tmp,JSON.stringify(next),{mode:0o600});fs.renameSync(tmp,profilesPath);profiles=next;update();return profile;}
    case 'renameProfile': {if(fromApi)throw new Error('User action required');if(typeof args.name!=='string' || !args.name.trim())throw new Error('Profile name required');findProfile(target);saveSettings(target,{name:args.name.trim()});update();return findProfile(target);}
    case 'closeRoomFromUser': {
      if(fromApi)throw new Error('User action required');
      const room=findRoom(target),tabIds=[...room.tabIds],ownership=room.ownership,profileId=room.profileId;
      const choice=await dialog.showMessageBox(window,{type:'warning',buttons:['取消','关闭Room'],defaultId:0,cancelId:0,title:'关闭Room',message:`关闭“${room.name}”？`,detail:`此Room有 ${tabIds.length} 个标签${ownership==='agent' ? '，当前由 Agent 控制' : ''}。关闭会结束这些页面，未保存的内容可能丢失；Profile、书签、历史和下载记录会保留。`});
      if(choice.response!==1)return {closed:false};
      if(!rooms.includes(room) || room.ownership!==ownership || room.profileId!==profileId || room.userResumePending || room.tabIds.length!==tabIds.length || room.tabIds.some((id,index)=>id!==tabIds[index]))throw new Error('确认期间Room已改变，请重新操作');
      await dispatch('closeRoom',{id:room.id},false);return {closed:true};
    }
    case 'activateProfile': {findProfile(target);activeProfileId=target;activeRoomId=rooms.find(s=>s.profileId===target)?.id || null;update();return describe();}
    case 'history': return {history:library.history(findProfile(args.profileId ?? activeProfileId).id)};
    case 'bookmarks': return {bookmarks:library.bookmarks(findProfile(args.profileId ?? activeProfileId).id)};
    case 'downloads': return {downloads:library.downloads(findProfile(args.profileId ?? activeProfileId).id)};
    case 'cancelDownload': {const download=activeDownloads.get(target);if(!download || download.profileId!==activeProfileId) throw new Error('Download is not active');download.item.cancel();return {ok:true};}
    case 'addBookmark': return library.addBookmark(args.url,args.title,findProfile(args.profileId ?? activeProfileId).id);
    case 'removeBookmark': return {removed:library.removeBookmark(target,findProfile(args.profileId ?? activeProfileId).id)};
    case 'removeHistory': return {removed:library.removeHistory(target,findProfile(args.profileId ?? activeProfileId).id)};
    case 'setPanel': panelOpen=Boolean(args.open); layout(); return {ok:true};
    case 'reorderTabs': {
      if(fromApi) throw new Error('User action required');
      const room=findRoom(target), order=args.tabIds;
      if(!Array.isArray(order) || order.length!==room.tabIds.length) throw new Error('Tab order must list every tab in the room');
      if(new Set(order).size!==order.length || order.some(tabId=>!room.tabIds.includes(tabId))) throw new Error('Tab order is invalid');
      room.tabIds=order; update(); return describe();
    }
    case 'findInPage': {
      const tab=findTab(target), text=args.text;
      if(typeof text!=='string' || !text.length) throw new Error('Find text required');
      if([...text].length>200) throw new Error('Find text is too long');
      const requestId=tab.view.webContents.findInPage(text,{forward:args.forward!==false,findNext:Boolean(args.findNext),matchCase:Boolean(args.matchCase)});
      return {requestId,tabId:tab.id,text};
    }
    case 'stopFindInPage': {
      const tab=findTab(target);
      const action=['clearSelection','keepSelection','activateSelection'].includes(args.action) ? args.action : 'clearSelection';
      tab.view.webContents.stopFindInPage(action);
      return {ok:true};
    }
    case 'openDownload': {
      if(fromApi) throw new Error('User action required');
      const entry=library.downloads(activeProfileId).find(item=>item.id===target);
      if(!entry) throw new Error('Download not found');
      if(entry.status!=='completed' || !entry.path) throw new Error('Download is not completed or has no saved file');
      const failure=await shell.openPath(entry.path);
      if(failure) throw new Error(`无法打开文件：${failure}`);
      return {ok:true};
    }
    case 'revealDownload': {
      if(fromApi) throw new Error('User action required');
      const entry=library.downloads(activeProfileId).find(item=>item.id===target);
      if(!entry) throw new Error('Download not found');
      if(!entry.path) throw new Error('Download has no saved file');
      shell.showItemInFolder(entry.path);
      return {ok:true};
    }
    case 'createRoom': return createRoom(args.name, fromApi ? 'agent' : (args.ownership || 'user'), args.profileId ?? (fromApi ? 'default' : activeProfileId));
    case 'resolveRoom': return resolveRoom(args.identifier,args.profileId);
    case 'createTab': return createTab(target,args.url || 'about:blank',id(),{openedBy:fromApi?'agent':'user'});
    case 'adoptTab': {const s=findRoom(target),tab=findTab(args.tabId);if(tab.roomId!==s.id)throw new Error('Tab belongs to a different room');if(!tab.ready)throw new Error('Tab is still initializing');if(tab.label)throw new Error('Tab is already managed');tab.label=allocatePageLabel(s,args.as);update();return describe().rooms.find(item=>item.id===s.id).tabs.find(item=>item.id===tab.id);}
    case 'releasePage': {const s=findRoom(target),tab=s.tabIds.map(findTab).find(item=>item.label===args.label);if(!tab)throw new Error('Page label not found');if(tab.openedBy==='agent')throw new Error('Agent-created pages must be closed, not released');agentDownloads.cancelTab(tab.id);await pageDebugger.cancelChooser(tab.view.webContents);await runAction.releasePointer(tab.view.webContents);if(s.ownership!=='agent' || s.userResumePending || s.executionRisk)throw new Error('Room is no longer available for agent control');tab.label=null;update();return describe().rooms.find(item=>item.id===s.id).tabs.find(item=>item.id===tab.id);}
    case 'finishRoom': return finishRoom(findRoom(target),args.keep);
    case 'claimRoom': return claimRoom(findRoom(target));
    case 'activateRoom': {const s=findRoom(target);activeProfileId=s.profileId;activeRoomId=target;update();return describe();}
    case 'activateTab': {const t=findTab(target), s=findRoom(t.roomId); activeProfileId=s.profileId;activeRoomId=s.id; s.activeTabId=target; update(); return describe();}
    case 'yieldControl': {const s=findRoom(target);if(s.ownership!=='agent'){if(!fromApi && args.manual && s.yielded){s.manualControl=true;update();return describe();}throw new Error('Room is under user control');}for(const tabId of s.tabIds){agentDownloads.cancelTab(tabId);const contents=findTab(tabId).view.webContents;await pageDebugger.cancelChooser(contents);await runAction.releasePointer(contents);}s.ownership='user';s.yielded=true;s.manualControl=Boolean(args.manual);update();return describe();}
    case 'resumeControl': {const s=findRoom(target);if(!s.yielded) throw new Error('Room was not handed off by an agent');if(fromApi && s.manualControl)throw new Error('The user has not returned control');if(s.executionRisk)throw new Error('Room has an unresolved timed-out execution; user review is required');s.ownership='agent';s.yielded=false;s.manualControl=false;update();return describe();}
    case 'requestUserControl': return requestUserControl(target);
    case 'returnUserControl': {if(fromApi)throw new Error('User action required');return dispatch('resumeControl',{id:target},false);}
    case 'reviewExecutionRisk': {
      if(fromApi) throw new Error('User review is required');
      const s=findRoom(target);if(!s.executionRisk) return describe();
      if(s.ownership!=='user') {s.ownership='user';s.yielded=true;s.manualControl=true;}
      update();
      const message=s.executionRisk.status==='unknown_after_restart' ? '上次执行或接管未完成，之前的操作结果未知。' : '此前的页面代码已超时，可能仍在运行或在稍后产生效果。';
      const choice=await dialog.showMessageBox(window,{type:'warning',buttons:['保留提示','了解并继续'],defaultId:0,cancelId:0,title:'页面代码执行状态未知',message,detail:'接管或确认不会撤销已发送的请求、定时器或其他页面活动。你可以选择重新加载或关闭页面；这些操作可能丢失页面状态。'});
      if(choice.response===1) {s.executionRisk=null;update();}
      return describe();
    }
    case 'clearSiteData': {
      if(fromApi)throw new Error('User action required');
      const tab=findTab(target),room=findRoom(tab.roomId),profile=findProfile(room.profileId);
      let origin;try {const url=new URL(tab.view.webContents.getURL());if(!['http:','https:'].includes(url.protocol))throw new Error();origin=url.origin;}catch{throw new Error('当前页面不是可清理的 HTTP(S) 站点');}
      const affected=rooms.filter(item=>item.profileId===profile.id).length;
      const choice=await dialog.showMessageBox(window,{type:'warning',buttons:['取消','清理站点数据'],defaultId:0,cancelId:0,title:'清理站点数据',message:`清理 ${origin} 的站点数据？`,detail:`Profile：${profile.name}，共有 ${affected} 个Room共享该 Profile。将清理此来源的站点存储、Service Worker 和 Cache Storage，以及该站点可用的 Cookie；Cookie 可能跨子域、端口或协议共享，相关页面可能退出登录。不会清理站点权限、浏览历史或整个 Profile 的 HTTP 缓存。清理不可撤销，打开的页面可能再次写入数据。`});
      if(choice.response!==1)return {cleared:false,origin};
      const current=tabs.get(target);let currentOrigin;try{currentOrigin=new URL(current?.view.webContents.getURL()).origin;}catch{}
      if(current!==tab || currentOrigin!==origin || findRoom(tab.roomId).profileId!==profile.id)throw new Error('确认期间页面或 Profile 已改变，请重新操作');
      await session.fromPartition(partitionFor(profile.id)).clearStorageData({origin,storages:['cookies','filesystem','indexdb','localstorage','serviceworkers','cachestorage']});
      return {cleared:true,origin};
    }
    case 'reviewSitePermissions': {
      if(fromApi)throw new Error('User action required');
      const tab=findTab(target),room=findRoom(tab.roomId),profile=findProfile(room.profileId);
      let origin;try {const url=new URL(tab.view.webContents.getURL());if(!['http:','https:'].includes(url.protocol))throw new Error();origin=url.origin;}catch{throw new Error('当前页面不是可管理权限的 HTTP(S) 站点');}
      const grants=permissionGrants.get(partitionFor(profile.id));if(!grants)throw new Error('Profile 权限状态不可用');
      const allowed=[...grants].map(key=>JSON.parse(key)).filter(([site])=>site===origin).map(([,permission])=>permission);
      const choice=await dialog.showMessageBox(window,{type:'question',buttons:['关闭','撤销这些权限'],defaultId:0,cancelId:0,title:'站点权限',message:`${origin} 在本次运行中已获权限`,detail:`Profile：${profile.name}。${allowed.length ? allowed.join('、') : '暂无已记录的允许权限'}。同一 Profile 的同来源页面共享这些权限。其他权限按单次请求处理；应用退出后本次授权不保留。`});
      if(choice.response!==1)return {revoked:false,origin};
      const current=tabs.get(target);let currentOrigin;try{currentOrigin=new URL(current?.view.webContents.getURL()).origin;}catch{}
      if(current!==tab || currentOrigin!==origin || findRoom(tab.roomId).profileId!==profile.id)throw new Error('确认期间页面或 Profile 已改变，请重新操作');
      for(const key of [...grants])if(JSON.parse(key)[0]===origin)grants.delete(key);
      return {revoked:true,origin};
    }
    case 'closeRoom': {const s=findRoom(target);for(const tabId of s.tabIds)await runAction.releasePointer(findTab(tabId).view.webContents);await closeRoom(target); return {ok:true};}
    case 'closeTab': await runAction.releasePointer(findTab(target).view.webContents);await closeTab(target); return {ok:true};
    case 'navigate': {const t=findTab(target),url=asUrl(args.url,findRoom(t.roomId).profileId);if(!fromApi){const sequence=t.userNavigation=(t.userNavigation || 0)+1;t.pendingNavigationUrl=url;t.restoringInitial=false;update();void (async()=>{await t.bootstrap;if(tabs.get(target)!==t || t.userNavigation!==sequence)return;await t.view.webContents.loadURL(url);if(tabs.get(target)===t && t.userNavigation===sequence){t.pendingNavigationUrl=null;update();}})().catch(error=>{if(tabs.get(target)===t && t.userNavigation===sequence){t.pendingNavigationUrl=null;update();console.error('Navigation failed:',error.message);}});return {ok:true};}return navigateAgent(t,url);}
    case 'action': {const t=findTab(target); if(args.operation==='navigate') return navigateAgent(t,asUrl(args.args?.url,findRoom(t.roomId).profileId)); if(args.operation==='evaluate') return evaluateWithDeadline(t,args.args || {}); const beforePopup=t.popupSequence; const result=await runAction(t.view.webContents,args.operation,args.args); const popups=(t.popupEvents||[]).filter(event=>event.sequence>beforePopup).map(event=>{const popup=tabs.get(event.tabId);return {sequence:event.sequence,tabId:event.tabId,status:popup?(popup.ready?'ready':'initializing'):'closed',...(popup?{label:popup.label,openedBy:popup.openedBy}:{})};}); return {...result,receipt:{popups,dialog:pageDebugger.get(t.view.webContents) ?? null}};}
    case 'getDialog': {const contents=findTab(target).view.webContents;if(!pageDebugger.available(contents)) throw new Error('Page debugger is unavailable; dialog state is unknown');return {dialog:pageDebugger.get(contents)};}
    case 'getPopupEvents': {const tab=findTab(target);if(args.after===undefined)return {cursor:tab.popupSequence,event:null};const after=Number(args.after);if(!Number.isSafeInteger(after) || after<0 || after>tab.popupSequence)throw new Error('Invalid popup cursor');if(tab.popupEvents.length && after<tab.popupEvents[0].sequence-1)throw new Error('Popup event history expired');const event=tab.popupEvents.find(item=>item.sequence>after);if(!event)return {cursor:tab.popupSequence,event:null};const popup=tabs.get(event.tabId);return {cursor:tab.popupSequence,event:{...event,status:popup?(popup.ready?'ready':'initializing'):'closed',...(popup?{label:popup.label,openedBy:popup.openedBy}: {})}};}
    case 'armDownload': return agentDownloads.arm(target,args.timeoutMs);
    case 'getAgentDownload': return agentDownloads.info(target,args.downloadId);
    case 'cancelAgentDownload': agentDownloads.cancel(target,args.downloadId);return {ok:true};
    case 'deleteAgentDownload': agentDownloads.discard(target,args.downloadId);return {ok:true};
    case 'handleDialog': return pageDebugger.handle(findTab(target).view.webContents,args.accept,args.promptText);
    case 'armChooser': {const t=findTab(target),result=await pageDebugger.armChooser(t.view.webContents,args.timeoutMs);const s=findRoom(t.roomId);if(fromApi && (s.ownership!=='agent' || s.executionRisk)) {await pageDebugger.cancelChooser(t.view.webContents,result.id);throw new Error('Room is under user control or has unresolved execution');}return result;}
    case 'getChooser': return pageDebugger.getChooser(findTab(target).view.webContents,args.chooserId);
    case 'cancelChooser': return pageDebugger.cancelChooser(findTab(target).view.webContents,args.chooserId);
    case 'chooseFiles': {if(!Array.isArray(args.files) || !args.files.length)throw new Error('Choose at least one file or cancel the chooser');await runAction.validateFiles(args.files);const t=findTab(target),s=findRoom(t.roomId);if(fromApi && (s.ownership!=='agent' || s.executionRisk))throw new Error('Room is under user control or has unresolved execution');return pageDebugger.chooseFiles(t.view.webContents,args.chooserId,args.files);}
    case 'back': {const c=findTab(target).view.webContents; if(c.navigationHistory.canGoBack()) c.navigationHistory.goBack(); return {ok:true};}
    case 'forward': {const c=findTab(target).view.webContents; if(c.navigationHistory.canGoForward()) c.navigationHistory.goForward(); return {ok:true};}
    case 'reload': findTab(target).view.webContents.reload(); return {ok:true};
    default: throw new Error('Unknown action');
  }
}
async function claimRoom(room) {
  if(room.ownership!=='user')throw new Error('Only a user-controlled room can be claimed');
  if(room.executionRisk || room.userResumePending)throw new Error('Resolve the pending execution or resumeControl before claiming this room');
  const profile=findProfile(room.profileId),tabIds=[...room.tabIds];
  const choice=await dialog.showMessageBox(window,{type:'question',buttons:['拒绝','允许 Agent 使用'],defaultId:0,cancelId:0,title:'Agent 请求使用Room',message:`允许 Agent 使用Room“${room.name}”？`,detail:`Profile：${profile.name}；当前有 ${tabIds.length} 个标签。Agent 可以接管并操作这些页面，页面可能包含登录状态和私人数据。用户创建或来源不明的标签不会因此变成 Agent 创建。`});
  if(choice.response!==1)throw new Error('User declined room claim');
  if(!rooms.includes(room) || room.ownership!=='user' || room.executionRisk || room.userResumePending || room.profileId!==profile.id || room.tabIds.length!==tabIds.length || room.tabIds.some((id,index)=>id!==tabIds[index]))throw new Error('Room changed while awaiting approval; request it again');
  room.ownership='agent';room.finished=false;room.yielded=false;room.manualControl=false;update();
  return describe().rooms.find(item=>item.id===room.id);
}
async function finishRoom(room,keep) {
  if(keep!=='all' && (!Array.isArray(keep) || keep.some(label=>typeof label!=='string' || !label)))throw new Error('finish requires keep: "all" or an array of page labels');
  const managed=room.tabIds.map(findTab).filter(tab=>tab.label),keepSet=new Set(keep==='all'?managed.map(tab=>tab.label):keep);
  for(const label of keepSet)if(!managed.some(tab=>tab.label===label))throw new Error(`Page label not found: ${label}`);
  const closing=managed.filter(tab=>tab.openedBy==='agent' && !keepSet.has(tab.label));
  const closedManagedLabels=closing.map(tab=>tab.label),keptManagedLabels=managed.filter(tab=>!closing.includes(tab)).map(tab=>tab.label);
  const preservedUnmanagedCount=room.tabIds.map(findTab).filter(tab=>!tab.label).length;
  for(const tabId of room.tabIds){agentDownloads.cancelTab(tabId);const contents=findTab(tabId).view.webContents;await pageDebugger.cancelChooser(contents);await runAction.releasePointer(contents);}
  if(room.ownership!=='agent' || room.userResumePending || room.executionRisk)throw new Error('Room is no longer available for agent control');
  let closedCount=0;
  for(const tab of closing){try{await closeTab(tab.id);closedCount++;}catch(error){if(closedCount)throw new Error(`${error.message}；已有 ${closedCount} 个标签关闭`);throw error;}if(room.ownership!=='agent' || room.userResumePending || room.executionRisk)throw new Error('Room is no longer available for agent control; some pages may already have closed');}
  if(!room.tabIds.length){await closeRoom(room.id);return {roomId:room.id,closedRoom:true,keptManagedLabels,closedManagedLabels,preservedUnmanagedCount};}
  for(const tabId of room.tabIds)findTab(tabId).label=null;
  room.ownership='user';room.finished=true;room.yielded=false;room.manualControl=false;update();
  return {roomId:room.id,closedRoom:false,keptManagedLabels,closedManagedLabels,preservedUnmanagedCount};
}
async function requestUserControl(roomId) {
  const room=findRoom(roomId);if(room.ownership!=='agent')throw new Error('Room is already under user control');
  if(room.userResumePending)throw new Error('User resumeControl is already pending');
  room.userResumePending=true;update();
  try {
    for(const tabId of room.tabIds){agentDownloads.cancelTab(tabId);await pageDebugger.cancelChooser(findTab(tabId).view.webContents);}
    return await dispatchQueued('yieldControl',{id:roomId,manual:true},false);
  } finally {room.userResumePending=false;if(rooms.includes(room))update();}
}
async function evaluateWithDeadline(tab,args) {
  const timeout=args.timeoutMs ?? 10000;
  if(!Number.isInteger(timeout) || timeout<100 || timeout>60000) throw new Error('evaluate timeoutMs must be an integer between 100 and 60000');
  const room=findRoom(tab.roomId), operationId=id();
  let timer, timedOut=false;
  const execution=Promise.resolve().then(()=>runAction(tab.view.webContents,'evaluate',args));
  execution.then(()=>settled('late_completed'),()=>settled('late_failed'));
  function settled(status) {if(!timedOut || room.executionRisk?.operationId!==operationId) return;room.executionRisk.status=status;update();}
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;room.executionRisk={operationId,tabId:tab.id,status:'timed_out',executionStopped:false,mayHaveLateEffects:true};update();resolve({status:'timed_out',operationId,executionStopped:false,mayHaveLateEffects:true});},timeout);});
  try {return await Promise.race([execution,deadline]);} finally {clearTimeout(timer);}
}
function dispatchQueued(method,args={},fromApi=false) {
  const roomMethods=['createTab','closeRoom','closeRoomFromUser','activateRoom','yieldControl','resumeControl','returnUserControl','adoptTab','releasePage','finishRoom','claimRoom'];
  const tabMethods=['closeTab','activateTab','navigate','back','forward','reload','action','armDownload'];
  let roomId;
  try { if(roomMethods.includes(method)) roomId=findRoom(args.id).id; else if(tabMethods.includes(method)) roomId=findTab(args.id).roomId; }
  catch(error) { return Promise.reject(error); }
  if(fromApi && roomId && findRoom(roomId).userResumePending) return Promise.reject(new Error('User resumeControl is pending'));
  if (!roomId) return dispatch(method,args,fromApi);
  const previous=queues.get(roomId) || Promise.resolve();
  const pending=previous.catch(()=>{}).then(()=>dispatch(method,args,fromApi));
  queues.set(roomId,pending); pending.finally(()=>{if(queues.get(roomId)===pending) queues.delete(roomId);}).catch(()=>{});
  return pending;
}
function apiRoute(req, url) {
  const pieces = url.pathname.split('/').filter(Boolean), [kind, target, action] = pieces;
  if (req.method==='GET' && url.pathname==='/health') return ['health',{}];
  if (req.method==='POST' && url.pathname==='/shutdown' && process.env.CORVID_TEST_MODE==='1') return ['shutdown',{}];
  if (req.method==='GET' && url.pathname==='/rooms') return ['state',{}];
  if (req.method==='GET' && url.pathname==='/profiles') return ['profiles',{}];
  if (req.method==='POST' && url.pathname==='/profiles') return ['createProfile',{}];
  if (req.method==='GET' && url.pathname==='/history') return ['history',{...(url.searchParams.has('profileId')?{profileId:url.searchParams.get('profileId')}:{})}];
  if (req.method==='GET' && url.pathname==='/bookmarks') return ['bookmarks',{...(url.searchParams.has('profileId')?{profileId:url.searchParams.get('profileId')}:{})}];
  if (req.method==='GET' && url.pathname==='/downloads') return ['downloads',{...(url.searchParams.has('profileId')?{profileId:url.searchParams.get('profileId')}:{})}];
  if (req.method==='POST' && url.pathname==='/bookmarks') return ['addBookmark',{}];
  if (kind==='history' && target && req.method==='DELETE' && !action) return ['removeHistory',{id:target}];
  if (kind==='bookmarks' && target && req.method==='DELETE' && !action) return ['removeBookmark',{id:target}];
  if (req.method==='POST' && url.pathname==='/rooms') return ['createRoom',{}];
  if (req.method==='POST' && url.pathname==='/rooms/open') return ['resolveRoom',{}];
  if (kind==='rooms' && target && req.method==='DELETE' && !action) return ['closeRoom',{id:target}];
  if (kind==='rooms' && target && req.method==='POST') return [{tabs:'createTab',activate:'activateRoom',yieldControl:'yieldControl',resumeControl:'resumeControl',adopt:'adoptTab',release:'releasePage',finish:'finishRoom',claim:'claimRoom'}[action],{id:target}];
  if (kind==='tabs' && target && req.method==='DELETE' && !action) return ['closeTab',{id:target}];
  if (kind==='tabs' && target && req.method==='GET' && action==='dialog') return ['getDialog',{id:target,...(url.searchParams.has('pageLabel')?{pageLabel:url.searchParams.get('pageLabel')}:{})}];
  if (kind==='tabs' && target && req.method==='GET' && action==='popups') return ['getPopupEvents',{id:target,...(url.searchParams.has('after')?{after:url.searchParams.get('after')}:{}) ,...(url.searchParams.has('pageLabel')?{pageLabel:url.searchParams.get('pageLabel')}:{})}];
  if (kind==='tabs' && target && req.method==='GET' && action==='agent-download') return ['getAgentDownload',{id:target,downloadId:url.searchParams.get('id'),...(url.searchParams.has('pageLabel')?{pageLabel:url.searchParams.get('pageLabel')}:{})}];
  if (kind==='tabs' && target && req.method==='POST' && action==='agent-download') return [{arm:'armDownload',cancel:'cancelAgentDownload',delete:'deleteAgentDownload'}[pieces[3]],{id:target}];
  if (kind==='tabs' && target && req.method==='POST' && action==='dialog') return ['handleDialog',{id:target}];
  if (kind==='tabs' && target && req.method==='GET' && action==='chooser') return ['getChooser',{id:target,chooserId:url.searchParams.get('id'),...(url.searchParams.has('pageLabel')?{pageLabel:url.searchParams.get('pageLabel')}:{})}];
  if (kind==='tabs' && target && req.method==='POST' && action==='chooser') return [{arm:'armChooser',files:'chooseFiles',cancel:'cancelChooser'}[pieces[3]],{id:target}];
  if (kind==='tabs' && target && req.method==='POST') return [{navigate:'navigate',activate:'activateTab',back:'back',forward:'forward',reload:'reload',action:'action'}[action],{id:target}];
  return [];
}
function errorCode(message) {
  const text=String(message);
  if(/timed out|timeout/i.test(text)) return 'CORVID_TIMEOUT';
  if(/stale|no longer manages|already used|expired/i.test(text)) return 'CORVID_STALE_REFERENCE';
  if(/user control|takeover is pending|resumeControl is pending|unresolved execution|execution risk/i.test(text)) return 'CORVID_CONTROL_LOST';
  if(/unsupported|not supported|not yet supported/i.test(text)) return 'CORVID_UNSUPPORTED';
  if(/not found|unknown action/i.test(text)) return 'CORVID_NOT_FOUND';
  return 'CORVID_DESKTOP_ERROR';
}
async function startServer() {
  server=http.createServer(async (req,res) => {
    res.setHeader('Content-Type','application/json');
    if (req.headers.authorization !== `Bearer ${token}`) {res.writeHead(401); res.end(JSON.stringify({error:'Unauthorized',code:'CORVID_UNAUTHORIZED'})); return;}
    try {
      const [method,routeArgs]=apiRoute(req,new URL(req.url,'http://localhost')); if (!method) {res.writeHead(404); res.end(JSON.stringify({error:'Not found',code:'CORVID_NOT_FOUND'})); return;}
      let raw=''; for await (const chunk of req) {raw+=chunk; if(raw.length>65536) throw new Error('Request too large');}
      const body=raw ? JSON.parse(raw) : {}; const result=method==='health' ? {ok:true} : method==='shutdown' ? {ok:true} : await dispatchQueued(method,{...body,...routeArgs},true);
      res.end(JSON.stringify(result));
      if(method==='shutdown') setImmediate(()=>app.quit());
    } catch (error) {res.writeHead(400);res.end(JSON.stringify({error:error.message,code:errorCode(error.message)}));}
  });
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(Number(process.env.CORVID_PORT || 0),'127.0.0.1',resolve);});
  const connection={baseUrl:`http://127.0.0.1:${server.address().port}`,token};
  fs.writeFileSync(connectionPath,JSON.stringify(connection),{mode:0o600}); fs.chmodSync(connectionPath,0o600);
}
app.whenReady().then(async () => {
  fs.mkdirSync(dataDir,{recursive:true});
  const savedWindow=readWindowState();
  const initialBounds=savedWindow ? (savedWindow.x!==undefined ? {x:savedWindow.x,y:savedWindow.y,width:savedWindow.width,height:savedWindow.height} : {width:savedWindow.width,height:savedWindow.height}) : {width:1280,height:850};
  window = new BrowserWindow({...initialBounds,title:'Corvid',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  if(savedWindow?.maximized) window.maximize();
  window.on('resize',scheduleWindowStateSave);window.on('move',scheduleWindowStateSave);window.on('close',saveWindowState);
  installShortcuts(window.webContents);
  ipcMain.handle('shell-action',(_event,method,args) => dispatchQueued(method,args));
  ipcMain.on('page-prompt',(event,message,defaultPrompt)=>{
    const tab=[...tabs.values()].find(item=>item.view.webContents===event.sender);
    if(!tab || typeof message!=='string' || typeof defaultPrompt!=='string') {event.returnValue=null;return;}
    try {pageDebugger.openPrompt(event.sender,message,defaultPrompt,value=>{event.returnValue=value;});} catch {event.returnValue=null;}
  });
  await window.loadFile(path.join(__dirname,'index.html')); window.on('resize',layout);
  const saved=readSavedRooms();
  if (saved && Array.isArray(saved.rooms)) {
    restoring = true;
    for (const old of saved.rooms) { const profileId=old.profileId ?? 'default';findProfile(profileId);const pending=Boolean(old.userResumePending);const executionRisk=old.executionRisk ? {...old.executionRisk,status:'unknown_after_restart'} : pending ? {operationId:null,tabId:null,status:'unknown_after_restart',executionStopped:null,mayHaveLateEffects:true} : null;const existingNumbers=old.tabs.map(tab=>/^p([1-9]\d*)$/.exec(tab.label || '')).filter(Boolean).map(match=>Number(match[1]));const nextPageNumber=Math.max(1,Number.isSafeInteger(old.nextPageNumber)?old.nextPageNumber:1,...existingNumbers.map(value=>value+1));const usedLabels=[...new Set([...(old.usedLabels || []),...old.tabs.map(tab=>tab.label).filter(Boolean)])];const s={id:old.id,name:old.name,profileId,ownership:pending?'user':old.ownership,finished:Boolean(old.finished),yielded:pending||Boolean(old.yielded),manualControl:pending||Boolean(old.manualControl),executionRisk,nextPageNumber,usedLabels,tabIds:[],activeTabId:null}; rooms.push(s); for (const t of old.tabs || []) await createTab(s.id,t.url,t.id,{label:t.label ?? null,openedBy:t.openedBy ?? 'unknown',restored:true}); s.activeTabId=s.tabIds.includes(old.activeTabId)?old.activeTabId:s.tabIds[0] || null; }
    activeProfileId=saved.activeProfileId ?? rooms.find(s=>s.id===saved.activeRoomId)?.profileId ?? 'default';findProfile(activeProfileId);
    activeRoomId=rooms.some(s=>s.id===saved.activeRoomId && s.profileId===activeProfileId)?saved.activeRoomId:rooms.find(s=>s.profileId===activeProfileId)?.id || null;
    restoring = false;
  }
  if (!rooms.length) await createRoom('我的 Room','user'); update();
  await startServer();
  console.log(`Corvid control: ${connectionPath}`);
}).catch(error => {console.error(error);if(process.env.CORVID_TEST_MODE!=='1') dialog.showErrorBox('Corvid 启动失败',error.message);app.exit(1);});
app.on('before-quit',() => {quitting=true; if(server) server.close(); try {const current=JSON.parse(fs.readFileSync(connectionPath,'utf8'));if(current.token===token) fs.unlinkSync(connectionPath);} catch {}});
app.on('window-all-closed',() => app.quit());
app.on('will-quit',()=>{try{agentDownloads.cleanup();}catch(error){console.error('Agent download cleanup failed:',error.message);}});
