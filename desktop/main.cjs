const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog, shell, screen, clipboard, safeStorage, Menu, nativeTheme } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { safePageUrl, createPageContextMenuTemplate } = require('./page-context-menu.cjs');
const { createAgentClientsStore } = require('./agent-clients.cjs');
const { permissionDisplayName } = require('./permission-labels.cjs');
const { isFullscreenShortcut } = require('./window-shortcuts.cjs');
const { clearPageFullscreen, markPageFullscreen, snapshotFullscreenRestoreState } = require('./page-fullscreen.cjs');
const { createStartupProgress } = require('./startup-progress.cjs');
const { applicationMenuText, createApplicationMenuTemplate, syncApplicationMenuState } = require('./application-menu.cjs');
const { createMainLocale } = require('./main-locales.cjs');
const { createActionIndicator } = require('./action-indicator.cjs');
const { resolveDataDirectory } = require('./data-directory.cjs');
const { navigationFailureDetails, navigationHttpStatusFailure } = require('./navigation-errors.cjs');
// Covers tabs plus the toolbar until the first renderer measurement reaches the main process.
const INITIAL_BROWSER_CHROME_HEIGHT = 90;
let mainMessages = createMainLocale(/^en(?:-|$)/i.test(app.getLocale()) ? 'en' : 'zh-CN');

const dataDir = resolveDataDirectory({ override:process.env.CORVID_DATA_DIR, homeDir:app.getPath('home') });
const startupProgress = createStartupProgress({ dataDir, enabled: process.env.CORVID_TEST_MODE === '1', onError: error => console.error(`Corvid test startup progress could not be saved: ${error.message}`) });
let dataDirectoryError = null;
try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  const probe = path.join(dataDir, `.corvid-write-check-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  let descriptor;
  try {
    descriptor = fs.openSync(probe, 'wx', 0o600);
    fs.closeSync(descriptor);
    descriptor = undefined;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(probe); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
} catch (error) {
  dataDirectoryError = new Error(mainMessages.t('dataDirectoryFailure', {path:dataDir,error:error.message}));
}
let singleInstanceLock = false;
if (!dataDirectoryError) {
  app.setPath('userData', dataDir);
  singleInstanceLock = app.requestSingleInstanceLock();
}

if (!singleInstanceLock && !dataDirectoryError) app.quit();
else if (singleInstanceLock) startupProgress('main-module-loaded');
// 测试实例的 HOME 是沙箱临时目录，真实登录钥匙串不存在；Cookie 加密走 mock keychain，
// 否则关停时 securityd 会在真实桌面会话弹「钥匙串找不到」并阻塞退出。
if (process.env.CORVID_TEST_MODE === '1') app.commandLine.appendSwitch('use-mock-keychain');
if (dataDirectoryError) {
  console.error(dataDirectoryError.message);
  void app.whenReady().then(() => {
    if (process.env.CORVID_TEST_MODE !== '1') dialog.showErrorBox(mainMessages.t('appStartupFailedTitle'), dataDirectoryError.message);
    app.exit(1);
  });
} else if (!singleInstanceLock) {
  // A second process must not initialize Corvid application state.
} else {
const hadExistingCorvidData=[path.join(dataDir,'rooms.json'),path.join(dataDir,'spaces.json'),path.join(dataDir,'profiles.json'),path.join(dataDir,'library.json'),path.join(dataDir,'window-state.json'),path.join(dataDir,'agent-tasks.json'),path.join(dataDir,'managed-extensions.json')].some(file=>fs.existsSync(file));
const token = crypto.randomBytes(32).toString('hex');
const tabs = new Map();
const queues = new Map();
const roomResolutions = new Map();
const runAction = require('./actions.cjs');
const installNewTabPage = require('./new-tab-page.cjs');
const pageDebugger = require('./page-debugger.cjs');
const agentDownloads = require('./agent-downloads.cjs')(app.getPath('temp'));
const { createAgentWorkbench } = require('./agent-workbench.cjs');
const { createPiAgentRuntime } = require('./agent-runtime.cjs');
const { createPiModelManager } = require('./pi-models.cjs');
const usePiFixture=process.env.CORVID_TEST_MODE==='1'&&process.env.CORVID_TEST_PI_REAL_MODEL!=='1';
const pendingPiAuthPrompts = new Map();
let nextPiAuthPromptId = 0;
const pendingAgentApprovals = new Map();
let nextAgentApprovalId = 0;
const piModelManager = createPiModelManager({ dataDir, agentDir:path.join(dataDir,'pi-agent'), safeStorage, openExternal: url => shell.openExternal(url), promptAuth: (providerId, prompt) => new Promise((resolve, reject) => {
  const record = [...windowRecords.values()].find(item => !item.browserWindow.isDestroyed() && item.browserWindow.isFocused()) || [...windowRecords.values()].find(item => !item.browserWindow.isDestroyed());
  if (!record) { reject(new Error('找不到可完成账号授权的 Corvid 窗口')); return; }
  const id = `pi-auth-${++nextPiAuthPromptId}`;
  const timer = setTimeout(() => { pendingPiAuthPrompts.delete(id); reject(new Error('账号授权交互已超时')); }, 180_000);
  pendingPiAuthPrompts.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  record.browserWindow.webContents.send('pi-auth-prompt', { id, providerId, prompt });
}), onAuthEvent: event => {
  for (const record of windowRecords.values()) if (!record.browserWindow.isDestroyed()) record.browserWindow.webContents.send('pi-auth-event', event);
} });
let failNextPiFixtureInitialization = process.env.CORVID_TEST_MODE === '1' && process.env.CORVID_TEST_PI_INIT_FAILURE_ONCE === '1';
let failNextPiFixtureDisposal = process.env.CORVID_TEST_MODE === '1' && process.env.CORVID_TEST_PI_DISPOSE_FAILURE_ONCE === '1';
const fixtureSession = async ({ dataDir, taskId, sessionFile }) => {
  if(failNextPiFixtureInitialization){failNextPiFixtureInitialization=false;throw new Error('本地 fixture 模拟 Pi Session 初始化失败');}
  const directory=path.join(dataDir,'agent-sessions',taskId);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.chmodSync(directory,0o700);
  const transcript=sessionFile || path.join(directory,'fixture-session.jsonl');
  if(sessionFile && !path.resolve(sessionFile).startsWith(`${path.resolve(directory)}${path.sep}`))throw new Error('Fixture transcript must remain inside the task directory');
  const listeners=new Set();
  let abortActive;
  let failDispose=false;
  const session={
    sessionFile:transcript,
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    async prompt(message){
      const previous=fs.existsSync(transcript)?fs.readFileSync(transcript,'utf8').split('\n').filter(Boolean).length:0;
      fs.appendFileSync(transcript,`${JSON.stringify({message})}\n`,{mode:0o600});
      if(message.includes('[fixture:dispose-failure]')&&failNextPiFixtureDisposal){failDispose=true;failNextPiFixtureDisposal=false;}
      if(message.includes('[fixture:fail-once]')&&previous===0)throw new Error('本地 fixture 模拟 Provider 断连');
      if(message.includes('[fixture:runtime-name-leak]')&&previous===0)throw new Error('pi runtime could not be resumed');
      if(message.includes('[fixture:hold-stop-late]'))return new Promise(resolve=>{abortActive=async()=>{
        await new Promise(done=>setTimeout(done,120));
        for(const listener of listeners){
          listener({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'迟到的停止后输出'}});
          listener({type:'tool_execution_start',toolName:'late_fixture_tool'});
        }
        abortActive=null;resolve({stopReason:'aborted'});
      };});
      if(message.includes('[fixture:hold-stop-fails]'))return new Promise(()=>{abortActive=async()=>{throw new Error('本地 fixture 无法确认停止');};});
      if(message.includes('[fixture:hold]'))return new Promise(resolve=>{abortActive=()=>{abortActive=null;resolve({stopReason:'aborted'});};});
      if(message.includes('[fixture:stream-and-tool-events]')){
        for(const listener of listeners)listener({type:'tool_execution_start',toolName:'corvid_page_snapshot'});
        for(const listener of listeners)listener({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'正在读取页面；'}});
        await new Promise(resolve=>setTimeout(resolve,400));
        for(const listener of listeners)listener({type:'tool_execution_end',toolName:'corvid_page_snapshot',isError:false});
        for(const listener of listeners)listener({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'页面要点已整理。'}});
        return {stopReason:'stop'};
      }
      const reply=message.includes('[fixture:dispose-failure]')?'这是已生成且保留的回复。':`这是本地确定性 Agent fixture 第 ${previous+1} 轮回复。没有调用真实模型。`;
      for(const listener of listeners)listener({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:reply}});
      return {stopReason:'stop'};
    },
    dispose(){if(failDispose)throw new Error('本地 fixture 模拟会话清理失败');},
    async abort(){await abortActive?.();}
  };
  return {session,sessionFile:transcript,tools:['corvid_navigate','corvid_page_snapshot'],fixture:true};
};
let rooms = [], activeRoomId, activeProfileId = 'default', window, server, quitting = false, restoring = false, frontView = null;
// Multi-window support. Each record owns its BrowserWindow plus the per-window
// view state (which Room/Profile that window shows and whether its panel is
// open). `window`, `activeRoomId`, `activeProfileId`, `panelOpen` and
// `frontView` stay as aliases for the focused window so existing call sites keep
// their meaning; `focusWindow` switches those aliases.
const windowRecords = new Map();
let pendingSecondInstanceActivation = false;
app.on('second-instance', () => {
  const record = [...windowRecords.values()].find(item => !item.browserWindow.isDestroyed() && item.browserWindow.isFocused())
    || [...windowRecords.values()].find(item => !item.browserWindow.isDestroyed());
  if (!record) {
    pendingSecondInstanceActivation = true;
    return;
  }
  if (record.browserWindow.isMinimized()) record.browserWindow.restore();
  if (!record.browserWindow.isVisible()) record.browserWindow.show();
  record.browserWindow.focus();
});
let applicationMenu = null;
const agentRuntime = createPiAgentRuntime({ dataDir, modelManager: usePiFixture ? null : piModelManager, getModelSelection: () => usePiFixture ? null : piModelManager.getSelection(), createSession: usePiFixture ? fixtureSession : undefined });
const agentWorkbench = createAgentWorkbench({ dataDir, runtime: agentRuntime,
  canReadPageContext: ({profileId,roomId,tabId}) => {
    const room=rooms.find(item=>item.id===roomId),tab=tabs.get(tabId);
    return Boolean(room&&tab&&room.profileId===profileId&&room.tabIds.includes(tabId)&&tab.roomId===roomId&&room.ownership==='agent'&&!room.userResumePending&&!room.executionRisk&&!tab.view.webContents.isDestroyed());
  },
  issueAgentCredential: ({taskId,roomId}) => {
    const room=rooms.find(item=>item.id===roomId);
    if(typeof taskId!=='string'||!taskId||!room||room.ownership!=='agent'||room.userResumePending||room.executionRisk)throw Object.assign(new Error('Corvid Agent 只能获得仍由 Agent 控制且没有待处理风险的任务空间授权'),{code:'CORVID_CONTROL_LOST'});
    const issued=agentClients.createInternal({id:`builtin:${taskId}`,name:'Corvid Agent',roomIds:[roomId]});
    return {id:issued.client.id,token:issued.token};
  },
  revokeAgentCredential: credentialId => agentClients.revokeInternal(credentialId),
  onChange: tasks => {
  for (const record of windowRecords.values()) if (!record.browserWindow.isDestroyed()) record.browserWindow.webContents.send('pi-task-state', tasks);
  for (const record of windowRecords.values()) if (!record.browserWindow.isDestroyed()) record.browserWindow.webContents.send('agent-task-summary-state', {profileId:record.activeProfileId,tasks:agentWorkbench.listSummaries(record.activeProfileId)});
} });
let panelOpen = false;
const selectedChromeSources = new Map();
// 各平台 Chrome 默认资料目录：主动探测与手动选择对话框共用同一个建议路径。
// 用 os.homedir() 而非 app.getPath('home')：前者尊重 HOME 环境变量，测试沙箱才不会探到开发机真实 Chrome 资料。
const defaultChromeUserDir=()=>process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support','Google','Chrome'):process.platform==='win32'?path.join(process.env.LOCALAPPDATA || app.getPath('appData'),'Google','Chrome','User Data'):path.join(os.homedir(),'.config','google-chrome');
let failChromeCookieFlushForTest=process.env.CORVID_TEST_MODE==='1'&&process.env.CORVID_TEST_CHROME_COOKIE_FLUSH_FAIL_ONCE==='1';
let failChromeCookieRollbackFlushForTest=process.env.CORVID_TEST_MODE==='1'&&process.env.CORVID_TEST_CHROME_COOKIE_ROLLBACK_FLUSH_FAIL_ONCE==='1';
let hangChromeCookieFlushForTest=process.env.CORVID_TEST_MODE==='1'&&process.env.CORVID_TEST_CHROME_COOKIE_FLUSH_TIMEOUT_ONCE==='1';
let failChromeCookieSetNameForTest=process.env.CORVID_TEST_MODE==='1'?process.env.CORVID_TEST_CHROME_COOKIE_SET_FAIL_NAME:'';
let failChromeCookieRemoveNameForTest=process.env.CORVID_TEST_MODE==='1'?process.env.CORVID_TEST_CHROME_COOKIE_REMOVE_FAIL_NAME:'';
function normalizeCookieDomain(domain){return String(domain||'').toLowerCase().replace(/^\./,'').replace(/\.$/,'');}
function chromeCookieStoreTimeoutMs(){
  const testTimeout=process.env.CORVID_TEST_MODE==='1'?Number(process.env.CORVID_TEST_CHROME_COOKIE_FLUSH_TIMEOUT_MS):0;
  return Number.isFinite(testTimeout)&&testTimeout>=100&&testTimeout<=30000?testTimeout:30000;
}
async function awaitChromeCookieStoreOperation(operation){
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('CORVID_COOKIE_PERSISTENCE_TIMEOUT');error.code='CORVID_COOKIE_PERSISTENCE_TIMEOUT';reject(error);},chromeCookieStoreTimeoutMs());}),
    ]);
  }finally{clearTimeout(timer);}
}
async function flushChromeCookies(destinationSession,{rollback=false}={}){
  if(failChromeCookieFlushForTest){failChromeCookieFlushForTest=false;throw new Error('测试注入：Chrome Cookie 持久化失败');}
  if(rollback&&failChromeCookieRollbackFlushForTest){failChromeCookieRollbackFlushForTest=false;throw new Error('测试注入：Chrome Cookie 回滚持久化失败');}
  if(hangChromeCookieFlushForTest){hangChromeCookieFlushForTest=false;await awaitChromeCookieStoreOperation(()=>new Promise(()=>{}));}
  await awaitChromeCookieStoreOperation(()=>destinationSession.cookies.flushStore());
}
function verifyChromeCookiesPersisted(destinationSession,addedCookies){
  const persistentCookies=addedCookies.filter(({cookie})=>Number.isFinite(cookie.expirationDate));
  if(!persistentCookies.length)return;
  const storagePath=destinationSession.getStoragePath();
  let database;
  try{
    // Chromium can resolve flushStore while a read-only Profile directory prevents persistent Cookies from reaching disk. Verify identity metadata only; never read Cookie values.
    if(!storagePath)throw new Error('Cookie 存储目录不可用');
    const databasePath=[path.join(storagePath,'Cookies'),path.join(storagePath,'Network','Cookies')].find(candidate=>fs.existsSync(candidate));
    if(!databasePath||!fs.lstatSync(databasePath).isFile())throw new Error('Cookie 数据库不可用');
    const {DatabaseSync}=require('node:sqlite');
    database=new DatabaseSync(databasePath,{readOnly:true});
    const hasCookie=database.prepare('SELECT 1 FROM cookies WHERE host_key = ? AND name = ? AND path = ? LIMIT 1');
    for(const {cookie} of persistentCookies){
      const hostKey=cookie.domain||new URL(cookie.url).hostname;
      if(!hasCookie.get(hostKey,cookie.name,cookie.path||'/'))throw new Error('Cookie 未写入数据库');
    }
  }catch{
    throw new Error('Chrome Cookie 持久化校验失败，未能确认本次导入的持久 Cookie 已写入磁盘。为保护目标 Profile 原有 Cookie，已撤回可安全撤回的本次修改。请确认目标 Profile 数据目录可写后，在同一来源和目标 Profile 下重试。');
  }finally{
    try{database?.close();}catch{}
  }
}
function activeRecord() {
  if (window && !window.isDestroyed()) {
    for (const record of windowRecords.values()) if (record.browserWindow === window) return record;
  }
  const first = [...windowRecords.values()].find(record => !record.browserWindow.isDestroyed());
  return first || null;
}
function focusWindow(record) {
  if (!record || record.browserWindow.isDestroyed()) return;
  window = record.browserWindow;
  panelOpen = record.panelOpen;
  frontView = record.frontView;
  activeRoomId = record.activeRoomId;
  activeProfileId = record.activeProfileId;
  syncApplicationMenu();
}
function applicationMenuContext() {
  const record=activeRecord(),room=record&&rooms.find(item=>item.id===record.activeRoomId),tab=room&&tabs.get(room.activeTabId);
  const canUseActiveTab=Boolean(record&&room?.ownership==='user'&&!room.userResumePending&&!room.executionRisk&&tab&&!tab.view.webContents.isDestroyed());
  const history=canUseActiveTab?tab.view.webContents.navigationHistory:null;
  return {record,room,tab,canUseActiveTab,canCreateTab:Boolean(record&&room?.ownership==='user'&&!room.userResumePending&&!room.executionRisk),canCloseTab:canUseActiveTab,canGoBack:Boolean(history?.canGoBack()),canGoForward:Boolean(history?.canGoForward()),fullscreen:Boolean(record?.appFullscreen),focusedWindowId:record?.id??null};
}
function showApplicationMenuError(record) {
  if(!record||record.browserWindow.isDestroyed())return;
  void dialog.showMessageBox(record.browserWindow,{type:'warning',message:applicationMenuText(uiLocale).actionUnavailable});
}
function runApplicationMenuAction(action) {
  const record=activeRecord();
  if(!record||record.browserWindow.isDestroyed())return;
  try{Promise.resolve(action(record)).catch(error=>{console.error('Corvid application menu action failed:',error.message);showApplicationMenuError(record);});}
  catch(error){console.error('Corvid application menu action failed:',error.message);showApplicationMenuError(record);}
}
function applicationMenuHandlers() {
  const active=()=>applicationMenuContext();
  const dispatchActive=method=>{const current=active();if(current.canUseActiveTab)return dispatchQueued(method,{id:current.tab.id});};
  const adjustZoom=delta=>runApplicationMenuAction(()=>{const current=active();if(!current.canUseActiveTab)return;const settings=profileSettings(current.record.activeProfileId);const zoom=delta===null?1:Math.round(Math.min(3,Math.max(0.5,settings.zoom+delta))*10)/10;saveSettings(current.record.activeProfileId,{zoom});applyZoom(current.record.activeProfileId);update(current.record);});
  return {
    canCreateTab:()=>applicationMenuContext().canCreateTab,
    canCloseTab:()=>applicationMenuContext().canCloseTab,
    canUseActiveTab:()=>applicationMenuContext().canUseActiveTab,
    canGoBack:()=>applicationMenuContext().canGoBack,
    canGoForward:()=>applicationMenuContext().canGoForward,
    isFullscreen:()=>applicationMenuContext().fullscreen,
    newTab:()=>runApplicationMenuAction(()=>{const current=active();if(current.canCreateTab)return dispatchQueued('createTab',{id:current.room.id});}),
    newWindow:()=>runApplicationMenuAction(()=>dispatchQueued('createWindow',{})),
    closeTab:()=>runApplicationMenuAction(()=>{const current=active();if(current.canCloseTab)return dispatchQueued('closeTab',{id:current.tab.id});}),
    closeWindow:()=>runApplicationMenuAction(current=>{
      if(windowRecords.size<=1){current.browserWindow.close();return;}
      return dispatchQueued('closeWindow',{id:current.id});
    }),
    back:()=>runApplicationMenuAction(()=>dispatchActive('back')),
    forward:()=>runApplicationMenuAction(()=>dispatchActive('forward')),
    reload:()=>runApplicationMenuAction(()=>dispatchActive('reload')),
    find:()=>runApplicationMenuAction(()=>{const current=active();if(!current.canUseActiveTab)return;current.record.browserWindow.webContents.focus();current.record.browserWindow.webContents.send('shell-find-open');}),
    findNext:()=>runApplicationMenuAction(()=>{const current=active();if(!current.canUseActiveTab)return;current.record.browserWindow.webContents.focus();current.record.browserWindow.webContents.send('shell-find-next',{backward:false});}),
    findPrevious:()=>runApplicationMenuAction(()=>{const current=active();if(!current.canUseActiveTab)return;current.record.browserWindow.webContents.focus();current.record.browserWindow.webContents.send('shell-find-next',{backward:true});}),
    print:()=>runApplicationMenuAction(()=>{const current=active();if(!current.canUseActiveTab)return;current.record.browserWindow.webContents.focus();current.record.browserWindow.webContents.send('shell-print-page',{id:current.tab.id});}),
    fullscreen:()=>runApplicationMenuAction(()=>{const current=active();if(!current.record||current.record.htmlFullscreen)return;return requestWindowFullscreen(current.record,!current.record.appFullscreen);}),
    zoomIn:()=>adjustZoom(0.1),
    zoomOut:()=>adjustZoom(-0.1),
    resetZoom:()=>adjustZoom(null),
    focusWindow:id=>{const target=windowRecords.get(id);if(target&&!target.browserWindow.isDestroyed())target.browserWindow.focus();},
    showShortcuts:()=>{
      const text=applicationMenuText(uiLocale),owner=activeRecord()?.browserWindow,options={type:'info',message:text.shortcutsTitle,detail:text.shortcutsDetail};
      if(owner&&!owner.isDestroyed())void dialog.showMessageBox(owner,options);else void dialog.showMessageBox(options);
    },
  };
}
function rebuildApplicationMenu() {
  const windows=[...windowRecords.values()].filter(record=>!record.browserWindow.isDestroyed()).map(record=>({id:record.id,focused:record.browserWindow.isFocused()}));
  applicationMenu=Menu.buildFromTemplate(createApplicationMenuTemplate({locale:uiLocale,platform:process.platform,handlers:applicationMenuHandlers(),windows}));
  Menu.setApplicationMenu(applicationMenu);
  syncApplicationMenu();
}
function syncApplicationMenu() {
  if(!applicationMenu)return;
  syncApplicationMenuState(applicationMenu,applicationMenuContext());
}
function syncRecordFromAliases(record) {
  if (!record) return;
  record.panelOpen = panelOpen;
  record.frontView = frontView;
  record.activeRoomId = activeRoomId;
  record.activeProfileId = activeProfileId;
}
function requireFocusedRecord() {
  const record = activeRecord();
  if (!record) throw new Error('No window is available');
  focusWindow(record);
  return record;
}
const id = () => crypto.randomUUID();
function navigationWasCancelled(error){return /ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/i.test(String(error?.message||error||''));}
const SCHEMA_VERSION = 2;
const dbPath = path.join(dataDir, 'rooms.json');
const legacyDbPath = path.join(dataDir, 'spaces.json');
const profilesPath = path.join(dataDir, 'profiles.json');
const uiPreferencesPath = path.join(dataDir, 'ui-preferences.json');
const browserPreferencesPath = path.join(dataDir, 'browser-preferences.json');
const defaultBrowserPreferences = {schemaVersion:2,theme:'system',startupBehavior:'restore',newTabBehavior:'home',downloadDirectory:'',askWhereToSave:true};
let browserPreferences = {...defaultBrowserPreferences};
try {
  const savedPreferences = JSON.parse(fs.readFileSync(browserPreferencesPath, 'utf8'));
  if (savedPreferences?.schemaVersion === 1 && ['system','light','dark'].includes(savedPreferences.theme)) browserPreferences.theme=savedPreferences.theme;
  else if (savedPreferences?.schemaVersion === 2) {
    if(['system','light','dark'].includes(savedPreferences.theme))browserPreferences.theme=savedPreferences.theme;
    if(['restore','new-tab'].includes(savedPreferences.startupBehavior))browserPreferences.startupBehavior=savedPreferences.startupBehavior;
    if(['home','blank'].includes(savedPreferences.newTabBehavior))browserPreferences.newTabBehavior=savedPreferences.newTabBehavior;
    if(typeof savedPreferences.downloadDirectory==='string' && (!savedPreferences.downloadDirectory || path.isAbsolute(savedPreferences.downloadDirectory)) && !savedPreferences.downloadDirectory.includes('\0'))browserPreferences.downloadDirectory=savedPreferences.downloadDirectory;
    if(typeof savedPreferences.askWhereToSave==='boolean')browserPreferences.askWhereToSave=savedPreferences.askWhereToSave;
  }
} catch (error) {
  if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
}
nativeTheme.themeSource = browserPreferences.theme;
let themePreference = browserPreferences.theme;
let uiLocale = process.env.CORVID_TEST_MODE === '1' ? 'zh-CN' : (/^en(?:-|$)/i.test(app.getLocale()) ? 'en' : 'zh-CN');
try {
  const savedPreferences = JSON.parse(fs.readFileSync(uiPreferencesPath, 'utf8'));
  if (savedPreferences && savedPreferences.schemaVersion === 1 && ['zh-CN', 'en'].includes(savedPreferences.uiLocale)) uiLocale = savedPreferences.uiLocale;
} catch (error) {
  if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
}
mainMessages.setLocale(uiLocale);
function saveUiLocale(locale) {
  const temporaryPath = `${uiPreferencesPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify({schemaVersion:1,uiLocale:locale}), {mode:0o600});
  fs.renameSync(temporaryPath, uiPreferencesPath);
  uiLocale = locale;
  rebuildApplicationMenu();
  mainMessages.setLocale(locale);
}
function saveBrowserPreferences(patch) {
  const next={...browserPreferences,...patch,schemaVersion:2};
  const invalid=(zh,en)=>Object.assign(new Error(uiLocale==='en'?en:zh),{code:'CORVID_INVALID_ARGUMENT'});
  if (!['system','light','dark'].includes(next.theme)) throw invalid('主题选项无效。','The theme option is invalid.');
  if (!['restore','new-tab'].includes(next.startupBehavior)) throw invalid('启动行为选项无效。','The startup option is invalid.');
  if (!['home','blank'].includes(next.newTabBehavior)) throw invalid('新标签页选项无效。','The new tab option is invalid.');
  if (typeof next.askWhereToSave!=='boolean') throw invalid('下载保存选项无效。','The download save option is invalid.');
  if (typeof next.downloadDirectory!=='string' || next.downloadDirectory.includes('\0') || (next.downloadDirectory&&!path.isAbsolute(next.downloadDirectory))) throw invalid('下载文件夹路径无效。','The download folder path is invalid.');
  if(next.downloadDirectory){try{if(!fs.statSync(next.downloadDirectory).isDirectory())throw invalid('所选下载位置不是文件夹。','The selected download location is not a folder.');}catch(error){if(error.code==='CORVID_INVALID_ARGUMENT')throw error;throw invalid('无法访问所选下载文件夹，请重新选择。','The selected download folder is unavailable. Choose another folder.');}}
  const temporaryPath = `${browserPreferencesPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(next), {mode:0o600});
  fs.renameSync(temporaryPath, browserPreferencesPath);
  browserPreferences=next;
  nativeTheme.themeSource=next.theme;
  themePreference=next.theme;
  return {...browserPreferences};
}
const chromeImportOnboardingPath = path.join(dataDir, 'chrome-import-onboarding.json');
let chromeImportOnboardingState=null;
try{chromeImportOnboardingState=JSON.parse(fs.readFileSync(chromeImportOnboardingPath,'utf8')).status;}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
const allowChromeImportOnboarding=process.env.CORVID_TEST_MODE!=='1'||process.env.CORVID_TEST_CHROME_IMPORT==='1';
let needsChromeImportOnboarding=chromeImportOnboardingState==='pending'||(allowChromeImportOnboarding&&chromeImportOnboardingState!=='completed'&&!hadExistingCorvidData);
if(needsChromeImportOnboarding&&chromeImportOnboardingState!=='pending'){
  const temp=`${chromeImportOnboardingPath}.tmp`;fs.writeFileSync(temp,JSON.stringify({status:'pending',startedAt:new Date().toISOString()}),{mode:0o600});fs.renameSync(temp,chromeImportOnboardingPath);chromeImportOnboardingState='pending';
}
// 首启引导三步（导入 / 连接模型 / 外部 Agent 授权）。老用户没有此文件即视为已完成，
// 只在用户实际操作时落盘；chrome-import-onboarding.json 只管欢迎框是否再出现。
const firstRunOnboardingPath=path.join(dataDir,'onboarding.json');
let firstRunOnboarding=null;
try{firstRunOnboarding=JSON.parse(fs.readFileSync(firstRunOnboardingPath,'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
const normalizeOnboardingStep=step=>['pending','done','skipped'].includes(step)?step:'pending';
if(firstRunOnboarding&&typeof firstRunOnboarding==='object'){
  firstRunOnboarding.steps={import:normalizeOnboardingStep(firstRunOnboarding.steps?.import),model:normalizeOnboardingStep(firstRunOnboarding.steps?.model),agent:normalizeOnboardingStep(firstRunOnboarding.steps?.agent)};
  firstRunOnboarding.setupDismissed=firstRunOnboarding.setupDismissed===true;
  firstRunOnboarding.welcomeDismissed=firstRunOnboarding.welcomeDismissed===true;
}else if(hadExistingCorvidData){
  firstRunOnboarding={steps:{import:'done',model:'done',agent:'done'},setupDismissed:true,welcomeDismissed:false};
}else{
  firstRunOnboarding={steps:{import:'pending',model:'pending',agent:'pending'},setupDismissed:false,welcomeDismissed:false};
}
function persistFirstRunOnboarding(){
  const temp=`${firstRunOnboardingPath}.tmp`;fs.writeFileSync(temp,JSON.stringify(firstRunOnboarding,null,2),{mode:0o600});fs.renameSync(temp,firstRunOnboardingPath);
}
const onboardingSnapshot=()=>({steps:{...firstRunOnboarding.steps},setupDismissed:firstRunOnboarding.setupDismissed,welcomeDismissed:firstRunOnboarding.welcomeDismissed});
const homeSetupState=()=>({steps:{...firstRunOnboarding.steps},dismissed:firstRunOnboarding.setupDismissed,welcomeDismissed:firstRunOnboarding.welcomeDismissed});
const connectionPath = path.join(dataDir, 'control.json');
const agentClients = createAgentClientsStore(path.join(dataDir, 'agent-clients.json'));
const windowStatePath = path.join(dataDir, 'window-state.json');
const MIN_WINDOW_WIDTH = 719;
const MIN_WINDOW_HEIGHT = 420;
function createAgentClientGrant(args = {}) {
  const name=typeof args.name==='string'?args.name.trim():'';
  const roomIds=args.roomIds;
  // openRoomGrant clients start with no granted Rooms; they gain access to Rooms
  // they open themselves through resolveRoom (see the agent-principal checks below).
  const openRoomGrant=args.openRoomGrant===true;
  const roomIdsValid=Array.isArray(roomIds)&&(openRoomGrant||roomIds.length)&&roomIds.every(roomId=>typeof roomId==='string'&&(openRoomGrant||rooms.some(room=>room.id===roomId)));
  if(!name||name.length>80||!roomIdsValid)throw Object.assign(new Error('请填写有效的客户端名称，并至少选择一个现有空间'),{code:'CORVID_INVALID_ARGUMENT'});
  const created=agentClients.create({name,roomIds:roomIds||[]});
  return {...created.client,token:created.token};
}
function normalizeBounds(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const { x, y, width, height, maximized } = saved;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  // Saved states may predate BrowserWindow's minimum; keep the saved position and clamp its size.
  const size = { width: Math.max(MIN_WINDOW_WIDTH, Math.round(width)), height: Math.max(MIN_WINDOW_HEIGHT, Math.round(height)), maximized: Boolean(maximized) };
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
// Window state is stored as a list so several windows can be restored. The
// single-object shape written by earlier versions is read as one window.
function readWindowStates() {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(windowStatePath, 'utf8')); } catch { return []; }
  const entries = Array.isArray(saved) ? saved : [saved];
  return entries.map(entry => ({id:typeof entry?.id==='string'?entry.id:null,bounds:normalizeBounds(entry)})).filter(entry=>entry.bounds);
}
let windowStateTimer;
function saveWindowState() {
  const states = [];
  for (const record of windowRecords.values()) {
    if (record.browserWindow.isDestroyed()) continue;
    const fullscreen = isTransientFullscreen(record);
    // 恢复 zoom 态的过渡窗口内 isMaximized() 可能瞬时为 false，按待恢复标记保持
    // 最大化语义与快照 bounds，避免把过渡帧写入持久化状态。
    const maximized = fullscreen
      ? Boolean(record.fullscreenRestoreMaximized ?? record.lastKnownMaximized)
      : Boolean(record.fullscreenRestoreMaximized===true || record.browserWindow.isMaximized() || record.lastKnownMaximized);
    const bounds = fullscreen && record.fullscreenRestoreBounds
      ? record.fullscreenRestoreBounds
      : maximized && record.normalBounds
        ? record.normalBounds
        : record.browserWindow.getNormalBounds();
    states.push({ id: record.id, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, maximized });
  }
  if (!states.length) return;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = `${windowStatePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(states), { mode: 0o600 });
    fs.renameSync(temp, windowStatePath);
  } catch (error) { console.error('Unable to save window state:', error.message); }
}
function scheduleWindowStateSave() { clearTimeout(windowStateTimer); windowStateTimer = setTimeout(saveWindowState, 300); }
function isTransientFullscreen(record) {
  return Boolean(record.appFullscreen || record.htmlFullscreen || record.fullscreenTransitionTarget !== null || (!record.browserWindow.isDestroyed() && record.browserWindow.isFullScreen()));
}
function requestWindowFullscreen(record, enabled) {
  const browserWindow = record.browserWindow;
  if (browserWindow.isDestroyed() || record.closing) return { requested: enabled };
  if (record.htmlFullscreen) return { requested: Boolean(record.appFullscreen), blockedByPageFullscreen: true };
  if (enabled) snapshotFullscreenRestoreState(record);
  record.fullscreenTransitionTarget = enabled;
  browserWindow.setFullScreen(enabled);
  return { requested: enabled };
}
function isWindowFullscreenRequested(record) {
  return record.fullscreenTransitionTarget ?? record.appFullscreen;
}
const library = require('./library.cjs')(dataDir);
const chromeImport = require('./chrome-import.cjs');
const chromeExtensions = require('./chrome-extensions.cjs');
const managedExtensions = chromeExtensions.createStore(dataDir);
const { createProfileDeletion, extensionProfileRoot } = require('./profile-deletion.cjs');
const extensionIconCache = new Map();
function closeExtensionPopup(record,{restoreFocus=false,focusTrigger=false}={}) {
  const popup=record?.extensionPopup;
  if(!popup)return;
  record.extensionPopup=null;
  if(!record.browserWindow.isDestroyed())record.browserWindow.webContents.send('shell-extension-popup-state',{id:popup.extensionId,open:false,focusTrigger});
  if(!popup.window.isDestroyed())popup.window.close();
  if(restoreFocus&&!record.browserWindow.isDestroyed())record.browserWindow.focus();
}
function closeExtensionPopupFor(profileId,extensionId) {
  for(const record of windowRecords.values())if(record.activeProfileId===profileId&&record.extensionPopup?.extensionId===extensionId)closeExtensionPopup(record);
}
function extensionIconData(profileId,item,manifest) {
  const declared=manifest?.action?.default_icon||manifest?.browser_action?.default_icon||manifest?.icons;
  const choices=typeof declared==='string'?[[32,declared]]:declared&&typeof declared==='object'?Object.entries(declared).map(([size,file])=>[Number(size)||32,file]):[];
  const selected=choices.filter(([,file])=>typeof file==='string').sort((a,b)=>Math.abs(a[0]-32)-Math.abs(b[0]-32))[0];
  if(!selected)return null;
  const relative=selected[1].replaceAll('\\','/');
  if(relative.startsWith('/')||relative.split('/').some(part=>!part||part==='..'))return null;
  const root=chromeExtensions.managedPath(dataDir,profileId,item.id,item.version),file=path.resolve(root,relative);
  if(!file.startsWith(`${root}${path.sep}`))return null;
  try{
    const stat=fs.lstatSync(file),actual=fs.realpathSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||!actual.startsWith(`${fs.realpathSync(root)}${path.sep}`)||stat.size<=0||stat.size>128*1024)return null;
    const cached=extensionIconCache.get(file);
    if(cached?.mtimeMs===stat.mtimeMs&&cached.size===stat.size)return cached.data;
    const data=`data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
    extensionIconCache.set(file,{mtimeMs:stat.mtimeMs,size:stat.size,data});return data;
  }catch{return null;}
}
function extensionToolbarItems(profileId) {
  const browserSession=session.fromPartition(partitionFor(profileId));
  return managedExtensions.list(profileId).filter(item=>item.enabled).flatMap(item=>{
    const extension=browserSession.extensions.getExtension(item.id);
    const popup=extension?.manifest?.action?.default_popup || extension?.manifest?.browser_action?.default_popup;
    return typeof popup==='string'&&popup.length? [{id:item.id,name:item.name,icon:extensionIconData(profileId,item,extension.manifest)}]:[];
  });
}
async function openExtensionPopup(record,args) {
  if(record.activeProfileId!==args.profileId)throw Object.assign(new Error('Active browser identity changed'),{code:'EXTENSION_POPUP_UNAVAILABLE'});
  const item=managedExtensions.find(record.activeProfileId,args.extensionId);
  if(!item?.enabled)throw Object.assign(new Error('Extension is not enabled'),{code:'EXTENSION_POPUP_UNAVAILABLE'});
  const browserSession=session.fromPartition(partitionFor(record.activeProfileId));
  const extension=browserSession.extensions.getExtension(item.id);
  const popupPath=extension?.manifest?.action?.default_popup || extension?.manifest?.browser_action?.default_popup;
  if(!extension||typeof popupPath!=='string'||!popupPath.trim())throw Object.assign(new Error('Extension popup is unavailable'),{code:'EXTENSION_POPUP_UNAVAILABLE'});
  const cleanPath=popupPath.replaceAll('\\','/');
  if(cleanPath.startsWith('/')||cleanPath.split('/').some(part=>part==='..'))throw Object.assign(new Error('Extension popup path is invalid'),{code:'EXTENSION_POPUP_UNAVAILABLE'});
  const popupUrl=new URL(cleanPath,extension.url).toString();
  const extensionUrl=new URL(extension.url),targetUrl=new URL(popupUrl);
  const extensionOrigin=`${extensionUrl.protocol}//${extensionUrl.host}`;
  if(`${targetUrl.protocol}//${targetUrl.host}`!==extensionOrigin)throw Object.assign(new Error('Extension popup path is invalid'),{code:'EXTENSION_POPUP_UNAVAILABLE'});
  if(record.extensionPopup?.extensionId===item.id){closeExtensionPopup(record,{restoreFocus:true,focusTrigger:true});return {open:false};}
  closeExtensionPopup(record);
  const anchor=args.anchor;
  if(!anchor||![anchor.left,anchor.right,anchor.top,anchor.bottom].every(Number.isFinite))throw Object.assign(new Error('Extension popup position is invalid'),{code:'EXTENSION_POPUP_UNAVAILABLE'});
  // A separate owned window dismisses on outside focus and remains isolated to the owning Profile session.
  const popup=new BrowserWindow({parent:record.browserWindow,title:item.name,show:false,frame:false,resizable:false,skipTaskbar:true,autoHideMenuBar:true,backgroundColor:'#ffffff',webPreferences:{partition:partitionFor(record.activeProfileId),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const owner={window:popup,extensionId:item.id};record.extensionPopup=owner;
  popup.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  popup.webContents.on('will-navigate',(event,url)=>{try{const target=new URL(url);if(`${target.protocol}//${target.host}`!==extensionOrigin)event.preventDefault();}catch{event.preventDefault();}});
  popup.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.key==='Escape'){event.preventDefault();closeExtensionPopup(record,{restoreFocus:true,focusTrigger:true});}});
  popup.on('closed',()=>{if(record.extensionPopup===owner){record.extensionPopup=null;if(!record.browserWindow.isDestroyed())record.browserWindow.webContents.send('shell-extension-popup-state',{id:item.id,open:false,focusTrigger:false});}});
  try{
    await popup.loadURL(popupUrl);
    if(popup.isDestroyed()||record.extensionPopup!==owner)return {open:false};
    if(popup.webContents.getURL()!==popupUrl)throw new Error('The extension popup page could not be loaded');
    const measured=await popup.webContents.executeJavaScript(`(()=>{const body=document.body;const width=Math.ceil(body?.scrollWidth||0),height=Math.ceil(body?.scrollHeight||0);return {width:width>0&&width<innerWidth*.9?width:360,height:height>0&&height<innerHeight*.9?height:420}})()`);
    const content=record.browserWindow.getContentBounds(),area=screen.getDisplayMatching(record.browserWindow.getBounds()).workArea;
    const width=Math.max(Math.min(240,area.width),Math.min(560,area.width,Number(measured?.width)||360));
    const height=Math.max(Math.min(160,area.height),Math.min(720,area.height,Number(measured?.height)||420));
    let x=content.x+anchor.right-width,y=content.y+anchor.bottom+4;
    x=Math.min(Math.max(area.x,x),area.x+area.width-width);
    if(y+height>area.y+area.height)y=Math.max(area.y,content.y+anchor.top-height-4);
    popup.setBounds({x,y,width,height});popup.show();popup.focus();
    record.browserWindow.webContents.send('shell-extension-popup-state',{id:item.id,open:true});
    popup.once('blur',()=>{if(record.extensionPopup===owner)setTimeout(()=>{if(record.extensionPopup===owner&&!popup.isDestroyed()&&!popup.isFocused())closeExtensionPopup(record);},80);});
    return {open:true,id:item.id};
  }catch(error){closeExtensionPopup(record);throw Object.assign(new Error(String(error?.message||error).slice(0,300)),{code:'EXTENSION_POPUP_LOAD_FAILED'});}
}
const extensionLoadErrors = new Map();
const activeDownloads = new Map();
const activeDownloadRetries = new Map();
const pendingDownloadRetries = new Map();
let failProfileDeleteStorageClearOnce=process.env.CORVID_TEST_MODE==='1'&&process.env.CORVID_TEST_PROFILE_DELETE_STORAGE_FAIL_ONCE==='1';
const downloadPartitions = new Set();
const permissionGrants = new Map();
let profiles;
try { profiles=JSON.parse(fs.readFileSync(profilesPath,'utf8')); }
catch(error) { if(error.code!=='ENOENT') throw error; profiles=[{id:'default',name:'默认',isDefault:true}]; }
if(!Array.isArray(profiles) || !profiles.some(p=>p.id==='default')) throw new Error('Invalid profile data');
function saveProfiles(next){
  const temporary=`${profilesPath}.tmp`;
  fs.writeFileSync(temporary,JSON.stringify(next),{mode:0o600});fs.chmodSync(temporary,0o600);fs.renameSync(temporary,profilesPath);profiles=next;
  for(const record of windowRecords.values())if(!record.browserWindow.isDestroyed())update(record);
}
const findProfile = profileId => { const profile=profiles.find(p=>p.id===profileId);if(!profile) throw new Error('Profile not found');if(profile.deletionPending)throw Object.assign(new Error('该浏览身份正在清理，完成前不能使用'),{code:'CORVID_PROFILE_DELETING'});return profile; };
const displayProfileName = profile => profile.id === 'default' && profile.isDefault ? mainMessages.t('defaultProfileName') : profile.name;
const partitionFor = profileId => profileId==='default' ? 'persist:corvid' : `persist:corvid-profile-${profileId}`;
const profileDeletion = createProfileDeletion({
  getProfiles:()=>profiles,
  saveProfiles,
  getReferences:profileId=>({
    windows:[...windowRecords.values()].filter(record=>!record.browserWindow.isDestroyed()&&record.activeProfileId===profileId).map(record=>({id:record.id,activeProfileId:record.activeProfileId})),
    rooms:rooms.filter(room=>room.profileId===profileId).map(room=>({id:room.id,name:room.name,profileId:room.profileId})),
    downloads:[
      ...[...activeDownloads.entries()].filter(([,item])=>item.profileId===profileId).map(([downloadId])=>({id:downloadId,status:'progressing'})),
      ...[...pendingDownloadRetries.entries()].filter(([,context])=>context.profileId===profileId).map(([downloadId])=>({id:downloadId,status:'starting'})),
      ...[...activeDownloadRetries.entries()].filter(([,context])=>context.profileId===profileId).map(([downloadId])=>({id:downloadId,status:'retrying'})),
    ],
  }),
  agentWorkbench,
  getSession:partition=>{
    const browserSession=session.fromPartition(partition);
    if(!failProfileDeleteStorageClearOnce)return browserSession;
    failProfileDeleteStorageClearOnce=false;
    return new Proxy(browserSession,{get(target,key){if(key==='clearStorageData')return async()=>{await new Promise(resolve=>setTimeout(resolve,4000));throw new Error('测试注入：Session 存储清理首次失败');};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  },
  partitionFor,
  library,
  managedExtensions,
  extensionRoot:extensionProfileRoot,
  dataDir,
  onDeleted:profileId=>{
    const partition=partitionFor(profileId);permissionGrants.delete(partition);downloadPartitions.delete(partition);
    for(const key of [...extensionLoadErrors.keys()])if(key.startsWith(`${profileId}:`))extensionLoadErrors.delete(key);
  },
});
async function loadProfileExtensions(profileId){
  startupProgress('tab-profile-extensions');
  const browserSession=session.fromPartition(partitionFor(profileId));
  for(const extension of managedExtensions.list(profileId).filter(item=>item.enabled)){
    if(browserSession.extensions.getExtension(extension.id))continue;
    try{
      const loaded=await browserSession.extensions.loadExtension(chromeExtensions.managedPath(dataDir,profileId,extension.id,extension.version));
      if(loaded.id!==extension.id){browserSession.extensions.removeExtension(loaded.id);throw new Error(`Electron 返回了不同的扩展 ID：${loaded.id}`);}
      extensionLoadErrors.delete(`${profileId}:${extension.id}`);
    }catch(error){
      extensionLoadErrors.set(`${profileId}:${extension.id}`,String(error?.message||error).slice(0,500));
    }
  }
  return browserSession;
}
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
  if(saved && typeof saved==='object' && saved.schemaVersion!==undefined && saved.schemaVersion!==SCHEMA_VERSION) {
    // v1 described a single implicit window; carry it forward in memory and let
    // the next persist() rewrite the file as v2. Anything else is refused with
    // the original file left untouched.
    if(saved.schemaVersion===1) saved={...saved,schemaVersion:SCHEMA_VERSION,windows:[{id:'legacy-window',activeRoomId:saved.activeRoomId ?? null,activeProfileId:saved.activeProfileId ?? 'default'}]};
    else throw new Error(`会话文件版本不受支持：${dbPath}（schemaVersion=${saved.schemaVersion}）；原文件未修改，请先备份并检查。`);
  }
  const validString=value=>typeof value==='string' && value.length>0;
  if(!saved || typeof saved!=='object' || !Array.isArray(saved.rooms) || saved.rooms.some(room=>!room || !validString(room.id) || !validString(room.name) || !['agent','user'].includes(room.ownership) || !Array.isArray(room.tabs) || room.tabs.some(tab=>!tab || !validString(tab.id) || typeof tab.url!=='string'))) {
    throw new Error(`会话文件结构无效：${dbPath}；原文件未修改，请先备份并检查后再恢复。`);
  }
  const roomIds=saved.rooms.map(room=>room.id), tabIds=saved.rooms.flatMap(room=>room.tabs.map(tab=>tab.id));
  if(new Set(roomIds).size!==roomIds.length || new Set(tabIds).size!==tabIds.length) throw new Error(`会话文件包含重复标识：${dbPath}；原文件未修改，请先备份并检查后再恢复。`);
  for(const room of saved.rooms) {const labels=room.tabs.map(tab=>tab.label).filter(label=>label!==null && label!==undefined);if(labels.some(label=>!validString(label)) || new Set(labels).size!==labels.length || (room.usedLabels!==undefined && (!Array.isArray(room.usedLabels) || room.usedLabels.some(label=>!validString(label)) || new Set(room.usedLabels).size!==room.usedLabels.length)) || room.tabs.some(tab=>tab.openedBy!==undefined && !['agent','user','unknown'].includes(tab.openedBy)) || room.tabs.some(tab=>tab.pinned!==undefined && typeof tab.pinned!=='boolean'))throw new Error(`会话页面标识无效：${dbPath}；原文件未修改，请先备份并检查后再恢复。`);}
  return saved;
}
function applyZoom(profileId) {const zoom=profileSettings(profileId).zoom;for(const tab of tabs.values()) if(findRoom(tab.roomId).profileId===profileId) tab.view.webContents.setZoomFactor(zoom);}
const findRoom = roomId => { const room = rooms.find(s => s.id === roomId); if (!room) throw new Error('Room not found'); return room; };
const findTab = tabId => { const tab = tabs.get(tabId); if (!tab) throw new Error('Tab not found'); return tab; };
const AGENT_APPROVAL_TIMEOUT_MS = 180_000;
function safeApprovalText(value,limit=500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
}
function agentApprovalContext(roomId,tabId,principal) {
  const room=findRoom(roomId),tab=findTab(tabId),clientId=principal?.client?.id;
  if(principal?.kind!=='agent' || !clientId)throw Object.assign(new Error('User approval is available only to an authorized external Agent'),{code:'CORVID_FORBIDDEN'});
  if(tab.roomId!==room.id || !room.tabIds.includes(tab.id) || !tab.label)throw Object.assign(new Error('Approval requires a managed page bound to this Room'),{code:'CORVID_CONTROL_LOST'});
  const pageUrl=tab.view.webContents.getURL() || 'about:blank';
  const pageTitle=tab.view.webContents.getTitle() || pageUrl;
  const profileId=room.profileId,pageLabel=tab.label,windowId=room.windowId;
  const validate=()=>{
    const currentClient=agentClients.findById(clientId);
    return rooms.includes(room) && tabs.get(tab.id)===tab && room.profileId===profileId && room.windowId===windowId && room.ownership==='agent' && !room.userResumePending && !room.executionRisk && room.tabIds.includes(tab.id) && tab.roomId===room.id && tab.label===pageLabel && !tab.view.webContents.isDestroyed() && tab.view.webContents.getURL()===(pageUrl || 'about:blank') && Boolean(currentClient && !currentClient.revoked && currentClient.roomIds.includes(room.id));
  };
  if(!validate())throw Object.assign(new Error('Room or page is no longer available for Agent approval'),{code:'CORVID_CONTROL_LOST'});
  let source='about:blank';
  try { const parsed=new URL(pageUrl);source=parsed.origin==='null' ? parsed.protocol==='about:' ? 'about:blank' : parsed.protocol : parsed.origin; } catch {}
  return {room,tab,clientId,clientName:safeApprovalText(principal.client.name,80),pageUrl,pageTitle:safeApprovalText(pageTitle,240),pageSource:safeApprovalText(source,512),pageLabel,profileId,windowId,validate};
}
function settleAgentApproval(pending,approved,reason,{notify=false}={}) {
  if(pendingAgentApprovals.get(pending.id)!==pending)return false;
  pendingAgentApprovals.delete(pending.id);
  clearTimeout(pending.timer);
  if(pending.signal && pending.abortHandler)pending.signal.removeEventListener('abort',pending.abortHandler);
  if(notify){const record=windowRecords.get(pending.windowId);if(record&&!record.browserWindow.isDestroyed())record.browserWindow.webContents.send('agent-approval-event',{type:'cancel',id:pending.id,reason});}
  pending.resolve({status:approved?'approved':'denied',reason});
  return true;
}
function cancelAgentApprovals({roomId,tabId,clientId,reason='context_changed'}={}) {
  for(const pending of pendingAgentApprovals.values()){
    if(roomId && pending.roomId!==roomId)continue;
    if(tabId && pending.tabId!==tabId)continue;
    if(clientId && pending.clientId!==clientId)continue;
    settleAgentApproval(pending,false,reason,{notify:true});
  }
}
function promptAgentApproval({context,kind,files=[],summary='',impact='',timeoutMs=AGENT_APPROVAL_TIMEOUT_MS,signal}) {
  if(!Number.isInteger(timeoutMs) || timeoutMs<100 || timeoutMs>AGENT_APPROVAL_TIMEOUT_MS)throw Object.assign(new Error('Approval timeout must be 100–180000 ms'),{code:'CORVID_INVALID_ARGUMENT'});
  if(signal?.aborted)return Promise.resolve({status:'denied',reason:'disconnected'});
  if(!context.validate())throw Object.assign(new Error('Room or page changed before approval was requested'),{code:'CORVID_CONTROL_LOST'});
  if(pendingAgentApprovals.size>=32)throw Object.assign(new Error('Too many Agent approval requests are pending'),{code:'CORVID_BUSY'});
  const record=windowRecords.get(context.windowId);
  if(!record || record.browserWindow.isDestroyed() || record.browserWindow.webContents.isDestroyed())throw Object.assign(new Error('No Corvid window is available to show this approval request'),{code:'CORVID_NOT_FOUND'});
  const id=`agent-approval-${++nextAgentApprovalId}`;
  const request={id,kind,clientName:context.clientName,room:{id:context.room.id,name:safeApprovalText(context.room.name,120)},page:{id:context.tab.id,label:context.pageLabel,title:context.pageTitle,source:context.pageSource},...(kind==='upload'?{files:files.map(file=>safeApprovalText([path.basename(path.dirname(file)),path.basename(file)].filter(Boolean).join(path.sep),255)),fileCount:files.length}:{summary:safeApprovalText(summary,1000),impact:safeApprovalText(impact,2000)}),expiresAt:Date.now()+timeoutMs};
  return new Promise(resolve=>{
    const pending={id,kind,roomId:context.room.id,tabId:context.tab.id,clientId:context.clientId,windowId:record.id,request,validate:context.validate,signal,resolve,timer:null,abortHandler:null};
    pending.timer=setTimeout(()=>settleAgentApproval(pending,false,'timeout',{notify:true}),timeoutMs);
    if(signal){pending.abortHandler=()=>settleAgentApproval(pending,false,'disconnected',{notify:true});signal.addEventListener('abort',pending.abortHandler,{once:true});}
    pendingAgentApprovals.set(id,pending);
    if(record.browserWindow.isMinimized())record.browserWindow.restore();
    if(!record.browserWindow.isVisible())record.browserWindow.show();
    record.browserWindow.focus();
    record.browserWindow.webContents.send('agent-approval-event',{type:'request',request});
  });
}
function pendingAgentApprovalsForWindow(windowId) {
  return [...pendingAgentApprovals.values()].filter(pending=>pending.windowId===windowId).map(pending=>pending.request);
}
function respondAgentApproval(id,approved,windowId) {
  if(typeof approved!=='boolean')throw Object.assign(new Error('Approval decision must be a boolean'),{code:'CORVID_INVALID_ARGUMENT'});
  const pending=pendingAgentApprovals.get(id);
  if(!pending || pending.windowId!==windowId)throw Object.assign(new Error('Approval request is no longer available'),{code:'CORVID_STALE_REFERENCE'});
  if(approved && !pending.validate()){
    settleAgentApproval(pending,false,'context_changed',{notify:true});
    return {ok:true,approved:false,status:'denied',reason:'context_changed'};
  }
  settleAgentApproval(pending,approved,approved?'approved':'user_denied');
  return {ok:true,approved,status:approved?'approved':'denied',reason:approved?'approved':'user_denied'};
}
function uploadAuthorizationError(reason) {
  if(reason==='timeout')return Object.assign(new Error('File selection approval timed out; no files were selected'),{code:'CORVID_TIMEOUT'});
  if(['control_lost','context_changed','page_changed','room_closed','authorization_revoked'].includes(reason))return Object.assign(new Error('Room or page changed before file selection was approved'),{code:'CORVID_CONTROL_LOST'});
  return Object.assign(new Error('File selection was not approved; no files were selected'),{code:'CORVID_USER_DENIED'});
}
function ensureUploadAuthorization(context,signal) {
  if(signal?.aborted)throw Object.assign(new Error('File selection request was cancelled'),{code:'CORVID_CANCELLED'});
  if(!context.validate())throw Object.assign(new Error('Room, page, or Agent authorization changed before file selection'),{code:'CORVID_CONTROL_LOST'});
}
// Pinned tabs form a prefix of tabIds: pinned first, then the rest in user order.
const tabPartition = room => ({pinned:room.tabIds.filter(id=>tabs.get(id)?.pinned),unpinned:room.tabIds.filter(id=>!tabs.get(id)?.pinned)});
const normalizeTabOrder = room => { const {pinned,unpinned}=tabPartition(room); room.tabIds=[...pinned,...unpinned]; };
const describe = (record = activeRecord(),includeExtensionToolbar=false) => {
  const scoped = record ? rooms.filter(s => s.windowId === record.id) : rooms;
  return {
    windowId: record?.id ?? null,
    windowCount: [...windowRecords.values()].filter(item => !item.browserWindow.isDestroyed()).length,
    fullscreen: Boolean(record?.appFullscreen),
    pageFullscreen: Boolean(record?.htmlFullscreen),
    fullscreenShortcut: process.platform === 'darwin' ? '⌃⌘F' : 'F11',
    glassChrome: process.platform === 'darwin',
    activeRoomId: record ? record.activeRoomId : activeRoomId,
    activeProfileId: record ? record.activeProfileId : activeProfileId,
    needsChromeImportOnboarding,
    onboarding:onboardingSnapshot(),
    ...(includeExtensionToolbar ? {uiLocale,themePreference} : {}),
    profiles,
    extensionToolbar: record&&includeExtensionToolbar ? extensionToolbarItems(record.activeProfileId) : [],
    rooms: scoped.map(s => ({ id:s.id, name:s.name, profileId:s.profileId,windowId:s.windowId,ownership:s.ownership,finished:Boolean(s.finished),yielded:Boolean(s.yielded),manualControl:Boolean(s.manualControl),userResumePending:Boolean(s.userResumePending),executionRisk:s.executionRisk || null,agentClientName:s.agentClientName || null,finishReport:s.finishReport || null, tabs:s.tabIds.map(id => { const t = tabs.get(id); return {id:t.id,label:t.label,openedBy:t.openedBy,openerId:t.openerId,ready:t.ready,domReady:t.domReady,loadComplete:t.loadComplete,isLoading:Boolean(t.isLoading),navigationError:t.navigationError || null,title:t.view.webContents.getTitle(),url:t.view.webContents.getURL() || 'about:blank',faviconUrl:t.faviconUrl || null,pinned:Boolean(t.pinned),active:s.activeTabId===id,dialog:pageDebugger.get(t.view.webContents)}; }) }))
  };
};
// The local control API speaks for the whole app: every Room is visible there,
// while `activeRoomId` keeps meaning "the focused window's room" so the SDK and
// existing contracts are unchanged.
const describeAll = () => {
  const focused = activeRecord();
  const scoped = describe(focused);
  return {
    ...scoped,
    activeRoomId: focused?.activeRoomId ?? null,
    activeProfileId: focused?.activeProfileId ?? activeProfileId,
    windows: [...windowRecords.values()].filter(record => !record.browserWindow.isDestroyed()).map(windowStateSnapshot),
    rooms: rooms.map(s => scoped.rooms.find(item => item.id === s.id) || describeRoom(s))
  };
};
function describeRoom(s) {
  return { id:s.id, name:s.name, profileId:s.profileId,windowId:s.windowId,ownership:s.ownership,finished:Boolean(s.finished),yielded:Boolean(s.yielded),manualControl:Boolean(s.manualControl),userResumePending:Boolean(s.userResumePending),executionRisk:s.executionRisk || null,agentClientName:s.agentClientName || null,finishReport:s.finishReport || null, tabs:s.tabIds.map(id => { const t = tabs.get(id); return {id:t.id,label:t.label,openedBy:t.openedBy,openerId:t.openerId,ready:t.ready,domReady:t.domReady,loadComplete:t.loadComplete,isLoading:Boolean(t.isLoading),navigationError:t.navigationError || null,title:t.view.webContents.getTitle(),url:t.view.webContents.getURL() || 'about:blank',faviconUrl:t.faviconUrl || null,pinned:Boolean(t.pinned),active:s.activeTabId===id,dialog:pageDebugger.get(t.view.webContents)}; }) };
}
function persist() {
  const state = {schemaVersion:SCHEMA_VERSION,activeRoomId,activeProfileId, windows:[...windowRecords.values()].filter(record=>!record.browserWindow.isDestroyed()).map(record=>({id:record.id,activeRoomId:record.activeRoomId,activeProfileId:record.activeProfileId})), rooms:rooms.map(s => ({...s, tabs:s.tabIds.map(id => {const t = tabs.get(id); return {id,label:t.label,openedBy:t.openedBy,pinned:Boolean(t.pinned),url:t.pendingNavigationUrl || (!t.ready && t.restoreUrl) || t.view.webContents.getURL() || 'about:blank'};})}))};
  fs.mkdirSync(dataDir,{recursive:true});
  const temp = `${dbPath}.tmp`; fs.writeFileSync(temp, JSON.stringify(state), {mode:0o600}); fs.renameSync(temp,dbPath);
}
function update(record = activeRecord()) {
  if (!record) return;
  if (record.browserWindow.isDestroyed()) return;
  // The focused window's record is the source of truth for the module-level
  // aliases, never the other way around: syncing aliases into the record here
  // would overwrite state the caller just changed.
  if (record.browserWindow === window) {
    panelOpen = record.panelOpen;
    frontView = record.frontView;
    activeRoomId = record.activeRoomId;
    activeProfileId = record.activeProfileId;
  }
  layout(record);
  for (const room of rooms) {
    if (room.windowId !== record.id) continue;
    const tab = tabs.get(room.activeTabId);
    if (tab?.homeSurfaceInstalled && !tab.view.webContents.isDestroyed()) {
      const bookmarks=room.ownership==='user'&&tab.openedBy==='user'?library.bookmarks(room.profileId).slice(0,8):[];
      tab.view.webContents.send('browser-home-state', {bookmarks,setup:homeSetupState()});
    }
  }
  record.browserWindow.webContents.send('shell-state', describe(record,true));
  syncApplicationMenu();
  if (!restoring) persist();
}
function notifyDownloads() {
  for (const record of windowRecords.values()) {
    if (record.browserWindow.isDestroyed()) continue;
    record.browserWindow.webContents.send('shell-state', describe(record,true));
  }
  if (!restoring) persist();
}
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
    if(room.ownership==='agent') {cancelAgentApprovals({roomId:room.id,reason:'control_lost'});for(const tabId of room.tabIds){agentDownloads.cancelTab(tabId);pageDebugger.cancelChooser(findTab(tabId).view.webContents).catch(()=>{});}room.ownership='user';room.yielded=true;room.manualControl=Boolean(room.userResumePending);update();}
    const requestedUrl=details.requestingUrl;
    const profile=findProfile(room.profileId);
    const permissionName=permissionDisplayName(permission,details.mediaTypes,mainMessages);
    const scope=mainMessages.t(rememberable.has(permission)?'permissionAllowedThisSession':'permissionCurrentRequestOnly');
    dialog.showMessageBox(window,{type:'question',buttons:[mainMessages.t('permissionRefuse'),mainMessages.t('permissionAllow')],defaultId:0,cancelId:0,title:mainMessages.t('sitePermissionTitle'),message:mainMessages.t('permissionRequestMessage',{origin,permission:permissionName}),detail:mainMessages.t('permissionRequestDetail',{profile:displayProfileName(profile),room:room.name,scope,deviceLimit:mainMessages.t('permissionDeviceLimit')})})
      .then(({response})=>{const allowed=response===1 && !contents.isDestroyed() && contents.getURL()===requestedUrl;if(allowed && rememberable.has(permission))grants.add(grantKey(origin,permission));callback(allowed);},()=>callback(false));
  });
  browserSession.on('will-download',(event,item,contents) => {
    const retryContext = !contents ? [...pendingDownloadRetries.values()].find(context => context.profileId===profileId && context.url===item.getURL()) : null;
    if (retryContext) {
      clearTimeout(retryContext.timer);
      pendingDownloadRetries.delete(retryContext.attemptId);
      retryContext.item=item;
    }
    const source=[...tabs.values()].find(tab=>tab.view.webContents===contents);
    if(source){const owner=findRoom(source.roomId);if(owner.ownership==='agent' && !owner.userResumePending && !owner.executionRisk){try{if(agentDownloads.capture(source.id,item))return;}catch(error){event.preventDefault();console.error('Agent download failed:',error.message);return;}}}
    const downloadId=retryContext?.attemptId || id(); const filename=path.basename(item.getFilename()) || 'download';
    if(retryContext) library.updateDownload(downloadId,{url:item.getURL(),filename,totalBytes:item.getTotalBytes()});
    else library.addDownload({id:downloadId,profileId,url:item.getURL(),filename,path:null,status:'progressing',receivedBytes:0,totalBytes:item.getTotalBytes(),createdAt:new Date().toISOString()});
    if(retryContext?.cancelRequested){event.preventDefault();library.updateDownload(downloadId,{status:'cancelled',finishedAt:new Date().toISOString()});activeDownloadRetries.delete(retryContext.sourceId);notifyDownloads();return;}
    let destination;
    try {
      const downloadDirectory=browserPreferences.downloadDirectory || (process.env.CORVID_TEST_MODE==='1'&&process.env.CORVID_TEST_DOWNLOAD_DIR) || app.getPath('downloads');
      if(browserPreferences.downloadDirectory){let available=false;try{available=fs.statSync(browserPreferences.downloadDirectory).isDirectory();}catch{}if(!available)throw new Error(uiLocale==='en'?'The saved download folder is unavailable. Choose another folder in Settings.':'已保存的下载文件夹不可用，请在设置中重新选择。');}
      if(process.env.CORVID_TEST_MODE==='1' && browserPreferences.askWhereToSave && process.env.CORVID_TEST_DOWNLOAD_DIALOG_RESULT!==undefined){
        const simulated=process.env.CORVID_TEST_DOWNLOAD_DIALOG_RESULT;
        destination=simulated==='cancel' ? undefined : simulated;
      }else if(process.env.CORVID_TEST_MODE==='1' && process.env.CORVID_TEST_DOWNLOAD_DIR){
        destination=path.join(downloadDirectory || process.env.CORVID_TEST_DOWNLOAD_DIR,filename);
      }else if(browserPreferences.askWhereToSave){
        destination=dialog.showSaveDialogSync(window,{title:uiLocale==='en'?'Save download':'保存下载',defaultPath:path.join(downloadDirectory,filename),properties:['createDirectory','showOverwriteConfirmation']});
      }else destination=path.join(downloadDirectory,filename);
      if (!destination) {event.preventDefault();library.updateDownload(downloadId,{status:'cancelled',finishedAt:new Date().toISOString()});if(retryContext)activeDownloadRetries.delete(retryContext.sourceId);notifyDownloads();return;}
      let exists=false;try {fs.lstatSync(destination);exists=true;} catch(error) {if(error.code!=='ENOENT') throw error;}
      if (exists) {event.preventDefault();library.updateDownload(downloadId,{status:'failed',path:destination,error:'目标文件已存在，未覆盖',finishedAt:new Date().toISOString()});if(retryContext)activeDownloadRetries.delete(retryContext.sourceId);notifyDownloads();return;}
      item.setSavePath(destination);library.updateDownload(downloadId,{path:destination});activeDownloads.set(downloadId,{item,profileId});
      if(retryContext?.cancelRequested) item.cancel();
    } catch(error) {event.preventDefault();library.updateDownload(downloadId,{status:'failed',error:error.message,finishedAt:new Date().toISOString()});if(retryContext)activeDownloadRetries.delete(retryContext.sourceId);notifyDownloads();return;}
    let lastUpdate=0;
    item.on('updated',(_event,state)=>{
      const now=Date.now(); if(now-lastUpdate<250 && state==='progressing') return;lastUpdate=now;
      library.updateDownload(downloadId,{receivedBytes:item.getReceivedBytes(),totalBytes:item.getTotalBytes()},false);notifyDownloads();
    });
    item.once('done',(_event,state)=>{
      activeDownloads.delete(downloadId);
      library.updateDownload(downloadId,{status:state,receivedBytes:item.getReceivedBytes(),totalBytes:item.getTotalBytes(),finishedAt:new Date().toISOString()});notifyDownloads();
      if(retryContext)activeDownloadRetries.delete(retryContext.sourceId);
    });
    notifyDownloads();
  });
}
function browserPageBounds(record) {
  const [width,height] = record.browserWindow.getContentSize();
  const top = record.browserChromeHeight ?? INITIAL_BROWSER_CHROME_HEIGHT;
  const dockStrip = record.dockStripHeight ?? 0;
  const workspaceWidth = record.panelOpen
    ? width > 720
      ? Math.min(420, Math.max(310, width - 332))
      : Math.min(420, Math.max(310, width - 330))
    : 0;
  const workspaceGap = workspaceWidth ? (width > 720 ? 12 : 10) : 0;
  return {x:0,y:top,width:Math.max(0,width-workspaceWidth-workspaceGap),height:Math.max(0,height-top-dockStrip)};
}
function layout(record = activeRecord()) {
  if (!record) return;
  const browserWindow = record.browserWindow;
  if (browserWindow.isDestroyed()) return;
  const roomId = record.activeRoomId;
  const room = rooms.find(item => item.id === roomId && item.windowId === record.id);
  const tab = room && tabs.get(room.activeTabId);
  const pageBounds = browserPageBounds(record);
  for (const item of tabs.values()) {
    // Every view is owned by exactly one window. Keep background pages visible
    // behind the selected page so trusted Agent input and screenshots keep a
    // live compositor; the active about:blank page paints Corvid's home UI.
    const owner = rooms.find(entry => entry.id === item.roomId);
    if (owner?.windowId !== record.id) continue;
    item.view.setBounds(pageBounds);
    item.view.setVisible(Boolean(tab) && !record.modalOpen);
  }
  if (tab && record.frontView !== tab.view) { browserWindow.contentView.removeChildView(tab.view); browserWindow.contentView.addChildView(tab.view); record.frontView = tab.view; if (browserWindow === window) frontView = tab.view; }
  if(record.actionIndicator && (!tab || record.actionIndicatorTabId!==tab.id || record.modalOpen))record.actionIndicator.hide();
}
function allocatePageLabel(room,requested) {
  if(requested!==undefined && (typeof requested!=='string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(requested)))throw new Error('Page label must start with a letter and contain letters, numbers, _ or -');
  let label=requested;if(label===undefined){do{label=`p${room.nextPageNumber++}`;}while(room.usedLabels.includes(label));}
  if(room.usedLabels.includes(label))throw new Error(`Page label already used: ${label}`);
  room.usedLabels.push(label);return label;
}
const findWindowRecord = windowId => { const record=windowRecords.get(windowId); if(!record || record.browserWindow.isDestroyed()) throw new Error('Window not found'); return record; };
// A Room lives in exactly one window. Moving it reparents every page view, since
// a WebContentsView can only be a child of one window's contentView at a time.
function moveRoomToWindow(room, record) {
  if (room.windowId === record.id) return;
  cancelAgentApprovals({roomId:room.id,reason:'context_changed'});
  const previous = windowRecords.get(room.windowId);
  for (const tabId of room.tabIds) {
    const tab = tabs.get(tabId);
    if (!tab) continue;
    if (previous && !previous.browserWindow.isDestroyed()) {
      try { previous.browserWindow.contentView.removeChildView(tab.view); } catch {}
      if (previous.frontView === tab.view) previous.frontView = null;
    }
    record.browserWindow.contentView.addChildView(tab.view);
    tab.view.setVisible(false);
  }
  room.windowId = record.id;
  record.frontView = null;
}
function roomsOfWindow(record) { return rooms.filter(room => room.windowId === record.id); }
function windowStateSnapshot(record) {
  return {id:record.id,activeRoomId:record.activeRoomId,activeProfileId:record.activeProfileId,fullscreen:Boolean(record.appFullscreen),pageFullscreen:Boolean(record.htmlFullscreen),roomIds:roomsOfWindow(record).map(room=>room.id)};
}
async function createTab(roomId, url = 'about:blank', tabId = id(), metadata = {}) {
  const s = findRoom(roomId);
  const partition=partitionFor(findProfile(s.profileId).id); await loadProfileExtensions(s.profileId); installDownloads(partition,s.profileId);
  const view = new WebContentsView({webPreferences:{partition,sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'page-preload.cjs')}});
  // 透明窗口（macOS vibrancy）下 WebContentsView 默认底色会变透明，页面未绘制区域会透出
  // 系统材质；显式固定为不透明白色，保持与不透明窗口一致。
  if (process.platform === 'darwin') view.setBackgroundColor('#ffffff');
  const openedBy=metadata.openedBy ?? 'unknown';
  const label=metadata.label ?? (openedBy==='agent' && !metadata.restored ? allocatePageLabel(s) : null);
  const tab = {id:tabId,roomId,view,label,openedBy,openerId:metadata.openerId ?? null,ready:false,domReady:false,loadComplete:false,isLoading:false,navigationError:null,restoreUrl:metadata.restored?url:null,restoringInitial:Boolean(metadata.restored),pinned:Boolean(metadata.pinned),popupSequence:0,popupEvents:[],homeSurfaceInstalled:false,homeInjection:null};
  const installHomeSurface=()=>{
    if(browserPreferences.newTabBehavior!=='home')return Promise.resolve();
    if(s.ownership!=='user'||openedBy!=='user')return Promise.resolve();
    if(tab.homeSurfaceInstalled)return Promise.resolve();
    if(tab.homeInjection)return tab.homeInjection;
    if(view.webContents.isDestroyed()||view.webContents.getURL()!=='about:blank')return Promise.resolve();
    // 起始页文案在注入时按当前 uiLocale 生成；注入后不随切换重绘（已打开的起始页保留旧语言）。
    const homeStrings=()=>({locale:mainMessages.locale,ariaLabel:mainMessages.t('newTabAriaLabel'),heading:mainMessages.t('newTabHeading'),intro:mainMessages.t('newTabIntro'),searchLabel:mainMessages.t('newTabSearchLabel'),searchAction:mainMessages.t('newTabSearchAction'),bookmarksTitle:mainMessages.t('newTabBookmarksTitle'),allBookmarks:mainMessages.t('newTabAllBookmarks'),bookmarksGroup:mainMessages.t('newTabBookmarksGroup'),emptyState:mainMessages.t('newTabEmptyState'),quickActions:mainMessages.t('newTabQuickActions'),historyAction:mainMessages.t('newTabHistoryAction'),agentAction:mainMessages.t('newTabAgentAction'),openBookmarkTemplate:mainMessages.t('newTabOpenBookmark'),siteFallbackName:mainMessages.t('newTabSiteFallbackName'),siteFallbackMark:mainMessages.t('newTabSiteFallbackMark'),setupTitle:mainMessages.t('newTabSetupTitle'),setupHint:mainMessages.t('newTabSetupHint'),setupItemImport:mainMessages.t('newTabSetupItemImport'),setupItemModel:mainMessages.t('newTabSetupItemModel'),setupItemAgent:mainMessages.t('newTabSetupItemAgent'),setupDismiss:mainMessages.t('newTabSetupDismiss'),setupContinue:mainMessages.t('newTabSetupContinue'),startTitle:mainMessages.t('newTabStartTitle'),startIntro:mainMessages.t('newTabStartIntro'),startPrompt1:mainMessages.t('newTabStartPrompt1'),startPrompt2:mainMessages.t('newTabStartPrompt2'),startPrompt3:mainMessages.t('newTabStartPrompt3'),startTryLabel:mainMessages.t('newTabStartTryLabel'),startShortcutsTitle:mainMessages.t('newTabStartShortcutsTitle'),startShortcutNewTab:mainMessages.t('newTabStartShortcutNewTab'),startShortcutFind:mainMessages.t('newTabStartShortcutFind'),startShortcutHistory:mainMessages.t('newTabStartShortcutHistory'),startDismiss:mainMessages.t('newTabStartDismiss')});
    tab.homeInjection=view.webContents.executeJavaScript(`(${installNewTabPage.toString()})(${JSON.stringify(tab.id)},${JSON.stringify(homeStrings())})`).then(()=>{if(view.webContents.getURL()==='about:blank'){tab.homeSurfaceInstalled=true;const owner=windowRecords.get(s.windowId);if(owner)update(owner);}}).finally(()=>{tab.homeInjection=null;});
    return tab.homeInjection;
  };
  // HTTP 4xx/5xx documents still navigate successfully; report their response status without replacing the page.
  view.webContents.on('did-navigate',(event,url,httpResponseCode)=>{
    tab.domReady=false;tab.loadComplete=false;tab.faviconUrl=null;
    if(Number.isInteger(httpResponseCode)&&httpResponseCode>=400){
      tab.navigationError={url,...navigationHttpStatusFailure(httpResponseCode,mainMessages),kind:'http-status'};
      changed();
    }
    clearPageFullscreen(windowRecords.get(s.windowId),tabId,describe);
  });
  // Keep HTML fullscreen ownership scoped to this tab; BrowserWindow events lack a tab identity.
  view.webContents.on('enter-html-full-screen',()=>{
    const owner=windowRecords.get(s.windowId);
    markPageFullscreen(owner,tabId,describe);
  });
  view.webContents.on('leave-html-full-screen',()=>clearPageFullscreen(windowRecords.get(s.windowId),tabId,describe));
  // A destroyed WebContents cannot provide getTitle(); closeTab publishes the shell state after removing this tab.
  view.webContents.once('destroyed',()=>clearPageFullscreen(windowRecords.get(s.windowId),tabId));
  view.webContents.on('dom-ready',()=>{tab.domReady=true;});
  view.webContents.on('did-finish-load',()=>{tab.domReady=true;tab.loadComplete=true;tab.isLoading=false;});
  view.webContents.on('will-prevent-unload',event=>{
    if(!tabs.has(tabId))return;
    if(s.ownership==='agent'){cancelAgentApprovals({roomId:s.id,reason:'control_lost'});for(const id of s.tabIds)agentDownloads.cancelTab(id);s.ownership='user';s.yielded=true;s.manualControl=true;update();}
    const choice=dialog.showMessageBoxSync(window,{type:'warning',buttons:[mainMessages.t('stayOnPage'),mainMessages.t('leavePage')],defaultId:0,cancelId:0,title:mainMessages.t('leavePageTitle'),message:mainMessages.t('unsavedChangesMessage'),detail:mainMessages.t('unsavedChangesDetail',{room:s.name})});
    tab.beforeUnloadAllowed=choice===1;if(tab.beforeUnloadAllowed)event.preventDefault();
  });
  view.webContents.on('context-menu',(_event,params)=>{
    const currentTab=tabs.get(tabId),currentRoom=currentTab&&rooms.find(room=>room.id===currentTab.roomId);
    const canUseTab=()=>Boolean(currentTab&&tabs.get(tabId)===currentTab&&!currentTab.view.webContents.isDestroyed()&&currentRoom&&rooms.includes(currentRoom)&&currentRoom.ownership==='user'&&!currentRoom.userResumePending&&!currentRoom.executionRisk);
    if(!canUseTab())return;
    const owner=windowRecords.get(currentRoom.windowId);
    if(!owner||owner.browserWindow.isDestroyed())return;
    const navigate=method=>{if(!canUseTab())return;void dispatchQueued(method,{id:tabId}).catch(error=>console.error('Page context menu navigation failed:',error.message));};
    const openLink=url=>{
      const target=safePageUrl(url);
      if(!target||!canUseTab())return;
      void createTab(currentRoom.id,target,id(),{openedBy:'user',openerId:tabId}).catch(error=>console.error('Page context menu could not open a tab:',error.message));
    };
    const template=createPageContextMenuTemplate({context:{...params,canGoBack:currentTab.view.webContents.navigationHistory.canGoBack(),canGoForward:currentTab.view.webContents.navigationHistory.canGoForward()},handlers:{back:()=>navigate('back'),forward:()=>navigate('forward'),reload:()=>navigate('reload'),openLink,copyText:value=>{if(canUseTab())clipboard.writeText(value);}},t:key=>mainMessages.t(key)});
    if(template.length)Menu.buildFromTemplate(template).popup({window:owner.browserWindow});
  });
  installShortcuts(view.webContents,()=>{const currentRoom=rooms.find(room=>room.id===s.id);return currentRoom&&windowRecords.get(currentRoom.windowId);});
  const owner=findWindowRecord(s.windowId);
  tabs.set(tabId,tab); s.tabIds.push(tabId); s.activeTabId = tabId; owner.browserWindow.contentView.addChildView(view); owner.frontView=null; view.setVisible(false);
  if(url!=='about:blank'||metadata.notifyInitialState) update(owner);
  const changed = () => { if (!quitting && tabs.has(tabId)) update(owner); };
  view.webContents.on('did-start-navigation',(_event,url,isInPlace,isMainFrame)=>{if(isMainFrame&&!isInPlace)cancelAgentApprovals({tabId,reason:'page_changed'});if(!isMainFrame||url==='about:blank')return;if(tab.navigationError&&url.startsWith('chrome-error://'))return;tab.isLoading=true;tab.navigationError=null;changed();});
  view.webContents.on('did-finish-load',()=>{if(view.webContents.getURL()==='about:blank'&&s.ownership==='user'&&openedBy==='user')void installHomeSurface().catch(error=>console.error('Corvid start page failed to load:',error.message));else{tab.homeSurfaceInstalled=false;changed();}});
  view.webContents.on('did-fail-load',(_event,errorCode,_errorDescription,validatedURL,isMainFrame)=>{
    if(!isMainFrame || errorCode===-3)return;
    const failure=navigationFailureDetails(errorCode,_errorDescription,mainMessages);
    tab.isLoading=false;tab.navigationError={url:validatedURL || tab.pendingNavigationUrl || view.webContents.getURL(),...failure};changed();
  });
  tab.bootstrap=(async()=>{
  // A newly created WebContents does not answer Page.enable until its first
  // document exists. Bind the debugger before navigating to the requested URL.
  startupProgress('tab-bootstrap-first-document');
  await view.webContents.loadURL('about:blank');
  startupProgress('tab-bootstrap-page-debugger');
  await pageDebugger.ensure(view.webContents,changed);
  startupProgress('tab-bootstrap-start-page');
  await installHomeSurface();
  view.webContents.on('page-title-updated',(_event,title) => { if (tab.visitId) library.title(tab.visitId,title); changed(); });
  view.webContents.on('page-favicon-updated',(_event,favicons) => { if (!Array.isArray(favicons) || !favicons.length) return; tab.faviconUrl=favicons[0]; changed(); });
  view.webContents.on('found-in-page',(_event,result) => { if (window && !window.isDestroyed()) window.webContents.send('shell-find-result',{tabId,...result}); });
  view.webContents.on('did-navigate',() => { if (window && !window.isDestroyed()) window.webContents.send('shell-find-reset',{tabId}); });
  const recordVisit = (_event,url) => { view.webContents.setZoomFactor(profileSettings(s.profileId).zoom);if (!restoring && !tab.restoringInitial) tab.visitId=library.visit(url,url,s.profileId)?.id; changed(); };
  view.webContents.on('did-navigate',recordVisit);
  view.webContents.on('did-navigate-in-page',(_event,url,isMainFrame) => { if(isMainFrame){cancelAgentApprovals({tabId,reason:'page_changed'});recordVisit(_event,url);} });
  view.webContents.setWindowOpenHandler(({url: popupUrl}) => {const popupId=id();tab.popupEvents.push({sequence:++tab.popupSequence,tabId:popupId});if(tab.popupEvents.length>128)tab.popupEvents.shift();createTab(roomId,popupUrl,popupId,{openerId:tabId}).catch(error=>console.error('Popup initialization failed:',error));return {action:'deny'};});
  })();
  tab.initialization=(async()=>{try {
  await tab.bootstrap;
  if(url!=='about:blank') await view.webContents.loadURL(url).catch(() => {});if(!tabs.has(tabId) || view.webContents.isDestroyed())throw new Error('Tab closed during initialization');tab.restoringInitial=false;view.webContents.setZoomFactor(profileSettings(s.profileId).zoom);tab.ready=true;update(); return describe().rooms.find(x => x.id===roomId).tabs.find(x => x.id===tabId);
  } catch(error) {if(tabs.has(tabId)){owner.browserWindow.contentView.removeChildView(view);tabs.delete(tabId);s.tabIds=s.tabIds.filter(value=>value!==tabId);if(s.activeTabId===tabId)s.activeTabId=s.tabIds[0] || null;if(!view.webContents.isDestroyed())view.webContents.close();update();}throw error;}})();
  if(metadata.restored){tab.initialization.catch(error=>console.error('Restored tab initialization failed:',error.message));await tab.bootstrap;return;}
  return tab.initialization;
}
async function createRoom(name, ownership = 'agent', profileId = 'default') {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Room name required');
  findProfile(profileId);
  const record=requireFocusedRecord();
  const previousRoom=record.activeRoomId,previousProfile=record.activeProfileId;
  const room = {id:id(),name:name.trim(),profileId,windowId:record.id,ownership,yielded:false,nextPageNumber:1,usedLabels:[],tabIds:[],activeTabId:null}; rooms.push(room); if (ownership === 'user') {record.activeProfileId=profileId;record.activeRoomId=room.id;} else if(!record.activeRoomId && record.activeProfileId===profileId) record.activeRoomId=room.id;
  // 新空间的初始标签是 about:blank，默认不推送；不显式 notify 的话，渲染层要等
  // bootstrap 完成才知道新空间存在，期间标签栏和页面视图仍是上一个空间的残留。
  try {await createTab(room.id,'about:blank',id(),{openedBy:ownership==='agent'?'agent':'user',notifyInitialState:true}); update(record); return describe(record).rooms.find(s => s.id === room.id);}
  catch(error) {rooms=rooms.filter(item=>item!==room);if(record.activeRoomId===room.id){record.activeRoomId=previousRoom;record.activeProfileId=previousProfile;}update(record);throw error;}
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
  cancelAgentApprovals({tabId,reason:'page_changed'});
  for(const record of windowRecords.values())record.actionIndicator?.hideTab(tabId);
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
  const owner=windowRecords.get(s.windowId);
  clearPageFullscreen(owner,tabId,describe);
  if(owner && !owner.browserWindow.isDestroyed()){owner.browserWindow.contentView.removeChildView(t.view);if(owner.frontView===t.view)owner.frontView=null;}
  tabs.delete(tabId);s.tabIds=s.tabIds.filter(x=>x!==tabId);
  if(s.activeTabId===tabId)s.activeTabId=s.tabIds[0] || null;update();
}
async function ensureUserRoomHasStartTab(room) {
  if(!rooms.includes(room) || room.ownership!=='user' || room.tabIds.length) return;
  await createTab(room.id,'about:blank',id(),{openedBy:'user'});
}
async function closeTabFromBrowserUi(tab) {
  const room=findRoom(tab.roomId);
  await runAction.releasePointer(tab.view.webContents);
  await closeTab(tab.id);
  await ensureUserRoomHasStartTab(room);
  return {closed:true};
}
async function closeRoom(roomId) {
  const s=findRoom(roomId);cancelAgentApprovals({roomId,reason:'room_closed'});clearActionIndicatorsForRoom(roomId);let count=0;
  for(const tabId of [...s.tabIds]){try{await closeTab(tabId);count++;}catch(error){if(count)throw new Error(`${error.message}；已有 ${count} 个标签关闭`);throw error;}}
  if(s.tabIds.length)throw new Error(`关闭期间出现新标签；已有 ${count} 个标签关闭，请检查剩余页面`);
  const owner=windowRecords.get(s.windowId);
  rooms=rooms.filter(x=>x.id!==roomId);
  if(owner && !owner.browserWindow.isDestroyed()){
    if(owner.activeRoomId===roomId){
      const next=roomsOfWindow(owner)[0] || rooms.find(room=>room.profileId===owner.activeProfileId) || null;
      owner.activeRoomId=next?.id ?? null;
      if(next && next.windowId!==owner.id) moveRoomToWindow(next,owner);
      if(next) owner.activeProfileId=next.profileId;
    }
    update(owner);
  } else update();
}
function asUrl(value,profileId) { if (typeof value !== 'string' || !value.trim()) throw new Error('URL required'); const input = value.trim(); if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return input; if (/^[^\s.]+(?:\.[^\s.]+)+(?::\d+)?(?:[/?#]|$)/.test(input) || /^localhost(?::\d+)?(?:[/?#]|$)/.test(input)) return `https://${input}`; return profileSettings(profileId).searchTemplate.replaceAll('{query}',encodeURIComponent(input)); }
async function ensureActionIndicator(record) {
  if(record.actionIndicator)return record.actionIndicator;
  const indicator=createActionIndicator(record.browserWindow,BrowserWindow);
  record.actionIndicator=indicator;
  try { await indicator.ready; }
  catch(error) { indicator.dispose();if(record.actionIndicator===indicator)record.actionIndicator=null;throw error; }
  return indicator;
}
function clearActionIndicatorsForRoom(roomId) {
  for(const record of windowRecords.values())record.actionIndicator?.hideRoom(roomId);
}
function installShortcuts(contents, getWindowRecord = activeRecord) {
  contents.on('before-input-event',(event,input)=>{
    if(input.type!=='keyDown') return;
    if(isFullscreenShortcut(input,process.platform)){
      event.preventDefault();
      const record=getWindowRecord();
      if(record&&!record.browserWindow.isDestroyed()&&!record.htmlFullscreen)requestWindowFullscreen(record,!isWindowFullscreenRequested(record));
      return;
    }
    const primary=process.platform==='darwin' ? input.meta : input.control;
    if(input.alt || (process.platform==='darwin' && input.control && primary) || (process.platform!=='darwin' && input.meta)) return;
    const key=input.key.toLowerCase(); const room=rooms.find(s=>s.id===activeRoomId),tab=room && tabs.get(room.activeTabId);
    const userControlsRoom=Boolean(room?.ownership==='user'&&!room.userResumePending&&!room.executionRisk);
    const cycle=input.control && !input.meta && key==='tab';let action;
    if(cycle && room?.tabIds.length){const index=room.tabIds.indexOf(room.activeTabId),step=input.shift?-1:1;action=()=>dispatchQueued('activateTab',{id:room.tabIds[(index+step+room.tabIds.length)%room.tabIds.length]});}
    else if(primary && key==='t' && !input.shift && userControlsRoom) action=()=>dispatchQueued('createTab',{id:room.id});
    else if(primary && key==='n' && !input.shift) action=()=>dispatchQueued('createWindow',{});
    else if(primary && key==='w' && !input.shift && userControlsRoom && tab) action=()=>dispatchQueued('closeTab',{id:tab.id});
    else if(primary && key==='l' && !input.shift && userControlsRoom) action=()=>{window.webContents.focus();void window.webContents.executeJavaScript("document.querySelector('#address').focus();document.querySelector('#address').select()");};
    else if(primary && key==='r' && !input.shift && userControlsRoom && tab) action=()=>dispatchQueued('reload',{id:tab.id});
    else if(primary && key==='p' && !input.shift && userControlsRoom && tab) action=()=>{window.webContents.focus();window.webContents.send('shell-print-page',{id:tab.id});};
    else if(primary && key==='f' && !input.shift && userControlsRoom) action=()=>{window.webContents.focus();window.webContents.send('shell-find-open');};
    else if(primary && key==='g' && !input.shift && userControlsRoom) action=()=>{window.webContents.focus();window.webContents.send('shell-find-next',{backward:false});};
    else if(primary && key==='g' && input.shift && userControlsRoom) action=()=>{window.webContents.focus();window.webContents.send('shell-find-next',{backward:true});};
    else if(primary && !input.shift && ['[',']'].includes(key) && userControlsRoom && tab) action=()=>dispatchQueued(key==='['?'back':'forward',{id:tab.id});
    else if(primary && !input.shift && /^[1-9]$/.test(key) && room?.tabIds.length) {const index=key==='9'?room.tabIds.length-1:Number(key)-1;const target=room.tabIds[index];if(target) action=()=>dispatchQueued('activateTab',{id:target});}
    else if(primary && userControlsRoom && ['+','=','-','0'].includes(key)) action=()=>{const current=profileSettings(activeProfileId).zoom;const zoom=key==='0'?1:Math.round(Math.min(3,Math.max(0.5,current+(key==='-'?-0.1:0.1)))*10)/10;saveSettings(activeProfileId,{zoom});applyZoom(activeProfileId);update();};
    if(action){event.preventDefault();Promise.resolve(action()).catch(error=>console.error('Shortcut failed:',error));}
  });
}
async function dispatch(method, args = {}, fromApi = false, requestContext = {}) {
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
    case 'state': return fromApi ? describeAll() : describe();
    case 'listAgentApprovals': {if(fromApi || !requestContext.windowId)throw Object.assign(new Error('Approval requests are available only in Corvid UI'),{code:'CORVID_FORBIDDEN'});return {requests:pendingAgentApprovalsForWindow(requestContext.windowId)};}
    case 'resolveAgentApproval': {if(fromApi || !requestContext.windowId)throw Object.assign(new Error('Approval requests can only be answered in Corvid UI'),{code:'CORVID_FORBIDDEN'});return respondAgentApproval(args.id,args.approved,requestContext.windowId);}
    case 'requestAgentApproval': {
      if(!fromApi || requestContext.principal?.kind!=='agent')throw Object.assign(new Error('Only an authorized external Agent can request action approval'),{code:'CORVID_FORBIDDEN'});
      const summary=safeApprovalText(args.summary,1000),impact=safeApprovalText(args.impact,2000);
      if(!summary || !impact || typeof args.tabId!=='string' || !args.tabId)throw Object.assign(new Error('A page, action summary, and impact description are required'),{code:'CORVID_INVALID_ARGUMENT'});
      const context=agentApprovalContext(target,args.tabId,requestContext.principal);
      const outcome=await promptAgentApproval({context,kind:'confirm-action',summary,impact,timeoutMs:args.timeoutMs ?? 30_000,signal:requestContext.signal});
      return {status:outcome.status,reason:outcome.reason};
    }
    case 'listAgentClients': { if(fromApi)throw new Error('授权客户端只能在 Corvid 界面管理');return {clients:agentClients.list()}; }
    case 'createAgentClient': { if(fromApi)throw new Error('授权客户端只能在 Corvid 界面管理');return createAgentClientGrant(args); }
    case 'revokeAgentClient': { if(fromApi)throw new Error('授权客户端只能在 Corvid 界面管理');const client=agentClients.revoke(args.id);if(!client)throw Object.assign(new Error('找不到此授权客户端'),{code:'CORVID_NOT_FOUND'});cancelAgentApprovals({clientId:client.id,reason:'authorization_revoked'});await pageDebugger.cancelChoosersForClient(client.id).catch(error=>console.error('Corvid could not cancel armed file choosers after revoke:',error.message));return {revoked:true,client}; }
    case 'copyTextToClipboard': { if(fromApi)throw new Error('剪贴板操作只能从 Corvid 界面发起');if(typeof args.text!=='string'||args.text.length>4096)throw Object.assign(new Error('剪贴板文本无效'),{code:'CORVID_INVALID_ARGUMENT'});clipboard.writeText(args.text);return {copied:true}; }
    case 'piTasks': return { tasks: agentWorkbench.list(args.profileId ?? activeProfileId) };
    case 'agentTaskSummaries': {if(fromApi)throw new Error('Agent task summaries are available only from Corvid UI');const profileId=findProfile(args.profileId ?? activeProfileId).id;return {profileId,tasks:agentWorkbench.listSummaries(profileId)};}
    case 'openPiAuthUrl': { if(fromApi) throw new Error('OAuth links can only be opened from Corvid UI'); const url=new URL(args.url); if(url.protocol!=='https:' || !['auth.openai.com','login.openai.com'].includes(url.hostname)) throw new Error('OAuth 地址无效'); return shell.openExternal(url.toString()); }
    case 'resolvePiAuthPrompt': { if(fromApi) throw new Error('Authentication prompts can only be answered in Corvid UI'); const pending=pendingPiAuthPrompts.get(args.id); if(!pending) throw new Error('账号授权请求已失效'); pendingPiAuthPrompts.delete(args.id); if(args.cancelled) pending.reject(new Error('用户取消了账号授权')); else pending.resolve(args.value); return {ok:true}; }
    case 'piModels': { if(fromApi) throw new Error('Model settings are available only from Corvid UI'); return piModelManager.list(); }
    case 'selectPiModel': { if(fromApi) throw new Error('Model settings are available only from Corvid UI'); return piModelManager.select(args); }
    case 'discoverPiEndpointModels': { if(fromApi) throw new Error('Model settings are available only from Corvid UI'); return piModelManager.discoverEndpointModels(args); }
    case 'savePiEndpoint': { if(fromApi) throw new Error('Model settings are available only from Corvid UI'); return piModelManager.saveEndpoint(args); }
    case 'removePiEndpoint': { if(fromApi) throw new Error('Model settings are available only from Corvid UI'); return piModelManager.removeEndpoint(args.id); }
    case 'loginPiProvider': { if(fromApi) throw new Error('Model login must be started by the user in Corvid UI'); return piModelManager.login(args.providerId); }
    case 'logoutPiProvider': { if(fromApi) throw new Error('Model logout must be started by the user in Corvid UI'); return piModelManager.logout(args.providerId); }
    case 'loginPiProviderApiKey': { if(fromApi) throw new Error('API Keys can only be managed from Corvid UI'); return piModelManager.loginApiKey(args.providerId, args.apiKey); }
    case 'preparePiTask': return agentWorkbench.prepare(args);
    case 'startPiTask': return agentWorkbench.start(args);
    case 'continuePiTask': return agentWorkbench.continueTask(args);
    case 'queuePiTaskMessage': return agentWorkbench.queueMessage(args);
    case 'updatePiTaskMessage': return agentWorkbench.updateQueuedMessage(args);
    case 'movePiTaskMessage': return agentWorkbench.moveQueuedMessage(args);
    case 'removePiTaskMessage': return agentWorkbench.removeQueuedMessage(args);
    case 'stopPiTask': return agentWorkbench.stop(args.taskId);
    case 'clearPiTask': return agentWorkbench.clear(args.taskId);
    case 'createPiRoom': {
      if(fromApi) throw new Error('User action required');
      const current=findTab(args.sourceTabId), sourceRoom=findRoom(current.roomId);
      if(sourceRoom.profileId!==activeProfileId || current.view.webContents.getURL()!==args.sourceUrl) throw new Error('当前页面已变化，请重新打开 Agent 工作台');
      const parsed=new URL(args.sourceUrl);
      if(!['http:','https:'].includes(parsed.protocol)) throw new Error('Agent 对话只支持从 HTTP 或 HTTPS 页面开始');
      const room=await createRoom(args.name || 'Corvid Agent 对话','agent',sourceRoom.profileId);
      try { await navigateAgent(findTab(room.tabs[0].id),parsed.href); return describe().rooms.find(item=>item.id===room.id); }
      catch(error) { await closeRoom(room.id).catch(()=>{}); throw error; }
    }
    case 'profiles': return {profiles};
    case 'previewProfileDeletion': {
      if(fromApi)throw new Error('浏览身份删除预览必须由用户在桌面查看');
      return profileDeletion.preview(args.id);
    }
    case 'deleteProfile': {
      if(fromApi)throw new Error('浏览身份删除必须由用户在桌面确认');
      const result=await profileDeletion.remove(args.id);
      for(const record of windowRecords.values())if(!record.browserWindow.isDestroyed())update(record);
      return result;
    }
    case 'settings': return {...profileSettings(args.profileId ?? activeProfileId), themePreference, browserPreferences:{...browserPreferences}};
    case 'setThemePreference': {
      if(fromApi) throw new Error('User action required');
      saveBrowserPreferences({theme:args.theme});
      for (const record of windowRecords.values()) update(record);
      return {themePreference};
    }
    case 'setBrowserPreferences': {
      if(fromApi)throw new Error('浏览器偏好只能在 Corvid 界面修改');
      const preferences=saveBrowserPreferences({startupBehavior:args.startupBehavior,newTabBehavior:args.newTabBehavior,downloadDirectory:args.downloadDirectory,askWhereToSave:args.askWhereToSave});
      for(const record of windowRecords.values())update(record);
      return preferences;
    }
    case 'chooseDownloadDirectory': {
      if(fromApi)throw new Error('下载文件夹只能在 Corvid 界面选择');
      if(process.env.CORVID_TEST_MODE==='1'&&process.env.CORVID_TEST_DOWNLOAD_DIR)return {canceled:false,path:process.env.CORVID_TEST_DOWNLOAD_DIR};
      const defaultPath=browserPreferences.downloadDirectory||app.getPath('downloads');
      const result=await dialog.showOpenDialog(window,{title:uiLocale==='en'?'Choose download folder':'选择下载文件夹',defaultPath,properties:['openDirectory','createDirectory']});
      if(result.canceled||!result.filePaths[0])return {canceled:true};
      return {canceled:false,path:result.filePaths[0]};
    }
    case 'finishChromeImportOnboarding': {
      if(fromApi)throw new Error('首次启动选择必须由用户在桌面操作');
      // completed=false 是欢迎框上的「稍后」/「先去设置」：欢迎框按完成收敛，但清单里导入项保持未完成。
      const importCompleted=args.completed!==false;
      if(firstRunOnboarding.steps.import!=='done'){firstRunOnboarding.steps.import=importCompleted?'done':'skipped';persistFirstRunOnboarding();}
      if(!needsChromeImportOnboarding){update();return {ok:true};}
      const temp=`${chromeImportOnboardingPath}.tmp`;
      fs.writeFileSync(temp,JSON.stringify({status:'completed',completedAt:new Date().toISOString()}),{mode:0o600});fs.renameSync(temp,chromeImportOnboardingPath);
      chromeImportOnboardingState='completed';needsChromeImportOnboarding=false;update();return {ok:true};
    }
    case 'completeOnboardingStep': {
      if(fromApi)throw new Error('首次引导状态只能由用户在桌面操作');
      if(!['model','agent'].includes(args.step))throw new Error('Unknown onboarding step');
      firstRunOnboarding.steps[args.step]='done';persistFirstRunOnboarding();update();return {ok:true};
    }
    case 'skipOnboardingStep': {
      if(fromApi)throw new Error('首次引导状态只能由用户在桌面操作');
      if(!['model','agent'].includes(args.step))throw new Error('Unknown onboarding step');
      firstRunOnboarding.steps[args.step]='skipped';persistFirstRunOnboarding();update();return {ok:true};
    }
    case 'dismissOnboardingSetup': {
      if(fromApi)throw new Error('首次引导状态只能由用户在桌面操作');
      firstRunOnboarding.setupDismissed=true;persistFirstRunOnboarding();update();return {ok:true};
    }
    case 'dismissOnboardingWelcome': {
      if(fromApi)throw new Error('首次引导状态只能由用户在桌面操作');
      firstRunOnboarding.welcomeDismissed=true;persistFirstRunOnboarding();update();return {ok:true};
    }
    case 'chooseChromeImportSource': {
      if(fromApi) throw new Error('Chrome 导入必须由用户在桌面操作');
      const suggested=defaultChromeUserDir();
      const result=await dialog.showOpenDialog(window,{title:mainMessages.t('chooseChromeDirectoryDialog'),defaultPath:fs.existsSync(suggested)?suggested:os.homedir(),properties:['openDirectory']});
      if(result.canceled || !result.filePaths[0]) return {canceled:true};
      const root=result.filePaths[0];
      try { const sources=chromeImport.profiles(root);if(!sources.length)throw new Error('所选目录中没有找到可导入的 Chrome Profile');const sourceToken=id();selectedChromeSources.set(sourceToken,root);return {canceled:false,sourceToken,sources}; }
      catch(error){throw error;}
    }
    case 'detectChromeImportSource': {
      // 主动探测标准安装路径：只读目录与 Local State 清单来预填来源；书签/历史等内容的读取仍以用户选择 Profile 为界，导入本身仍需明确确认。
      if(fromApi) throw new Error('Chrome 导入必须由用户在桌面操作');
      const suggested=defaultChromeUserDir();
      if(!fs.existsSync(suggested))return {available:false};
      try{
        const sources=chromeImport.profiles(suggested);
        if(!sources.length)return {available:false};
        const sourceToken=id();
        selectedChromeSources.set(sourceToken,suggested);
        return {available:true,path:suggested,sourceToken,sources};
      }catch{return {available:false};}
    }
    case 'releaseChromeImportSource': {
      if(typeof args.sourceToken==='string')selectedChromeSources.delete(args.sourceToken);
      return {released:true};
    }
    case 'previewChromeImport': {
      if(fromApi) throw new Error('Chrome 导入必须由用户在桌面操作');
      const selectedRoot=selectedChromeSources.get(args.sourceToken);
      if(!selectedRoot)throw new Error('Chrome 导入来源已失效，请重新选择目录');
      if(typeof args.sourceId!=='string')throw new Error('请选择 Chrome Profile');
      const sources=chromeImport.profiles(selectedRoot),source=sources.find(profile=>profile.id===args.sourceId);
      if(!source)throw new Error('Chrome Profile 已变化，请重新选择来源');
      const content=chromeImport.readProfilePreview(selectedRoot,args.sourceId);
      const extensions=chromeExtensions.discover(path.join(selectedRoot,args.sourceId)).map(({sourcePath,...extension})=>extension);
      return {sourceName:source.name,bookmarks:content.bookmarks.length,history:content.history.length,cookies:content.cookieCount,errors:content.errors,canImportCookies:process.platform==='darwin',extensions};
    }
    case 'importChromeData': {
      if(fromApi) throw new Error('Chrome 导入必须由用户在桌面操作');
      const selectedRoot=selectedChromeSources.get(args.sourceToken);
      if(!selectedRoot)throw new Error('Chrome 导入来源已失效，请重新选择目录');
      const profileId=findProfile(args.profileId ?? activeProfileId).id;
      if(!Array.isArray(args.categories) || !args.categories.length || args.categories.some(category=>!['bookmarks','history','cookies','extensions'].includes(category)))throw new Error('请选择可导入的资料类别');
      chromeImport.assertCookieConsent(args.categories,args.cookieConsent);
      const sources=chromeImport.profiles(selectedRoot);
      if(!sources.some(profile=>profile.id===args.sourceId))throw new Error('Chrome Profile 已变化，请重新选择来源');
      const content=chromeImport.readSelectedProfile(selectedRoot,args.sourceId,args.categories);
      const sourceExtensions=chromeExtensions.discover(path.join(selectedRoot,args.sourceId));
      const chosenExtensionIds=args.extensionIds;
      if(args.categories.includes('extensions')){
        if(!Array.isArray(chosenExtensionIds)||!chosenExtensionIds.length||chosenExtensionIds.length>50||chosenExtensionIds.some(extensionId=>typeof extensionId!=='string'))throw new Error('请选择要迁移的 Chrome 扩展');
        if(chosenExtensionIds.some(extensionId=>!sourceExtensions.some(extension=>extension.id===extensionId)))throw new Error('Chrome 扩展清单已变化，请重新预览');
      }else if(chosenExtensionIds!==undefined&&(!Array.isArray(chosenExtensionIds)||chosenExtensionIds.length))throw new Error('扩展 ID 只能与扩展导入类别一起提交');
      const destinationSession=session.fromPartition(partitionFor(profileId));
      const cookieResult={imported:0,skipped:0,unsupported:0,failed:0},addedCookies=[];
      const rollbackCookies=async()=>{
        const failures=[];
        for(const {cookie,previous} of [...addedCookies].reverse()){
          if(previous.length){failures.push('为保护目标 Profile 原有 Cookie，跳过无法按路径安全执行的删除回滚');continue;}
          try{
            if(failChromeCookieRemoveNameForTest===cookie.name){failChromeCookieRemoveNameForTest='';throw new Error('测试注入：Chrome Cookie 回滚删除失败');}
            await awaitChromeCookieStoreOperation(()=>destinationSession.cookies.remove(cookie.url,cookie.name));
          }catch(error){if(error?.code==='CORVID_COOKIE_PERSISTENCE_TIMEOUT')throw error;failures.push('删除本次新增 Cookie');}
        }
        if(addedCookies.length){try{await flushChromeCookies(destinationSession,{rollback:true});}catch{failures.push('持久化 Cookie 回滚结果');}}
        if(failures.length)throw new Error(`Chrome Cookie 导入失败后回滚未完整完成（${[...new Set(failures)].join('、')}）。为保护目标 Profile 原有 Cookie，本次跳过无法按路径安全执行的删除回滚；本次导入的 Cookie 可能仍保留在目标 Profile。请在当前对话框中重试；关闭对话框或重启 Corvid 后，请重新选择同一 Chrome 来源和目标 Profile，再次点击“导入”以补写持久化结果。`);
      };
      try{
        if(args.categories.includes('cookies')){
          const sourceCookies=await chromeImport.readCookies(path.join(selectedRoot,args.sourceId),{consent:args.cookieConsent});
          cookieResult.unsupported=sourceCookies.unsupported;
          for(const cookie of sourceCookies.cookies){
            const existing=await awaitChromeCookieStoreOperation(()=>destinationSession.cookies.get({url:cookie.url,name:cookie.name}));
            // Electron omits the leading dot for HostOnly cookies, while Chrome Domain cookies include it.
            const targetDomain=normalizeCookieDomain(cookie.sourceDomain);
            if(existing.some(item=>normalizeCookieDomain(item.domain)===targetDomain && item.path===cookie.path)){cookieResult.skipped++;continue;}
            const {sourceDomain,hostOnly,...cookieDetails}=cookie;
            if(!hostOnly)cookieDetails.domain=sourceDomain;
            try{
              if(failChromeCookieSetNameForTest===cookie.name){failChromeCookieSetNameForTest='';throw new Error('测试注入：Chrome Cookie 单项写入失败');}
              await awaitChromeCookieStoreOperation(()=>destinationSession.cookies.set(cookieDetails));addedCookies.push({cookie:cookieDetails,previous:existing});cookieResult.imported++;
            }catch(error){if(error?.code==='CORVID_COOKIE_PERSISTENCE_TIMEOUT')throw error;cookieResult.failed++;}
          }
          await flushChromeCookies(destinationSession);
          verifyChromeCookiesPersisted(destinationSession,addedCookies);
        }
        const libraryCategories=args.categories.filter(category=>category!=='extensions');
        const result=libraryCategories.length?library.importChromeData(content,profileId,libraryCategories):{bookmarks:{imported:0,skipped:0},history:{imported:0,skipped:0}};
        const extensions={imported:[],skipped:[],failed:[]};
        for(const extensionId of chosenExtensionIds||[]){
          const extension=sourceExtensions.find(item=>item.id===extensionId);
          if(managedExtensions.find(profileId,extensionId)){extensions.skipped.push(extension.name);continue;}
          let copied;
          try{
            copied=chromeExtensions.copyToCorvid(extension,dataDir,profileId);
            managedExtensions.add({profileId,id:extension.id,name:extension.name,version:extension.version,manifestVersion:extension.manifestVersion,permissions:extension.permissions,enabled:true,importedAt:new Date().toISOString()});
            await loadProfileExtensions(profileId);
            const loadError=extensionLoadErrors.get(`${profileId}:${extension.id}`);
            if(loadError)throw new Error(loadError);
            extensions.imported.push({id:extension.id,name:extension.name,version:extension.version});
          }catch(error){
            if(managedExtensions.find(profileId,extension.id))managedExtensions.remove(profileId,extension.id);
            if(copied?.created)fs.rmSync(copied.path,{recursive:true,force:true});
            extensions.failed.push({id:extension.id,name:extension.name,error:String(error?.message||error).slice(0,300)});
          }
        }
        if(!cookieResult.failed)selectedChromeSources.delete(args.sourceToken);
        return {...result,cookies:cookieResult,extensions,profileId};
      }catch(error){
        try{await rollbackCookies();}catch(rollbackError){const combined=new Error(`${error.message}；${rollbackError.message}`);combined.code=error.code||rollbackError.code;throw combined;}
        throw error;
      }
    }
    case 'listProfileExtensions': {
      if(fromApi)throw new Error('扩展清单必须由用户在桌面查看');
      const profileId=findProfile(args.profileId??activeProfileId).id;
      return {extensions:managedExtensions.list(profileId).map(item=>({...item,loadError:extensionLoadErrors.get(`${profileId}:${item.id}`)||null}))};
    }
    case 'openExtensionPopup': {
      if(fromApi)throw new Error('Extension popups can only be opened from Corvid UI');
      const record=requireFocusedRecord();return openExtensionPopup(record,args);
    }
    case 'setProfileExtensionEnabled': {
      if(fromApi)throw new Error('扩展管理必须由用户在桌面操作');
      const profileId=findProfile(args.profileId??activeProfileId).id,extension=managedExtensions.find(profileId,args.extensionId);
      if(!extension)throw new Error('Corvid 扩展不存在');
      const browserSession=session.fromPartition(partitionFor(profileId));
      if(args.enabled===true){
        managedExtensions.setEnabled(profileId,extension.id,true);
        await loadProfileExtensions(profileId);
        const loadError=extensionLoadErrors.get(`${profileId}:${extension.id}`);
        if(loadError){managedExtensions.setEnabled(profileId,extension.id,false);throw new Error(`扩展无法加载：${loadError}`);}
      }else if(args.enabled===false){
        closeExtensionPopupFor(profileId,extension.id);
        if(browserSession.extensions.getExtension(extension.id))browserSession.extensions.removeExtension(extension.id);
        managedExtensions.setEnabled(profileId,extension.id,false);
        extensionLoadErrors.delete(`${profileId}:${extension.id}`);
      }else throw new Error('扩展启用状态无效');
      update();return {id:extension.id,enabled:args.enabled};
    }
    case 'removeProfileExtension': {
      if(fromApi)throw new Error('扩展管理必须由用户在桌面操作');
      const profileId=findProfile(args.profileId??activeProfileId).id,extension=managedExtensions.find(profileId,args.extensionId);
      if(!extension)throw new Error('Corvid 扩展不存在');
      const browserSession=session.fromPartition(partitionFor(profileId));
      closeExtensionPopupFor(profileId,extension.id);
      if(browserSession.extensions.getExtension(extension.id))browserSession.extensions.removeExtension(extension.id);
      managedExtensions.remove(profileId,extension.id);
      fs.rmSync(chromeExtensions.managedPath(dataDir,profileId,extension.id,extension.version),{recursive:true,force:true});
      extensionLoadErrors.delete(`${profileId}:${extension.id}`);
      update();return {removed:true,id:extension.id};
    }
    case 'saveSettings': {const profileId=args.profileId ?? activeProfileId;findProfile(profileId);if(!validSearchTemplate(args.searchTemplate)) throw new Error('[[corvid-error:search-template-invalid]] 搜索模板必须是包含 {query} 的 HTTP(S) 地址');saveSettings(profileId,{searchTemplate:args.searchTemplate});update();return profileSettings(profileId);}
    case 'setUiLocale': {
      if(fromApi) throw new Error('User action required');
      if(!['zh-CN','en'].includes(args.locale)) throw Object.assign(new Error('Unsupported application language'),{code:'CORVID_INVALID_ARGUMENT'});
      saveUiLocale(args.locale);
      for(const record of windowRecords.values()) update(record);
      return {uiLocale};
    }
    case 'createProfile': {if(typeof args.name!=='string' || !args.name.trim()) throw new Error('[[corvid-error:profile-name-required]] 浏览身份名称不能为空');const name=args.name.trim();if(profiles.some(profile=>profile.deletionPending&&profile.name===name))throw Object.assign(new Error('同名浏览身份仍在清理中，请先重试清理'),{code:'CORVID_PROFILE_DELETING'});const profile={id:id(),name,isDefault:false};saveProfiles([...profiles,profile]);update();return profile;}
    case 'renameProfile': {if(fromApi)throw new Error('User action required');if(typeof args.name!=='string' || !args.name.trim())throw new Error('[[corvid-error:profile-name-required]] 浏览身份名称不能为空');findProfile(target);saveSettings(target,{name:args.name.trim()});update();return findProfile(target);}
    case 'closeRoomFromUser': {
      if(fromApi)throw new Error('User action required');
      const room=findRoom(target),tabIds=[...room.tabIds],ownership=room.ownership,profileId=room.profileId;
      const choice=await dialog.showMessageBox(window,{type:'warning',buttons:[mainMessages.t('cancelClose'),mainMessages.t('closeSpaceAction')],defaultId:0,cancelId:0,title:mainMessages.t('closeSpaceTitle'),message:mainMessages.t('closeSpaceMessage',{room:room.name}),detail:mainMessages.t('closeSpaceDetails',{tabs:mainMessages.plural('tabs',tabIds.length),ownership:mainMessages.t(ownership==='agent'?'agentOwnsSpace':'userOwnsSpace')})});
      if(choice.response!==1)return {closed:false};
      if(!rooms.includes(room) || room.ownership!==ownership || room.profileId!==profileId || room.userResumePending || room.tabIds.length!==tabIds.length || room.tabIds.some((id,index)=>id!==tabIds[index]))throw new Error('确认期间空间已改变，请重新操作');
      await dispatch('closeRoom',{id:room.id},false);return {closed:true};
    }
    case 'activateProfile': {findProfile(target);const record=requireFocusedRecord();closeExtensionPopup(record);record.activeProfileId=target;record.activeRoomId=rooms.find(s=>s.profileId===target && s.windowId===record.id)?.id || rooms.find(s=>s.profileId===target)?.id || null;const room=rooms.find(s=>s.id===record.activeRoomId);if(room && room.windowId!==record.id) moveRoomToWindow(room,record);update(record);return describe(record);}
    case 'history': return {history:library.history(findProfile(args.profileId ?? activeProfileId).id)};
    case 'historySuggestions': {if(fromApi)throw new Error('地址栏建议只能在 Corvid 界面读取');return {suggestions:library.historySuggestions(findProfile(args.profileId ?? activeProfileId).id,args.query)};}
    case 'bookmarks': return {bookmarks:library.bookmarks(findProfile(args.profileId ?? activeProfileId).id)};
    case 'downloads': return {downloads:library.downloads(findProfile(args.profileId ?? activeProfileId).id).map(item=>({...item,retrying:activeDownloadRetries.has(item.id)}))};
    case 'retryDownload': {
      if(fromApi)throw new Error('下载重试必须由用户在桌面操作');
      const source=library.downloads(activeProfileId).find(item=>item.id===target);
      if(!source)throw new Error('下载记录不属于当前浏览身份');
      if(!['failed','cancelled','interrupted'].includes(source.status))throw new Error('只有失败、已取消或已中断的下载可以重试');
      if(activeDownloadRetries.has(source.id))throw new Error('此下载已有重试正在进行');
      let url;try{url=new URL(source.url);}catch{throw new Error('下载地址无效，无法重试');}
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('仅允许重试安全的 HTTP 或 HTTPS 下载地址');
      const sameUrlPending=[...pendingDownloadRetries.values()].some(context=>context.profileId===activeProfileId&&context.url===source.url);
      if(sameUrlPending)throw new Error('相同下载地址的重试正在启动');
      const retryId=id(),browserSession=session.fromPartition(partitionFor(activeProfileId));
      installDownloads(partitionFor(activeProfileId),activeProfileId);
      const retry={id:retryId,profileId:activeProfileId,url:source.url,filename:source.filename,path:null,status:'progressing',receivedBytes:0,totalBytes:0,createdAt:new Date().toISOString(),retryOf:source.id};
      library.addDownload(retry);
      const context={attemptId:retryId,sourceId:source.id,profileId:activeProfileId,url:source.url,cancelRequested:false,timer:null};
      activeDownloadRetries.set(source.id,context);
      pendingDownloadRetries.set(retryId,context);
      context.timer=setTimeout(()=>{
        if(pendingDownloadRetries.get(retryId)!==context)return;
        pendingDownloadRetries.delete(retryId);activeDownloadRetries.delete(source.id);
        library.updateDownload(retryId,{status:context.cancelRequested?'cancelled':'failed',...(context.cancelRequested?{}:{error:'下载未能启动，请重试'}),finishedAt:new Date().toISOString()});notifyDownloads();
      },15000);
      context.timer.unref();
      try{browserSession.downloadURL(source.url);}
      catch(error){clearTimeout(context.timer);pendingDownloadRetries.delete(retryId);activeDownloadRetries.delete(source.id);library.updateDownload(retryId,{status:'failed',error:error.message,finishedAt:new Date().toISOString()});notifyDownloads();throw new Error(`无法启动下载重试：${error.message}`);}
      notifyDownloads();return {ok:true,id:retryId};
    }
    case 'cancelDownload': {
      if(fromApi)throw new Error('下载取消必须由用户在桌面操作');
      const download=activeDownloads.get(target);
      if(download&&download.profileId===activeProfileId){download.item.cancel();return {ok:true};}
      const pending=[...activeDownloadRetries.values()].find(context=>context.attemptId===target&&context.profileId===activeProfileId);
      if(!pending)throw new Error('下载不在进行中');
      pending.cancelRequested=true;return {ok:true};
    }
    case 'addBookmark': return library.addBookmark(args.url,args.title,findProfile(args.profileId ?? activeProfileId).id);
    case 'removeBookmark': return {removed:library.removeBookmark(target,findProfile(args.profileId ?? activeProfileId).id)};
    case 'removeHistory': return {removed:library.removeHistory(target,findProfile(args.profileId ?? activeProfileId).id)};
    case 'setPanel': {const record=requireFocusedRecord();record.panelOpen=Boolean(args.open&&args.workspace);panelOpen=record.panelOpen;layout(record);return {ok:true};}
    case 'toggleFullscreen': {
      if(fromApi)throw Object.assign(new Error('全屏只能由用户在 Corvid 界面切换'),{code:'CORVID_FORBIDDEN'});
      const record=requireFocusedRecord();
      return requestWindowFullscreen(record,!isWindowFullscreenRequested(record));
    }
    case 'setShellModal': {const record=requireFocusedRecord();record.modalOpen=Boolean(args.open);layout(record);return {ok:true};}
    case 'listWindows': return {windows:[...windowRecords.values()].filter(record=>!record.browserWindow.isDestroyed()).map(windowStateSnapshot),focusedWindowId:activeRecord()?.id ?? null};
    case 'createWindow': {
      if(fromApi) throw new Error('User action required');
      const record=await createWindowRecord();
      const profileId=args.profileId ?? activeRecord()?.activeProfileId ?? 'default';
      findProfile(profileId);
      const room=await createRoom(args.name || '新窗口的空间','user',profileId);
      record.activeRoomId=room.id; record.activeProfileId=profileId; update(record);
      return describeAll();
    }
    case 'closeWindow': {
      // Reachable from the window UI and from the local control API (a local
      // client is inside the same trust boundary); the last window is protected
      // inside closeWindowRecord.
      const record=findWindowRecord(target ?? activeRecord()?.id);
      await closeWindowRecord(record);
      return describeAll();
    }
    case 'reorderTabs': {
      if(fromApi) throw new Error('User action required');
      const room=findRoom(target), order=args.tabIds;
      if(!Array.isArray(order) || order.length!==room.tabIds.length) throw new Error('Tab order must list every tab in the room');
      if(new Set(order).size!==order.length || order.some(tabId=>!room.tabIds.includes(tabId))) throw new Error('Tab order is invalid');
      const pinnedIds=room.tabIds.filter(tabId=>findTab(tabId).pinned);
      if(order.slice(0,pinnedIds.length).some(tabId=>!findTab(tabId).pinned) || order.slice(pinnedIds.length).some(tabId=>findTab(tabId).pinned)) throw new Error('固定标签必须保持在固定分组内');
      room.tabIds=order; update(); return describe();
    }
    case 'setTabPinned': {
      if(fromApi) throw new Error('User action required');
      const tab=findTab(target), room=findRoom(tab.roomId), pinned=Boolean(args.pinned);
      if(tab.pinned===pinned) return describe();
      tab.pinned=pinned; normalizeTabOrder(room); update(); return describe();
    }
    case 'closeTabFromUser': {
      if(fromApi) throw new Error('User action required');
      const tab=findTab(target);
      if(tab.pinned){
        const title=tab.view.webContents.getTitle() || tab.view.webContents.getURL() || '固定标签';
        const choice=await dialog.showMessageBox(window,{type:'warning',buttons:[mainMessages.t('cancelClose'),mainMessages.t('closePinnedTabTitle')],defaultId:0,cancelId:0,title:mainMessages.t('closePinnedTabTitle'),message:mainMessages.t('closePinnedTabMessage',{title}),detail:mainMessages.t('closePinnedTabDetails')});
        if(choice.response!==1) return {closed:false};
        if(tabs.get(target)!==tab || !tab.pinned) throw new Error('确认期间标签已改变，请重新操作');
      }
      return closeTabFromBrowserUi(tab);
    }
    case 'closeOtherTabs': {
      if(fromApi) throw new Error('User action required');
      const keep=findTab(target), room=findRoom(keep.roomId);
      const closing=room.tabIds.filter(tabId=>tabId!==keep.id && !findTab(tabId).pinned);
      let count=0;
      for(const tabId of closing){
        agentDownloads.cancelTab(tabId);
        try { await runAction.releasePointer(findTab(tabId).view.webContents); await closeTab(tabId); count++; }
        catch(error) { throw new Error(`关闭其他标签时出错：${error.message}${count ? `；已有 ${count} 个标签关闭` : ''}`); }
      }
      return {closed:count,keptPinned:room.tabIds.length-closing.length};
    }
    case 'copyTabUrl': {
      if(fromApi) throw new Error('User action required');
      const tab=findTab(target),url=tab.navigationError?.url||tab.view.webContents.getURL();
      if(!url || url==='about:blank') throw new Error('当前标签页没有可复制的地址');
      clipboard.writeText(url);
      return {url};
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
    case 'createTab': return createTab(target,args.url || 'about:blank',id(),{openedBy:fromApi?'agent':'user',notifyInitialState:!fromApi});
    case 'adoptTab': {const s=findRoom(target),tab=findTab(args.tabId);if(tab.roomId!==s.id)throw new Error('Tab belongs to a different room');if(!tab.ready)throw new Error('Tab is still initializing');if(tab.label)throw new Error('Tab is already managed');tab.label=allocatePageLabel(s,args.as);update();return describe().rooms.find(item=>item.id===s.id).tabs.find(item=>item.id===tab.id);}
    case 'releasePage': {const s=findRoom(target),tab=s.tabIds.map(findTab).find(item=>item.label===args.label);if(!tab)throw new Error('Page label not found');if(tab.openedBy==='agent')throw new Error('Agent-created pages must be closed, not released');agentDownloads.cancelTab(tab.id);await pageDebugger.cancelChooser(tab.view.webContents);await runAction.releasePointer(tab.view.webContents);if(s.ownership!=='agent' || s.userResumePending || s.executionRisk)throw new Error('Room is no longer available for agent control');tab.label=null;update();return describe().rooms.find(item=>item.id===s.id).tabs.find(item=>item.id===tab.id);}
    case 'finishRoom': return finishRoom(findRoom(target),args.keep);
    case 'claimRoom': return claimRoom(findRoom(target));
    case 'activateRoom': {const s=findRoom(target);const record=requireFocusedRecord();if(s.windowId!==record.id) moveRoomToWindow(s,record);record.activeProfileId=s.profileId;record.activeRoomId=target;update(record);return describe(record);}
    case 'activateTab': {const t=findTab(target), s=findRoom(t.roomId); const record=requireFocusedRecord(); if(s.windowId!==record.id) moveRoomToWindow(s,record); record.activeProfileId=s.profileId;record.activeRoomId=s.id; s.activeTabId=target; update(record); return describe(record);}
    case 'yieldControl': {const s=findRoom(target);if(s.ownership!=='agent'){if(!fromApi && args.manual && s.yielded){s.manualControl=true;update();return describe();}throw new Error('Room is under user control');}cancelAgentApprovals({roomId:s.id,reason:'control_lost'});clearActionIndicatorsForRoom(s.id);for(const tabId of s.tabIds){agentDownloads.cancelTab(tabId);const contents=findTab(tabId).view.webContents;await pageDebugger.cancelChooser(contents);await runAction.releasePointer(contents);}s.ownership='user';s.yielded=true;s.manualControl=Boolean(args.manual);update();await agentWorkbench.pauseRoom(s.id);return describe();}
    case 'resumeControl': {const s=findRoom(target);if(!s.yielded) throw new Error('Room was not handed off by an agent');if(fromApi && s.manualControl)throw new Error('The user has not returned control');if(s.executionRisk)throw new Error('Room has an unresolved timed-out execution; user review is required');s.ownership='agent';s.yielded=false;s.manualControl=false;update();return describe();}
    case 'requestUserControl': return requestUserControl(target);
    case 'returnUserControl': {if(fromApi)throw new Error('User action required');return dispatch('resumeControl',{id:target},false);}
    case 'reviewExecutionRisk': {
      if(fromApi) throw new Error('User review is required');
      const s=findRoom(target);if(!s.executionRisk) return describe();
      if(s.ownership!=='user') {cancelAgentApprovals({roomId:s.id,reason:'control_lost'});s.ownership='user';s.yielded=true;s.manualControl=true;}
      update();
      const message=s.executionRisk.status==='unknown_after_restart' ? mainMessages.t('executionUnknownAfterRestart') : mainMessages.t('executionTimedOut');
      const choice=await dialog.showMessageBox(window,{type:'warning',buttons:[mainMessages.t('keepNotice'),mainMessages.t('understandAndContinue')],defaultId:0,cancelId:0,title:mainMessages.t('executionUnknownTitle'),message,detail:mainMessages.t('executionUnknownDetails')});
      if(choice.response===1) {s.executionRisk=null;update();}
      return describe();
    }
    case 'clearSiteData': {
      if(fromApi)throw new Error('User action required');
      const tab=findTab(target),room=findRoom(tab.roomId),profile=findProfile(room.profileId);
      let origin;try {const url=new URL(tab.view.webContents.getURL());if(!['http:','https:'].includes(url.protocol))throw new Error();origin=url.origin;}catch{throw new Error('当前页面不是可清理的 HTTP(S) 站点');}
      const affected=rooms.filter(item=>item.profileId===profile.id).length;
      const choice=await dialog.showMessageBox(window,{type:'warning',buttons:[mainMessages.t('cancelClose'),mainMessages.t('clearSiteDataAction')],defaultId:0,cancelId:0,title:mainMessages.t('clearSiteDataTitle'),message:mainMessages.t('clearSiteDataMessage',{origin}),detail:mainMessages.t('clearSiteDataDetails',{profile:displayProfileName(profile),spaces:affected})});
      if(choice.response!==1)return {cleared:false,origin};
      const current=tabs.get(target);let currentOrigin;try{currentOrigin=new URL(current?.view.webContents.getURL()).origin;}catch{}
      if(current!==tab || currentOrigin!==origin || findRoom(tab.roomId).profileId!==profile.id)throw new Error('确认期间页面或浏览身份已改变，请重新操作');
      await session.fromPartition(partitionFor(profile.id)).clearStorageData({origin,storages:['cookies','filesystem','indexdb','localstorage','serviceworkers','cachestorage']});
      return {cleared:true,origin};
    }
    case 'reviewSitePermissions': {
      if(fromApi)throw new Error('User action required');
      const tab=findTab(target),room=findRoom(tab.roomId),profile=findProfile(room.profileId);
      let origin;try {const url=new URL(tab.view.webContents.getURL());if(!['http:','https:'].includes(url.protocol))throw new Error();origin=url.origin;}catch{throw new Error('当前页面不是可管理权限的 HTTP(S) 站点');}
      const grants=permissionGrants.get(partitionFor(profile.id));if(!grants)throw new Error('浏览身份权限状态不可用');
      const allowed=[...grants].map(key=>JSON.parse(key)).filter(([site])=>site===origin).map(([,permission])=>permission);
      const allowedNames=allowed.map(permission=>permissionDisplayName(permission,[],mainMessages));
      const choice=await dialog.showMessageBox(window,{type:'question',buttons:[mainMessages.t('closeDialog'),mainMessages.t('revokePermissions')],defaultId:0,cancelId:0,title:mainMessages.t('sitePermissionsTitle'),message:mainMessages.t('permissionsGrantedMessage',{origin}),detail:mainMessages.t('permissionsDetails',{profile:displayProfileName(profile),permissions:allowedNames.length?mainMessages.formatList(allowedNames):mainMessages.t('noGrantedPermissions')})});
      if(choice.response!==1)return {revoked:false,origin};
      const current=tabs.get(target);let currentOrigin;try{currentOrigin=new URL(current?.view.webContents.getURL()).origin;}catch{}
      if(current!==tab || currentOrigin!==origin || findRoom(tab.roomId).profileId!==profile.id)throw new Error('确认期间页面或浏览身份已改变，请重新操作');
      for(const key of [...grants])if(JSON.parse(key)[0]===origin)grants.delete(key);
      return {revoked:true,origin};
    }
    case 'closeRoom': {const s=findRoom(target);for(const tabId of s.tabIds)await runAction.releasePointer(findTab(tabId).view.webContents);await closeRoom(target); return {ok:true};}
    case 'closeTab': {
      const tab=findTab(target);
      if(!fromApi) return closeTabFromBrowserUi(tab);
      await runAction.releasePointer(tab.view.webContents);await closeTab(target);return {ok:true};
    }
    case 'navigate': {const t=findTab(target),url=asUrl(args.url,findRoom(t.roomId).profileId);if(!fromApi){const sequence=t.userNavigation=(t.userNavigation || 0)+1;t.pendingNavigationUrl=url;t.navigationError=null;t.isLoading=true;t.restoringInitial=false;update();void (async()=>{await t.bootstrap;if(tabs.get(target)!==t || t.userNavigation!==sequence)return;await t.view.webContents.loadURL(url);if(tabs.get(target)===t && t.userNavigation===sequence){t.pendingNavigationUrl=null;update();}})().catch(error=>{if(tabs.get(target)===t && t.userNavigation===sequence){t.pendingNavigationUrl=null;t.isLoading=false;if(!navigationWasCancelled(error)&&!t.navigationError){const failure=navigationFailureDetails(error.errno,error.message,mainMessages);t.navigationError={url,...failure};}update();console.error('Navigation failed:',error.message);}});return {ok:true};}return navigateAgent(t,url);}
    case 'action': {
      const t=findTab(target);
      if(args.operation==='navigate') return navigateAgent(t,asUrl(args.args?.url,findRoom(t.roomId).profileId));
      if(args.operation==='evaluate') return evaluateWithDeadline(t,args.args || {});
      let preparedFileTarget,beforeFileSelection;
      if(fromApi && requestContext.principal?.kind==='agent' && args.operation==='setInputFiles' && Array.isArray(args.args?.files) && args.args.files.length){
        const fileIdentities=await runAction.validateFiles(args.args.files);
        preparedFileTarget=await runAction.prepareFileInput(t.view.webContents,args.args);
        const context=agentApprovalContext(t.roomId,t.id,requestContext.principal);
        const outcome=await promptAgentApproval({context,kind:'upload',files:args.args.files,signal:requestContext.signal});
        if(outcome.status!=='approved')throw uploadAuthorizationError(outcome.reason);
        await runAction.validateFiles(args.args.files,fileIdentities);
        ensureUploadAuthorization(context,requestContext.signal);
        beforeFileSelection=async()=>{
          ensureUploadAuthorization(context,requestContext.signal);
          await runAction.validateFiles(args.args.files,fileIdentities);
          ensureUploadAuthorization(context,requestContext.signal);
        };
      }
      const owner=findRoom(t.roomId),record=windowRecords.get(owner.windowId),activeRoom=rooms.find(room=>room.id===record?.activeRoomId),activeTab=activeRoom&&tabs.get(activeRoom.activeTabId);
      const homeIsForeground=Boolean(fromApi&&record&&!record.modalOpen&&!record.browserWindow.isDestroyed()&&record.browserWindow.isVisible()&&!record.browserWindow.isMinimized()&&activeTab&&activeTab.view!==t.view&&activeTab.view.webContents.getURL()==='about:blank'&&!activeTab.isLoading&&!activeTab.navigationError);
      const indicatorOperation=['click','hover','scroll','fill'].includes(args.operation);
      const canShowIndicator=Boolean(requestContext.showPageActionIndicator&&indicatorOperation&&record&&owner.ownership==='agent'&&!owner.userResumePending&&!owner.executionRisk&&owner.activeTabId===t.id&&record.activeRoomId===owner.id&&!record.modalOpen&&record.frontView===t.view&&!record.browserWindow.isDestroyed()&&record.browserWindow.isVisible()&&!record.browserWindow.isMinimized()&&record.browserWindow.isFocused());
      let indicator=null;
      if(canShowIndicator){try{indicator=await ensureActionIndicator(record);}catch(error){console.error('Corvid page action indicator failed to initialize:',error.message);}}
      const actionId=crypto.randomUUID();
      let indicatorShown=false;
      const onInput=({operation,point})=>{
        if(!indicator||!point||!tabs.has(t.id)||tabs.get(t.id)!==t||!rooms.includes(owner)||owner.ownership!=='agent'||owner.userResumePending||owner.executionRisk||owner.activeTabId!==t.id||record.activeRoomId!==owner.id||record.modalOpen||record.frontView!==t.view||record.browserWindow.isDestroyed()||!record.browserWindow.isVisible()||record.browserWindow.isMinimized()||!record.browserWindow.isFocused())return;
        const pageBounds=browserPageBounds(record),zoom=t.view.webContents.getZoomFactor(),actionLabel=mainMessages.t(`actionIndicator${operation[0].toUpperCase()}${operation.slice(1)}`);
        indicator.show({actionId,roomId:owner.id,tabId:t.id,operation,x:pageBounds.x+point.x*zoom,y:pageBounds.y+point.y*zoom,label:actionLabel,ariaLabel:mainMessages.t('actionIndicatorAriaLabel',{action:actionLabel})});
        record.actionIndicatorTabId=t.id;
        indicatorShown=true;
      };
      const beforePopup=t.popupSequence;
      let result;
      try { result=await runAction(t.view.webContents,args.operation,args.args,{allowHiddenPage:homeIsForeground,onInput,preparedFileTarget,beforeFileSelection}); }
      catch(error) { if(indicatorShown)indicator.hide();throw error; }
      if(indicatorShown)indicator.finish(actionId);
      const popups=(t.popupEvents||[]).filter(event=>event.sequence>beforePopup).map(event=>{const popup=tabs.get(event.tabId);return {sequence:event.sequence,tabId:event.tabId,status:popup?(popup.ready?'ready':'initializing'):'closed',...(popup?{label:popup.label,openedBy:popup.openedBy}:{})};});
      return {...result,receipt:{popups,dialog:pageDebugger.get(t.view.webContents) ?? null}};
    }
    case 'getDialog': {const contents=findTab(target).view.webContents;if(!pageDebugger.available(contents)) throw new Error('Page debugger is unavailable; dialog state is unknown');return {dialog:pageDebugger.get(contents)};}
    case 'getPopupEvents': {const tab=findTab(target);if(args.after===undefined)return {cursor:tab.popupSequence,event:null};const after=Number(args.after);if(!Number.isSafeInteger(after) || after<0 || after>tab.popupSequence)throw new Error('Invalid popup cursor');if(tab.popupEvents.length && after<tab.popupEvents[0].sequence-1)throw new Error('Popup event history expired');const event=tab.popupEvents.find(item=>item.sequence>after);if(!event)return {cursor:tab.popupSequence,event:null};const popup=tabs.get(event.tabId);return {cursor:tab.popupSequence,event:{...event,status:popup?(popup.ready?'ready':'initializing'):'closed',...(popup?{label:popup.label,openedBy:popup.openedBy}: {})}};}
    case 'armDownload': return agentDownloads.arm(target,args.timeoutMs);
    case 'getAgentDownload': return agentDownloads.info(target,args.downloadId);
    case 'cancelAgentDownload': agentDownloads.cancel(target,args.downloadId);return {ok:true};
    case 'deleteAgentDownload': agentDownloads.discard(target,args.downloadId);return {ok:true};
    case 'handleDialog': return pageDebugger.handle(findTab(target).view.webContents,args.accept,args.promptText);
    case 'armChooser': {const t=findTab(target),clientId=fromApi && requestContext.principal?.kind==='agent' ? requestContext.principal.client?.id ?? null : null,result=await pageDebugger.armChooser(t.view.webContents,args.timeoutMs,clientId);const s=findRoom(t.roomId);if(fromApi && (s.ownership!=='agent' || s.executionRisk)) {await pageDebugger.cancelChooser(t.view.webContents,result.id);throw new Error('Room is under user control or has unresolved execution');}return result;}
    case 'getChooser': return pageDebugger.getChooser(findTab(target).view.webContents,args.chooserId);
    case 'cancelChooser': return pageDebugger.cancelChooser(findTab(target).view.webContents,args.chooserId);
    case 'chooseFiles': {
      const t=findTab(target),s=findRoom(t.roomId),agentApproval=fromApi && requestContext.principal?.kind==='agent';
      try {
        if(!Array.isArray(args.files) || !args.files.length)throw new Error('Choose at least one file or cancel the chooser');
        const fileIdentities=await runAction.validateFiles(args.files);
        if(fromApi && (s.ownership!=='agent' || s.executionRisk))throw new Error('Room is under user control or has unresolved execution');
        let approvalContext=null;
        if(agentApproval){
          await pageDebugger.validateChooser(t.view.webContents,args.chooserId,args.files,{sameOriginOnly:true});
          approvalContext=agentApprovalContext(s.id,t.id,requestContext.principal);
          const outcome=await promptAgentApproval({context:approvalContext,kind:'upload',files:args.files,signal:requestContext.signal});
          if(outcome.status!=='approved')throw uploadAuthorizationError(outcome.reason);
          await runAction.validateFiles(args.files,fileIdentities);
          ensureUploadAuthorization(approvalContext,requestContext.signal);
        }
        const beforeSelection=approvalContext?async()=>{
          ensureUploadAuthorization(approvalContext,requestContext.signal);
          await runAction.validateFiles(args.files,fileIdentities);
          ensureUploadAuthorization(approvalContext,requestContext.signal);
        }:undefined;
        return await pageDebugger.chooseFiles(t.view.webContents,args.chooserId,args.files,beforeSelection,Boolean(approvalContext));
      } catch(error) {
        if(agentApproval)await pageDebugger.cancelChooser(t.view.webContents,args.chooserId).catch(()=>{});
        throw error;
      }
    }
    case 'back': {const c=findTab(target).view.webContents; if(c.navigationHistory.canGoBack()) c.navigationHistory.goBack(); return {ok:true};}
    case 'forward': {const c=findTab(target).view.webContents; if(c.navigationHistory.canGoForward()) c.navigationHistory.goForward(); return {ok:true};}
    case 'reload': findTab(target).view.webContents.reload(); return {ok:true};
    case 'printPage': {
      if(fromApi) throw new Error('打印只能由用户从 Corvid 界面发起');
      const tab=findTab(target),room=findRoom(tab.roomId),contents=tab.view.webContents;
      if(room.ownership!=='user') throw new Error('请先接管此空间，再打印页面');
      if(room.userResumePending) throw new Error('请等待接管完成后再打印页面');
      if(room.executionRisk) throw new Error('页面执行状态未知；完成复核后再打印');
      if(!tab.ready || contents.isDestroyed() || contents.isLoadingMainFrame()) throw new Error('页面尚未加载完成，请稍后再打印');
      return new Promise(resolve=>{
        try {
          contents.print({silent:false,printBackground:true},(success,failureReason)=>{
            if(success) resolve({ok:true});
            else if(/cancel/i.test(String(failureReason||''))) resolve({ok:false,cancelled:true});
            else resolve({ok:false,error:'打印失败，请检查打印机设置后重试。'});
          });
        } catch { resolve({ok:false,error:'无法打开打印设置，请稍后重试。'}); }
      });
    }
    default: throw new Error('Unknown action');
  }
}
async function claimRoom(room) {
  if(room.ownership!=='user')throw new Error('Only a user-controlled room can be claimed');
  if(room.executionRisk || room.userResumePending)throw new Error('Resolve the pending execution or resumeControl before claiming this room');
  const profile=findProfile(room.profileId),tabIds=[...room.tabIds];
  const choice=await dialog.showMessageBox(window,{type:'question',buttons:[mainMessages.t('permissionRefuse'),mainMessages.t('allowAgentToUseSpace')],defaultId:0,cancelId:0,title:mainMessages.t('claimSpaceTitle'),message:mainMessages.t('allowAgentToUseSpaceMessage',{room:room.name}),detail:mainMessages.t('allowAgentToUseSpaceDetails',{profile:displayProfileName(profile),tabs:mainMessages.plural('tabs',tabIds.length)})});
  if(choice.response!==1)throw new Error('User declined room claim');
  if(!rooms.includes(room) || room.ownership!=='user' || room.executionRisk || room.userResumePending || room.profileId!==profile.id || room.tabIds.length!==tabIds.length || room.tabIds.some((id,index)=>id!==tabIds[index]))throw new Error('Room changed while awaiting approval; request it again');
  room.ownership='agent';room.finished=false;room.yielded=false;room.manualControl=false;room.finishReport=null;update();
  return describe().rooms.find(item=>item.id===room.id);
}
async function finishRoom(room,keep) {
  cancelAgentApprovals({roomId:room.id,reason:'room_closed'});
  clearActionIndicatorsForRoom(room.id);
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
  room.ownership='user';room.finished=true;room.yielded=false;room.manualControl=false;
  room.finishReport={closed:closedManagedLabels,kept:keptManagedLabels,preserved:preservedUnmanagedCount,agent:room.agentClientName || null,at:new Date().toISOString()};
  update();
  return {roomId:room.id,closedRoom:false,keptManagedLabels,closedManagedLabels,preservedUnmanagedCount};
}
async function requestUserControl(roomId) {
  const room=findRoom(roomId);if(room.ownership!=='agent')throw new Error('Room is already under user control');
  if(room.userResumePending)throw new Error('User resumeControl is already pending');
  room.userResumePending=true;cancelAgentApprovals({roomId:room.id,reason:'control_lost'});clearActionIndicatorsForRoom(room.id);update();
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
function dispatchQueued(method,args={},fromApi=false,requestContext={}) {
  const roomMethods=['createTab','closeRoom','closeRoomFromUser','activateRoom','yieldControl','resumeControl','returnUserControl','adoptTab','releasePage','finishRoom','claimRoom'];
  const tabMethods=['closeTab','activateTab','navigate','back','forward','reload','action','armDownload'];
  let roomId;
  try { if(roomMethods.includes(method)) roomId=findRoom(args.id).id; else if(tabMethods.includes(method)) roomId=findRoom(findTab(args.id).roomId).id; }
  catch(error) { return Promise.reject(error); }
  if(roomId && ['yieldControl','finishRoom','closeRoom','closeRoomFromUser'].includes(method))cancelAgentApprovals({roomId,reason:method==='yieldControl'?'control_lost':'room_closed'});
  if(['closeTab','navigate','back','forward','reload'].includes(method) || method==='action'&&args.operation==='navigate')cancelAgentApprovals({tabId:args.id,reason:'page_changed'});
  if(method==='releasePage' && roomId){const tab=findRoom(roomId).tabIds.map(findTab).find(item=>item.label===args.label);if(tab)cancelAgentApprovals({tabId:tab.id,reason:'page_changed'});}
  if(fromApi && roomId && findRoom(roomId).userResumePending) return Promise.reject(new Error('User resumeControl is pending'));
  if (!roomId) return dispatch(method,args,fromApi,requestContext);
  const previous=queues.get(roomId) || Promise.resolve();
  const pending=previous.catch(()=>{}).then(()=>dispatch(method,args,fromApi,requestContext));
  queues.set(roomId,pending); pending.finally(()=>{if(queues.get(roomId)===pending) queues.delete(roomId);}).catch(()=>{});
  return pending;
}
function apiRoute(req, url) {
  const pieces = url.pathname.split('/').filter(Boolean), [kind, target, action] = pieces;
  if (req.method==='GET' && url.pathname==='/health') return ['health',{}];
  if (kind==='agent-clients' && !target && req.method==='GET') return ['listAgentClients',{}];
  if (kind==='agent-clients' && !target && req.method==='POST') return ['createAgentClient',{}];
  if (kind==='agent-clients' && target && req.method==='DELETE' && !action) return ['revokeAgentClient',{clientId:target}];
  if (kind==='rooms' && target && !action && req.method==='GET') return ['roomDetails',{id:target}];
  if (req.method==='POST' && url.pathname==='/shutdown' && process.env.CORVID_TEST_MODE==='1') return ['shutdown',{}];
  if (req.method==='POST' && url.pathname==='/test/shortcuts' && process.env.CORVID_TEST_MODE==='1') return ['sendTestShortcut',{}];
  if (req.method==='GET' && url.pathname==='/rooms') return ['state',{}];
  if (req.method==='GET' && url.pathname==='/windows') return ['listWindows',{}];
  if (kind==='windows' && target && req.method==='DELETE' && !action) return ['closeWindow',{id:target}];
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
  if (kind==='rooms' && target && action==='confirm-action' && req.method==='POST') return ['requestAgentApproval',{id:target}];
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
  startupProgress('control-server-listen');
  server=http.createServer(async (req,res) => {
    res.setHeader('Content-Type','application/json');
    const requestAbortController=new AbortController();
    req.once('aborted',()=>requestAbortController.abort());
    res.once('close',()=>{if(!res.writableEnded)requestAbortController.abort();});
    try {
      const credential=String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
      const agentClient=credential && credential!==token ? agentClients.findByToken(credential) : null;
      const principal=credential && credential===token ? {kind:'admin'} : agentClient ? {kind:'agent',client:agentClient} : null;
      if(!principal){res.writeHead(401);res.end(JSON.stringify({error:'Unauthorized',code:'CORVID_UNAUTHORIZED'}));return;}
      const url=new URL(req.url,'http://localhost');
      const [method,routeArgs]=apiRoute(req,url); if (!method) {res.writeHead(404); res.end(JSON.stringify({error:'Not found',code:'CORVID_NOT_FOUND'})); return;}
      if(principal.kind==='agent'){
        let roomId=null;
        const pieces=url.pathname.split('/').filter(Boolean);
        if(pieces[0]==='rooms'&&pieces[1]&&pieces[1]!=='open') roomId=pieces[1];
        else if(pieces[0]==='tabs'&&pieces[1]) {try{roomId=findTab(pieces[1]).roomId;}catch{}}
        // 外部 Agent 客户端在空间内的动作留下其身份，供标签栏命名分组与状态标记展示（内置 Agent 除外）。
        if(roomId && !String(principal.client.id||'').startsWith('builtin:')) {
          const actingRoom=rooms.find(room=>room.id===roomId);
          if(actingRoom && actingRoom.ownership==='agent') actingRoom.agentClientName ??= principal.client.name;
        }
        const permittedMethods=new Set(['state','profiles','roomDetails','resolveRoom','requestAgentApproval','createTab','activateRoom','yieldControl','resumeControl','adoptTab','releasePage','finishRoom','claimRoom','closeRoom','closeTab','activateTab','navigate','back','forward','reload','action','getDialog','handleDialog','armChooser','getChooser','chooseFiles','cancelChooser','getPopupEvents','armDownload','getAgentDownload','cancelAgentDownload','deleteAgentDownload']);
        if(!permittedMethods.has(method)||!roomId&&!['state','profiles','resolveRoom'].includes(method)||roomId&&!principal.client.roomIds.includes(roomId)){
          res.writeHead(403);res.end(JSON.stringify({error:'该 Agent 客户端无权访问此资源',code:'CORVID_FORBIDDEN'}));return;
        }
      }
      let raw=''; for await (const chunk of req) {raw+=chunk; if(raw.length>65536) throw new Error('Request too large');}
      const body=raw ? JSON.parse(raw) : {};
      let result;
      if(method==='health') result={ok:true};
      else if(method==='listAgentClients') {if(principal.kind!=='admin')throw Object.assign(new Error('需要管理员授权'),{status:403,code:'CORVID_FORBIDDEN'});result={clients:agentClients.list()};}
      else if(method==='createAgentClient') {if(principal.kind!=='admin')throw Object.assign(new Error('需要管理员授权'),{status:403,code:'CORVID_FORBIDDEN'});result=createAgentClientGrant(body);}
      else if(method==='revokeAgentClient') {if(principal.kind!=='admin')throw Object.assign(new Error('需要管理员授权'),{status:403,code:'CORVID_FORBIDDEN'});const client=agentClients.revoke(routeArgs.clientId);if(!client)throw Object.assign(new Error('Agent 授权不存在'),{status:404,code:'CORVID_NOT_FOUND'});cancelAgentApprovals({clientId:client.id,reason:'authorization_revoked'});await pageDebugger.cancelChoosersForClient(client.id).catch(error=>console.error('Corvid could not cancel armed file choosers after revoke:',error.message));result={revoked:true,client};}
      else if(method==='roomDetails') result=describeRoom(findRoom(routeArgs.id));
      else if(method==='state'&&principal.kind==='agent') result={rooms:describeAll().rooms.filter(room=>principal.client.roomIds.includes(room.id))};
      else if(method==='profiles'&&principal.kind==='agent') {const allowedProfileIds=new Set(rooms.filter(room=>principal.client.roomIds.includes(room.id)).map(room=>room.profileId));result={profiles:profiles.filter(profile=>allowedProfileIds.has(profile.id))};}
      else if(method==='resolveRoom') {
        // A scoped Agent client may open Rooms it creates itself; Rooms owned by
        // someone else (including another Agent client) stay out of reach. A Room
        // whose name/ID already exists outside the grant is refused (403) instead
        // of silently creating a duplicate-name Room. Profile selection is part
        // of the grant: agents may only target Profiles visible through their
        // granted Rooms (or the default Profile when their grant is empty).
        if(principal.kind==='agent'){
          const key=typeof body.identifier==='string'?body.identifier.trim():'';
          const candidates=key?rooms.filter(room=>room.id===key):[];
          const target=(candidates.length?candidates:rooms.filter(room=>room.name===key))[0];
          if(target && !principal.client.roomIds.includes(target.id))throw Object.assign(new Error('该 Agent 客户端无权访问此空间'),{status:403,code:'CORVID_FORBIDDEN'});
          if(body.profileId!==undefined){
            const allowedProfileIds=new Set(rooms.filter(room=>principal.client.roomIds.includes(room.id)).map(room=>room.profileId));
            allowedProfileIds.add('default');
            if(!allowedProfileIds.has(body.profileId))throw Object.assign(new Error('该 Agent 客户端无权在此浏览身份中创建空间'),{status:403,code:'CORVID_FORBIDDEN'});
          }
        }
        result=await resolveRoom(body.identifier,body.profileId);
        if(principal.kind==='agent' && result && result.id) {
          agentClients.grantRooms(principal.client.id,[result.id]);
          principal.client.roomIds.push(result.id);
          const openedRoom=rooms.find(room=>room.id===result.id);
          if(openedRoom && !String(principal.client.id||'').startsWith('builtin:')) openedRoom.agentClientName ??= principal.client.name;
        }
      }
      else if(method==='shutdown') result={ok:true};
      else if(method==='sendTestShortcut') {
        if(principal.kind!=='admin') throw Object.assign(new Error('测试快捷键需要管理员授权'),{status:403,code:'CORVID_FORBIDDEN'});
        const keys=new Map([['t','T'],['l','L'],['[','['],[']',']'],['r','R'],['Tab','TAB'],['2','2'],['=','='],['0','0'],['w','W']]);
        const [modifier,...keyParts]=String(body.combination||'').split('+');
        const key=keyParts.join('+');
        const allowedModifier=modifier==='Control'||(modifier==='Meta'&&process.platform==='darwin');
        if(!allowedModifier||!keys.has(key)) throw Object.assign(new Error('Unsupported test shortcut'),{status:400,code:'CORVID_INVALID_ARGUMENT'});
        const shortcut={keyCode:keys.get(key),modifiers:[modifier.toLowerCase()]};
        const record=activeRecord();
        if(!record||record.browserWindow.isDestroyed()) throw Object.assign(new Error('No active Corvid window'),{status:409,code:'CORVID_NOT_FOUND'});
        record.browserWindow.webContents.sendInputEvent({type:'keyDown',...shortcut});
        record.browserWindow.webContents.sendInputEvent({type:'keyUp',...shortcut});
        result={sent:true};
      }
      else result=await dispatchQueued(method,{...body,...routeArgs},true,{showPageActionIndicator:principal.kind==='admin'||!String(principal.client?.id||'').startsWith('builtin:'),principal:{kind:principal.kind,...(principal.client?{client:{id:principal.client.id,name:principal.client.name}}:{})},signal:requestAbortController.signal});
      if(!res.destroyed)res.end(JSON.stringify(result));
      if(method==='shutdown') setImmediate(()=>app.quit());
    } catch (error) {if(!res.destroyed){res.writeHead(error.status||400);res.end(JSON.stringify({error:error.message,code:error.code||errorCode(error.message)}));}}
  });
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(Number(process.env.CORVID_PORT || 0),'127.0.0.1',resolve);});
  const connection={baseUrl:`http://127.0.0.1:${server.address().port}`,token};
  fs.writeFileSync(connectionPath,JSON.stringify(connection),{mode:0o600}); fs.chmodSync(connectionPath,0o600);
  startupProgress('control-file-written');
}
async function createWindowRecord(bounds = {width:1280,height:850},recordId = id()) {
  bounds={x:bounds.x??0,y:bounds.y??0,...bounds};
  const area=screen.getDisplayMatching(bounds).workArea;
  // The Agent panel's scrollable list may reserve a 15px scrollbar. Keep the
  // minimum window wide enough for 320px of web content plus 280px of panel
  // content after that platform-dependent gutter is accounted for.
  const minimumWidth=Math.min(MIN_WINDOW_WIDTH,area.width),minimumHeight=Math.min(MIN_WINDOW_HEIGHT,area.height);
  const width=Math.min(area.width,Math.max(bounds.width,minimumWidth));
  const height=Math.min(area.height,Math.max(bounds.height,minimumHeight));
  const fittedBounds={...bounds,width,height,x:Math.min(Math.max(bounds.x,area.x),area.x+area.width-width),y:Math.min(Math.max(bounds.y,area.y),area.y+area.height-height)};
  // macOS 用原生 vibrancy 承载下缘 dock 的真实毛玻璃；页面画布由 WebContentsView 覆盖，
  // 只有 dock 条带透出系统材质。其他平台退回不透明底色。
  const glassChrome = process.platform === 'darwin';
  // transparent:true 会禁用 macOS vibrancy（Electron 已知行为），只用带 alpha 的
  // backgroundColor 即可让窗口底色透出系统材质。
  const browserWindow = new BrowserWindow({...fittedBounds,title:'Corvid',...(glassChrome?{vibrancy:'under-window',backgroundColor:'#00000000'}:{autoHideMenuBar:true}),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  browserWindow.setMinimumSize(minimumWidth,minimumHeight);
  const record = {id:recordId,browserWindow,browserChromeHeight:INITIAL_BROWSER_CHROME_HEIGHT,dockStripHeight:0,panelOpen:false,modalOpen:false,frontView:null,activeRoomId:null,activeProfileId:activeProfileId || 'default',extensionPopup:null,actionIndicator:null,actionIndicatorTabId:null,appFullscreen:false,htmlFullscreen:false,htmlFullscreenTabId:null,fullscreenTransitionTarget:null,fullscreenRestoreMaximized:null,fullscreenRestoreBounds:null,normalBounds:{...browserWindow.getNormalBounds()},lastKnownMaximized:false,closing:false};
  windowRecords.set(recordId,record);
  rebuildApplicationMenu();
  focusWindow(record);
  const settleRestoredMaximizedState=()=>{
    if(!isTransientFullscreen(record)&&record.fullscreenRestoreMaximized===true&&!browserWindow.isDestroyed()&&browserWindow.isMaximized())record.fullscreenRestoreMaximized=null;
  };
  let normalBoundsTimer;
  const scheduleNormalBoundsSnapshot=()=>{
    clearTimeout(normalBoundsTimer);
    normalBoundsTimer=setTimeout(()=>{
      normalBoundsTimer=null;
      if(browserWindow.isDestroyed()||isTransientFullscreen(record)||browserWindow.isMaximized()||record.lastKnownMaximized)return;
      record.normalBounds={...browserWindow.getNormalBounds()};
    },500);
  };
  const clearRestoredBoundsAfterGeometryChange=()=>{
    if(!isTransientFullscreen(record)&&record.fullscreenRestoreMaximized!==true&&!browserWindow.isMaximized()&&!record.lastKnownMaximized)record.fullscreenRestoreBounds=null;
  };
  browserWindow.on('resize',()=>{closeExtensionPopup(record);if(!isTransientFullscreen(record)){if(!browserWindow.isMaximized()&&!record.lastKnownMaximized)scheduleNormalBoundsSnapshot();settleRestoredMaximizedState();clearRestoredBoundsAfterGeometryChange();scheduleWindowStateSave();}layout(record);});
  browserWindow.on('move',()=>{if(!isTransientFullscreen(record)){if(!browserWindow.isMaximized()&&!record.lastKnownMaximized)scheduleNormalBoundsSnapshot();settleRestoredMaximizedState();clearRestoredBoundsAfterGeometryChange();scheduleWindowStateSave();}});
  browserWindow.on('maximize',()=>{clearTimeout(normalBoundsTimer);normalBoundsTimer=null;if(!isTransientFullscreen(record)){record.lastKnownMaximized=true;clearTimeout(record.fullscreenRestoreSettleTimer);if(record.fullscreenRestoreMaximized===true)record.fullscreenRestoreMaximized=null;}});
  browserWindow.on('unmaximize',()=>{if(!isTransientFullscreen(record)){if(record.fullscreenRestoreMaximized===true){record.lastKnownMaximized=true;}else{record.lastKnownMaximized=false;record.fullscreenRestoreBounds=null;}scheduleNormalBoundsSnapshot();scheduleWindowStateSave();}});
  // macOS transitions are asynchronous; if the user reverses direction during
  // the animation, replay the latest target instead of trusting a stale event.
  browserWindow.on('enter-full-screen',()=>{
    if(record.closing)return;
    snapshotFullscreenRestoreState(record);
    record.appFullscreen=true;
    if(record.fullscreenTransitionTarget===true)record.fullscreenTransitionTarget=null;
    else if(record.fullscreenTransitionTarget===false&&!browserWindow.isDestroyed())browserWindow.setFullScreen(false);
    update(record);
  });
  browserWindow.on('leave-full-screen',()=>{
    const transitionTarget=record.fullscreenTransitionTarget;
    record.appFullscreen=false;
    if(transitionTarget===false)record.fullscreenTransitionTarget=null;
    else if(transitionTarget===true&&!record.closing&&!browserWindow.isDestroyed())browserWindow.setFullScreen(true);
    record.lastKnownMaximized=Boolean(browserWindow.isMaximized()||record.fullscreenRestoreMaximized);
    if(!record.htmlFullscreen&&transitionTarget!==true){
      if(record.fullscreenRestoreMaximized===true){
        // macOS 在退出全屏后异步恢复 zoom 态：恢复完成前事件报告的几何值是过渡帧
        // （宽度可达全屏宽、高度可差 2px），不能据此清除快照。等 maximize 事件或
        // 稳态几何事件确认恢复后再清除标记；定时器是事件缺失时的兜底。
        clearTimeout(record.fullscreenRestoreSettleTimer);
        record.fullscreenRestoreSettleTimer=setTimeout(()=>{
          if(!browserWindow.isDestroyed()&&record.fullscreenRestoreMaximized===true)record.fullscreenRestoreMaximized=null;
        },1500);
      }else{
        record.fullscreenRestoreMaximized=null;
      }
    }
    update(record);if(!record.htmlFullscreen&&transitionTarget!==true)scheduleWindowStateSave();
  });
  browserWindow.on('close',()=>{closeExtensionPopup(record);record.actionIndicator?.hide();for(const room of roomsOfWindow(record))cancelAgentApprovals({roomId:room.id,reason:'room_closed'});saveWindowState();record.closing=true;record.fullscreenTransitionTarget=null;});
  browserWindow.on('focus',()=>{focusWindow(record);layout(record);});
  browserWindow.on('closed',()=>{record.actionIndicator?.dispose();windowRecords.delete(recordId);rebuildApplicationMenu();if(!quitting){const next=activeRecord();if(next){focusWindow(next);update(next);}else persist();saveWindowState();}});
  installShortcuts(browserWindow.webContents,()=>record);
  startupProgress('shell-window-load-file');
  await browserWindow.loadFile(path.join(__dirname,'index.html'));
  startupProgress('shell-window-ready');
  return record;
}
async function closeWindowRecord(record) {
  if (windowRecords.size <= 1) throw new Error('至少需要保留一个窗口');
  const scoped = roomsOfWindow(record);
  // Agent-owned, unfinished rooms keep working: move them to another window
  // instead of silently ending an agent task.
  const fallback = [...windowRecords.values()].find(item => item.id !== record.id && !item.browserWindow.isDestroyed());
  for (const room of scoped) moveRoomToWindow(room, fallback);
  const browserWindow = record.browserWindow;
  windowRecords.delete(record.id);
  record.actionIndicator?.dispose();
  if (!browserWindow.isDestroyed()) browserWindow.destroy();
  const next = activeRecord();
  if (next) { focusWindow(next); update(next); }
  saveWindowState();
}
app.whenReady().then(async () => {
  startupProgress('app-ready-handler');
  app.setAboutPanelOptions({applicationName:'Corvid',applicationVersion:app.getVersion()});
  rebuildApplicationMenu();
  fs.mkdirSync(dataDir,{recursive:true});
  ipcMain.handle('shell-action',(event,method,args) => {
    const record = [...windowRecords.values()].find(item => !item.browserWindow.isDestroyed() && item.browserWindow.webContents === event.sender);
    if (record) { focusWindow(record); syncRecordFromAliases(record); }
    return dispatchQueued(method,args,false,{windowId:record?.id});
  });
  // Native page bounds follow each trusted shell window's measured chrome; remote page renderers have no sender match.
  ipcMain.on('shell-browser-chrome-height',(event,value)=>{
    const record=[...windowRecords.values()].find(item=>!item.browserWindow.isDestroyed()&&item.browserWindow.webContents===event.sender);
    if(!record||typeof value!=='number'||!Number.isFinite(value)||value<1||value>600)return;
    const height=Math.ceil(value);
    if(record.browserChromeHeight===height)return;
    record.browserChromeHeight=height;
    layout(record);
  });
  ipcMain.on('shell-dock-strip-height',(event,value)=>{
    const record=[...windowRecords.values()].find(item=>!item.browserWindow.isDestroyed()&&item.browserWindow.webContents===event.sender);
    if(!record||typeof value!=='number'||!Number.isFinite(value)||value<0||value>200)return;
    const height=Math.ceil(value);
    if(record.dockStripHeight===height)return;
    record.dockStripHeight=height;
    layout(record);
  });
  ipcMain.handle('browser-home-action',(event,action,value)=>{
    const tab=[...tabs.values()].find(item=>item.view.webContents===event.sender);
    if(!tab||!tab.homeSurfaceInstalled||tab.openedBy!=='user'||tab.view.webContents.getURL()!=='about:blank'||tab.isLoading)throw new Error('Corvid 起始页当前不可用');
    const room=findRoom(tab.roomId),record=windowRecords.get(room.windowId);
    if(room.ownership!=='user')throw new Error('起始页仅在用户拥有的空间中可用');
    if(room.activeTabId!==tab.id)throw new Error('起始页标签已不再活动');
    if(record?.activeRoomId!==room.id||record.modalOpen||record.browserWindow.isDestroyed())throw new Error('起始页尚未准备好，请稍后重试');
    if(action==='navigate'&&typeof value==='string'){
      if(value.length>4096)throw new Error('搜索内容过长');
      return dispatchQueued('navigate',{id:tab.id,url:value},false);
    }
    if(action==='panel'&&['bookmarks','history','agent'].includes(value)){record.browserWindow.webContents.send('shell-home-action',value);return {ok:true};}
    if(action==='setup'&&['import','model','agent'].includes(value)){record.browserWindow.webContents.send('shell-home-action',{kind:'setup',step:value});return {ok:true};}
    if(action==='prompt'&&typeof value==='string'&&value.trim()&&value.length<=500){record.browserWindow.webContents.send('shell-home-action',{kind:'prompt',text:value.trim()});return {ok:true};}
    if(action==='setupWizard'){record.browserWindow.webContents.send('shell-home-action',{kind:'openSetup'});return {ok:true};}
    if(action==='dismissSetup'){record.browserWindow.webContents.send('shell-home-action',{kind:'dismissSetup'});return {ok:true};}
    if(action==='dismissWelcome'){record.browserWindow.webContents.send('shell-home-action',{kind:'dismissWelcome'});return {ok:true};}
    throw new Error('不支持此起始页操作');
  });
  ipcMain.on('page-prompt',(event,message,defaultPrompt)=>{
    const tab=[...tabs.values()].find(item=>item.view.webContents===event.sender);
    if(!tab || typeof message!=='string' || typeof defaultPrompt!=='string') {event.returnValue=null;return;}
    try {pageDebugger.openPrompt(event.sender,message,defaultPrompt,value=>{event.returnValue=value;});} catch {event.returnValue=null;}
  });
  startupProgress('read-session-state');
  const saved=readSavedRooms();
  const savedStates=readWindowStates();
  const savedWindows=Array.isArray(saved?.windows) ? saved.windows : null;
  // Older session files describe a single implicit window; give it an identity
  // so rooms can be assigned to a window in both shapes.
  const windowPlan=(savedWindows && savedWindows.length ? savedWindows : [{id:'legacy-window',activeRoomId:saved?.activeRoomId ?? null,activeProfileId:saved?.activeProfileId ?? 'default'}]);
  restoring = true;
  for (const [index,plan] of windowPlan.entries()) {
    const savedState=savedStates.find(entry=>entry.id===plan.id) || savedStates[index];
    const stateBounds=savedState?.bounds;
    const bounds=stateBounds ? (stateBounds.x!==undefined?{x:stateBounds.x,y:stateBounds.y,width:stateBounds.width,height:stateBounds.height}:{width:stateBounds.width,height:stateBounds.height}) : {width:1280,height:850};
    startupProgress('restore-shell-window');
    const record=await createWindowRecord(bounds,plan.id);
    if(stateBounds?.maximized) record.browserWindow.maximize();
    record.plan=plan;
  }
  // The first plan entry that is not the legacy placeholder owns every room
  // when the session file predates multi-window.
  const legacyRecord=[...windowRecords.values()].find(record=>record.plan?.id==='legacy-window');
  if (saved && Array.isArray(saved.rooms)) {
    for (const old of saved.rooms) {
      const profileId=old.profileId ?? 'default';
      findProfile(profileId);
      const pending=Boolean(old.userResumePending);
      const executionRisk=old.executionRisk ? {...old.executionRisk,status:'unknown_after_restart'} : pending ? {operationId:null,tabId:null,status:'unknown_after_restart',executionStopped:null,mayHaveLateEffects:true} : null;
      const existingNumbers=old.tabs.map(tab=>/^p([1-9]\d*)$/.exec(tab.label || '')).filter(Boolean).map(match=>Number(match[1]));
      const nextPageNumber=Math.max(1,Number.isSafeInteger(old.nextPageNumber)?old.nextPageNumber:1,...existingNumbers.map(value=>value+1));
      const usedLabels=[...new Set([...(old.usedLabels || []),...old.tabs.map(tab=>tab.label).filter(Boolean)])];
      const ownerRecord=(old.windowId && windowRecords.get(old.windowId)) || legacyRecord || [...windowRecords.values()][0];
      focusWindow(ownerRecord);
      const s={id:old.id,name:old.name,profileId,windowId:ownerRecord.id,ownership:pending?'user':old.ownership,finished:Boolean(old.finished),yielded:pending||Boolean(old.yielded),manualControl:pending||Boolean(old.manualControl),executionRisk,nextPageNumber,usedLabels,tabIds:[],activeTabId:null};
      rooms.push(s);
      for (const t of old.tabs || []) {
        startupProgress('restore-session-tab');
        await createTab(s.id,t.url,t.id,{label:t.label ?? null,openedBy:t.openedBy ?? 'unknown',pinned:Boolean(t.pinned),restored:true});
      }
      s.activeTabId=s.tabIds.includes(old.activeTabId)?old.activeTabId:s.tabIds[0] || null;
    }
    for (const record of windowRecords.values()) {
      const plan=record.plan || {};
      const scoped=roomsOfWindow(record);
      const wanted=plan.activeRoomId && scoped.some(room=>room.id===plan.activeRoomId) ? plan.activeRoomId : scoped[0]?.id || null;
      record.activeProfileId=plan.activeProfileId && profiles.some(profile=>profile.id===plan.activeProfileId) ? plan.activeProfileId : (rooms.find(room=>room.id===wanted)?.profileId ?? 'default');
      findProfile(record.activeProfileId);
      record.activeRoomId=wanted;
    }
    const first=activeRecord();
    if (first) focusWindow(first);
  }
  // A fresh session (or a session whose windows outnumbered its rooms) needs at
  // least one user room in the focused window.
  const primary=activeRecord();
  focusWindow(primary);
  if (pendingSecondInstanceActivation) {
    pendingSecondInstanceActivation = false;
    if (primary.browserWindow.isMinimized()) primary.browserWindow.restore();
    if (!primary.browserWindow.isVisible()) primary.browserWindow.show();
    primary.browserWindow.focus();
  }
  if (!rooms.length) { startupProgress('create-initial-room'); await createRoom('我的空间','user'); }
  else if (!roomsOfWindow(primary).length) { const orphan=rooms[0]; moveRoomToWindow(orphan,primary); primary.activeRoomId=orphan.id; primary.activeProfileId=orphan.profileId; }
  if(saved?.rooms?.length && browserPreferences.startupBehavior==='new-tab'){
    const record=activeRecord(),room=record&&rooms.find(item=>item.id===record.activeRoomId);
    if(room){
      const existing=room.tabIds.map(tabId=>tabs.get(tabId)).find(tab=>tab?.openedBy==='user'&&(tab.restoreUrl==='about:blank'||(!tab.restoringInitial&&tab.view.webContents.getURL()==='about:blank')));
      if(existing){await existing.initialization;room.activeTabId=existing.id;}
      else await createTab(room.id,'about:blank',id(),{openedBy:'user',notifyInitialState:true});
    }
  }
  restoring = false;
  for (const record of windowRecords.values()) update(record);
  startupProgress('restoration-complete');
  await startServer();
  startupProgress('startup-complete');
  console.log(`Corvid control: ${connectionPath}`);
}).catch(error => {console.error(error);if(process.env.CORVID_TEST_MODE!=='1') dialog.showErrorBox(mainMessages.t('appStartupFailedTitle'),error.message);app.exit(1);});
app.on('before-quit',() => {quitting=true; persist(); saveWindowState(); if(server) server.close(); try {const current=JSON.parse(fs.readFileSync(connectionPath,'utf8'));if(current.token===token) fs.unlinkSync(connectionPath);} catch {}});
app.on('window-all-closed',() => app.quit());
app.on('will-quit',()=>{try{agentDownloads.cleanup();}catch(error){console.error('Agent download cleanup failed:',error.message);}});
}
