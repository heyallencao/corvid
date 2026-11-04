const api = window.browserShell;
function userFacingAgentError(error, fallback=null) {
  const message=String(error?.message||error||'').trim();
  const localizedMessage=extensionMessages?.userFacingError?.(message);
  if(localizedMessage)return localizedMessage;
  const implementationName=/\bpi(?:[\s_-]+(?:coding[\s_-]*agent|runtime|sdk|session|agent))?\b|@earendil-works\/pi-[a-z0-9-]+/i;
  const safeFallback=fallback||extensionMessages.t('agentErrorFallback');
  return implementationName.test(message) ? safeFallback : (message||safeFallback);
}
function agentEventText(event) {
  if(event.messageKey)return extensionMessages.t(event.messageKey,event.params);
  const value=String(event.text||'');
  if(event.type==='tool'&&value.startsWith('正在使用浏览器工具：'))return extensionMessages.t('agentBrowserActionStarting');
  if((event.type==='tool'||event.type==='error')&&/^corvid_[\w-]+ 已完成$/.test(value))return extensionMessages.t('agentBrowserActionCompleted');
  if(event.type==='error'&&/^corvid_[\w-]+ 执行失败$/.test(value))return extensionMessages.t('agentBrowserActionFailed');
  const retry=value.match(/^连接暂时不稳定，Agent 正在重试（(\d+)\/(\d+)）$/);
  if(event.type==='retry'&&retry)return extensionMessages.t('agentRetrying',{attempt:retry[1],maxAttempts:retry[2]});
  return event.type==='error'?userFacingAgentError(value):value;
}
let state, libraryKind = null, libraryTrigger = null, controlError = '', siteDataNotice = null, piBinding = null, piContextPreview = null, piTasks = [], piPromptDraft = '', piContinueTaskId = null, piContinuationPreview = null, piContinuationDraft = '', piContinuationConsent = false, piHistoryOpen = false, piSelectedTaskId = null, piShowNewChat = false, addressDraftDirty = false, addressDraftTabId = null, addressDraftBaseUrl = null;
let piQueueEdit = null, piQueueDraft = '', piQueueDrafts = new Map(), piQueueSend = null;
let piTaskDurationTimer = null;
const extensionPopupOpenIds=new Set();
let extensionToolbarSignature='';
const extensionMessages=window.corvidI18n;
let chromeImportOnboardingPrompted=false;
const piModelControlVersions=new WeakMap();
let agentRoomRenderVersion=0;
let lastAgentRoomAnnouncementStates=new Map();
let hasAgentRoomAnnouncementSnapshot=false;
const button = (text, action, selected = false) => { const b = document.createElement('button'); b.textContent = text; b.className = selected ? 'selected' : ''; b.onclick = action; return b; };
async function openShellDialog(selector, focusSelector) {
  await api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});
  await api.invoke('setShellModal',{open:true});
  const dialog=document.querySelector(selector);dialog.showModal();
  if(focusSelector)document.querySelector(focusSelector).focus();
}
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>{void api.invoke('setShellModal',{open:false});});
function activeTab() { const room = state?.rooms.find(s => s.id === state.activeRoomId); return room?.tabs.find(t => t.active); }
function profileDisplayName(profile) { return profile.isDefault && profile.name === '默认' ? extensionMessages.t('defaultProfile') : profile.name; }
let profileDeletionPreviewVersion=0;
document.addEventListener('corvid-locale-changed',()=>{if(libraryKind==='pi-workbench')renderPiWorkbench();});
function formatTaskElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60), remainingSeconds = seconds % 60;
  const hours = Math.floor(minutes / 60), remainingMinutes = minutes % 60;
  if (hours) return extensionMessages.t('elapsedHoursMinutes', { hours: extensionMessages.formatNumber(hours), minutes: extensionMessages.formatNumber(remainingMinutes) });
  if (minutes) return extensionMessages.t('elapsedMinutesSeconds', { minutes: extensionMessages.formatNumber(minutes), seconds: extensionMessages.formatNumber(remainingSeconds) });
  return extensionMessages.t('elapsedSeconds', { count: extensionMessages.formatNumber(seconds) });
}
function updatePiTaskElapsedTimes() {
  for (const element of document.querySelectorAll('.pi-task-elapsed')) {
    const startedAt = Date.parse(element.dataset.startedAt || '');
    const finishedAt = element.dataset.finishedAt ? Date.parse(element.dataset.finishedAt) : NaN;
    const endedAt = Number.isFinite(finishedAt) ? finishedAt : element.dataset.live === 'true' ? Date.now() : NaN;
    element.textContent = Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt
      ? extensionMessages.t('taskTurnElapsed', { duration: formatTaskElapsed(endedAt - startedAt) })
      : extensionMessages.t('taskTurnDurationUnknown');
  }
}
function syncPiTaskElapsedTimer() {
  if (libraryKind === 'pi-workbench') {
    updatePiTaskElapsedTimes();
    if (!piTaskDurationTimer) piTaskDurationTimer = setInterval(updatePiTaskElapsedTimes, 1_000);
  } else if (piTaskDurationTimer) {
    clearInterval(piTaskDurationTimer);
    piTaskDurationTimer = null;
  }
}
function profileDeletionErrorText(error) {
  const message=String(error?.message||'');
  if(/CORVID_PROFILE_DELETE_FAILED|浏览身份清理未完成/.test(message))return extensionMessages.t('profileDeleteFailed');
  if(/CORVID_PROFILE_IN_USE|仍被窗口、空间|正在运行或可继续/.test(message))return extensionMessages.t('profileDeleteUnavailable');
  if(/CORVID_PROFILE_NOT_FOUND|浏览身份不存在/.test(message))return extensionMessages.t('profileNotFound');
  return extensionMessages.t('profileDeletionErrorFallback');
}
function profileDeletionBlockerText(blocker) {
  if(blocker.kind==='window')return extensionMessages.t('profileDeleteWindowItem');
  if(blocker.kind==='room')return extensionMessages.t('profileDeleteSpaceItem',{name:blocker.name||blocker.id});
  if(blocker.kind==='download')return extensionMessages.t('profileDeleteDownloadItem');
  if(blocker.kind==='agent-task')return extensionMessages.t('profileDeleteAgentTaskItem');
  if(blocker.kind==='default')return extensionMessages.t('profileDeleteDefaultItem');
  return extensionMessages.t('profileDeleteUnavailable');
}
function renderProfileDeletionPreview(preview) {
  const impact=document.querySelector('#profile-deletion-impact'),button=document.querySelector('#confirm-profile-deletion'),select=document.querySelector('#profile-deletion-select');
  impact.replaceChildren();impact.dataset.blocked=String(Boolean(preview.blockers.length));
  if(preview.deletionPending){const pending=document.createElement('p');pending.textContent=extensionMessages.t('profileDeletePending');impact.append(pending);}
  if(preview.blockers.length){const list=document.createElement('ul');const blockerLabels=new Set(preview.blockers.map(profileDeletionBlockerText));for(const label of blockerLabels){const item=document.createElement('li');item.textContent=label;list.append(item);}impact.append(list);}
  else {const scope=document.createElement('p');scope.textContent=extensionMessages.t('profileDeleteScope');impact.append(scope);}
  button.disabled=Boolean(preview.blockers.length);button.textContent=extensionMessages.t(preview.deletionPending?'profileDeleteRetry':'profileDeleteConfirm');
  select.disabled=false;
}
async function refreshProfileDeletionPreview() {
  const version=++profileDeletionPreviewVersion,id=document.querySelector('#profile-deletion-select').value;
  const impact=document.querySelector('#profile-deletion-impact'),button=document.querySelector('#confirm-profile-deletion');
  document.querySelector('#profile-deletion-error').hidden=true;button.disabled=true;
  if(!id){impact.replaceChildren();impact.dataset.blocked='true';const empty=document.createElement('p');empty.textContent=extensionMessages.t('profileDeleteNoProfiles');impact.append(empty);return;}
  try{const preview=await api.invoke('previewProfileDeletion',{id});if(version===profileDeletionPreviewVersion&&document.querySelector('#profile-deletion').open)renderProfileDeletionPreview(preview);}
  catch(error){if(version!==profileDeletionPreviewVersion)return;impact.replaceChildren();impact.dataset.blocked='true';const message=document.createElement('p');message.textContent=profileDeletionErrorText(error);impact.append(message);}
}
async function openProfileDeletionDialog() {
  const select=document.querySelector('#profile-deletion-select');select.replaceChildren();
  const submit=document.querySelector('#confirm-profile-deletion');submit.textContent=extensionMessages.t('profileDeleteConfirm');submit.disabled=true;
  const candidates=(state?.profiles||[]).filter(profile=>!profile.isDefault&&profile.id!=='default');
  for(const profile of candidates){const option=document.createElement('option');option.value=profile.id;option.textContent=profile.deletionPending?extensionMessages.t('profileDeletePendingOption',{name:profileDisplayName(profile)}):profileDisplayName(profile);select.append(option);}
  document.querySelector('#profile-deletion-error').hidden=true;
  await openShellDialog('#profile-deletion','#profile-deletion-select');
  await refreshProfileDeletionPreview();
}
function roomDisplayName(room) { return room.name === '我的空间' ? extensionMessages.t('mySpace') : room.name === '新窗口的空间' ? extensionMessages.t('newWindowSpace') : room.name; }
function updateNewTabSurface(active) {
  const isNewTab=Boolean(active && active.url==='about:blank' && !active.isLoading && !active.navigationError);
  document.querySelector('#bookmarks-bar').toggleAttribute('hidden',isNewTab);
}
function draw(value) {
  state = value;
  extensionMessages.setLocale(state.uiLocale);
  const fullscreenToggle=document.querySelector('#toggle-fullscreen');
  fullscreenToggle.setAttribute('aria-checked',String(Boolean(state.fullscreen)));
  fullscreenToggle.disabled=Boolean(state.pageFullscreen);
  fullscreenToggle.title=state.pageFullscreen?extensionMessages.t('fullscreenPageActive'):'';
  document.querySelector('#fullscreen-shortcut').textContent=state.fullscreenShortcut||'F11';
  document.querySelector('#ui-locale').value = state.uiLocale;
  if(state.needsChromeImportOnboarding&&!chromeImportOnboardingPrompted){chromeImportOnboardingPrompted=true;void openShellDialog('#chrome-import-onboarding');}
  if(piBinding&&(piBinding.profileId!==state.activeProfileId||!state.rooms.some(room=>room.id===piBinding.roomId&&room.tabs.some(tab=>tab.id===piBinding.tabId)))){piBinding=null;piContextPreview=null;}
  const dialogView=document.querySelector('#page-dialog');
  if(dialogView.open && !state.rooms.some(room=>room.tabs.some(tab=>tab.id===dialogTabId && tab.dialog))) dialogView.close();
  if (libraryKind === 'pi-workbench') void renderPiTasks(); else if (libraryKind) void renderLibrary();
  for(const kind of ['bookmarks','history','downloads','agent-rooms','pi-workbench'])document.querySelector(`#show-${kind}`).setAttribute('aria-expanded',String(libraryKind===kind));
  void renderBookmarksBar();
  const profileSelect=document.querySelector('#profile-select');profileSelect.replaceChildren();
  for(const profile of state.profiles){const option=document.createElement('option');option.value=profile.id;option.textContent=profile.deletionPending?extensionMessages.t('profileDeletePendingOption',{name:profileDisplayName(profile)}):profileDisplayName(profile);option.selected=profile.id===state.activeProfileId;option.disabled=Boolean(profile.deletionPending);profileSelect.append(option);}
  const activeProfile=state.profiles.find(profile=>profile.id===state.activeProfileId);
  document.querySelector('.profile-avatar').textContent=(activeProfile?profileDisplayName(activeProfile):'A').trim().charAt(0).toLocaleUpperCase()||'A';
  profileSelect.onchange=()=>api.invoke('activateProfile',{id:profileSelect.value});
  renderExtensionToolbar();
  const roomStrip=document.querySelector('#room-strip');roomStrip.replaceChildren();
  for (const s of state.rooms.filter(s=>s.profileId===state.activeProfileId)) {
    const displayName=roomDisplayName(s);
    const item=button(displayName,()=>api.invoke('activateRoom',{id:s.id}),s.id===state.activeRoomId);
    item.dataset.ownership=s.ownership;
    item.setAttribute('aria-current',s.id===state.activeRoomId?'page':'false');
    item.title=`${displayName} · ${s.ownership==='agent'?extensionMessages.t('agentUsing'):extensionMessages.t('userSpace')}`;
    roomStrip.append(item);
  }
  const profileMenu=document.querySelector('#profile-menu');profileMenu.replaceChildren();
  const profileAction=(label,fn)=>{const item=button(label,()=>{profileMenu.hidden=true;fn();});item.setAttribute('role','menuitem');profileMenu.append(item);};
  profileAction(extensionMessages.t('newProfile'),async()=>{await openShellDialog('#new-profile','#profile-name');});
  profileAction(extensionMessages.t('renameCurrentProfile'),async()=>{renameProfileId=state.activeProfileId;const profile=state.profiles.find(item=>item.id===renameProfileId);document.querySelector('#renamed-profile-name').value=profileDisplayName(profile);document.querySelector('#rename-profile-error').textContent='';await openShellDialog('#rename-profile','#renamed-profile-name');document.querySelector('#renamed-profile-name').select();});
  profileAction(extensionMessages.t('manageProfileDeletion'),openProfileDeletionDialog);
  const roomMenu=document.querySelector('#room-menu');roomMenu.replaceChildren();
  const roomAction=(label,fn)=>{const item=button(label,()=>{roomMenu.hidden=true;fn();});item.setAttribute('role','menuitem');roomMenu.append(item);};
  roomAction(extensionMessages.t('createSpace'),async()=>{await openShellDialog('#new-room','#room-name');});
  if(state.activeRoomId)roomAction(extensionMessages.t('closeCurrentSpace'),async()=>{const id=state.activeRoomId;controlError='';try{await api.invoke('closeRoomFromUser',{id});}catch(error){controlError=error.message;draw(state);}});
  const roomActions=document.querySelector('#room-actions');roomActions.replaceChildren();
  const newWindow=button(`＋  ${extensionMessages.t('newWindow')}`,async()=>{controlError='';try{await api.invoke('createWindow',{});}catch(error){controlError=error.message;draw(state);}});
  newWindow.className='new-window-button';
  roomActions.append(newWindow);
  const room = state.rooms.find(s => s.id === state.activeRoomId);
  if (!room) {document.querySelector('#tabs').replaceChildren();tabsSignature='';addressDraftDirty=false;addressDraftTabId=null;addressDraftBaseUrl=null;document.querySelector('#address').value='';document.querySelector('#status').textContent='';return;}
  renderTabs(room);
  const active = activeTab(),address=document.querySelector('#address');
  updateNewTabSurface(active);
  // 对话框关闭后的状态事件可能晚于输入和失焦到达；同标签草稿应保留到提交。
  if(addressDraftDirty && (addressDraftTabId!==active?.id || addressDraftBaseUrl!==active?.url)){addressDraftDirty=false;addressDraftTabId=null;addressDraftBaseUrl=null;}
  if(!addressDraftDirty && document.activeElement!==address)address.value=active?.navigationError?.url || (active?.url === 'about:blank' ? '' : active?.url || '');
  if(findOpen && (!active || active.id!==findTabId)) closeFindBar();
  const status=document.querySelector('#status');status.setAttribute('role','status');status.replaceChildren();
  if(active?.isLoading){const loading=document.createElement('span');loading.className='navigation-loading';loading.textContent=extensionMessages.t('loading');status.append(loading);}
  if(active?.navigationError){const error=document.createElement('span');error.className='navigation-error';error.setAttribute('role','alert');error.textContent=extensionMessages.t('pageLoadFailed',{message:active.navigationError.message});status.append(error);if(room.ownership!=='agent'&&!room.userResumePending)status.append(button(extensionMessages.t('retry'),()=>api.invoke('navigate',{id:active.id,url:active.navigationError.url})));}
  if(room.executionRisk) status.append(button(extensionMessages.t('pageExecutionUnknown'),()=>api.invoke('reviewExecutionRisk',{id:room.id})));
  if(active?.dialog) status.append(button(extensionMessages.t('pageDialogReview'),()=>showPageDialog(active)));
  if(room.ownership==='agent') {
    const label=document.createElement('span');label.textContent=extensionMessages.t('agentInControl');status.append(label);
    const take=button(room.userResumePending ? extensionMessages.t('takingControl') : extensionMessages.t('takeControl'),async()=>{controlError='';try{await api.invoke('requestUserControl',{id:room.id});}catch(error){controlError=error.message;draw(state);}});take.disabled=room.userResumePending;status.append(take);
  } else if(room.yielded) {const label=document.createElement('span');label.textContent=extensionMessages.t('userInControl');status.append(label);if(!room.executionRisk)status.append(button(extensionMessages.t('returnControl'),async()=>{controlError='';try{await api.invoke('returnUserControl',{id:room.id});}catch(error){controlError=error.message;draw(state);}}));}
  if(controlError){const note=document.createElement('span');note.setAttribute('role','alert');note.textContent=controlError;status.append(note);}
  if(siteDataNotice?.tabId===active?.id){const note=document.createElement('span');note.setAttribute('role','status');note.textContent=siteDataNotice.message;status.append(note);}
}
function renderExtensionToolbar(){
  const host=document.querySelector('#extension-toolbar');
  host.setAttribute('aria-label',extensionMessages.t('extensionToolbar'));
  const extensions=state.extensionToolbar||[];
  const signature=[state.activeProfileId,...extensions.map(item=>`${item.id}:${item.name}:${item.icon||''}`)].join('|');
  if(signature===extensionToolbarSignature)return;
  extensionToolbarSignature=signature;host.replaceChildren();
  for(const extension of extensions){
    const trigger=document.createElement('button');trigger.type='button';trigger.className='extension-toolbar-button';
    if(extension.icon){const icon=document.createElement('img');icon.src=extension.icon;icon.alt='';icon.draggable=false;trigger.append(icon);}else trigger.textContent=(extension.name.trim().charAt(0)||'E').toLocaleUpperCase();
    trigger.dataset.extensionId=extension.id;
    trigger.title=extension.name;trigger.setAttribute('aria-label',extensionMessages.t('extensionPopup',{name:extension.name}));trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded',String(extensionPopupOpenIds.has(extension.id)));
    trigger.onclick=async()=>{
      const bounds=trigger.getBoundingClientRect();
      try{
        const result=await api.invoke('openExtensionPopup',{profileId:state.activeProfileId,extensionId:extension.id,anchor:{left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom}});
        if(result.open)extensionPopupOpenIds.add(extension.id);else extensionPopupOpenIds.delete(extension.id);
        trigger.setAttribute('aria-expanded',String(Boolean(result.open)));
      }catch(error){
        const status=document.querySelector('#status');status.textContent=error?.code==='EXTENSION_POPUP_UNAVAILABLE'?extensionMessages.t('extensionPopupUnavailable'):extensionMessages.t('extensionPopupFailed');
        status.setAttribute('role','alert');
        trigger.focus();
      }
    };
    host.append(trigger);
  }
}
api.onExtensionPopupState(({id,open,focusTrigger})=>{
  if(typeof id!=='string')return;
  if(open)extensionPopupOpenIds.add(id);else extensionPopupOpenIds.delete(id);
  const trigger=document.querySelector(`.extension-toolbar-button[data-extension-id="${CSS.escape(id)}"]`);
  if(trigger){trigger.setAttribute('aria-expanded',String(Boolean(open)));if(focusTrigger)trigger.focus();}
});
let dialogTabId;
async function showPageDialog(tab) {
  dialogTabId=tab.id;document.querySelector('#page-dialog-message').textContent=tab.dialog.message;
  document.querySelector('#page-dialog-prompt-label').hidden=tab.dialog.type!=='prompt';
  document.querySelector('#page-dialog-prompt').value=tab.dialog.defaultPrompt || '';
  await openShellDialog('#page-dialog','#page-dialog-prompt');
}
async function answerPageDialog(accept) {
  const tabId=dialogTabId, tab=state.rooms.flatMap(room=>room.tabs).find(item=>item.id===tabId);
  const promptText=tab?.dialog?.type==='prompt' ? document.querySelector('#page-dialog-prompt').value : undefined;
  await api.invoke('handleDialog',{id:tabId,accept,...(promptText===undefined?{}:{promptText})});
  document.querySelector('#page-dialog').close();
}
document.querySelector('#page-dialog-form').onsubmit=event=>{event.preventDefault();void answerPageDialog(true);};
document.querySelector('#page-dialog-dismiss').onclick=()=>answerPageDialog(false);
document.querySelector('#page-dialog').onclose=()=>api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});
let libraryRenderVersion=0;
function historyLocalDayKey(value){const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function historyGroup(item){
  const date=new Date(item.visitedAt),dayKey=historyLocalDayKey(date);
  if(!dayKey)return {key:'unavailable',label:extensionMessages.t('historyDateUnavailable')};
  const today=new Date(),yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
  if(dayKey===historyLocalDayKey(today))return {key:'today',label:extensionMessages.t('historyToday')};
  if(dayKey===historyLocalDayKey(yesterday))return {key:'yesterday',label:extensionMessages.t('historyYesterday')};
  return {key:dayKey,label:extensionMessages.formatDate(date,{dateStyle:'full'})};
}
function historyDisplayUrl(value){try{const url=new URL(value);return `${url.host}${url.pathname}`;}catch{return value;}}
async function renderLibrary() {
  if (!libraryKind) return;
  if(libraryKind==='agent-rooms'){await renderAgentRooms();return;}
  if(libraryKind==='pi-workbench'){renderPiWorkbench();return;}
  const kind = libraryKind, profileId=state.activeProfileId, version=++libraryRenderVersion; const result = await api.invoke(kind,{profileId}); if (version!==libraryRenderVersion || libraryKind !== kind || state.activeProfileId!==profileId) return;
  const panel=document.querySelector('#library');panel.dataset.kind=kind;
  document.querySelector('#library-search').hidden=false;
  const query=document.querySelector('#library-search').value.trim().toLocaleLowerCase();
  const matching=result[kind].filter(item=>!query || [item.title,item.url,item.filename,item.path].some(value=>typeof value==='string' && value.toLocaleLowerCase().includes(query)));
  const items = document.querySelector('#library-items'); items.replaceChildren();
  document.querySelector('#library-title').textContent = kind === 'history' ? extensionMessages.t('historyTitle') : kind === 'downloads' ? extensionMessages.t('downloadsTitle') : extensionMessages.t('bookmarksTitle');
  if(kind==='history'){
    const groups=new Map();
    for(const item of matching){const group=historyGroup(item);if(!groups.has(group.key))groups.set(group.key,{...group,items:[]});groups.get(group.key).items.push(item);}
    for(const group of groups.values()){
      const section=document.createElement('section');section.className='history-group';section.dataset.historyGroup=group.key;
      const heading=document.createElement('h3');heading.className='history-group-title';heading.textContent=group.label;section.append(heading);
      for(const item of group.items){
        const row=document.createElement('div');row.className='entry history-entry';row.dataset.historyId=item.id;
        const details=document.createElement('div');details.className='history-entry-details';
        const link=document.createElement('a');link.href='#';link.className='history-title';link.textContent=item.title||historyDisplayUrl(item.url);link.title=historyDisplayUrl(item.url);
        link.onclick=async event=>{event.preventDefault();const tab=activeTab();if(tab)await api.invoke('navigate',{id:tab.id,url:item.url});};
        const meta=document.createElement('div');meta.className='history-entry-meta';
        const address=document.createElement('span');address.className='history-url';address.textContent=historyDisplayUrl(item.url);address.title=historyDisplayUrl(item.url);
        const time=document.createElement('time');time.className='history-time';
        const date=new Date(item.visitedAt);
        if(Number.isFinite(date.getTime())){time.dateTime=date.toISOString();time.textContent=extensionMessages.formatDate(date,{hour:'numeric',minute:'2-digit'});}
        else time.textContent=extensionMessages.t('historyTimeUnavailable');
        meta.append(address,time);details.append(link,meta);row.append(details);
        const remove=button(extensionMessages.t('delete'),async()=>{await api.invoke('removeHistory',{id:item.id,profileId});await renderLibrary();});
        remove.setAttribute('aria-label',`${extensionMessages.t('delete')} ${item.title||historyDisplayUrl(item.url)}`);row.append(remove);section.append(row);
      }
      items.append(section);
    }
    if(!matching.length)items.textContent=query&&result.history.length?extensionMessages.t('noMatches'):extensionMessages.t('noHistory');
    return;
  }
  for (const item of matching) {
    const row = document.createElement('div'); row.className = 'entry';
    if (kind === 'downloads') {
      const details = document.createElement('span'); details.style.flex='1';
      const labels={progressing:extensionMessages.t('downloadProgressing'),completed:extensionMessages.t('downloadCompleted'),cancelled:extensionMessages.t('downloadCancelled'),interrupted:extensionMessages.t('downloadInterrupted'),failed:extensionMessages.t('downloadFailed')};
      const progress=item.totalBytes>0 ? ` ${extensionMessages.formatNumber(Math.round(item.receivedBytes/item.totalBytes*100))}%` : ` ${extensionMessages.t('byteCount',{count:extensionMessages.formatNumber(item.receivedBytes)})}`;
      details.textContent=`${item.filename} — ${labels[item.status] || item.status}${item.status==='progressing' ? progress : ''}${item.error ? `：${item.error}` : ''}`;
      details.title=item.path || item.url; row.append(details);
      if(item.status==='progressing') row.append(button(extensionMessages.t('cancelDownload'),async()=>{await api.invoke('cancelDownload',{id:item.id});}));
      if(['failed','cancelled','interrupted'].includes(item.status)) {
        const retry=button(item.retrying?extensionMessages.t('retryingDownload'):extensionMessages.t('retry'),async()=>{controlError='';try{await api.invoke('retryDownload',{id:item.id});await renderLibrary();}catch(error){controlError=error.message;draw(state);}});
        retry.disabled=Boolean(item.retrying);row.append(retry);
      }
      if(item.status==='completed' && item.path){
        row.append(button(extensionMessages.t('open'),async()=>{controlError='';try{await api.invoke('openDownload',{id:item.id});}catch(error){controlError=error.message;draw(state);}}));
        row.append(button(extensionMessages.t('showInFolder'),async()=>{controlError='';try{await api.invoke('revealDownload',{id:item.id});}catch(error){controlError=error.message;draw(state);}}));
      }
      items.append(row); continue;
    }
    const link = document.createElement('a'); link.href = '#'; link.textContent = item.title || item.url; link.title = item.url;
    link.onclick = async event => { event.preventDefault(); const tab=activeTab(); if(tab) await api.invoke('navigate',{id:tab.id,url:item.url}); };
    const remove = button(extensionMessages.t('delete'), async () => { await api.invoke(kind === 'history' ? 'removeHistory' : 'removeBookmark',{id:item.id,profileId}); await renderLibrary(); });
    remove.setAttribute('aria-label',`${extensionMessages.t('delete')} ${item.title || item.url}`); row.append(link,remove); items.append(row);
  }
  if (!matching.length) items.textContent = query && result[kind].length ? extensionMessages.t('noMatches') : kind === 'history' ? extensionMessages.t('noHistory') : kind === 'downloads' ? extensionMessages.t('noDownloads') : extensionMessages.t('noBookmarks');
}
async function renderAgentRooms(){
  const version=++agentRoomRenderVersion,profileId=state.activeProfileId;
  const result=await api.invoke('piTasks',{profileId});
  if(version!==agentRoomRenderVersion||libraryKind!=='agent-rooms'||state.activeProfileId!==profileId)return;
  const panel=document.querySelector('#library'),items=document.querySelector('#library-items');
  panel.dataset.kind='agent-rooms';
  document.querySelector('#library-title').textContent=extensionMessages.t('agentWorkspace');
  document.querySelector('#library-search').hidden=true;
  let announcement=panel.querySelector('#agent-room-announcer');
  if(!announcement){announcement=document.createElement('div');announcement.id='agent-room-announcer';announcement.className='visually-hidden';announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');announcement.setAttribute('aria-atomic','true');panel.insertBefore(announcement,items);}
  announcement.hidden=false;
  const rooms=state.rooms.filter(room=>room.profileId===state.activeProfileId&&(room.ownership==='agent'||room.yielded||room.finished));
  const tasksByRoom=new Map();
  for(const task of result.tasks){const tasks=tasksByRoom.get(task.roomId)||[];tasks.push(task);tasksByRoom.set(task.roomId,tasks);}
  const taskLabels={preparing:extensionMessages.t('preparing'),running:extensionMessages.t('agentReplying'),waiting_for_user:extensionMessages.t('waitingForTakeover'),completed:extensionMessages.t('taskCompleted'),failed:extensionMessages.t('needsAttention'),interrupted:extensionMessages.t('waitingForReview')},nextAnnouncementStates=new Map(),changedStates=[];
  for(const room of rooms){
    const ownershipLabel=room.executionRisk?extensionMessages.t('executionStatusUnknown'):room.userResumePending?extensionMessages.t('takingOver'):room.finished?extensionMessages.t('taskFinished'):room.ownership==='agent'?extensionMessages.t('agentInControl'):room.yielded?extensionMessages.t('userInControl'):extensionMessages.t('idle');
    for(const task of tasksByRoom.get(room.id)||[]){
      const key=`${profileId}:${task.id}`,signature=`${task.status}:${ownershipLabel}`,previous=lastAgentRoomAnnouncementStates.get(key);
      nextAnnouncementStates.set(key,signature);
      if(previous!==undefined?previous!==signature:hasAgentRoomAnnouncementSnapshot)changedStates.push({room,task,ownershipLabel});
    }
  }
  if(changedStates.length){
    const messages=changedStates.slice(0,3).map(({room,task,ownershipLabel})=>extensionMessages.t('agentTaskStatus',{room:room.name,task:taskLabels[task.status]||extensionMessages.t('taskStatusUnknown'),control:ownershipLabel?extensionMessages.t('taskStatusControl',{control:ownershipLabel}):''}));
      const remainder=changedStates.length>messages.length?extensionMessages.t('moreStateUpdates',{count:extensionMessages.formatNumber(changedStates.length-messages.length)}):'';
      announcement.textContent=messages.join(extensionMessages.t('stateAnnouncementSeparator'))+remainder;
  }
  lastAgentRoomAnnouncementStates=nextAnnouncementStates;
  hasAgentRoomAnnouncementSnapshot=true;
  items.replaceChildren();
  for(const room of rooms){
    const row=document.createElement('div');row.className='agent-room-entry';
    const name=document.createElement('span');name.className='agent-room-name';name.textContent=room.name;name.title=room.name;
    const status=document.createElement('span');status.className='agent-room-state';
    const ownershipLabel=room.executionRisk?extensionMessages.t('executionStatusUnknown'):room.userResumePending?extensionMessages.t('takingOver'):room.finished?extensionMessages.t('taskFinished'):room.ownership==='agent'?extensionMessages.t('agentInControl'):room.yielded?extensionMessages.t('userInControl'):extensionMessages.t('idle');
    status.textContent=`${ownershipLabel} · ${extensionMessages.plural('tabs',room.tabs.length)}`;
    const roomTasks=tasksByRoom.get(room.id)||[];
    const taskStates=document.createElement('div');taskStates.className='agent-room-tasks';
    for(const task of roomTasks){
      const taskStatus=document.createElement('span');taskStatus.className='agent-room-task-state';taskStatus.dataset.status=task.status;taskStatus.textContent=`Corvid Agent · ${taskLabels[task.status]||extensionMessages.t('taskStatusUnknown')}`;taskStates.append(taskStatus);
      const openTask=button(extensionMessages.t('viewConversation'),async()=>{
        piSelectedTaskId=task.id;piHistoryOpen=false;piContinueTaskId=null;piContinuationPreview=null;piContinuationDraft='';piContinuationConsent=false;piBinding={profileId:task.profileId,roomId:task.roomId,tabId:task.tabId};piContextPreview=null;
        setLibraryPanel('pi-workbench',document.querySelector('#show-pi-workbench'));
        await api.invoke('setPanel',{open:true,workspace:true});
        renderPiWorkbench();
      });openTask.setAttribute('aria-label',`${extensionMessages.t('viewConversation')} · Corvid Agent · ${room.name} · ${taskLabels[task.status]||extensionMessages.t('conversationTask')}`);taskStates.append(openTask);
    }
    const view=button(extensionMessages.t('view'),async()=>{await closeLibraryPanel({restoreFocus:true});await api.invoke('activateRoom',{id:room.id});});
    view.setAttribute('aria-label',`${extensionMessages.t('view')} ${room.name}`);
    row.append(name,status);
    if(roomTasks.length)row.append(taskStates);
    row.append(view);
    if(room.ownership==='agent'){
      const take=button(room.userResumePending?extensionMessages.t('takingControl'):extensionMessages.t('takeControl'),async()=>{controlError='';try{await api.invoke('requestUserControl',{id:room.id});}catch(error){controlError=error.message;draw(state);}});
      take.disabled=room.userResumePending;take.setAttribute('aria-label',`${extensionMessages.t('takeControl')} ${room.name}`);row.append(take);
    }else if(room.yielded&&!room.finished&&!room.executionRisk){
      const resume=button(extensionMessages.t('returnControl'),async()=>{controlError='';try{await api.invoke('returnUserControl',{id:room.id});}catch(error){controlError=error.message;draw(state);}});
      resume.setAttribute('aria-label',`${extensionMessages.t('returnControl')}: ${room.name}`);row.append(resume);
    }
    if(room.executionRisk){const review=button(extensionMessages.t('review'),()=>api.invoke('reviewExecutionRisk',{id:room.id}));review.setAttribute('aria-label',extensionMessages.t('reviewRoomExecution',{room:room.name}));row.append(review);}
    items.append(row);
  }
  if(!rooms.length){
    const empty=document.createElement('p');empty.className='workspace-empty-state';empty.textContent=extensionMessages.t('noAgentSpaces');items.append(empty);
    const start=button(extensionMessages.t('openCorvidAgent'),async()=>{
      document.querySelector('#library-search').value='';
      setLibraryPanel('pi-workbench',document.querySelector('#show-pi-workbench'));
      await api.invoke('setPanel',{open:true,workspace:true});
      renderPiWorkbench();
      document.querySelector('#pi-task-prompt')?.focus();
    });start.className='workspace-empty-action';items.append(start);
  }
}
async function renderPiTasks(){
  if(libraryKind!=='pi-workbench')return;
  const profileId=state.activeProfileId,result=await api.invoke('piTasks',{profileId});
  if(libraryKind!=='pi-workbench'||state.activeProfileId!==profileId)return;
  piTasks=result.tasks;
  if(piContinueTaskId&&!piTasks.some(task=>task.id===piContinueTaskId)){piContinueTaskId=null;piContinuationPreview=null;}
  const list=document.querySelector('#pi-task-list');
  if(!list)return;
  const historyTop=list.scrollTop,historyAtEnd=historyTop+list.clientHeight>=list.scrollHeight-24;
  list.replaceChildren();
  const toolbar=document.createElement('div');toolbar.className='pi-chat-toolbar';
  const historyButton=button(`${extensionMessages.t('conversationHistory')} · ${extensionMessages.formatNumber(piTasks.length)}`,()=>{piHistoryOpen=!piHistoryOpen;renderPiTasks();});historyButton.setAttribute('aria-expanded',String(piHistoryOpen));historyButton.setAttribute('aria-label',extensionMessages.t('conversationHistory'));
  const newChat=button(extensionMessages.t('newConversation'),()=>{piSelectedTaskId=null;piShowNewChat=true;piContinueTaskId=null;piContinuationPreview=null;piContinuationDraft='';piContinuationConsent=false;piBinding=null;piContextPreview=null;piPromptDraft='';renderPiWorkbench();});newChat.className='pi-new-chat';
  toolbar.append(historyButton,newChat);list.append(toolbar);
  const labels={preparing:extensionMessages.t('preparing'),running:extensionMessages.t('taskRunning'),waiting_for_user:extensionMessages.t('waitingForTakeover'),completed:extensionMessages.t('taskCompleted'),failed:extensionMessages.t('needsAttention'),interrupted:extensionMessages.t('waitingForReview')};
  if(piSelectedTaskId&&!piTasks.some(task=>task.id===piSelectedTaskId))piSelectedTaskId=null;
  const visibleTasks=piShowNewChat?[]:piTasks.filter(task=>task.id===(piSelectedTaskId||piTasks.at(-1)?.id));
  const announcement=document.querySelector('#pi-task-announcer'),activeTask=visibleTasks[0];
  if(announcement){
    if(activeTask){
      const room=state.rooms.find(item=>item.id===activeTask.roomId),control=room?.executionRisk?extensionMessages.t('executionStatusUnknown'):room?.userResumePending?extensionMessages.t('takingOver'):room?.ownership==='user'?extensionMessages.t('userInControlShort'):'';
      const signature=`${activeTask.id}:${activeTask.status}:${control}`,message=`Corvid Agent: ${labels[activeTask.status]||activeTask.status}${control?` · ${control}`:''}`;
      if(announcement.dataset.signature!==signature){announcement.dataset.signature=signature;announcement.textContent=message;}
    }else if(announcement.dataset.signature){announcement.dataset.signature='';announcement.textContent='';}
  }
  if(piHistoryOpen){
    const history=document.createElement('div');history.id='pi-chat-history';history.className='pi-chat-history';
    for(const task of [...piTasks].reverse()){
      const item=button('',()=>{piSelectedTaskId=task.id;piShowNewChat=false;piContinueTaskId=task.canContinue&&!['running','preparing'].includes(task.status)?task.id:null;piContinuationPreview=null;piContinuationDraft='';piContinuationConsent=false;piHistoryOpen=false;renderPiTasks();});item.className='pi-history-item';item.setAttribute('aria-current',String(task.id===piSelectedTaskId));
      const title=document.createElement('span');title.className='pi-task-title';title.textContent=task.conversation?.find(turn=>turn.role==='user')?.text||task.prompt||extensionMessages.t('conversationTask');
      const subtitle=document.createElement('small');subtitle.textContent=`${labels[task.status]||task.status} · ${task.page?.title||task.page?.url||extensionMessages.t('page')}`;item.append(title,subtitle);history.append(item);
    }
    list.append(history);
  }
  for(const task of visibleTasks){
    const row=document.createElement('article');row.className='pi-task-entry';row.dataset.taskId=task.id;
    const title=document.createElement('strong');title.className='pi-task-title';title.textContent=task.conversation?.find(turn=>turn.role==='user')?.text||task.prompt||extensionMessages.t('conversationTask');title.title=title.textContent;row.append(title);
    const context=document.createElement('div');context.className='pi-task-context';context.textContent=`Corvid Agent${task.selectedModel?.name?` · ${task.selectedModel.name}`:''} · ${task.page?.title||task.page?.url||extensionMessages.t('page')}`;row.append(context);
    const meta=document.createElement('div');meta.className='pi-task-meta';
    const roomState=state.rooms.find(room=>room.id===task.roomId);const controlLabel=roomState?.executionRisk?extensionMessages.t('executionStatusUnknown'):roomState?.userResumePending?extensionMessages.t('takingOver'):roomState?.ownership==='user'?extensionMessages.t('userInControlShort'):'';
    const status=document.createElement('span');status.className='pi-task-state';status.dataset.status=task.status;status.textContent=labels[task.status]||task.status;status.setAttribute('role','status');meta.append(status);
    if(controlLabel){const control=document.createElement('span');control.className='pi-task-control-state';control.textContent=controlLabel;control.setAttribute('role','status');meta.append(control);}
    const currentTurn=task.conversation?.at(-1);
    if(currentTurn?.role==='assistant'){
      const elapsed=document.createElement('span');elapsed.className='pi-task-elapsed';elapsed.dataset.startedAt=currentTurn.at||'';elapsed.dataset.finishedAt=currentTurn.finishedAt||'';elapsed.dataset.live=String(Boolean(currentTurn.status==='running'&&['preparing','running'].includes(task.status)));elapsed.setAttribute('aria-live','off');meta.append(elapsed);
    }
    meta.append(button(extensionMessages.t('openSpace'),async()=>{await api.invoke('activateRoom',{id:task.roomId});}));
    if(task.status==='running')meta.append(button(extensionMessages.t('stopTask'),async()=>{await api.invoke('stopPiTask',{taskId:task.id});await renderPiTasks();}));
    else {
      if(task.canContinue&&['completed','interrupted','failed','waiting_for_user'].includes(task.status)){const actionLabel=task.continuationMode==='saved-conversation'?extensionMessages.t('continueSavedConversation'):task.status==='failed'?extensionMessages.t('reviewAndResume'):extensionMessages.t('continueConversation');const resume=button(piContinueTaskId===task.id?extensionMessages.t('collapseContinue'):actionLabel,()=>{piContinueTaskId=piContinueTaskId===task.id?null:task.id;piContinuationPreview=null;piContinuationConsent=false;renderPiTasks();});resume.disabled=Boolean(roomState&&(roomState.ownership!=='agent'||roomState.userResumePending||roomState.executionRisk));resume.title=resume.disabled?extensionMessages.t('returnControlBeforeContinue'):'';meta.append(resume);}
      meta.append(button(extensionMessages.t('removeRecord'),async()=>{await api.invoke('clearPiTask',{taskId:task.id});if(piContinueTaskId===task.id)piContinueTaskId=null;if(piSelectedTaskId===task.id)piSelectedTaskId=null;await renderPiTasks();}));
    }
    row.append(meta);
    for(const turn of task.conversation||[]){const message=document.createElement('div');message.className=`pi-task-output ${turn.role==='user'?'from-user':'from-pi'}`;message.dataset.role=turn.role;message.setAttribute('aria-label',turn.role==='user'?extensionMessages.t('you'):'Corvid Agent');message.textContent=turn.text|| (turn.status==='running'?`${extensionMessages.t('taskRunning')}…`:'');row.append(message);}
    for(const event of task.events||[]){if(task.error&&event.type==='error'&&String(event.text||'').includes(task.error))continue;const line=document.createElement('div');line.className='pi-task-event';line.dataset.type=event.type;line.textContent=agentEventText(event);line.setAttribute('role',event.type==='error'?'alert':'status');row.append(line);}
    if(task.status==='failed'){
      const failure=document.createElement('div');failure.className='pi-task-error';failure.setAttribute('role','alert');
      const heading=document.createElement('strong');heading.textContent=extensionMessages.t('taskIncomplete');failure.append(heading);
      const reason=document.createElement('span');reason.textContent=userFacingAgentError(task.error,extensionMessages.t('taskFailedFallback'));failure.append(reason);row.append(failure);
      if(!task.hasSession){const guidance=document.createElement('div');guidance.className='pi-task-recovery-note';guidance.setAttribute('role','status');guidance.textContent=extensionMessages.t('noRecoverableRecord');row.append(guidance);}
    } else if(task.error){const error=document.createElement('div');error.className='pi-task-error';error.setAttribute('role','alert');error.textContent=userFacingAgentError(task.error);row.append(error);}
    if(task.stopUnconfirmed){const recovery=document.createElement('div');recovery.className='pi-task-recovery-note';recovery.setAttribute('role','status');recovery.textContent=extensionMessages.t('previousTurnStopUnknown');row.append(recovery);}
    else if(task.hasSession&&!task.canContinue){const recovery=document.createElement('div');recovery.className='pi-task-recovery-note';recovery.setAttribute('role','status');recovery.textContent=extensionMessages.t('cannotContinueHere');row.append(recovery);}
    if(task.canContinue||['preparing','running'].includes(task.status)||task.messageQueue?.length)row.append(buildMessageQueuePanel(task,roomState));
    list.append(row);
  }
  updatePiTaskElapsedTimes();
  if(!piTasks.length&&!piHistoryOpen){const empty=document.createElement('div');empty.className='pi-chat-welcome';const mark=document.createElement('span');mark.className='pi-welcome-mark';mark.textContent='✳';const heading=document.createElement('h3');heading.textContent=extensionMessages.t('welcomeAgentHeading');const description=document.createElement('p');description.textContent=extensionMessages.t('welcomeAgentDescription');empty.append(mark,heading,description);list.append(empty);}
  if(piHistoryOpen&&!piTasks.length){const empty=document.createElement('p');empty.className='workspace-empty-state';empty.textContent=extensionMessages.t('noConversationHistory');list.append(empty);}
  list.scrollTop=historyAtEnd?list.scrollHeight:historyTop;
  const currentComposer=document.querySelector('#pi-task-form'),continuingTask=piTasks.find(task=>task.id===piContinueTaskId);
  if(continuingTask&&currentComposer)currentComposer.replaceWith(buildContinuationComposer(continuingTask));
  else if(currentComposer?.classList.contains('pi-continuation-form'))renderPiWorkbench();
}
function buildMessageQueuePanel(task, roomState) {
  const queue=task.messageQueue||[], panel=document.createElement('section');panel.className='pi-message-queue';panel.setAttribute('aria-label',extensionMessages.t('followUpQueue'));
  const heading=document.createElement('div');heading.className='pi-message-queue-heading';
  const title=document.createElement('strong');title.textContent=`${extensionMessages.t('followUpQueue')} · ${extensionMessages.formatNumber(queue.length)}`;
  const help=document.createElement('span');help.textContent=extensionMessages.t('followUpQueueHelp');heading.append(title,help);panel.append(heading);
  const frozen=!roomState||roomState.ownership!=='agent'||Boolean(roomState.userResumePending||roomState.executionRisk);
  if(frozen&&queue.length){const notice=document.createElement('p');notice.className='pi-message-queue-notice';notice.setAttribute('role','status');notice.textContent=extensionMessages.t('queueFrozenNotice');panel.append(notice);}
  if(['preparing','running'].includes(task.status)){const notice=document.createElement('p');notice.className='pi-message-queue-notice';notice.setAttribute('role','status');notice.textContent=extensionMessages.t('queueBusyNotice');panel.append(notice);}
  const entries=document.createElement('ol');entries.className='pi-message-queue-list';
  for(const [index,item] of queue.entries()){
    const entry=document.createElement('li');entry.className='pi-message-queue-item';
    const label=document.createElement('span');label.className='pi-message-queue-position';label.textContent=extensionMessages.t('queuedMessagePosition',{position:extensionMessages.formatNumber(index+1)});entry.append(label);
    if(piQueueEdit?.taskId===task.id&&piQueueEdit.itemId===item.id){
      const editor=document.createElement('textarea');editor.className='pi-message-queue-editor';editor.value=piQueueDraft;editor.setAttribute('aria-label',extensionMessages.t('editQueuedMessage'));entry.append(editor);
      const save=button(extensionMessages.t('saveQueuedMessage'),async()=>{try{await api.invoke('updatePiTaskMessage',{taskId:task.id,itemId:item.id,text:editor.value});piQueueEdit=null;piQueueDraft='';await renderPiTasks();}catch(error){errorText.setAttribute('role','alert');errorText.textContent=userFacingAgentError(error);}});entry.append(save);
      const cancel=button(extensionMessages.t('cancelContinue'),()=>{piQueueEdit=null;piQueueDraft='';renderPiTasks();});entry.append(cancel);
      const errorText=document.createElement('span');entry.append(errorText);
    }else{
      const content=document.createElement('p');content.className='pi-message-queue-text';content.textContent=item.text;entry.append(content);
      const actions=document.createElement('div');actions.className='pi-message-queue-actions';
      const earlier=button(extensionMessages.t('moveEarlier'),async()=>{await api.invoke('movePiTaskMessage',{taskId:task.id,itemId:item.id,offset:-1});await renderPiTasks();});earlier.disabled=index===0;actions.append(earlier);
      const later=button(extensionMessages.t('moveLater'),async()=>{await api.invoke('movePiTaskMessage',{taskId:task.id,itemId:item.id,offset:1});await renderPiTasks();});later.disabled=index===queue.length-1;actions.append(later);
      const edit=button(extensionMessages.t('editQueuedMessage'),()=>{piQueueEdit={taskId:task.id,itemId:item.id};piQueueDraft=item.text;renderPiTasks();});actions.append(edit);
      const remove=button(extensionMessages.t('removeQueuedMessage'),async()=>{await api.invoke('removePiTaskMessage',{taskId:task.id,itemId:item.id});if(piQueueSend?.itemId===item.id)piQueueSend=null;await renderPiTasks();});actions.append(remove);
      const canSend=task.canContinue&&['completed','interrupted','failed','waiting_for_user'].includes(task.status)&&index===0;
      if(canSend){const sendNext=button(extensionMessages.t('sendNextQueuedMessage'),()=>{piQueueSend={taskId:task.id,itemId:item.id,preview:null,consent:false};renderPiTasks();});sendNext.className='pi-message-queue-send';sendNext.disabled=Boolean(frozen);sendNext.title=sendNext.disabled?extensionMessages.t('returnControlBeforeContinue'):'';actions.append(sendNext);}
      entry.append(actions);
      if(piQueueSend?.taskId===task.id&&piQueueSend.itemId===item.id){
        const review=button(extensionMessages.t('reviewPageContent'),async()=>{try{const preview=await api.invoke('preparePiTask',{profileId:task.profileId,roomId:task.roomId,tabId:task.tabId});piQueueSend={...piQueueSend,preview,consent:false};renderPiTasks();}catch(error){sendError.setAttribute('role','alert');sendError.textContent=userFacingAgentError(error);}});entry.append(review);
        if(piQueueSend.preview){const details=document.createElement('div');details.className='pi-context';details.textContent=`${extensionMessages.t('shareWithAgent')}\n${piQueueSend.preview.title}\n${piQueueSend.preview.url}${piQueueSend.preview.snapshotTruncated?`\n${extensionMessages.t('truncatedPagePreview')}`:''}\n\n${piQueueSend.preview.snapshot}`;entry.append(details);
          const consentLabel=document.createElement('label'),consent=document.createElement('input');consent.type='checkbox';consent.checked=piQueueSend.consent;consentLabel.append(consent,document.createTextNode(extensionMessages.t('consentPageAndInstruction')));consent.onchange=()=>{piQueueSend={...piQueueSend,consent:consent.checked};dispatch.disabled=!consent.checked;};entry.append(consentLabel);
          const dispatch=button(extensionMessages.t('send'),async()=>{dispatch.disabled=true;try{await api.invoke('continuePiTask',{taskId:task.id,queueItemId:item.id,queueItemRevision:item.revision,includePageContext:consent.checked,contextPreview:piQueueSend.preview});piQueueSend=null;await renderPiTasks();}catch(error){sendError.setAttribute('role','alert');sendError.textContent=extensionMessages.t('messageNotSent',{message:userFacingAgentError(error)});dispatch.disabled=!consent.checked;}});dispatch.className='pi-primary-action';dispatch.disabled=!piQueueSend.consent;entry.append(dispatch);
        }
        const cancel=button(extensionMessages.t('cancelContinue'),()=>{piQueueSend=null;renderPiTasks();});cancel.className='pi-secondary-action';entry.append(cancel);
        const sendError=document.createElement('span');entry.append(sendError);
      }
    }
    entries.append(entry);
  }
  if(queue.length)panel.append(entries);else{const empty=document.createElement('p');empty.className='pi-message-queue-empty';empty.textContent=extensionMessages.t('followUpQueueEmpty');panel.append(empty);}
  if(task.canContinue||['preparing','running'].includes(task.status)){
    const form=document.createElement('form');form.className='pi-message-queue-form';
    const input=document.createElement('textarea');input.value=piQueueDrafts.get(task.id)||'';input.placeholder=extensionMessages.t('followUpQueuePlaceholder');input.setAttribute('aria-label',extensionMessages.t('followUpQueueLabel'));input.maxLength=8_000;let add;input.oninput=()=>{piQueueDrafts.set(task.id,input.value);if(add)add.disabled=!input.value.trim()||queue.length>=20;};form.append(input);
    add=button(extensionMessages.t('addToQueue'),async()=>{add.disabled=true;try{await api.invoke('queuePiTaskMessage',{taskId:task.id,text:input.value});piQueueDrafts.delete(task.id);await renderPiTasks();}catch(error){errorText.setAttribute('role','alert');errorText.textContent=userFacingAgentError(error);add.disabled=false;}});add.type='submit';add.disabled=!input.value.trim()||queue.length>=20;form.append(add);
    const errorText=document.createElement('span');form.append(errorText);
    form.onsubmit=event=>{event.preventDefault();if(!add.disabled)add.click();};panel.append(form);
  }
  return panel;
}
function buildContinuationComposer(task){
  const form=document.createElement('section');form.id='pi-task-form';form.className='pi-continuation-form';form.setAttribute('aria-label',extensionMessages.t('continueConversation'));
  const page=document.createElement('div');page.className='pi-page-binding';page.textContent=`${extensionMessages.t('continueThisConversation')} · ${task.page?.title||task.page?.url||extensionMessages.t('currentPage')} · ${task.selectedModel?.name||'Corvid Agent'}`;form.append(page);
  if(task.continuationMode==='saved-conversation'){const note=document.createElement('p');note.className='pi-task-recovery-note';note.textContent=extensionMessages.t('savedConversationContextLimit');form.append(note);}
  const prompt=document.createElement('textarea');prompt.setAttribute('aria-label',extensionMessages.t('continueTaskLabel'));prompt.placeholder=extensionMessages.t('continueTaskPlaceholder');prompt.value=piContinuationDraft;prompt.oninput=()=>{piContinuationDraft=prompt.value;};form.append(prompt);
  const preview=button(extensionMessages.t('reviewPageContent'),async()=>{try{piContinuationPreview=await api.invoke('preparePiTask',{profileId:task.profileId,roomId:task.roomId,tabId:task.tabId});piContinuationConsent=false;renderPiTasks();}catch(error){message.textContent=extensionMessages.t('cannotReadPageContext',{message:userFacingAgentError(error)});}});form.append(preview);
  if(piContinuationPreview){
    const details=document.createElement('div');details.className='pi-context';details.textContent=`${extensionMessages.t('shareWithAgent')}\n${piContinuationPreview.title}\n${piContinuationPreview.url}${piContinuationPreview.snapshotTruncated?`\n${extensionMessages.t('truncatedPagePreview')}`:''}\n\n${piContinuationPreview.snapshot}`;form.append(details);
    const consent=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.id='pi-continuation-consent';check.checked=piContinuationConsent;consent.append(check,document.createTextNode(extensionMessages.t('consentPageAndInstruction')));form.append(consent);
    const send=button(extensionMessages.t('send'),async()=>{try{await api.invoke('continuePiTask',{taskId:task.id,message:prompt.value,includePageContext:check.checked,contextPreview:piContinuationPreview});piContinuationPreview=null;piContinuationDraft='';piContinuationConsent=false;piContinueTaskId=task.id;await renderPiWorkbench();}catch(error){message.textContent=extensionMessages.t('messageNotSent',{message:userFacingAgentError(error)});}});send.disabled=!check.checked||!prompt.value.trim();check.onchange=()=>{piContinuationConsent=check.checked;send.disabled=!check.checked||!prompt.value.trim();};prompt.oninput=()=>{piContinuationDraft=prompt.value;send.disabled=!check.checked||!prompt.value.trim();};form.append(send);
  }
  const cancel=button(extensionMessages.t('cancelContinue'),()=>{piContinueTaskId=null;piContinuationPreview=null;piContinuationConsent=false;renderPiWorkbench();});cancel.className='pi-secondary-action';form.append(cancel);
  const message=document.createElement('div');message.setAttribute('role','alert');form.append(message);return form;
}
async function renderPiModelControls(target){
  const version=(piModelControlVersions.get(target)||0)+1;piModelControlVersions.set(target,version);
  target.replaceChildren();
  const status=document.createElement('span');status.className='pi-model-status';status.setAttribute('role','status');status.textContent=extensionMessages.t('modelCatalogLoading');
  try{
    const catalog=await api.invoke('piModels');if(piModelControlVersions.get(target)!==version)return;const select=document.createElement('select');select.className='pi-model-select';select.setAttribute('aria-label',extensionMessages.t('agentModel'));
    for(const provider of catalog.providers){
      const group=document.createElement('optgroup');group.label=provider.name;
      for(const model of provider.models){const option=document.createElement('option');option.value=JSON.stringify({providerId:provider.id,modelId:model.id});option.textContent=model.name;option.selected=provider.id===catalog.selection.providerId&&model.id===catalog.selection.modelId;group.append(option);}
      select.append(group);
    }
    if(!Array.from(select.options).some(option=>option.value===JSON.stringify(catalog.selection))){const missing=document.createElement('option');missing.value=JSON.stringify(catalog.selection);missing.textContent=extensionMessages.t('modelNotFound',{model:`${catalog.selection.providerId}/${catalog.selection.modelId}`});missing.selected=true;missing.disabled=true;select.prepend(missing);}
    if(!select.options.length)throw new Error(extensionMessages.t('noChatModels'));
    select.onchange=async()=>{try{const next=JSON.parse(select.value);await api.invoke('selectPiModel',next);const provider=catalog.providers.find(item=>item.id===next.providerId);status.textContent=provider?.configured?extensionMessages.t('useModelForNewTasks'):extensionMessages.t('connectModelAccount');renderPiModelActions(target,catalog,next,status);}catch(error){status.textContent=`${extensionMessages.t('cannotSelectModel')}: ${userFacingAgentError(error)}`;}};
    target.append(select,status);renderPiModelActions(target,catalog,catalog.selection,status);
    const manage=button(extensionMessages.t('manageModels'),()=>void openPiModelSettings());manage.type='button';manage.className='pi-model-action pi-model-manage';manage.setAttribute('aria-label',extensionMessages.t('modelCatalog'));target.append(manage);
  }catch(error){if(piModelControlVersions.get(target)!==version)return;status.textContent=`${extensionMessages.t('modelSettingsUnavailable')}: ${userFacingAgentError(error)}`;target.append(status);}
}
function renderPiModelActions(target,catalog,selection,status){
  target.querySelectorAll('.pi-model-action:not(.pi-model-manage),.pi-model-key').forEach(node=>node.remove());
  const provider=catalog.providers.find(item=>item.id===selection.providerId);if(!provider)return;
  status.textContent=userFacingAgentError(provider.authStatus,provider.configured?extensionMessages.t('connected'):extensionMessages.t('notConnected'));status.setAttribute('aria-label',`${provider.name} ${status.textContent}`);status.title=`${provider.name} · ${status.textContent}`;
  if(provider.configured&&!provider.customEndpoint){const logout=button(extensionMessages.t('logout'),async()=>{logout.disabled=true;try{await api.invoke('logoutPiProvider',{providerId:provider.id});await renderPiModelControls(target);}catch(error){logout.disabled=false;status.textContent=extensionMessages.t('logoutFailed',{message:userFacingAgentError(error)});}});logout.className='pi-model-action';target.append(logout);return;}
  if(provider.customEndpoint)return;
  if(provider.supportsOAuth){const connect=button(extensionMessages.t('connectAccount'),async()=>{connect.disabled=true;status.textContent=extensionMessages.t('openingSignIn');try{await api.invoke('loginPiProvider',{providerId:provider.id});await renderPiModelControls(target);}catch(error){connect.disabled=false;status.textContent=extensionMessages.t('signInIncomplete',{message:userFacingAgentError(error)});}});connect.className='pi-model-action';target.append(connect);}
  if(provider.supportsApiKey){const key=document.createElement('input');key.className='pi-model-key';key.type='password';key.autocomplete='off';key.spellcheck=false;key.placeholder=extensionMessages.t('apiKeyPlaceholder');key.setAttribute('aria-label',`${provider.name} ${extensionMessages.t('apiKeyPlaceholder')}`);const save=button(extensionMessages.t('connectKey'),async()=>{save.disabled=true;try{await api.invoke('loginPiProviderApiKey',{providerId:provider.id,apiKey:key.value});key.value='';await renderPiModelControls(target);}catch(error){save.disabled=false;status.textContent=extensionMessages.t('connectFailed',{message:userFacingAgentError(error)});}});save.className='pi-model-action';target.append(key,save);}
  if(!provider.supportsOAuth&&!provider.supportsApiKey)status.textContent+=` · ${extensionMessages.t('configureAuthentication')}`;
}
function resetPiEndpointForm(){
  document.querySelector('#pi-endpoint-id').value='';document.querySelector('#pi-endpoint-name').value='';document.querySelector('#pi-endpoint-url').value='';document.querySelector('#pi-endpoint-key').value='';document.querySelector('#pi-endpoint-model-ids').value='';document.querySelector('#pi-endpoint-clear-key').checked=false;document.querySelector('#pi-endpoint-form-title').textContent=extensionMessages.t('addCustomEndpoint');document.querySelector('#pi-endpoint-error').textContent='';document.querySelector('#pi-endpoint-discovered').textContent='';
}
async function renderPiCustomEndpoints(){
  const list=document.querySelector('#pi-custom-endpoints');list.replaceChildren();
  try{
    const catalog=await api.invoke('piModels');
    if(!catalog.endpoints.length){const empty=document.createElement('p');empty.className='pi-endpoint-empty';empty.textContent=extensionMessages.t('noCustomEndpoints');list.append(empty);return;}
    for(const endpoint of catalog.endpoints){
      const row=document.createElement('div');row.className='pi-endpoint-row';
      const info=document.createElement('div'),name=document.createElement('strong'),details=document.createElement('span');name.textContent=endpoint.name;details.textContent=`${endpoint.baseUrl} · ${extensionMessages.formatList(endpoint.modelIds)}${endpoint.configuredKey?` · ${extensionMessages.t('apiKeySaved')}`:''}`;info.append(name,details);
      const edit=button(extensionMessages.t('edit'),()=>{document.querySelector('#pi-endpoint-id').value=endpoint.id;document.querySelector('#pi-endpoint-name').value=endpoint.name;document.querySelector('#pi-endpoint-url').value=endpoint.baseUrl;document.querySelector('#pi-endpoint-key').value='';document.querySelector('#pi-endpoint-model-ids').value=endpoint.modelIds.join('\n');document.querySelector('#pi-endpoint-clear-key').checked=false;document.querySelector('#pi-endpoint-form-title').textContent=extensionMessages.t('editCustomEndpoint');document.querySelector('#pi-endpoint-error').textContent='';document.querySelector('#pi-endpoint-name').focus();});edit.type='button';
      const remove=button(extensionMessages.t('remove'),async()=>{if(!window.confirm(extensionMessages.t('removeEndpointConfirm',{name:endpoint.name})))return;remove.disabled=true;try{await api.invoke('removePiEndpoint',{id:endpoint.id});await renderPiCustomEndpoints();await renderPiModelControls(document.querySelector('.pi-model-controls'));}catch(error){remove.disabled=false;document.querySelector('#pi-endpoint-error').textContent=userFacingAgentError(error);}});remove.type='button';
      row.append(info,edit,remove);list.append(row);
    }
  }catch(error){document.querySelector('#pi-endpoint-error').textContent=extensionMessages.t('cannotReadModelSettings',{message:userFacingAgentError(error)});}
}
async function openPiModelSettings(){
  resetPiEndpointForm();await renderPiCustomEndpoints();await openShellDialog('#pi-model-settings','#pi-endpoint-name');
}
function renderPiWorkbench(){
  if(piBinding&&piBinding.profileId!==state.activeProfileId){piBinding=null;piContextPreview=null;}
  const panel=document.querySelector('#library'),items=document.querySelector('#library-items');
  panel.dataset.kind='pi-workbench';document.querySelector('#library-title').textContent='Corvid Agent';document.querySelector('#library-search').hidden=true;items.replaceChildren();panel.querySelector('#pi-workbench-content')?.remove();
  const activeRoom=state.rooms.find(room=>room.id===state.activeRoomId),current=activeRoom?.tabs.find(tab=>tab.active);
  if(!piBinding&&activeRoom?.ownership==='agent'&&current?.label)piBinding={roomId:activeRoom.id,tabId:current.id,profileId:activeRoom.profileId};
  const form=document.createElement('section');form.id='pi-task-form';
  const page=document.createElement('div');page.className='pi-page-binding';page.setAttribute('role','status');
  const bound=piBinding&&state.rooms.find(room=>room.id===piBinding.roomId)?.tabs.find(tab=>tab.id===piBinding.tabId);
  if(bound){const room=state.rooms.find(value=>value.id===piBinding.roomId);page.textContent=extensionMessages.t('taskPageLabel',{room:room.name,label:bound.label,title:bound.title||bound.url});}
  else page.textContent=current&&/^https?:/i.test(current.url)?extensionMessages.t('currentPageLabel',{page:current.title||current.url}):extensionMessages.t('openHttpPageFirst');
  form.append(page);
  if(!bound&&current&&/^https?:/i.test(current.url)){
    const create=button(extensionMessages.t('connectCurrentPage'),async()=>{try{const room=await api.invoke('createPiRoom',{sourceTabId:current.id,sourceUrl:current.url,name:extensionMessages.t('corvidAgentConversation')});piBinding={roomId:room.id,tabId:room.tabs[0].id,profileId:room.profileId};piContextPreview=null;renderPiWorkbench();}catch(error){page.textContent=extensionMessages.t('cannotConnectCurrentPage',{message:userFacingAgentError(error)});}});create.className='pi-create-room';form.append(create);
  }
  const prompt=document.createElement('textarea');prompt.id='pi-task-prompt';prompt.setAttribute('aria-label',extensionMessages.t('describeBrowserTask'));prompt.placeholder=extensionMessages.t('askAboutPagePlaceholder');prompt.value=piPromptDraft;prompt.oninput=()=>{piPromptDraft=prompt.value;};form.append(prompt);
  const modelControls=document.createElement('div');modelControls.className='pi-model-controls';form.insertBefore(modelControls,prompt);void renderPiModelControls(modelControls);
  const previewButton=button(extensionMessages.t('verifyPageContext'),async()=>{if(!piBinding){page.textContent=extensionMessages.t('connectPageFirst');return;}try{piContextPreview=await api.invoke('preparePiTask',piBinding);renderPiWorkbench();document.querySelector('#pi-context-consent')?.focus();}catch(error){page.textContent=extensionMessages.t('cannotReadPageContext',{message:userFacingAgentError(error)});}});previewButton.className='pi-secondary-action';previewButton.disabled=!piBinding;form.append(previewButton);
  if(piContextPreview){
    const details=document.createElement('div');details.className='pi-context';details.textContent=`${extensionMessages.t('shareWithAgent')}\n${piContextPreview.title}\n${piContextPreview.url}${piContextPreview.snapshotTruncated?`\n${extensionMessages.t('truncatedPagePreview')}`:''}\n\n${piContextPreview.snapshot}`;form.append(details);
    const consent=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.id='pi-context-consent';consent.className='pi-consent';consent.append(check,document.createTextNode(extensionMessages.t('pageShareConsent')));form.append(consent);
    let starting=false;
    const start=button(extensionMessages.t('send'),async()=>{if(starting)return;starting=true;start.disabled=true;start.textContent=extensionMessages.t('startingTask');start.setAttribute('aria-busy','true');try{const task=await api.invoke('startPiTask',{...piBinding,prompt:prompt.value,includePageContext:check.checked,contextPreview:piContextPreview});piSelectedTaskId=task?.id||null;piShowNewChat=false;piContextPreview=null;piPromptDraft='';renderPiWorkbench();}catch(error){page.textContent=extensionMessages.t('messageNotSent',{message:userFacingAgentError(error)});starting=false;start.removeAttribute('aria-busy');start.textContent=extensionMessages.t('send');start.disabled=!bound||!check.checked||!prompt.value.trim();}});start.className='pi-primary-action';start.disabled=!bound||!check.checked||!prompt.value.trim();check.onchange=()=>{start.disabled=starting||!bound||!check.checked||!prompt.value.trim();};prompt.oninput=()=>{piPromptDraft=prompt.value;start.disabled=starting||!bound||!check.checked||!prompt.value.trim();};form.append(start);
  }
  const workspace=document.createElement('div');workspace.id='pi-workbench-content';workspace.dataset.newChat=String(piShowNewChat);
  const list=document.createElement('div');list.id='pi-task-list';
  const announcement=document.createElement('div');announcement.id='pi-task-announcer';announcement.className='visually-hidden';announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');announcement.setAttribute('aria-atomic','true');
  workspace.append(list,form,announcement);panel.append(workspace);void renderPiTasks();
}
function setLibraryPanel(kind,trigger=null){
  libraryKind=kind;libraryTrigger=kind?trigger:null;
  syncPiTaskElapsedTimer();
  const panel=document.querySelector('#library');
  const agentRoomAnnouncement=document.querySelector('#agent-room-announcer');if(agentRoomAnnouncement){agentRoomAnnouncement.hidden=kind!=='agent-rooms';if(agentRoomAnnouncement.hidden)agentRoomAnnouncement.textContent='';}
  if(kind){panel.hidden=false;panel.setAttribute('aria-label',kind==='pi-workbench'?'Corvid Agent':kind==='agent-rooms'?extensionMessages.t('agentWorkspace'):kind==='bookmarks'?extensionMessages.t('bookmarksTitle'):kind==='history'?extensionMessages.t('historyTitle'):extensionMessages.t('downloadsTitle'));}
  else{panel.hidden=true;delete panel.dataset.kind;panel.setAttribute('aria-label',extensionMessages.t('libraryPanel'));}
  for(const name of ['bookmarks','history','downloads','agent-rooms','pi-workbench'])document.querySelector(`#show-${name}`).setAttribute('aria-expanded',String(kind===name));
}
function closeLibraryPanel({restoreFocus=false}={}){
  const trigger=libraryTrigger;setLibraryPanel(null);
  const closed=api.invoke('setPanel',{open:false});
  if(restoreFocus&&trigger?.isConnected)trigger.focus();
  return closed;
}
async function showLibrary(kind,trigger=document.activeElement) {if(libraryKind!==kind)document.querySelector('#library-search').value='';setLibraryPanel(kind,trigger);await api.invoke('setPanel',{open:true,workspace:true});await renderLibrary();}
let bookmarksRenderVersion=0;
async function renderBookmarksBar() {
  const version=++bookmarksRenderVersion, profileId=state?.activeProfileId;
  if(!profileId)return;
  const result=await api.invoke('bookmarks',{profileId});
  if(version!==bookmarksRenderVersion || state?.activeProfileId!==profileId)return;
  const bar=document.querySelector('#bookmarks-bar');bar.replaceChildren();
  const active=activeTab(),isBrowserHome=Boolean(active && active.url==='about:blank' && !active.isLoading && !active.navigationError);
  bar.toggleAttribute('hidden',isBrowserHome);
  if(isBrowserHome)return;
  const items=result.bookmarks.slice(0,12);
  for(const item of items){
    const link=document.createElement('a');link.className='bookmark-item';link.href='#';link.title=item.url;
    const icon=document.createElement('img');icon.alt='';icon.src=`${new URL(item.url).origin}/favicon.ico`;icon.onerror=()=>{icon.remove();};
    const label=document.createElement('span');label.textContent=item.title||item.url;
    link.append(icon,label);link.onclick=async event=>{event.preventDefault();const tab=activeTab();if(tab)await api.invoke('navigate',{id:tab.id,url:item.url});};bar.append(link);
  }
  if(result.bookmarks.length>items.length){const more=button(extensionMessages.t('moreBookmarks'),()=>showLibrary('bookmarks'));more.className='bookmark-item';bar.append(more);}
}
api.onBrowserHomeAction(kind=>{
  if(kind==='bookmarks')void showLibrary('bookmarks',document.querySelector('#show-bookmarks'));
  else if(kind==='history')void showLibrary('history',document.querySelector('#show-history'));
  else if(kind==='agent')void document.querySelector('#show-pi-workbench').click();
});
api.onState(draw); api.onPiTasks(()=>{if(libraryKind==='pi-workbench')void renderPiTasks();else if(libraryKind==='agent-rooms')void renderAgentRooms();}); api.onPiAuthEvent(event=>{const status=document.querySelector('.pi-model-status');if(event.type==='device_code'){if(status)status.textContent=extensionMessages.t('loginCode',{code:event.userCode,url:event.verificationUri});return;}if(event.type==='auth_url'){const link=document.querySelector('#pi-auth-open-url');link.href=event.url;link.hidden=false;link.onclick=async e=>{e.preventDefault();try{await api.invoke('openPiAuthUrl',{url:event.url});}catch(error){if(status)status.textContent=userFacingAgentError(error);}};if(status)status.textContent=extensionMessages.t('authBrowserInstruction');return;}if((event.type==='progress'||event.type==='info')&&status)status.textContent=userFacingAgentError(event.message,extensionMessages.t('connectingModelAccount'));});
api.onPiAuthPrompt(async request=>{
  const prompt=request.prompt||{},dialog=document.querySelector('#pi-auth-dialog'),form=document.querySelector('#pi-auth-form'),message=document.querySelector('#pi-auth-message'),label=document.querySelector('#pi-auth-input-label');let input=document.querySelector('#pi-auth-input');
  message.textContent=userFacingAgentError(prompt.message||prompt.instructions,extensionMessages.t('authorizationPrompt'));label.replaceChildren(document.createTextNode(prompt.type==='manual_code'?extensionMessages.t('authCodeOrCallback'):extensionMessages.t('authorizationInfo')));
  let cancelled=false,value;
  if(prompt.type==='select'){
    const options=prompt.options||prompt.choices||{},select=document.createElement('select');select.id='pi-auth-input';select.setAttribute('aria-label',extensionMessages.t('authMethod'));
    for(const option of options){const item=document.createElement('option');item.value=option.id;item.textContent=option.label||option.id;select.append(item);}
    label.append(select);input=select;
  }else{input.type=prompt.type==='secret'?'password':'text';input.value='';input.placeholder=prompt.placeholder||'';input.autocomplete='off';label.append(input);}
  const result=await new Promise(resolve=>{
    const finish=()=>{dialog.removeEventListener('close',closed);resolve(dialog.returnValue==='continue'?input.value:null);};
    const closed=()=>finish();dialog.addEventListener('close',closed,{once:true});
    form.onsubmit=event=>{event.preventDefault();dialog.close('continue');};
    document.querySelector('#pi-auth-cancel').onclick=()=>dialog.close('cancel');
    dialog.showModal();input.focus();
  });
  cancelled=result===null;value=result;
  if(input.tagName==='SELECT'){const replacement=document.createElement('input');replacement.id='pi-auth-input';replacement.autocomplete='off';input.replaceWith(replacement);}
  try{await api.invoke('resolvePiAuthPrompt',{id:request.id,value,cancelled});}catch(error){const status=document.querySelector('.pi-model-status');if(status)status.textContent=extensionMessages.t('authorizationStepFailed',{message:userFacingAgentError(error)});}
}); api.invoke('state').then(draw);
for(const [triggerId,menuId] of [['profile-menu-trigger','profile-menu'],['room-menu-trigger','room-menu']]){const trigger=document.querySelector(`#${triggerId}`),menu=document.querySelector(`#${menuId}`);trigger.onclick=()=>{const next=menu.hidden;for(const item of document.querySelectorAll('#profile-menu,#room-menu'))item.hidden=true;menu.hidden=!next;trigger.setAttribute('aria-expanded',String(!menu.hidden));};}
document.addEventListener('pointerdown',event=>{for(const [triggerId,menuId] of [['profile-menu-trigger','profile-menu'],['room-menu-trigger','room-menu']]){const trigger=document.querySelector(`#${triggerId}`),menu=document.querySelector(`#${menuId}`);if(!menu.hidden&&!menu.contains(event.target)&&!trigger.contains(event.target)){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}}});
document.addEventListener('keydown',event=>{if(event.key==='Escape')for(const [triggerId,menuId] of [['profile-menu-trigger','profile-menu'],['room-menu-trigger','room-menu']]){const trigger=document.querySelector(`#${triggerId}`),menu=document.querySelector(`#${menuId}`);if(!menu.hidden){menu.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();}}});
document.querySelector('#new-room-form').onsubmit = async event => { event.preventDefault(); const input=document.querySelector('#room-name'); const name=input.value.trim(); if(!name) return; await api.invoke('createRoom',{name,ownership:'user'}); input.value=''; document.querySelector('#new-room').close(); };
document.querySelector('#create-room-trigger').onclick=async()=>{await openShellDialog('#new-room','#room-name');};
document.querySelector('#cancel-room').onclick = () => document.querySelector('#new-room').close();
document.querySelector('#new-room').onclose = () => api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});
document.querySelector('#new-profile-form').onsubmit = async event => {event.preventDefault();const input=document.querySelector('#profile-name');const name=input.value.trim();if(!name)return;const profile=await api.invoke('createProfile',{name});await api.invoke('activateProfile',{id:profile.id});input.value='';document.querySelector('#new-profile').close();};
document.querySelector('#cancel-profile').onclick=()=>document.querySelector('#new-profile').close();
document.querySelector('#new-profile').onclose=()=>api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});
let renameProfileId;
document.querySelector('#rename-profile-form').onsubmit=async event=>{event.preventDefault();try{const profile=state.profiles.find(item=>item.id===renameProfileId),entered=document.querySelector('#renamed-profile-name').value,name=profile&&entered===profileDisplayName(profile)?profile.name:entered;await api.invoke('renameProfile',{id:renameProfileId,name});document.querySelector('#rename-profile').close();}catch(error){document.querySelector('#rename-profile-error').textContent=error.message;}};
document.querySelector('#cancel-rename-profile').onclick=()=>document.querySelector('#rename-profile').close();
document.querySelector('#rename-profile').onclose=()=>api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});
document.querySelector('#profile-deletion-select').onchange=()=>void refreshProfileDeletionPreview();
document.querySelector('#profile-deletion-form').onsubmit=async event=>{
  event.preventDefault();const id=document.querySelector('#profile-deletion-select').value;if(!id)return;
  const form=event.currentTarget,submit=document.querySelector('#confirm-profile-deletion'),select=document.querySelector('#profile-deletion-select'),cancel=document.querySelector('#cancel-profile-deletion'),errorNode=document.querySelector('#profile-deletion-error');
  submit.disabled=true;submit.textContent=extensionMessages.t('profileDeleteWorking');select.disabled=true;cancel.disabled=true;form.setAttribute('aria-busy','true');errorNode.hidden=true;
  try{await api.invoke('deleteProfile',{id});document.querySelector('#profile-deletion').close();}
  catch(error){select.disabled=false;cancel.disabled=false;form.removeAttribute('aria-busy');await refreshProfileDeletionPreview();errorNode.textContent=profileDeletionErrorText(error);errorNode.hidden=false;}
};
document.querySelector('#cancel-profile-deletion').onclick=()=>document.querySelector('#profile-deletion').close();
document.querySelector('#profile-deletion').addEventListener('cancel',event=>{if(document.querySelector('#profile-deletion-form').getAttribute('aria-busy')==='true')event.preventDefault();});
document.querySelector('#profile-deletion').onclose=()=>{profileDeletionPreviewVersion++;return api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});};
let settingsProfileId;
async function renderProfileExtensions(){
  const list=document.querySelector('#profile-extension-list');list.replaceChildren();
  const {extensions}=await api.invoke('listProfileExtensions',{profileId:settingsProfileId});
  if(!extensions.length){const empty=document.createElement('p');empty.className='empty-extension-list';empty.textContent=extensionMessages.t('extensionsNotImported');list.append(empty);return;}
  for(const extension of extensions){
    const row=document.createElement('article');row.className='profile-extension';
    const heading=document.createElement('div');heading.className='profile-extension-heading';
    const title=document.createElement('strong');title.textContent=extension.name;heading.append(title);
    const version=document.createElement('span');version.textContent=`v${extension.version} · MV${extension.manifestVersion}`;heading.append(version);row.append(heading);
    const grants=[...(extension.permissions?.required||[]),...(extension.permissions?.hosts||[])];
    const optional=[...(extension.permissions?.optional||[]),...(extension.permissions?.optionalHosts||[])];
    const permissionSeparator=extensionMessages.locale==='zh-CN'?'、':', ';
    const grantText=document.createElement('p');grantText.textContent=`${extensionMessages.t('requiredPermissions',{permissions:grants.join(permissionSeparator)||extensionMessages.t('permissionsNotDeclared')})}${optional.length?extensionMessages.t('optionalPermissions',{permissions:optional.join(permissionSeparator)}):''}`;row.append(grantText);
    if(extension.loadError){const warning=document.createElement('p');warning.className='extension-load-error';warning.textContent=extensionMessages.t('extensionLoadFailed',{message:extension.loadError});row.append(warning);}
    const actions=document.createElement('div');actions.className='profile-extension-actions';
    const toggleLabel=document.createElement('label');toggleLabel.className='extension-enabled';
    const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=extension.enabled;toggle.setAttribute('aria-label',`${extension.enabled?extensionMessages.t('disableExtension'):extensionMessages.t('enableExtension')} ${extension.name}`);
    toggle.onchange=async()=>{try{await api.invoke('setProfileExtensionEnabled',{profileId:settingsProfileId,extensionId:extension.id,enabled:toggle.checked});await renderProfileExtensions();}catch(error){toggle.checked=extension.enabled;document.querySelector('#settings-error').textContent=error.message;}};
    toggleLabel.append(toggle,document.createTextNode(extensionMessages.t('enable')));actions.append(toggleLabel);
    const remove=document.createElement('button');remove.type='button';remove.textContent=extensionMessages.t('remove');remove.onclick=async()=>{try{await api.invoke('removeProfileExtension',{profileId:settingsProfileId,extensionId:extension.id});await renderProfileExtensions();}catch(error){document.querySelector('#settings-error').textContent=error.message;}};actions.append(remove);
    row.append(actions);list.append(row);
  }
}
async function renderAgentAccess(){
  const roomOptions=document.querySelector('#agent-room-options'),list=document.querySelector('#agent-client-list');
  roomOptions.replaceChildren();list.replaceChildren();
  const rooms=state?.rooms||[];
  if(!rooms.length){const empty=document.createElement('p');empty.className='agent-client-empty';empty.textContent=extensionMessages.t('noGrantableSpaces');roomOptions.append(empty);}
  else for(const room of rooms){
    const label=document.createElement('label');label.className='agent-room-choice';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.name='agent-room-id';checkbox.value=room.id;checkbox.setAttribute('aria-label',`${room.name} · ${state.profiles.find(profile=>profile.id===room.profileId)?.name||extensionMessages.t('profile')}`);
    const name=document.createElement('span');name.textContent=`${room.name} · ${state.profiles.find(profile=>profile.id===room.profileId)?.name||extensionMessages.t('profile')}`;
    label.append(checkbox,name);roomOptions.append(label);
  }
  document.querySelector('#create-agent-client').disabled=!rooms.length;
  try{
    const {clients}=await api.invoke('listAgentClients');
    if(!clients.length){const empty=document.createElement('p');empty.className='agent-client-empty';empty.textContent=extensionMessages.t('noAuthorizedClients');list.append(empty);return;}
    for(const client of clients){
      const row=document.createElement('article');row.className='agent-client-row';row.dataset.revoked=String(client.revoked);
      const summary=document.createElement('div');summary.className='agent-client-summary';
      const name=document.createElement('strong');name.textContent=client.name;summary.append(name);
      const scope=(client.roomIds||[]).map(id=>rooms.find(room=>room.id===id)?.name||extensionMessages.t('removedSpace')).join(extensionMessages.locale==='zh-CN'?'、':', ')||extensionMessages.t('noSpaceAccess');
      const status=document.createElement('span');status.textContent=client.revoked?extensionMessages.t('accessRevoked',{scope}):extensionMessages.t('accessAvailable',{scope});summary.append(status);
      const created=document.createElement('span');created.textContent=extensionMessages.t('createdDate',{date:extensionMessages.formatDate(client.createdAt)});summary.append(created);row.append(summary);
      if(!client.revoked){const revoke=button(extensionMessages.t('revokeAccess'),async()=>{
        if(!window.confirm(extensionMessages.t('revokeClientConfirm',{name:client.name})))return;
        revoke.disabled=true;try{await api.invoke('revokeAgentClient',{id:client.id});document.querySelector('#agent-access-error').textContent='';await renderAgentAccess();}catch(error){revoke.disabled=false;document.querySelector('#agent-access-error').textContent=error.message;}
      });revoke.setAttribute('aria-label',extensionMessages.t('revokeClientLabel',{name:client.name}));row.append(revoke);}
      else row.append(document.createElement('span'));
      list.append(row);
    }
  }catch(error){document.querySelector('#agent-access-error').textContent=extensionMessages.t('cannotReadAuthorizedClients',{message:userFacingAgentError(error)});}
}
document.querySelector('#show-settings').onclick=async()=>{settingsProfileId=state.activeProfileId;const settings=await api.invoke('settings',{profileId:settingsProfileId});const preset=document.querySelector('#search-preset');const known=[...preset.options].some(option=>option.value===settings.searchTemplate);preset.value=known?settings.searchTemplate:'custom';document.querySelector('#search-template').value=settings.searchTemplate;document.querySelector('#settings-error').textContent='';await renderProfileExtensions();await openShellDialog('#settings');};
document.querySelector('#ui-locale').onchange=async event=>{const locale=event.currentTarget.value,previous=state.uiLocale;extensionMessages.setLocale(locale);try{await renderProfileExtensions();await api.invoke('setUiLocale',{locale});}catch{extensionMessages.setLocale(previous);await renderProfileExtensions();event.currentTarget.value=state.uiLocale;document.querySelector('#settings-error').textContent=extensionMessages.t('localeSaveFailed');}};
document.querySelector('#open-agent-access').onclick=async()=>{document.querySelector('#settings').close();document.querySelector('#agent-access-error').textContent='';document.querySelector('#agent-client-token-panel').hidden=true;document.querySelector('#agent-client-token').value='';document.querySelector('#agent-client-form').reset();await renderAgentAccess();await openShellDialog('#agent-access-dialog','#agent-client-name');};
document.querySelector('#close-agent-access').onclick=()=>document.querySelector('#agent-access-dialog').close();
document.querySelector('#agent-access-dialog').addEventListener('close',()=>{document.querySelector('#agent-client-token').value='';document.querySelector('#agent-client-token-panel').hidden=true;document.querySelector('#agent-client-copy-status').textContent='';});
document.querySelector('#agent-client-form').onsubmit=async event=>{event.preventDefault();const roomIds=[...document.querySelectorAll('input[name="agent-room-id"]:checked')].map(input=>input.value);const error=document.querySelector('#agent-access-error');error.textContent='';if(!roomIds.length){error.textContent=extensionMessages.t('selectAtLeastOneSpace');return;}const submit=document.querySelector('#create-agent-client');submit.disabled=true;try{const client=await api.invoke('createAgentClient',{name:document.querySelector('#agent-client-name').value,roomIds});document.querySelector('#agent-client-form').reset();document.querySelector('#agent-client-token').value=client.token;document.querySelector('#agent-client-token-panel').hidden=false;await renderAgentAccess();document.querySelector('#agent-client-token').focus();}catch(failure){error.textContent=userFacingAgentError(failure);}finally{submit.disabled=!(state?.rooms?.length);}};
document.querySelector('#copy-agent-client-token').onclick=async()=>{const status=document.querySelector('#agent-client-copy-status');try{await api.invoke('copyTextToClipboard',{text:document.querySelector('#agent-client-token').value});status.textContent=extensionMessages.t('copiedToClipboard');}catch(error){status.textContent=extensionMessages.t('copyFailed',{message:userFacingAgentError(error)});}};
document.querySelector('#search-preset').onchange=event=>{if(event.target.value!=='custom')document.querySelector('#search-template').value=event.target.value;};
document.querySelector('#search-template').oninput=()=>{document.querySelector('#search-preset').value='custom';};
document.querySelector('#settings-form').onsubmit=async event=>{event.preventDefault();try {await api.invoke('saveSettings',{profileId:settingsProfileId,searchTemplate:document.querySelector('#search-template').value});document.querySelector('#settings').close();}catch(error){document.querySelector('#settings-error').textContent=error.message;}};
document.querySelector('#cancel-settings').onclick=()=>document.querySelector('#settings').close();
document.querySelector('#settings').onclose=()=>api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});
document.querySelector('#close-pi-model-settings').onclick=()=>document.querySelector('#pi-model-settings').close();
document.querySelector('#reset-pi-endpoint-form').onclick=resetPiEndpointForm;
document.querySelector('#discover-pi-endpoint-models').onclick=async event=>{
  const action=event.currentTarget;action.disabled=true;const status=document.querySelector('#pi-endpoint-discovered');status.textContent=extensionMessages.t('readingModelList');
  try{const ids=await api.invoke('discoverPiEndpointModels',{baseUrl:document.querySelector('#pi-endpoint-url').value,apiKey:document.querySelector('#pi-endpoint-key').value});document.querySelector('#pi-endpoint-model-ids').value=ids.join('\n');status.textContent=extensionMessages.t('discoveredModels',{count:extensionMessages.formatNumber(ids.length)});}
  catch(error){status.textContent=extensionMessages.t('readingModelsFailed',{message:userFacingAgentError(error)});}
  finally{action.disabled=false;}
};
document.querySelector('#pi-model-endpoint-form').onsubmit=async event=>{
  event.preventDefault();const save=document.querySelector('#save-pi-endpoint'),error=document.querySelector('#pi-endpoint-error');save.disabled=true;error.textContent='';
  try{
    const id=document.querySelector('#pi-endpoint-id').value;
    await api.invoke('savePiEndpoint',{...(id?{id}:{}),name:document.querySelector('#pi-endpoint-name').value,baseUrl:document.querySelector('#pi-endpoint-url').value,apiKey:document.querySelector('#pi-endpoint-key').value,clearApiKey:document.querySelector('#pi-endpoint-clear-key').checked,modelIds:document.querySelector('#pi-endpoint-model-ids').value});
    resetPiEndpointForm();document.querySelector('#pi-endpoint-discovered').textContent=extensionMessages.t('endpointSavedAndAdded');await renderPiCustomEndpoints();const controls=document.querySelector('.pi-model-controls');if(controls)await renderPiModelControls(controls);
  }catch(cause){error.textContent=extensionMessages.t('savingEndpointFailed',{message:userFacingAgentError(cause)});}
  finally{save.disabled=false;}
};
let chromeSources=[],chromeSourceId='',chromeSourceToken='',chromeImportProfileId='',chromeImportProfileLocked=false;
const chromeImportDialog=document.querySelector('#chrome-import');
async function openChromeImportDialog(){
  chromeSources=[];chromeSourceId='';chromeSourceToken='';document.querySelector('#chrome-import-error').textContent='';
  document.querySelector('#chrome-import-error').removeAttribute('data-success');
  document.querySelector('#chrome-import-error').removeAttribute('data-partial');
  const targetProfile=document.querySelector('#chrome-import-target-profile');
  targetProfile.replaceChildren(...state.profiles.map(profile=>new Option(profile.name,profile.id)));
  chromeImportProfileId=state.profiles.some(profile=>profile.id===settingsProfileId)?settingsProfileId:state.activeProfileId;
  chromeImportProfileLocked=false;targetProfile.disabled=false;
  targetProfile.value=chromeImportProfileId;
  document.querySelector('#chrome-source-profile').replaceChildren(new Option(extensionMessages.t('chooseChromeProfileFirst'),''));
  document.querySelector('#chrome-source-profile').disabled=true;document.querySelector('#chrome-import-categories').disabled=true;document.querySelector('#confirm-chrome-import').disabled=true;
  document.querySelector('#chrome-extension-choices').replaceChildren();
  document.querySelector('#chrome-cookie-consent-check').checked=false;
  document.querySelector('#chrome-cookie-consent').hidden=true;
  for(const input of document.querySelectorAll('input[name="chrome-category"]'))input.checked=input.value==='bookmarks'||input.value==='history';
  document.querySelector('#chrome-import-preview').textContent=extensionMessages.t('chooseDirectoryForCounts');
  await openShellDialog('#chrome-import');
}
function showChromePreview(preview){
  const errors=preview.errors||{},unavailable=extensionMessages.t('categoryCountUnavailable');
  const bookmarkCount=errors.bookmarks?unavailable:extensionMessages.formatNumber(preview.bookmarks);
  const historyCount=errors.history?unavailable:extensionMessages.formatNumber(preview.history);
  const cookieCount=errors.cookies?unavailable:preview.cookies===null?null:extensionMessages.formatNumber(preview.cookies);
  const summaryKey=Object.keys(errors).length?'importPreviewSomeCategoriesUnavailable':'importPreviewSummary';
  document.querySelector('#chrome-import-preview').textContent=extensionMessages.t(summaryKey,{source:preview.sourceName,bookmarks:bookmarkCount,history:historyCount,cookies:cookieCount===null?'':extensionMessages.t('cookiePreviewSuffix',{count:cookieCount}),extensions:extensionMessages.t('extensionPreviewSuffix',{count:extensionMessages.formatNumber(preview.extensions.length)})});
  document.querySelector('#chrome-bookmark-count').textContent=errors.bookmarks?unavailable:extensionMessages.t('itemCount',{count:bookmarkCount});
  document.querySelector('#chrome-history-count').textContent=errors.history?unavailable:extensionMessages.t('itemCount',{count:historyCount});
  document.querySelector('#chrome-cookie-count').textContent=errors.cookies?unavailable:preview.cookies===null?(preview.canImportCookies?extensionMessages.t('databaseUnavailable'):extensionMessages.t('unsupportedPlatform')):extensionMessages.t('itemCount',{count:cookieCount});
  document.querySelector('#chrome-extension-count').textContent=extensionMessages.t('itemCount',{count:extensionMessages.formatNumber(preview.extensions.length)});
  const checks=[...document.querySelectorAll('input[name="chrome-category"]')];
  for(const category of ['bookmarks','history','cookies']){
    const input=checks.find(item=>item.value===category),failed=Boolean(errors[category]);
    input.disabled=failed||(category==='bookmarks'?preview.bookmarks===0:category==='history'?preview.history===0:!preview.canImportCookies||preview.cookies===null||preview.cookies===0);
    const categoryId={bookmarks:'bookmark',history:'history',cookies:'cookie'}[category];
    const status=document.querySelector(`#chrome-${categoryId}-error`);
    status.hidden=!failed;status.textContent=failed?extensionMessages.t('categoryReadUnavailable'):'';
  }
  checks.find(input=>input.value==='extensions').disabled=preview.extensions.length===0;
  for(const input of checks) if(input.disabled) input.checked=false;
  const choices=document.querySelector('#chrome-extension-choices');choices.replaceChildren();
  for(const extension of preview.extensions){
    const label=document.createElement('label');label.className='chrome-extension-choice';
    const input=document.createElement('input');input.type='checkbox';input.value=extension.id;input.checked=false;input.setAttribute('aria-label',extensionMessages.t('importExtensionLabel',{name:extension.name}));
    const details=document.createElement('span');
    const title=document.createElement('strong');title.textContent=`${extension.name} · v${extension.version}`;details.append(title);
    const grantList=[...(extension.permissions?.required||[]),...(extension.permissions?.hosts||[])];
    const optionalList=[...(extension.permissions?.optional||[]),...(extension.permissions?.optionalHosts||[])];
    const permission=document.createElement('small');permission.textContent=extensionMessages.t('permissionSummary',{required:grantList.join(extensionMessages.locale==='zh-CN'?'、':', ')||extensionMessages.t('permissionsNotDeclared'),optional:optionalList.length?extensionMessages.t('optionalPermissions',{permissions:optionalList.join(extensionMessages.locale==='zh-CN'?'、':', ')}):'',warning:extension.warning||''});details.append(permission);
    label.append(input,details);choices.append(label);
  }
  document.querySelector('#chrome-import-categories').disabled=false;
  updateChromeImportButton();
}
function updateChromeImportButton(){
  const categories=[...document.querySelectorAll('input[name="chrome-category"]:checked')].map(input=>input.value);
  const selectedExtensions=[...document.querySelectorAll('#chrome-extension-choices input:checked')];
  const importingCookies=categories.includes('cookies');
  const cookieConsent=document.querySelector('#chrome-cookie-consent-check');
  document.querySelector('#chrome-cookie-consent').hidden=!importingCookies;
  if(!importingCookies)cookieConsent.checked=false;
  document.querySelector('#confirm-chrome-import').disabled=!chromeSourceId||!categories.length||(importingCookies&&!cookieConsent.checked)||(categories.includes('extensions')&&!selectedExtensions.length);
}
document.querySelector('#start-chrome-import').onclick=async()=>{
  document.querySelector('#settings').close();
  await openChromeImportDialog();
};
document.querySelector('#skip-chrome-import').onclick=async()=>{try{await api.invoke('finishChromeImportOnboarding');document.querySelector('#chrome-import-onboarding').close();}catch(error){document.querySelector('#chrome-import-onboarding-error').textContent=error.message;}};
document.querySelector('#begin-chrome-import').onclick=async()=>{try{await api.invoke('finishChromeImportOnboarding');document.querySelector('#chrome-import-onboarding').close();settingsProfileId=state.activeProfileId;await openChromeImportDialog();}catch(error){document.querySelector('#chrome-import-onboarding-error').textContent=error.message;}};
document.querySelector('#chrome-import-onboarding').addEventListener('cancel',event=>event.preventDefault());
document.querySelector('#choose-chrome-source').onclick=async()=>{
  const error=document.querySelector('#chrome-import-error');error.textContent='';error.removeAttribute('data-success');
  error.removeAttribute('data-partial');
  try{const result=await api.invoke('chooseChromeImportSource');if(result.canceled)return;if(chromeSourceToken)void api.invoke('releaseChromeImportSource',{sourceToken:chromeSourceToken});chromeSources=result.sources;chromeSourceToken=result.sourceToken;const select=document.querySelector('#chrome-source-profile');select.replaceChildren(...chromeSources.map(source=>new Option(`${source.name} (${source.id})`,source.id)));select.disabled=false;select.value=chromeSources[0]?.id || '';if(select.value){chromeSourceId=select.value;showChromePreview(await api.invoke('previewChromeImport',{sourceToken:chromeSourceToken,sourceId:chromeSourceId}));}}
  catch(reason){error.textContent=reason.message;}
};
document.querySelector('#chrome-source-profile').onchange=async event=>{chromeSourceId=event.target.value;document.querySelector('#confirm-chrome-import').disabled=true;try{showChromePreview(await api.invoke('previewChromeImport',{sourceToken:chromeSourceToken,sourceId:chromeSourceId}));}catch(error){document.querySelector('#chrome-import-error').textContent=error.message;}};
document.querySelector('#chrome-import-form').onsubmit=async event=>{
  event.preventDefault();const categories=[...document.querySelectorAll('input[name="chrome-category"]:checked')].map(input=>input.value);const error=document.querySelector('#chrome-import-error');error.textContent='';error.removeAttribute('data-success');error.removeAttribute('data-partial');
  const extensionIds=[...document.querySelectorAll('#chrome-extension-choices input:checked')].map(input=>input.value);
  try{
    chromeImportProfileLocked=true;document.querySelector('#chrome-import-target-profile').disabled=true;
    const result=await api.invoke('importChromeData',{sourceToken:chromeSourceToken,sourceId:chromeSourceId,profileId:chromeImportProfileId,categories,cookieConsent:categories.includes('cookies')&&document.querySelector('#chrome-cookie-consent-check').checked,...(categories.includes('extensions')?{extensionIds}:{})});
    if(result.cookies.failed)error.dataset.partial='true';else error.dataset.success='true';
    const failed=result.extensions.failed.map(item=>`${item.name}: ${item.error}`).join(extensionMessages.locale==='zh-CN'?'；':'; ');
    const cookieNotes=[];
    if(result.cookies.skipped)cookieNotes.push(extensionMessages.t('cookieSkipped',{count:extensionMessages.formatNumber(result.cookies.skipped)}));
    if(result.cookies.unsupported)cookieNotes.push(extensionMessages.t('cookieUnsupported',{count:extensionMessages.formatNumber(result.cookies.unsupported)}));
    if(result.cookies.failed)cookieNotes.push(extensionMessages.t('cookieWriteFailed',{count:extensionMessages.formatNumber(result.cookies.failed)}));
    const cookieSummary=extensionMessages.t('cookiesImported',{count:extensionMessages.formatNumber(result.cookies.imported),notes:cookieNotes.length?` (${cookieNotes.join(extensionMessages.locale==='zh-CN'?'、':', ')})`:''});
    error.textContent=extensionMessages.t('importCompletedSummary',{bookmarks:extensionMessages.formatNumber(result.bookmarks.imported),history:extensionMessages.formatNumber(result.history.imported),cookies:cookieSummary,extensions:extensionMessages.formatNumber(result.extensions.imported.length),skipped:result.extensions.skipped.length?extensionMessages.t('skippedExtensions',{count:extensionMessages.formatNumber(result.extensions.skipped.length)}):'',failed:failed?extensionMessages.t('importFailedItems',{items:failed}):''});
    if(result.cookies.failed)updateChromeImportButton();else document.querySelector('#confirm-chrome-import').disabled=true;
    void renderBookmarksBar();
    if(libraryKind==='bookmarks'||libraryKind==='history')void renderLibrary();
    if(document.querySelector('#settings').open)void renderProfileExtensions();
  }
  catch(reason){error.textContent=userFacingAgentError(reason);if(reason.message.includes('回滚未完整完成'))error.dataset.partial='true';}
};
document.querySelectorAll('input[name="chrome-category"]').forEach(input=>input.onchange=updateChromeImportButton);
document.querySelector('#chrome-import-target-profile').onchange=event=>{if(!chromeImportProfileLocked)chromeImportProfileId=event.target.value;};
document.querySelector('#chrome-cookie-consent-check').onchange=updateChromeImportButton;
document.querySelector('#chrome-extension-choices').onchange=updateChromeImportButton;
document.querySelector('#cancel-chrome-import').onclick=()=>chromeImportDialog.close();
chromeImportDialog.onclose=()=>{if(chromeSourceToken)void api.invoke('releaseChromeImportSource',{sourceToken:chromeSourceToken});chromeSourceToken='';return api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});};
document.querySelector('#address').addEventListener('input',()=>{const tab=activeTab();if(!addressDraftDirty||addressDraftTabId!==tab?.id)addressDraftBaseUrl=tab?.url ?? null;addressDraftDirty=true;addressDraftTabId=tab?.id ?? null;});
document.querySelector('#address-form').onsubmit = event => { event.preventDefault(); const tab=activeTab(),url=document.querySelector('#address').value;addressDraftDirty=false;addressDraftTabId=null;addressDraftBaseUrl=null;if(tab) api.invoke('navigate',{id:tab.id,url}); };
document.querySelectorAll('[data-action]').forEach(el => el.onclick = () => {const tab=activeTab();if(tab) api.invoke(el.dataset.action,{id:tab.id});});
document.querySelector('#bookmark-current').onclick = async () => {const tab=activeTab();if(!tab || !/^https?:/i.test(tab.url)) return;await api.invoke('addBookmark',{url:tab.url,title:tab.title});void renderBookmarksBar();};
document.querySelector('#show-bookmarks').onclick = event => showLibrary('bookmarks',event.currentTarget);
document.querySelector('#show-history').onclick = event => {if(libraryKind==='history')closeLibraryPanel();else void showLibrary('history',event.currentTarget);};
document.querySelector('#show-downloads').onclick = event => showLibrary('downloads',event.currentTarget);
document.querySelector('#library-search').oninput=()=>{void renderLibrary();};
const siteToolsMenu=document.querySelector('#site-tools'),siteToolsTrigger=document.querySelector('#more-tools');
function siteToolsItems(){return [...siteToolsMenu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')].filter(item=>!item.disabled);}
function closeSiteTools(returnFocus=false){if(siteToolsMenu.hidden)return;siteToolsMenu.hidden=true;siteToolsTrigger.setAttribute('aria-expanded','false');if(returnFocus)siteToolsTrigger.focus();}
function openSiteTools(last=false){siteToolsMenu.hidden=false;siteToolsTrigger.setAttribute('aria-expanded','true');(last?siteToolsItems().at(-1):siteToolsItems()[0])?.focus();}
function focusOutsideSiteTools(backward){
  const controls=[...document.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')]
    .filter(element=>!element.closest('[hidden]')&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden'&&!siteToolsMenu.contains(element));
  const index=controls.indexOf(siteToolsTrigger),target=controls[index+(backward?-1:1)]||(backward?controls.at(-1):controls[0]);
  closeSiteTools();(target||siteToolsTrigger).focus();
}
document.querySelector('#site-permissions').onclick = async () => {closeSiteTools(true);const tab=activeTab();if(!tab)return;siteDataNotice=null;try{const result=await api.invoke('reviewSitePermissions',{id:tab.id});if(result.revoked)siteDataNotice={tabId:tab.id,message:extensionMessages.t('permissionsRevoked',{origin:result.origin})};}catch(error){siteDataNotice={tabId:tab.id,message:extensionMessages.t('cannotManagePermissions',{message:userFacingAgentError(error)})};}draw(state);};
document.querySelector('#clear-site').onclick = async () => {closeSiteTools(true);const tab=activeTab();if(!tab)return;siteDataNotice=null;try{const result=await api.invoke('clearSiteData',{id:tab.id});if(result.cleared)siteDataNotice={tabId:tab.id,message:extensionMessages.t('siteDataCleared',{origin:result.origin})};}catch(error){siteDataNotice={tabId:tab.id,message:extensionMessages.t('cannotClearSiteData',{message:userFacingAgentError(error)})};}draw(state);};
async function requestPagePrint(tabId){
  siteDataNotice=null;
  try{
    const result=await api.invoke('printPage',{id:tabId});
    if(result.cancelled)siteDataNotice={tabId,message:extensionMessages.t('printCancelled')};
    else if(result.error)siteDataNotice={tabId,message:result.error};
    else siteDataNotice={tabId,message:extensionMessages.t('printSent')};
  }catch(error){siteDataNotice={tabId,message:extensionMessages.t('cannotPrintPage',{message:userFacingAgentError(error)})};}
  if(state)draw(state);
}
document.querySelector('#print-page').onclick=()=>{closeSiteTools(true);const tab=activeTab();if(tab)void requestPagePrint(tab.id);};
document.querySelector('#toggle-fullscreen').onclick=async()=>{closeSiteTools(true);try{await api.invoke('toggleFullscreen');}catch{controlError=extensionMessages.t('fullscreenFailed');if(state)draw(state);}};
api.onPrintPage(({id})=>{if(typeof id==='string')void requestPagePrint(id);});
siteToolsTrigger.onclick=()=>siteToolsMenu.hidden?openSiteTools():closeSiteTools(true);
siteToolsTrigger.onkeydown=event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();openSiteTools(event.key==='ArrowUp');}};
siteToolsMenu.onkeydown=event=>{
  const items=siteToolsItems(),index=items.indexOf(document.activeElement);
  if(event.key==='Escape'){event.preventDefault();closeSiteTools(true);return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'||event.key==='Home'||event.key==='End'){
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();return;
  }
  if(event.key==='Tab'){event.preventDefault();focusOutsideSiteTools(event.shiftKey);}
};
document.addEventListener('pointerdown',event=>{if(!siteToolsMenu.hidden&&!siteToolsMenu.contains(event.target)&&!siteToolsTrigger.contains(event.target))closeSiteTools();});
document.querySelector('#close-library').onclick = () => closeLibraryPanel({restoreFocus:true});
document.querySelector('#show-agent-rooms').onclick=async event=>{if(libraryKind==='agent-rooms'){closeLibraryPanel();}else{document.querySelector('#library-search').value='';setLibraryPanel('agent-rooms',event.currentTarget);await api.invoke('setPanel',{open:true,workspace:true});await renderAgentRooms();}};
document.querySelector('#show-pi-workbench').onclick=async event=>{if(libraryKind==='pi-workbench'){closeLibraryPanel();}else{document.querySelector('#library-search').value='';setLibraryPanel('pi-workbench',event.currentTarget);await api.invoke('setPanel',{open:true,workspace:true});renderPiWorkbench();}};

// ---- 日常浏览：标签栏（favicon/拖拽排序/中键关闭）与页内查找 ----
const FALLBACK_FAVICON='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="#8a94a6" stroke-width="1.4"/><path d="M1.5 7h11M7 1.5c2 2 2 9 0 11M7 1.5c-2 2-2 9 0 11" stroke="#8a94a6" stroke-width="1.2" fill="none"/></svg>');
const PIN_ICON='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16"><path d="M6 1.5h4l-.6 4.2 2.1 2.1v1.2H8.9V15h-1.8V9H4.5V7.8l2.1-2.1L6 1.5Z" fill="#4a5568"/></svg>');
let findOpen=false, findTabId=null, tabMenu=null, tabMenuTabId=null, tabMenuTrigger=null;
function createTabPinIcon(){const pin=document.createElement('img');pin.className='pin-icon';pin.alt=extensionMessages.t('pinned');pin.title=extensionMessages.t('pinned');pin.draggable=false;pin.src=PIN_ICON;return pin;}
function createTabFavicon(tab){const icon=document.createElement('img');icon.className='favicon';icon.alt='';icon.draggable=false;icon.src=tab.faviconUrl||FALLBACK_FAVICON;icon.onerror=()=>{icon.onerror=null;icon.src=FALLBACK_FAVICON;};return icon;}
function syncTabElement(el,tab,room){
  el.className=tab.pinned?'tab pinned':'tab';el.dataset.active=String(tab.active);el.dataset.tabId=tab.id;
  if(tab.pinned)el.dataset.pinned='true';else delete el.dataset.pinned;
  const main=el.querySelector('.tab-main'),close=el.querySelector('.tab-close'),titleText=tab.title||tab.url||extensionMessages.t('newTab');
  if(tab.active)main.setAttribute('aria-current','page');else main.removeAttribute('aria-current');
  let loading=main.querySelector('.tab-loading-indicator'),favicon=main.querySelector('img.favicon'),pin=main.querySelector(':scope > img.pin-icon');
  if(tab.isLoading){
    if(!loading){loading=document.createElement('span');loading.className='tab-loading-indicator';loading.setAttribute('aria-hidden','true');if(tab.pinned){loading.dataset.pinned='true';pin ||= createTabPinIcon();loading.append(pin);pin=null;}if(favicon)favicon.replaceWith(loading);else main.insertBefore(loading,main.querySelector('.tab-title'));}
    main.setAttribute('aria-label',extensionMessages.t(tab.pinned?'pinnedTabLoadingLabel':'tabLoadingLabel',{tab:titleText}));
  }else{
    main.removeAttribute('aria-label');
    if(loading){const retainedPin=loading.querySelector('.pin-icon');favicon=createTabFavicon(tab);loading.replaceWith(favicon);if(tab.pinned)main.insertBefore(retainedPin||createTabPinIcon(),favicon);}
    else{
      if(tab.pinned&&!pin){pin=createTabPinIcon();main.insertBefore(pin,favicon||main.querySelector('.tab-title'));}
      if(!tab.pinned)pin?.remove();
      if(!favicon){favicon=createTabFavicon(tab);main.insertBefore(favicon,main.querySelector('.tab-title'));}
      else if(favicon.getAttribute('src')!==(tab.faviconUrl||FALLBACK_FAVICON))favicon.src=tab.faviconUrl||FALLBACK_FAVICON;
    }
  }
  main.querySelector('.tab-title').textContent=titleText;
  close.title=extensionMessages.t('closeNamedTab',{tab:titleText});
  main.onkeydown=event=>{if(event.key==='ContextMenu'||(event.key==='F10'&&event.shiftKey)){event.preventDefault();openTabMenu(null,tab,main);}};
  close.onclick=event=>{event.stopPropagation();void closeTabFromUi(tab.id);};
  el.oncontextmenu=event=>{event.preventDefault();openTabMenu(event,tab,main);};
  main.onclick=()=>{closeTabMenu();void api.invoke('activateTab',{id:tab.id}).catch(error=>{controlError=error.message;draw(state);});};
  el.onauxclick=event=>{if(event.button===1){event.preventDefault();void closeTabFromUi(tab.id);}};
  el.onpointerdown=event=>{if(event.button!==0 || event.target===close) return;closeTabMenu();startTabDrag(event,el,room);};
  return el;
}
function tabElement(tab,room){const el=document.createElement('div');const main=document.createElement('button');main.type='button';main.className='tab-main';main.tabIndex=0;main.setAttribute('aria-haspopup','menu');main.setAttribute('aria-expanded','false');main.setAttribute('aria-controls','tab-menu');const title=document.createElement('span');title.className='tab-title';main.append(title);const close=document.createElement('button');close.type='button';close.className='tab-close';close.textContent='×';close.setAttribute('aria-label',extensionMessages.t('closeTab'));el.append(main,close);return syncTabElement(el,tab,room);}
let tabsStructureSignature='';
function renderTabs(room){
  // Rebuild only when the room or its tabs actually changed: frequent state
  // updates (download progress, agent activity) must not tear down the tab bar
  // while the user is dragging a tab or clicking its close button.
  const signature=[room.id,...room.tabs.map(tab=>[tab.id,tab.active,tab.pinned].join('\u0000'))].join('\u0001');
  const existing=document.querySelector('#new-tab');
  const tabs=document.querySelector('#tabs');
  if(signature===tabsStructureSignature && existing && existing.parentElement?.id==='tabs'){
    for(const tab of room.tabs){const el=tabs.querySelector(`.tab[data-tab-id="${CSS.escape(tab.id)}"]`);if(el)syncTabElement(el,tab,room);}
    return;
  }
  tabsStructureSignature=signature;
  tabs.replaceChildren();
  for(const tab of room.tabs) tabs.append(tabElement(tab,room));
  const add=button('+',()=>{void api.invoke('createTab',{id:room.id}).catch(error=>{controlError=error.message;draw(state);});});
  add.id='new-tab'; add.setAttribute('aria-label',extensionMessages.t('newTabButton')); tabs.append(add);
}
async function closeTabFromUi(tabId){controlError='';try{await api.invoke('closeTabFromUser',{id:tabId});}catch(error){controlError=error.message;draw(state);}}
function tabMenuElement(){return document.querySelector('#tab-menu');}
function tabMenuItems(){return [...tabMenuElement().querySelectorAll('.menu-item')];}
function closeTabMenu({restoreFocus=false}={}){
  const menu=tabMenuElement();if(menu && !menu.hidden){menu.hidden=true;menu.replaceChildren();}
  if(tabMenuTrigger)tabMenuTrigger.setAttribute('aria-expanded','false');
  const trigger=tabMenuTrigger;tabMenu=null;tabMenuTabId=null;tabMenuTrigger=null;
  if(restoreFocus&&trigger?.isConnected&&!trigger.disabled)trigger.focus();
}
function focusOutsideTabMenu(backward){
  const menu=tabMenuElement(),trigger=tabMenuTrigger;
  const controls=[...document.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')]
    .filter(element=>!element.closest('[hidden]')&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden'&&!menu.contains(element));
  const index=controls.indexOf(trigger),target=controls[index+(backward?-1:1)]||(backward?controls.at(-1):controls[0]);
  closeTabMenu();(target||trigger)?.focus();
}
function openTabMenu(event,tab,trigger){
  const menu=tabMenuElement();
  const items=[
    {label:tab.pinned?extensionMessages.t('unpinTab'):extensionMessages.t('pinTab'),action:()=>api.invoke('setTabPinned',{id:tab.id,pinned:!tab.pinned})},
    {label:extensionMessages.t('reload'),action:()=>api.invoke('reload',{id:tab.id})},
    {label:extensionMessages.t('copyLink'),action:()=>api.invoke('copyTabUrl',{id:tab.id})},
    {separator:true},
    {label:extensionMessages.t('closeTab'),action:()=>api.invoke('closeTabFromUser',{id:tab.id})},
    {label:extensionMessages.t('closeOtherTabs'),action:()=>api.invoke('closeOtherTabs',{id:tab.id})}
  ];
  menu.replaceChildren();
  for(const item of items){
    if(item.separator){const rule=document.createElement('div');rule.className='menu-separator';menu.append(rule);continue;}
    const entry=document.createElement('button');entry.type='button';entry.className='menu-item';entry.textContent=item.label;entry.setAttribute('role','menuitem');
    entry.onclick=async()=>{closeTabMenu({restoreFocus:true});controlError='';try{await item.action();}catch(error){controlError=error.message;draw(state);}finally{const focusTarget=document.querySelector(`.tab[data-tab-id="${CSS.escape(tab.id)}"] .tab-main`)||document.querySelector('.tab[data-active="true"] .tab-main')||document.querySelector('#new-tab');focusTarget?.focus();}};
    menu.append(entry);
  }
  menu.hidden=false;
  const menuWidth=190, menuHeight=items.length*34+14,rect=trigger.getBoundingClientRect();
  const left=event?event.clientX:rect.left,top=event?event.clientY:rect.bottom;
  menu.style.left=`${Math.max(4,Math.min(left,window.innerWidth-menuWidth-4))}px`;
  menu.style.top=`${Math.max(4,Math.min(top,window.innerHeight-menuHeight-4))}px`;
  tabMenuTabId=tab.id; tabMenu=menu;tabMenuTrigger=trigger;trigger.setAttribute('aria-expanded','true');
  menu.onkeydown=event=>{
    const menuItems=tabMenuItems(),index=menuItems.indexOf(document.activeElement);
    if(event.key==='Escape'){event.preventDefault();closeTabMenu({restoreFocus:true});return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'||event.key==='Home'||event.key==='End'){
      event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?menuItems.length-1:(index+(event.key==='ArrowDown'?1:-1)+menuItems.length)%menuItems.length;menuItems[next]?.focus();return;
    }
    if(event.key==='Tab'){event.preventDefault();focusOutsideTabMenu(event.shiftKey);}
  };
  menu.querySelector('.menu-item')?.focus();
}
function pinnedFirst(order,rooms){const pinned=new Set(order.filter(id=>rooms.some(tab=>tab.id===id && tab.pinned)));return [...order.filter(id=>pinned.has(id)),...order.filter(id=>!pinned.has(id))];}
function startTabDrag(event,el,room){
  if(room.tabs.length<2) return;
  let active=false;
  const move=ev=>{
    if(!active){ if(Math.abs(ev.clientX-event.clientX)<6 && Math.abs(ev.clientY-event.clientY)<6) return; active=true; document.body.classList.add('tab-dragging'); el.classList.add('dragging'); }
    const over=document.elementFromPoint(ev.clientX,ev.clientY)?.closest?.('.tab');
    document.querySelectorAll('.tab').forEach(node=>node.classList.remove('drop-before','drop-after'));
    if(!over || over===el) return;
    const rect=over.getBoundingClientRect(); over.classList.add(ev.clientX < rect.left+rect.width/2?'drop-before':'drop-after');
  };
  const finish=ev=>{
    document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',finish);
    if(!active) return;
    document.body.classList.remove('tab-dragging'); el.classList.remove('dragging');
    document.querySelectorAll('.tab').forEach(node=>node.classList.remove('drop-before','drop-after'));
    const over=document.elementFromPoint(ev.clientX,ev.clientY)?.closest?.('.tab');
    if(!over || over===el) return;
    const order=state.rooms.find(item=>item.id===room.id)?.tabs.map(tab=>tab.id) || [];
    const from=order.indexOf(el.dataset.tabId);
    if(from<0 || !order.includes(over.dataset.tabId)) return;
    const rect=over.getBoundingClientRect(); const before=ev.clientX < rect.left+rect.width/2;
    order.splice(from,1);
    const target=order.indexOf(over.dataset.tabId);
    order.splice(before?target:target+1,0,el.dataset.tabId);
    // Pinned tabs always lead the bar; dropping across the partition snaps back
    // into the tab's own group instead of silently changing its pinned state.
    const next=pinnedFirst(order,state.rooms.find(item=>item.id===room.id)?.tabs || []);
    void api.invoke('reorderTabs',{id:room.id,tabIds:next}).catch(error=>{controlError=error.message;draw(state);});
  };
  document.addEventListener('pointermove',move);document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);
}
function findbarEl(){return document.querySelector('#findbar');}
function closeFindBar(){
  const bar=findbarEl(); if(!bar || bar.hidden) return;
  bar.hidden=true; findOpen=false; document.querySelector('#find-count').textContent='';
  const tabId=findTabId; findTabId=null;
  if(tabId) void api.invoke('stopFindInPage',{id:tabId,action:'clearSelection'}).catch(()=>{});
}
function openFindBar(){
  const tab=activeTab(); if(!tab) return;
  const bar=findbarEl(); const input=document.querySelector('#find-input');
  findTabId=tab.id;
  if(bar.hidden){ bar.hidden=false; findOpen=true; input.focus(); if(input.value) runFind(false,true); }
  else { input.focus(); input.select(); }
}
function runFind(findNext,forward){
  const tab=activeTab(); const input=document.querySelector('#find-input'); const text=input.value;
  if(!tab) return;
  findTabId=tab.id;
  if(!text){ document.querySelector('#find-count').textContent=''; void api.invoke('stopFindInPage',{id:tab.id,action:'clearSelection'}).catch(()=>{}); return; }
  void api.invoke('findInPage',{id:tab.id,text,forward,findNext}).catch(error=>{document.querySelector('#find-count').textContent='';controlError=error.message;draw(state);});
}
document.querySelector('#find-input').oninput=()=>runFind(false,true);
document.querySelector('#find-input').onkeydown=event=>{
  if(event.key==='Enter'){event.preventDefault();runFind(true,!event.shiftKey);}
  else if(event.key==='Escape'){event.preventDefault();closeFindBar();}
};
document.querySelector('#find-next').onclick=()=>runFind(true,true);
document.querySelector('#find-prev').onclick=()=>runFind(true,false);
document.querySelector('#find-close').onclick=()=>closeFindBar();
api.onFindOpen(()=>openFindBar());
api.onFindNext(options=>{const bar=findbarEl();if(bar.hidden){openFindBar();return;}runFind(true,!options.backward);});
api.onFindResult(result=>{if(!findOpen || result.tabId!==findTabId) return;const count=document.querySelector('#find-count');if(!result.matches){count.textContent=extensionMessages.t('noResults');return;}count.textContent=`${extensionMessages.formatNumber(result.activeMatchOrdinal)}/${extensionMessages.formatNumber(result.matches)}`;});
api.onFindReset(result=>{if(findTabId===result.tabId) closeFindBar();});
document.addEventListener('pointerdown',event=>{if(tabMenu && !tabMenu.contains(event.target)) closeTabMenu();},true);
