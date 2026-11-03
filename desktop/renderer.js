const api = window.browserShell;
function userFacingAgentError(error, fallback='Corvid Agent 暂时无法完成此操作，请重试。') {
  const message=String(error?.message||error||'').trim();
  const implementationName=/\bpi(?:[\s_-]+(?:coding[\s_-]*agent|runtime|sdk|session|agent))?\b|@earendil-works\/pi-[a-z0-9-]+/i;
  return implementationName.test(message) ? fallback : (message||fallback);
}
let state, libraryKind = null, libraryTrigger = null, controlError = '', siteDataNotice = null, piBinding = null, piContextPreview = null, piTasks = [], piPromptDraft = '', piContinueTaskId = null, piContinuationPreview = null, piContinuationDraft = '', piContinuationConsent = false, piHistoryOpen = false, piSelectedTaskId = null, addressDraftDirty = false, addressDraftTabId = null, addressDraftBaseUrl = null;
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
function updateNewTabSurface(active) {
  const isNewTab=Boolean(active && active.url==='about:blank' && !active.isLoading && !active.navigationError);
  document.querySelector('#bookmarks-bar').toggleAttribute('hidden',isNewTab);
}
function draw(value) {
  state = value;
  if(state.needsChromeImportOnboarding&&!chromeImportOnboardingPrompted){chromeImportOnboardingPrompted=true;void openShellDialog('#chrome-import-onboarding');}
  if(piBinding&&(piBinding.profileId!==state.activeProfileId||!state.rooms.some(room=>room.id===piBinding.roomId&&room.tabs.some(tab=>tab.id===piBinding.tabId)))){piBinding=null;piContextPreview=null;}
  const dialogView=document.querySelector('#page-dialog');
  if(dialogView.open && !state.rooms.some(room=>room.tabs.some(tab=>tab.id===dialogTabId && tab.dialog))) dialogView.close();
  if (libraryKind === 'pi-workbench') void renderPiTasks(); else if (libraryKind) void renderLibrary();
  for(const kind of ['bookmarks','history','downloads','agent-rooms','pi-workbench'])document.querySelector(`#show-${kind}`).setAttribute('aria-expanded',String(libraryKind===kind));
  void renderBookmarksBar();
  const profileSelect=document.querySelector('#profile-select');profileSelect.replaceChildren();
  for(const profile of state.profiles){const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;option.selected=profile.id===state.activeProfileId;profileSelect.append(option);}
  const activeProfile=state.profiles.find(profile=>profile.id===state.activeProfileId);
  document.querySelector('.profile-avatar').textContent=(activeProfile?.name||'A').trim().charAt(0).toLocaleUpperCase()||'A';
  profileSelect.onchange=()=>api.invoke('activateProfile',{id:profileSelect.value});
  const roomStrip=document.querySelector('#room-strip');roomStrip.replaceChildren();
  for (const s of state.rooms.filter(s=>s.profileId===state.activeProfileId)) {
    const item=button(s.name,()=>api.invoke('activateRoom',{id:s.id}),s.id===state.activeRoomId);
    item.dataset.ownership=s.ownership;
    item.setAttribute('aria-current',s.id===state.activeRoomId?'page':'false');
    item.title=`${s.name} · ${s.ownership==='agent'?'Agent 使用中':'用户空间'}`;
    roomStrip.append(item);
  }
  const profileMenu=document.querySelector('#profile-menu');profileMenu.replaceChildren();
  const profileAction=(label,fn)=>{const item=button(label,()=>{profileMenu.hidden=true;fn();});item.setAttribute('role','menuitem');profileMenu.append(item);};
  profileAction('新建浏览身份',async()=>{await openShellDialog('#new-profile','#profile-name');});
  profileAction('重命名当前浏览身份',async()=>{renameProfileId=state.activeProfileId;const profile=state.profiles.find(item=>item.id===renameProfileId);document.querySelector('#renamed-profile-name').value=profile.name;document.querySelector('#rename-profile-error').textContent='';await openShellDialog('#rename-profile','#renamed-profile-name');document.querySelector('#renamed-profile-name').select();});
  const roomMenu=document.querySelector('#room-menu');roomMenu.replaceChildren();
  const roomAction=(label,fn)=>{const item=button(label,()=>{roomMenu.hidden=true;fn();});item.setAttribute('role','menuitem');roomMenu.append(item);};
  roomAction('新建空间',async()=>{await openShellDialog('#new-room','#room-name');});
  if(state.activeRoomId)roomAction('关闭当前空间',async()=>{const id=state.activeRoomId;controlError='';try{await api.invoke('closeRoomFromUser',{id});}catch(error){controlError=error.message;draw(state);}});
  const roomActions=document.querySelector('#room-actions');roomActions.replaceChildren();
  const newWindow=button('＋  新建窗口',async()=>{controlError='';try{await api.invoke('createWindow',{});}catch(error){controlError=error.message;draw(state);}});
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
  const status=document.querySelector('#status'); status.replaceChildren();
  if(active?.isLoading){const loading=document.createElement('span');loading.className='navigation-loading';loading.textContent='正在加载';status.append(loading);}
  if(active?.navigationError){const error=document.createElement('span');error.className='navigation-error';error.setAttribute('role','alert');error.textContent=`页面加载失败：${active.navigationError.message}`;status.append(error);if(room.ownership!=='agent'&&!room.userResumePending)status.append(button('重试',()=>api.invoke('navigate',{id:active.id,url:active.navigationError.url})));}
  if(room.executionRisk) status.append(button('页面执行状态未知 · 查看',()=>api.invoke('reviewExecutionRisk',{id:room.id})));
  if(active?.dialog) status.append(button('网页对话框 · 查看',()=>showPageDialog(active)));
  if(room.ownership==='agent') {
    const label=document.createElement('span');label.textContent='Agent 控制中';status.append(label);
    const take=button(room.userResumePending ? '正在接管…' : '接管',async()=>{controlError='';try{await api.invoke('requestUserControl',{id:room.id});}catch(error){controlError=error.message;draw(state);}});take.disabled=room.userResumePending;status.append(take);
  } else if(room.yielded) {const label=document.createElement('span');label.textContent='用户控制中';status.append(label);if(!room.executionRisk)status.append(button('交还 Agent',async()=>{controlError='';try{await api.invoke('returnUserControl',{id:room.id});}catch(error){controlError=error.message;draw(state);}}));}
  if(controlError){const note=document.createElement('span');note.setAttribute('role','alert');note.textContent=controlError;status.append(note);}
  if(siteDataNotice?.tabId===active?.id){const note=document.createElement('span');note.setAttribute('role','status');note.textContent=siteDataNotice.message;status.append(note);}
}
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
  document.querySelector('#library-title').textContent = kind === 'history' ? '浏览历史' : kind === 'downloads' ? '下载' : '书签';
  for (const item of matching) {
    const row = document.createElement('div'); row.className = 'entry';
    if (kind === 'downloads') {
      const details = document.createElement('span'); details.style.flex='1';
      const labels={progressing:'下载中',completed:'已完成',cancelled:'已取消',interrupted:'已中断',failed:'失败'};
      const progress=item.totalBytes>0 ? ` ${Math.round(item.receivedBytes/item.totalBytes*100)}%` : ` ${item.receivedBytes} 字节`;
      details.textContent=`${item.filename} — ${labels[item.status] || item.status}${item.status==='progressing' ? progress : ''}${item.error ? `：${item.error}` : ''}`;
      details.title=item.path || item.url; row.append(details);
      if(item.status==='progressing') row.append(button('取消',async()=>{await api.invoke('cancelDownload',{id:item.id});}));
      if(item.status==='completed' && item.path){
        row.append(button('打开',async()=>{controlError='';try{await api.invoke('openDownload',{id:item.id});}catch(error){controlError=error.message;draw(state);}}));
        row.append(button('在文件夹中显示',async()=>{controlError='';try{await api.invoke('revealDownload',{id:item.id});}catch(error){controlError=error.message;draw(state);}}));
      }
      items.append(row); continue;
    }
    const link = document.createElement('a'); link.href = '#'; link.textContent = item.title || item.url; link.title = item.url;
    link.onclick = async event => { event.preventDefault(); const tab=activeTab(); if(tab) await api.invoke('navigate',{id:tab.id,url:item.url}); };
    const remove = button('删除', async () => { await api.invoke(kind === 'history' ? 'removeHistory' : 'removeBookmark',{id:item.id,profileId}); await renderLibrary(); });
    remove.setAttribute('aria-label',`删除 ${item.title || item.url}`); row.append(link,remove); items.append(row);
  }
  if (!matching.length) items.textContent = query && result[kind].length ? '没有匹配结果' : kind === 'history' ? '暂无浏览历史' : kind === 'downloads' ? '暂无下载' : '暂无书签';
}
async function renderAgentRooms(){
  const version=++agentRoomRenderVersion,profileId=state.activeProfileId;
  const result=await api.invoke('piTasks',{profileId});
  if(version!==agentRoomRenderVersion||libraryKind!=='agent-rooms'||state.activeProfileId!==profileId)return;
  const panel=document.querySelector('#library'),items=document.querySelector('#library-items');
  panel.dataset.kind='agent-rooms';
  document.querySelector('#library-title').textContent='Agent 工作区';
  document.querySelector('#library-search').hidden=true;
  let announcement=panel.querySelector('#agent-room-announcer');
  if(!announcement){announcement=document.createElement('div');announcement.id='agent-room-announcer';announcement.className='visually-hidden';announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');announcement.setAttribute('aria-atomic','true');panel.insertBefore(announcement,items);}
  announcement.hidden=false;
  const rooms=state.rooms.filter(room=>room.profileId===state.activeProfileId&&(room.ownership==='agent'||room.yielded||room.finished));
  const tasksByRoom=new Map();
  for(const task of result.tasks){const tasks=tasksByRoom.get(task.roomId)||[];tasks.push(task);tasksByRoom.set(task.roomId,tasks);}
  const taskLabels={preparing:'准备中',running:'正在回复',waiting_for_user:'等待你接管',completed:'已完成',failed:'需要处理',interrupted:'等待检查'},nextAnnouncementStates=new Map(),changedStates=[];
  for(const room of rooms){
    const ownershipLabel=room.executionRisk?'页面执行状态未知':room.userResumePending?'正在接管':room.finished?'已结束':room.ownership==='agent'?'Agent 控制中':room.yielded?'用户控制中':'空闲';
    for(const task of tasksByRoom.get(room.id)||[]){
      const key=`${profileId}:${task.id}`,signature=`${task.status}:${ownershipLabel}`,previous=lastAgentRoomAnnouncementStates.get(key);
      nextAnnouncementStates.set(key,signature);
      if(previous!==undefined?previous!==signature:hasAgentRoomAnnouncementSnapshot)changedStates.push({room,task,ownershipLabel});
    }
  }
  if(changedStates.length){
    const messages=changedStates.slice(0,3).map(({room,task,ownershipLabel})=>`${room.name}：Corvid Agent ${taskLabels[task.status]||'状态未知'}${ownershipLabel?`；${ownershipLabel}`:''}`);
    const remainder=changedStates.length>messages.length?`；还有 ${changedStates.length-messages.length} 项状态更新`:'';
    announcement.textContent=messages.join('；')+remainder;
  }
  lastAgentRoomAnnouncementStates=nextAnnouncementStates;
  hasAgentRoomAnnouncementSnapshot=true;
  items.replaceChildren();
  for(const room of rooms){
    const row=document.createElement('div');row.className='agent-room-entry';
    const name=document.createElement('span');name.className='agent-room-name';name.textContent=room.name;name.title=room.name;
    const status=document.createElement('span');status.className='agent-room-state';
    const ownershipLabel=room.executionRisk?'页面执行状态未知':room.userResumePending?'正在接管':room.finished?'已结束':room.ownership==='agent'?'Agent 控制中':room.yielded?'用户控制中':'空闲';
    status.textContent=`${ownershipLabel} · ${room.tabs.length} 个标签`;
    const roomTasks=tasksByRoom.get(room.id)||[];
    const taskStates=document.createElement('div');taskStates.className='agent-room-tasks';
    for(const task of roomTasks){
      const taskStatus=document.createElement('span');taskStatus.className='agent-room-task-state';taskStatus.dataset.status=task.status;taskStatus.textContent=`Corvid Agent · ${taskLabels[task.status]||'状态未知'}`;taskStates.append(taskStatus);
      const openTask=button('查看对话',async()=>{
        piSelectedTaskId=task.id;piHistoryOpen=false;piContinueTaskId=null;piContinuationPreview=null;piContinuationDraft='';piContinuationConsent=false;piBinding={profileId:task.profileId,roomId:task.roomId,tabId:task.tabId};piContextPreview=null;
        setLibraryPanel('pi-workbench',document.querySelector('#show-pi-workbench'));
        await api.invoke('setPanel',{open:true,workspace:true});
        renderPiWorkbench();
      });openTask.setAttribute('aria-label',`查看 Corvid Agent 对话：${room.name} · ${taskLabels[task.status]||'任务'}`);taskStates.append(openTask);
    }
    const view=button('查看',async()=>{await closeLibraryPanel({restoreFocus:true});await api.invoke('activateRoom',{id:room.id});});
    view.setAttribute('aria-label',`查看 ${room.name}`);
    row.append(name,status);
    if(roomTasks.length)row.append(taskStates);
    row.append(view);
    if(room.ownership==='agent'){
      const take=button(room.userResumePending?'接管中…':'接管',async()=>{controlError='';try{await api.invoke('requestUserControl',{id:room.id});}catch(error){controlError=error.message;draw(state);}});
      take.disabled=room.userResumePending;take.setAttribute('aria-label',`接管 ${room.name}`);row.append(take);
    }else if(room.yielded&&!room.finished&&!room.executionRisk){
      const resume=button('交还 Agent',async()=>{controlError='';try{await api.invoke('returnUserControl',{id:room.id});}catch(error){controlError=error.message;draw(state);}});
      resume.setAttribute('aria-label',`交还 Agent：${room.name}`);row.append(resume);
    }
    if(room.executionRisk){const review=button('复核',()=>api.invoke('reviewExecutionRisk',{id:room.id}));review.setAttribute('aria-label',`复核 ${room.name} 的执行状态`);row.append(review);}
    items.append(row);
  }
  if(!rooms.length){
    const empty=document.createElement('p');empty.className='workspace-empty-state';empty.textContent='当前浏览身份还没有 Agent 空间。打开 Corvid Agent 后，可从当前网页创建工作区；发送页面内容前需要先检查并确认。';items.append(empty);
    const start=button('打开 Corvid Agent',async()=>{
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
  const historyButton=button(`历史对话 · ${piTasks.length}`,()=>{piHistoryOpen=!piHistoryOpen;renderPiTasks();});historyButton.setAttribute('aria-expanded',String(piHistoryOpen));historyButton.setAttribute('aria-label','对话历史');
  const newChat=button('＋ 新建对话',()=>{piSelectedTaskId=null;piContinueTaskId=null;piContinuationPreview=null;piContinuationDraft='';piContinuationConsent=false;piBinding=null;piContextPreview=null;piPromptDraft='';renderPiWorkbench();});newChat.className='pi-new-chat';
  toolbar.append(historyButton,newChat);list.append(toolbar);
  const labels={preparing:'准备中',running:'Agent 正在回复',waiting_for_user:'等待你接管',completed:'已完成',failed:'需要处理',interrupted:'等待检查'};
  if(piSelectedTaskId&&!piTasks.some(task=>task.id===piSelectedTaskId))piSelectedTaskId=null;
  const visibleTasks=piTasks.filter(task=>task.id===(piSelectedTaskId||piTasks.at(-1)?.id));
  const announcement=document.querySelector('#pi-task-announcer'),activeTask=visibleTasks[0];
  if(announcement){
    if(activeTask){
      const room=state.rooms.find(item=>item.id===activeTask.roomId),control=room?.executionRisk?'页面执行状态未知':room?.userResumePending?'接管中':room?.ownership==='user'?'用户控制中':'';
      const signature=`${activeTask.id}:${activeTask.status}:${control}`,message=`Corvid Agent：${labels[activeTask.status]||activeTask.status}${control?`；${control}`:''}`;
      if(announcement.dataset.signature!==signature){announcement.dataset.signature=signature;announcement.textContent=message;}
    }else if(announcement.dataset.signature){announcement.dataset.signature='';announcement.textContent='';}
  }
  if(piHistoryOpen){
    const history=document.createElement('div');history.id='pi-chat-history';history.className='pi-chat-history';
    for(const task of [...piTasks].reverse()){
      const item=button('',()=>{piSelectedTaskId=task.id;piContinueTaskId=task.canContinue&&!['running','preparing'].includes(task.status)?task.id:null;piContinuationPreview=null;piContinuationDraft='';piContinuationConsent=false;piHistoryOpen=false;renderPiTasks();});item.className='pi-history-item';item.setAttribute('aria-current',String(task.id===piSelectedTaskId));
      const title=document.createElement('span');title.className='pi-task-title';title.textContent=task.conversation?.find(turn=>turn.role==='user')?.text||task.prompt||'浏览任务';
      const subtitle=document.createElement('small');subtitle.textContent=`${labels[task.status]||task.status} · ${task.page?.title||task.page?.url||'页面'}`;item.append(title,subtitle);history.append(item);
    }
    list.append(history);
  }
  for(const task of visibleTasks){
    const row=document.createElement('article');row.className='pi-task-entry';row.dataset.taskId=task.id;
    const title=document.createElement('strong');title.className='pi-task-title';title.textContent=task.conversation?.find(turn=>turn.role==='user')?.text||task.prompt||'浏览任务';title.title=title.textContent;row.append(title);
    const context=document.createElement('div');context.className='pi-task-context';context.textContent=`Corvid Agent${task.selectedModel?.name?` · ${task.selectedModel.name}`:''} · ${task.page?.title||task.page?.url||'页面'}`;row.append(context);
    const meta=document.createElement('div');meta.className='pi-task-meta';
    const roomState=state.rooms.find(room=>room.id===task.roomId);const controlLabel=roomState?.executionRisk?'页面执行状态未知':roomState?.userResumePending?'接管中':roomState?.ownership==='user'?'用户控制中':'';
    const status=document.createElement('span');status.className='pi-task-state';status.dataset.status=task.status;status.textContent=labels[task.status]||task.status;status.setAttribute('role','status');meta.append(status);
    if(controlLabel){const control=document.createElement('span');control.className='pi-task-control-state';control.textContent=controlLabel;control.setAttribute('role','status');meta.append(control);}
    meta.append(button('打开空间',async()=>{await api.invoke('activateRoom',{id:task.roomId});}));
    if(task.status==='running')meta.append(button('停止任务',async()=>{await api.invoke('stopPiTask',{taskId:task.id});await renderPiTasks();}));
    else {
      if(task.canContinue&&['completed','interrupted','failed','waiting_for_user'].includes(task.status)){const actionLabel=task.continuationMode==='saved-conversation'?'从已保存对话继续':task.status==='failed'?'检查上下文并恢复':'继续对话';const resume=button(piContinueTaskId===task.id?'收起继续对话':actionLabel,()=>{piContinueTaskId=piContinueTaskId===task.id?null:task.id;piContinuationPreview=null;piContinuationConsent=false;renderPiTasks();});resume.disabled=Boolean(roomState&&(roomState.ownership!=='agent'||roomState.userResumePending||roomState.executionRisk));resume.title=resume.disabled?'先交还空间控制权并处理执行风险，再继续该任务':'';meta.append(resume);}
      meta.append(button('移除记录',async()=>{await api.invoke('clearPiTask',{taskId:task.id});if(piContinueTaskId===task.id)piContinueTaskId=null;if(piSelectedTaskId===task.id)piSelectedTaskId=null;await renderPiTasks();}));
    }
    row.append(meta);
    for(const turn of task.conversation||[]){const message=document.createElement('div');message.className=`pi-task-output ${turn.role==='user'?'from-user':'from-pi'}`;message.dataset.role=turn.role;message.setAttribute('aria-label',turn.role==='user'?'你':'Corvid Agent');message.textContent=turn.text|| (turn.status==='running'?'Agent 正在回复…':'');row.append(message);}
    for(const event of task.events||[]){if(task.error&&event.type==='error'&&String(event.text||'').includes(task.error))continue;const line=document.createElement('div');line.className='pi-task-event';line.dataset.type=event.type;line.textContent=event.type==='error'?userFacingAgentError(event.text):event.text;line.setAttribute('role',event.type==='error'?'alert':'status');row.append(line);}
    if(task.status==='failed'){
      const failure=document.createElement('div');failure.className='pi-task-error';failure.setAttribute('role','alert');
      const heading=document.createElement('strong');heading.textContent='任务未完成';failure.append(heading);
      const reason=document.createElement('span');reason.textContent=userFacingAgentError(task.error,'Agent 未能完成此轮对话，请检查模型连接后重试。');failure.append(reason);row.append(failure);
      if(!task.hasSession){const guidance=document.createElement('div');guidance.className='pi-task-recovery-note';guidance.setAttribute('role','status');guidance.textContent='这段对话尚无可恢复记录。打开对应空间检查页面后，再重新开始。';row.append(guidance);}
    } else if(task.error){const error=document.createElement('div');error.className='pi-task-error';error.setAttribute('role','alert');error.textContent=userFacingAgentError(task.error);row.append(error);}
    if(task.stopUnconfirmed){const recovery=document.createElement('div');recovery.className='pi-task-recovery-note';recovery.setAttribute('role','status');recovery.textContent='无法确认上一轮是否已停止。对话记录已保留；请检查模型服务和页面状态，再从新对话继续。';row.append(recovery);}
    else if(task.hasSession&&!task.canContinue){const recovery=document.createElement('div');recovery.className='pi-task-recovery-note';recovery.setAttribute('role','status');recovery.textContent='这段对话记录已保留，但暂时无法从这里继续。你可以打开对应空间检查页面，再开始一段新对话。';row.append(recovery);}
    list.append(row);
  }
  if(!piTasks.length&&!piHistoryOpen){const empty=document.createElement('div');empty.className='pi-chat-welcome';empty.innerHTML='<span class="pi-welcome-mark">✳</span><h3>让 Corvid Agent 帮你读懂网页</h3><p>提问、总结或开始一项浏览任务。先检查页面内容，再决定是否分享给 Agent。</p>';list.append(empty);}
  if(piHistoryOpen&&!piTasks.length){const empty=document.createElement('p');empty.className='workspace-empty-state';empty.textContent='还没有对话记录。打开一个网页后即可开始。';list.append(empty);}
  list.scrollTop=historyAtEnd?list.scrollHeight:historyTop;
  const currentComposer=document.querySelector('#pi-task-form'),continuingTask=piTasks.find(task=>task.id===piContinueTaskId);
  if(continuingTask&&currentComposer)currentComposer.replaceWith(buildContinuationComposer(continuingTask));
  else if(currentComposer?.classList.contains('pi-continuation-form'))renderPiWorkbench();
}
function buildContinuationComposer(task){
  const form=document.createElement('section');form.id='pi-task-form';form.className='pi-continuation-form';form.setAttribute('aria-label','继续对话');
  const page=document.createElement('div');page.className='pi-page-binding';page.textContent=`继续此对话 · ${task.page?.title||task.page?.url||'当前页面'} · ${task.selectedModel?.name||'Corvid Agent'}`;form.append(page);
  if(task.continuationMode==='saved-conversation'){const note=document.createElement('p');note.className='pi-task-recovery-note';note.textContent='Corvid 会把最近最多 40 条对话消息（最多 24,000 个字符）带入新一轮；更早或超出长度的内容不会发送。当前页面仍需重新检查并确认。';form.append(note);}
  const prompt=document.createElement('textarea');prompt.setAttribute('aria-label','继续这项浏览任务');prompt.placeholder='继续这段对话，或告诉 Agent 下一步做什么';prompt.value=piContinuationDraft;prompt.oninput=()=>{piContinuationDraft=prompt.value;};form.append(prompt);
  const preview=button('检查页面内容',async()=>{try{piContinuationPreview=await api.invoke('preparePiTask',{profileId:task.profileId,roomId:task.roomId,tabId:task.tabId});piContinuationConsent=false;renderPiTasks();}catch(error){message.textContent=`无法检查页面内容：${userFacingAgentError(error)}`;}});form.append(preview);
  if(piContinuationPreview){
    const details=document.createElement('div');details.className='pi-context';details.textContent=`将分享给 Agent：\n${piContinuationPreview.title}\n${piContinuationPreview.url}${piContinuationPreview.snapshotTruncated?'\n页面快照过长，以下预览与发送内容均截断至 12 KB。':''}\n\n${piContinuationPreview.snapshot}`;form.append(details);
    const consent=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.id='pi-continuation-consent';check.checked=piContinuationConsent;consent.append(check,document.createTextNode('我已检查，并同意将页面内容和继续指令发送给 Agent'));form.append(consent);
    const send=button('发送',async()=>{try{await api.invoke('continuePiTask',{taskId:task.id,message:prompt.value,includePageContext:check.checked,contextPreview:piContinuationPreview});piContinuationPreview=null;piContinuationDraft='';piContinuationConsent=false;piContinueTaskId=task.id;await renderPiWorkbench();}catch(error){message.textContent=`消息未能发送：${userFacingAgentError(error)}`;}});send.disabled=!check.checked||!prompt.value.trim();check.onchange=()=>{piContinuationConsent=check.checked;send.disabled=!check.checked||!prompt.value.trim();};prompt.oninput=()=>{piContinuationDraft=prompt.value;send.disabled=!check.checked||!prompt.value.trim();};form.append(send);
  }
  const cancel=button('取消继续',()=>{piContinueTaskId=null;piContinuationPreview=null;piContinuationConsent=false;renderPiWorkbench();});cancel.className='pi-secondary-action';form.append(cancel);
  const message=document.createElement('div');message.setAttribute('role','alert');form.append(message);return form;
}
async function renderPiModelControls(target){
  const version=(piModelControlVersions.get(target)||0)+1;piModelControlVersions.set(target,version);
  target.replaceChildren();
  const status=document.createElement('span');status.className='pi-model-status';status.setAttribute('role','status');status.textContent='读取模型目录…';
  try{
    const catalog=await api.invoke('piModels');if(piModelControlVersions.get(target)!==version)return;const select=document.createElement('select');select.className='pi-model-select';select.setAttribute('aria-label','Corvid Agent 模型');
    for(const provider of catalog.providers){
      const group=document.createElement('optgroup');group.label=provider.name;
      for(const model of provider.models){const option=document.createElement('option');option.value=JSON.stringify({providerId:provider.id,modelId:model.id});option.textContent=model.name;option.selected=provider.id===catalog.selection.providerId&&model.id===catalog.selection.modelId;group.append(option);}
      select.append(group);
    }
    if(!Array.from(select.options).some(option=>option.value===JSON.stringify(catalog.selection))){const missing=document.createElement('option');missing.value=JSON.stringify(catalog.selection);missing.textContent=`模型未找到：${catalog.selection.providerId}/${catalog.selection.modelId}`;missing.selected=true;missing.disabled=true;select.prepend(missing);}
    if(!select.options.length)throw new Error('当前没有可用的聊天模型');
    select.onchange=async()=>{try{const next=JSON.parse(select.value);await api.invoke('selectPiModel',next);const provider=catalog.providers.find(item=>item.id===next.providerId);status.textContent=provider?.configured?'新任务将使用此模型':'请先连接此模型的账号';renderPiModelActions(target,catalog,next,status);}catch(error){status.textContent=`无法选择模型：${userFacingAgentError(error)}`;}};
    target.append(select,status);renderPiModelActions(target,catalog,catalog.selection,status);
    const manage=button('管理模型',()=>void openPiModelSettings());manage.type='button';manage.className='pi-model-action pi-model-manage';manage.setAttribute('aria-label','管理 Corvid Agent 模型');target.append(manage);
  }catch(error){if(piModelControlVersions.get(target)!==version)return;status.textContent=`模型设置不可用：${userFacingAgentError(error)}`;target.append(status);}
}
function renderPiModelActions(target,catalog,selection,status){
  target.querySelectorAll('.pi-model-action:not(.pi-model-manage),.pi-model-key').forEach(node=>node.remove());
  const provider=catalog.providers.find(item=>item.id===selection.providerId);if(!provider)return;
  status.textContent=userFacingAgentError(provider.authStatus,provider.configured?'已连接':'未连接');status.setAttribute('aria-label',`${provider.name} ${status.textContent}`);status.title=`${provider.name} · ${status.textContent}`;
  if(provider.configured&&!provider.customEndpoint){const logout=button('退出',async()=>{logout.disabled=true;try{await api.invoke('logoutPiProvider',{providerId:provider.id});await renderPiModelControls(target);}catch(error){logout.disabled=false;status.textContent=`退出失败：${userFacingAgentError(error)}`;}});logout.className='pi-model-action';target.append(logout);return;}
  if(provider.customEndpoint)return;
  if(provider.supportsOAuth){const connect=button('连接账号',async()=>{connect.disabled=true;status.textContent='正在打开账号授权页…完成授权后请返回 Corvid';try{await api.invoke('loginPiProvider',{providerId:provider.id});await renderPiModelControls(target);}catch(error){connect.disabled=false;status.textContent=`登录未完成：${userFacingAgentError(error)}`;}});connect.className='pi-model-action';target.append(connect);}
  if(provider.supportsApiKey){const key=document.createElement('input');key.className='pi-model-key';key.type='password';key.autocomplete='off';key.spellcheck=false;key.placeholder='API Key';key.setAttribute('aria-label',`${provider.name} API Key`);const save=button('连接 Key',async()=>{save.disabled=true;try{await api.invoke('loginPiProviderApiKey',{providerId:provider.id,apiKey:key.value});key.value='';await renderPiModelControls(target);}catch(error){save.disabled=false;status.textContent=`连接失败：${userFacingAgentError(error)}`;}});save.className='pi-model-action';target.append(key,save);}
  if(!provider.supportsOAuth&&!provider.supportsApiKey)status.textContent+=' · 请在模型服务设置中完成认证';
}
function resetPiEndpointForm(){
  document.querySelector('#pi-endpoint-id').value='';document.querySelector('#pi-endpoint-name').value='';document.querySelector('#pi-endpoint-url').value='';document.querySelector('#pi-endpoint-key').value='';document.querySelector('#pi-endpoint-model-ids').value='';document.querySelector('#pi-endpoint-clear-key').checked=false;document.querySelector('#pi-endpoint-form-title').textContent='添加自定义端点';document.querySelector('#pi-endpoint-error').textContent='';document.querySelector('#pi-endpoint-discovered').textContent='';
}
async function renderPiCustomEndpoints(){
  const list=document.querySelector('#pi-custom-endpoints');list.replaceChildren();
  try{
    const catalog=await api.invoke('piModels');
    if(!catalog.endpoints.length){const empty=document.createElement('p');empty.className='pi-endpoint-empty';empty.textContent='还没有自定义端点。添加后，模型会出现在 Corvid Agent 模型选择器中。';list.append(empty);return;}
    for(const endpoint of catalog.endpoints){
      const row=document.createElement('div');row.className='pi-endpoint-row';
      const info=document.createElement('div'),name=document.createElement('strong'),details=document.createElement('span');name.textContent=endpoint.name;details.textContent=`${endpoint.baseUrl} · ${endpoint.modelIds.join(', ')}${endpoint.configuredKey?' · API Key 已保存':''}`;info.append(name,details);
      const edit=button('编辑',()=>{document.querySelector('#pi-endpoint-id').value=endpoint.id;document.querySelector('#pi-endpoint-name').value=endpoint.name;document.querySelector('#pi-endpoint-url').value=endpoint.baseUrl;document.querySelector('#pi-endpoint-key').value='';document.querySelector('#pi-endpoint-model-ids').value=endpoint.modelIds.join('\n');document.querySelector('#pi-endpoint-clear-key').checked=false;document.querySelector('#pi-endpoint-form-title').textContent='编辑自定义端点';document.querySelector('#pi-endpoint-error').textContent='';document.querySelector('#pi-endpoint-name').focus();});edit.type='button';
      const remove=button('移除',async()=>{if(!window.confirm(`移除“${endpoint.name}”端点？已有对话记录不会删除。`))return;remove.disabled=true;try{await api.invoke('removePiEndpoint',{id:endpoint.id});await renderPiCustomEndpoints();await renderPiModelControls(document.querySelector('.pi-model-controls'));}catch(error){remove.disabled=false;document.querySelector('#pi-endpoint-error').textContent=userFacingAgentError(error);}});remove.type='button';
      row.append(info,edit,remove);list.append(row);
    }
  }catch(error){document.querySelector('#pi-endpoint-error').textContent=`无法读取模型设置：${userFacingAgentError(error)}`;}
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
  if(bound){const room=state.rooms.find(value=>value.id===piBinding.roomId);page.textContent=`任务页面：${room.name} / ${bound.label} · ${bound.title||bound.url}`;}
  else page.textContent=current&&/^https?:/i.test(current.url)?`当前页面：${current.title||current.url}`:'请先打开一个 HTTP(S) 页面，再连接 Corvid Agent';
  form.append(page);
  if(!bound&&current&&/^https?:/i.test(current.url)){
    const create=button('连接当前页面',async()=>{try{const room=await api.invoke('createPiRoom',{sourceTabId:current.id,sourceUrl:current.url,name:'Corvid Agent 对话'});piBinding={roomId:room.id,tabId:room.tabs[0].id,profileId:room.profileId};piContextPreview=null;renderPiWorkbench();}catch(error){page.textContent=`无法连接当前页面：${userFacingAgentError(error)}`;}});create.className='pi-create-room';form.append(create);
  }
  const prompt=document.createElement('textarea');prompt.id='pi-task-prompt';prompt.setAttribute('aria-label','描述要完成的浏览任务');prompt.placeholder='问问当前页面，或描述你想完成的事…';prompt.value=piPromptDraft;prompt.oninput=()=>{piPromptDraft=prompt.value;};form.append(prompt);
  const modelControls=document.createElement('div');modelControls.className='pi-model-controls';form.insertBefore(modelControls,prompt);void renderPiModelControls(modelControls);
  const previewButton=button('检查并预览页面上下文',async()=>{if(!piBinding){page.textContent='请先连接当前页面';return;}try{piContextPreview=await api.invoke('preparePiTask',piBinding);renderPiWorkbench();}catch(error){page.textContent=`无法读取页面上下文：${userFacingAgentError(error)}`;}});previewButton.className='pi-secondary-action';previewButton.disabled=!piBinding;form.append(previewButton);
  if(piContextPreview){
    const details=document.createElement('div');details.className='pi-context';details.textContent=`将分享给 Agent：\n${piContextPreview.title}\n${piContextPreview.url}${piContextPreview.snapshotTruncated?'\n页面快照过长，以下预览与发送内容均截断至 12 KB。':''}\n\n${piContextPreview.snapshot}`;form.append(details);
    const consent=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.id='pi-context-consent';consent.className='pi-consent';consent.append(check,document.createTextNode('我已检查，并同意将页面内容发送给 Agent'));form.append(consent);
    const start=button('发送',async()=>{try{const task=await api.invoke('startPiTask',{...piBinding,prompt:prompt.value,includePageContext:check.checked,contextPreview:piContextPreview});piSelectedTaskId=task?.id||null;piContextPreview=null;piPromptDraft='';renderPiWorkbench();}catch(error){page.textContent=`消息未能发送：${userFacingAgentError(error)}`;}});start.className='pi-primary-action';start.disabled=!bound||!check.checked||!prompt.value.trim();check.onchange=()=>{start.disabled=!bound||!check.checked||!prompt.value.trim();};prompt.oninput=()=>{piPromptDraft=prompt.value;start.disabled=!bound||!check.checked||!prompt.value.trim();};form.append(start);
  }
  const workspace=document.createElement('div');workspace.id='pi-workbench-content';
  const list=document.createElement('div');list.id='pi-task-list';
  const announcement=document.createElement('div');announcement.id='pi-task-announcer';announcement.className='visually-hidden';announcement.setAttribute('role','status');announcement.setAttribute('aria-live','polite');announcement.setAttribute('aria-atomic','true');
  workspace.append(list,form,announcement);panel.append(workspace);void renderPiTasks();
}
function setLibraryPanel(kind,trigger=null){
  libraryKind=kind;libraryTrigger=kind?trigger:null;
  const panel=document.querySelector('#library');
  const agentRoomAnnouncement=document.querySelector('#agent-room-announcer');if(agentRoomAnnouncement){agentRoomAnnouncement.hidden=kind!=='agent-rooms';if(agentRoomAnnouncement.hidden)agentRoomAnnouncement.textContent='';}
  if(kind){panel.hidden=false;panel.setAttribute('aria-label',kind==='pi-workbench'?'Corvid Agent':kind==='agent-rooms'?'Agent 工作区':kind==='bookmarks'?'书签':kind==='history'?'浏览历史':'下载');}
  else{panel.hidden=true;delete panel.dataset.kind;panel.setAttribute('aria-label','工作区面板');}
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
  if(result.bookmarks.length>items.length){const more=button('更多书签',()=>showLibrary('bookmarks'));more.className='bookmark-item';bar.append(more);}
}
api.onBrowserHomeAction(kind=>{
  if(kind==='bookmarks')void showLibrary('bookmarks',document.querySelector('#show-bookmarks'));
  else if(kind==='history')void showLibrary('history',document.querySelector('#show-history'));
  else if(kind==='agent')void document.querySelector('#show-pi-workbench').click();
});
api.onState(draw); api.onPiTasks(()=>{if(libraryKind==='pi-workbench')void renderPiTasks();else if(libraryKind==='agent-rooms')void renderAgentRooms();}); api.onPiAuthEvent(event=>{const status=document.querySelector('.pi-model-status');if(event.type==='device_code'){if(status)status.textContent=`登录码 ${event.userCode} · ${event.verificationUri}`;return;}if(event.type==='auth_url'){const link=document.querySelector('#pi-auth-open-url');link.href=event.url;link.hidden=false;link.onclick=async e=>{e.preventDefault();try{await api.invoke('openPiAuthUrl',{url:event.url});}catch(error){if(status)status.textContent=`无法打开授权页：${userFacingAgentError(error)}`;}};if(status)status.textContent='请在浏览器完成授权，或从授权框打开登录页';return;}if((event.type==='progress'||event.type==='info')&&status)status.textContent=userFacingAgentError(event.message,'正在连接模型账号…');});
api.onPiAuthPrompt(async request=>{
  const prompt=request.prompt||{},dialog=document.querySelector('#pi-auth-dialog'),form=document.querySelector('#pi-auth-form'),message=document.querySelector('#pi-auth-message'),label=document.querySelector('#pi-auth-input-label');let input=document.querySelector('#pi-auth-input');
  message.textContent=userFacingAgentError(prompt.message||prompt.instructions,'请按步骤完成模型账号授权。');label.replaceChildren(document.createTextNode(prompt.type==='manual_code'?'授权码或回调链接':'授权信息'));
  let cancelled=false,value;
  if(prompt.type==='select'){
    const options=prompt.options||prompt.choices||{},select=document.createElement('select');select.id='pi-auth-input';select.setAttribute('aria-label','授权方式');
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
  try{await api.invoke('resolvePiAuthPrompt',{id:request.id,value,cancelled});}catch(error){const status=document.querySelector('.pi-model-status');if(status)status.textContent=`授权步骤未完成：${userFacingAgentError(error)}`;}
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
document.querySelector('#rename-profile-form').onsubmit=async event=>{event.preventDefault();try{await api.invoke('renameProfile',{id:renameProfileId,name:document.querySelector('#renamed-profile-name').value});document.querySelector('#rename-profile').close();}catch(error){document.querySelector('#rename-profile-error').textContent=error.message;}};
document.querySelector('#cancel-rename-profile').onclick=()=>document.querySelector('#rename-profile').close();
document.querySelector('#rename-profile').onclose=()=>api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});
let settingsProfileId;
async function renderProfileExtensions(){
  const list=document.querySelector('#profile-extension-list');list.replaceChildren();
  const {extensions}=await api.invoke('listProfileExtensions',{profileId:settingsProfileId});
  if(!extensions.length){const empty=document.createElement('p');empty.className='empty-extension-list';empty.textContent='尚未导入扩展。';list.append(empty);return;}
  for(const extension of extensions){
    const row=document.createElement('article');row.className='profile-extension';
    const heading=document.createElement('div');heading.className='profile-extension-heading';
    const title=document.createElement('strong');title.textContent=extension.name;heading.append(title);
    const version=document.createElement('span');version.textContent=`v${extension.version} · MV${extension.manifestVersion}`;heading.append(version);row.append(heading);
    const grants=[...(extension.permissions?.required||[]),...(extension.permissions?.hosts||[])];
    const optional=[...(extension.permissions?.optional||[]),...(extension.permissions?.optionalHosts||[])];
    const grantText=document.createElement('p');grantText.textContent=`必需权限：${grants.join('、')||'未声明'}${optional.length?'；可选权限：'+optional.join('、'):''}`;row.append(grantText);
    if(extension.loadError){const warning=document.createElement('p');warning.className='extension-load-error';warning.textContent=`加载失败：${extension.loadError}`;row.append(warning);}
    const actions=document.createElement('div');actions.className='profile-extension-actions';
    const toggleLabel=document.createElement('label');toggleLabel.className='extension-enabled';
    const toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=extension.enabled;toggle.setAttribute('aria-label',`${extension.enabled?'停用':'启用'} ${extension.name}`);
    toggle.onchange=async()=>{try{await api.invoke('setProfileExtensionEnabled',{profileId:settingsProfileId,extensionId:extension.id,enabled:toggle.checked});await renderProfileExtensions();}catch(error){toggle.checked=extension.enabled;document.querySelector('#settings-error').textContent=error.message;}};
    toggleLabel.append(toggle,document.createTextNode('启用'));actions.append(toggleLabel);
    const remove=document.createElement('button');remove.type='button';remove.textContent='移除';remove.onclick=async()=>{try{await api.invoke('removeProfileExtension',{profileId:settingsProfileId,extensionId:extension.id});await renderProfileExtensions();}catch(error){document.querySelector('#settings-error').textContent=error.message;}};actions.append(remove);
    row.append(actions);list.append(row);
  }
}
async function renderAgentAccess(){
  const roomOptions=document.querySelector('#agent-room-options'),list=document.querySelector('#agent-client-list');
  roomOptions.replaceChildren();list.replaceChildren();
  const rooms=state?.rooms||[];
  if(!rooms.length){const empty=document.createElement('p');empty.className='agent-client-empty';empty.textContent='当前没有可授权的空间。请先创建 Agent 空间。';roomOptions.append(empty);}
  else for(const room of rooms){
    const label=document.createElement('label');label.className='agent-room-choice';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.name='agent-room-id';checkbox.value=room.id;checkbox.setAttribute('aria-label',`${room.name} · ${state.profiles.find(profile=>profile.id===room.profileId)?.name||'浏览身份'}`);
    const name=document.createElement('span');name.textContent=`${room.name} · ${state.profiles.find(profile=>profile.id===room.profileId)?.name||'浏览身份'}`;
    label.append(checkbox,name);roomOptions.append(label);
  }
  document.querySelector('#create-agent-client').disabled=!rooms.length;
  try{
    const {clients}=await api.invoke('listAgentClients');
    if(!clients.length){const empty=document.createElement('p');empty.className='agent-client-empty';empty.textContent='还没有已授权的外部客户端。';list.append(empty);return;}
    for(const client of clients){
      const row=document.createElement('article');row.className='agent-client-row';row.dataset.revoked=String(client.revoked);
      const summary=document.createElement('div');summary.className='agent-client-summary';
      const name=document.createElement('strong');name.textContent=client.name;summary.append(name);
      const scope=(client.roomIds||[]).map(id=>rooms.find(room=>room.id===id)?.name||'已移除的空间').join('、')||'无空间授权';
      const status=document.createElement('span');status.textContent=client.revoked?`已撤销 · ${scope}`:`可访问：${scope}`;summary.append(status);
      const created=document.createElement('span');created.textContent=`创建于 ${new Date(client.createdAt).toLocaleDateString()}`;summary.append(created);row.append(summary);
      if(!client.revoked){const revoke=button('撤销',async()=>{
        if(!window.confirm(`撤销“${client.name}”的访问权限？撤销后该客户端会立即无法连接。`))return;
        revoke.disabled=true;try{await api.invoke('revokeAgentClient',{id:client.id});document.querySelector('#agent-access-error').textContent='';await renderAgentAccess();}catch(error){revoke.disabled=false;document.querySelector('#agent-access-error').textContent=error.message;}
      });revoke.setAttribute('aria-label',`撤销 ${client.name} 的访问权限`);row.append(revoke);}
      else row.append(document.createElement('span'));
      list.append(row);
    }
  }catch(error){document.querySelector('#agent-access-error').textContent=`无法读取授权客户端：${error.message}`;}
}
document.querySelector('#show-settings').onclick=async()=>{settingsProfileId=state.activeProfileId;const settings=await api.invoke('settings',{profileId:settingsProfileId});const preset=document.querySelector('#search-preset');const known=[...preset.options].some(option=>option.value===settings.searchTemplate);preset.value=known?settings.searchTemplate:'custom';document.querySelector('#search-template').value=settings.searchTemplate;document.querySelector('#settings-error').textContent='';await renderProfileExtensions();await openShellDialog('#settings');};
document.querySelector('#open-agent-access').onclick=async()=>{document.querySelector('#settings').close();document.querySelector('#agent-access-error').textContent='';document.querySelector('#agent-client-token-panel').hidden=true;document.querySelector('#agent-client-token').value='';document.querySelector('#agent-client-form').reset();await renderAgentAccess();await openShellDialog('#agent-access-dialog','#agent-client-name');};
document.querySelector('#close-agent-access').onclick=()=>document.querySelector('#agent-access-dialog').close();
document.querySelector('#agent-access-dialog').addEventListener('close',()=>{document.querySelector('#agent-client-token').value='';document.querySelector('#agent-client-token-panel').hidden=true;document.querySelector('#agent-client-copy-status').textContent='';});
document.querySelector('#agent-client-form').onsubmit=async event=>{event.preventDefault();const roomIds=[...document.querySelectorAll('input[name="agent-room-id"]:checked')].map(input=>input.value);const error=document.querySelector('#agent-access-error');error.textContent='';if(!roomIds.length){error.textContent='至少选择一个空间。';return;}const submit=document.querySelector('#create-agent-client');submit.disabled=true;try{const client=await api.invoke('createAgentClient',{name:document.querySelector('#agent-client-name').value,roomIds});document.querySelector('#agent-client-form').reset();document.querySelector('#agent-client-token').value=client.token;document.querySelector('#agent-client-token-panel').hidden=false;await renderAgentAccess();document.querySelector('#agent-client-token').focus();}catch(failure){error.textContent=failure.message;}finally{submit.disabled=!(state?.rooms?.length);}};
document.querySelector('#copy-agent-client-token').onclick=async()=>{const status=document.querySelector('#agent-client-copy-status');try{await api.invoke('copyTextToClipboard',{text:document.querySelector('#agent-client-token').value});status.textContent='已复制到剪贴板';}catch(error){status.textContent=`复制失败：${error.message}`;}};
document.querySelector('#search-preset').onchange=event=>{if(event.target.value!=='custom')document.querySelector('#search-template').value=event.target.value;};
document.querySelector('#search-template').oninput=()=>{document.querySelector('#search-preset').value='custom';};
document.querySelector('#settings-form').onsubmit=async event=>{event.preventDefault();try {await api.invoke('saveSettings',{profileId:settingsProfileId,searchTemplate:document.querySelector('#search-template').value});document.querySelector('#settings').close();}catch(error){document.querySelector('#settings-error').textContent=error.message;}};
document.querySelector('#cancel-settings').onclick=()=>document.querySelector('#settings').close();
document.querySelector('#settings').onclose=()=>api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});
document.querySelector('#close-pi-model-settings').onclick=()=>document.querySelector('#pi-model-settings').close();
document.querySelector('#reset-pi-endpoint-form').onclick=resetPiEndpointForm;
document.querySelector('#discover-pi-endpoint-models').onclick=async event=>{
  const action=event.currentTarget;action.disabled=true;const status=document.querySelector('#pi-endpoint-discovered');status.textContent='正在读取模型列表…';
  try{const ids=await api.invoke('discoverPiEndpointModels',{baseUrl:document.querySelector('#pi-endpoint-url').value,apiKey:document.querySelector('#pi-endpoint-key').value});document.querySelector('#pi-endpoint-model-ids').value=ids.join('\n');status.textContent=`已发现 ${ids.length} 个模型；可编辑后保存。`;}
  catch(error){status.textContent=`读取失败：${userFacingAgentError(error)}`;}
  finally{action.disabled=false;}
};
document.querySelector('#pi-model-endpoint-form').onsubmit=async event=>{
  event.preventDefault();const save=document.querySelector('#save-pi-endpoint'),error=document.querySelector('#pi-endpoint-error');save.disabled=true;error.textContent='';
  try{
    const id=document.querySelector('#pi-endpoint-id').value;
    await api.invoke('savePiEndpoint',{...(id?{id}:{}),name:document.querySelector('#pi-endpoint-name').value,baseUrl:document.querySelector('#pi-endpoint-url').value,apiKey:document.querySelector('#pi-endpoint-key').value,clearApiKey:document.querySelector('#pi-endpoint-clear-key').checked,modelIds:document.querySelector('#pi-endpoint-model-ids').value});
    resetPiEndpointForm();document.querySelector('#pi-endpoint-discovered').textContent='端点已保存；模型已加入 Agent 工作台选择器。';await renderPiCustomEndpoints();const controls=document.querySelector('.pi-model-controls');if(controls)await renderPiModelControls(controls);
  }catch(cause){error.textContent=`保存失败：${userFacingAgentError(cause)}`;}
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
  document.querySelector('#chrome-source-profile').replaceChildren(new Option('先选择资料目录',''));
  document.querySelector('#chrome-source-profile').disabled=true;document.querySelector('#chrome-import-categories').disabled=true;document.querySelector('#confirm-chrome-import').disabled=true;
  document.querySelector('#chrome-extension-choices').replaceChildren();
  document.querySelector('#chrome-cookie-consent-check').checked=false;
  document.querySelector('#chrome-cookie-consent').hidden=true;
  for(const input of document.querySelectorAll('input[name="chrome-category"]'))input.checked=input.value==='bookmarks'||input.value==='history';
  document.querySelector('#chrome-import-preview').textContent='选择目录后会显示可导入项目数量。';
  await openShellDialog('#chrome-import');
}
function showChromePreview(preview){
  document.querySelector('#chrome-import-preview').textContent=`来源：${preview.sourceName}。找到 ${preview.bookmarks} 个书签、${preview.history} 条历史记录${preview.cookies===null?'':`、${preview.cookies} 个 Cookie`}、${preview.extensions.length} 个可读取扩展。导入只会新增项目；已有资料会跳过。`;
  document.querySelector('#chrome-bookmark-count').textContent=`${preview.bookmarks} 项`;
  document.querySelector('#chrome-history-count').textContent=`${preview.history} 项`;
  document.querySelector('#chrome-cookie-count').textContent=preview.cookies===null?(preview.canImportCookies?'数据库不可读取':'当前平台不支持'):`${preview.cookies} 项`;
  document.querySelector('#chrome-extension-count').textContent=`${preview.extensions.length} 项`;
  const checks=[...document.querySelectorAll('input[name="chrome-category"]')];
  checks.find(input=>input.value==='bookmarks').disabled=preview.bookmarks===0;
  checks.find(input=>input.value==='history').disabled=preview.history===0;
  checks.find(input=>input.value==='cookies').disabled=!preview.canImportCookies||preview.cookies===null||preview.cookies===0;
  checks.find(input=>input.value==='extensions').disabled=preview.extensions.length===0;
  for(const input of checks) if(input.disabled) input.checked=false;
  const choices=document.querySelector('#chrome-extension-choices');choices.replaceChildren();
  for(const extension of preview.extensions){
    const label=document.createElement('label');label.className='chrome-extension-choice';
    const input=document.createElement('input');input.type='checkbox';input.value=extension.id;input.checked=false;input.setAttribute('aria-label',`导入 ${extension.name}`);
    const details=document.createElement('span');
    const title=document.createElement('strong');title.textContent=`${extension.name} · v${extension.version}`;details.append(title);
    const grantList=[...(extension.permissions?.required||[]),...(extension.permissions?.hosts||[])];
    const optionalList=[...(extension.permissions?.optional||[]),...(extension.permissions?.optionalHosts||[])];
    const permission=document.createElement('small');permission.textContent=`必需权限：${grantList.join('、')||'未声明'}${optionalList.length?'；可选权限：'+optionalList.join('、'):''}。${extension.warning}`;details.append(permission);
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
    const failed=result.extensions.failed.map(item=>`${item.name}：${item.error}`).join('；');
    const cookieNotes=[];
    if(result.cookies.skipped)cookieNotes.push(`跳过 ${result.cookies.skipped} 项`);
    if(result.cookies.unsupported)cookieNotes.push(`不支持 ${result.cookies.unsupported} 项`);
    if(result.cookies.failed)cookieNotes.push(`写入失败 ${result.cookies.failed} 项，可再次点击导入重试`);
    const cookieSummary=`Cookie 新增 ${result.cookies.imported} 项${cookieNotes.length?`（${cookieNotes.join('、')}）`:''}`;
    error.textContent=`导入完成：书签新增 ${result.bookmarks.imported} 项、历史新增 ${result.history.imported} 项、${cookieSummary}、扩展新增 ${result.extensions.imported.length} 项${result.extensions.skipped.length?`、扩展跳过 ${result.extensions.skipped.length} 项`:''}${failed?`。未导入：${failed}`:''}。`;
    if(result.cookies.failed)updateChromeImportButton();else document.querySelector('#confirm-chrome-import').disabled=true;
    void renderBookmarksBar();
    if(libraryKind==='bookmarks'||libraryKind==='history')void renderLibrary();
    if(document.querySelector('#settings').open)void renderProfileExtensions();
  }
  catch(reason){error.textContent=reason.message;if(reason.message.includes('回滚未完整完成'))error.dataset.partial='true';}
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
function siteToolsItems(){return [...siteToolsMenu.querySelectorAll('[role="menuitem"]:not(:disabled)')];}
function closeSiteTools(returnFocus=false){if(siteToolsMenu.hidden)return;siteToolsMenu.hidden=true;siteToolsTrigger.setAttribute('aria-expanded','false');if(returnFocus)siteToolsTrigger.focus();}
function openSiteTools(last=false){siteToolsMenu.hidden=false;siteToolsTrigger.setAttribute('aria-expanded','true');(last?siteToolsItems().at(-1):siteToolsItems()[0])?.focus();}
function focusOutsideSiteTools(backward){
  const controls=[...document.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')]
    .filter(element=>!element.closest('[hidden]')&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden'&&!siteToolsMenu.contains(element));
  const index=controls.indexOf(siteToolsTrigger),target=controls[index+(backward?-1:1)]||(backward?controls.at(-1):controls[0]);
  closeSiteTools();(target||siteToolsTrigger).focus();
}
document.querySelector('#site-permissions').onclick = async () => {closeSiteTools(true);const tab=activeTab();if(!tab)return;siteDataNotice=null;try{const result=await api.invoke('reviewSitePermissions',{id:tab.id});if(result.revoked)siteDataNotice={tabId:tab.id,message:`已撤销 ${result.origin} 的本次授权。`};}catch(error){siteDataNotice={tabId:tab.id,message:`无法管理站点权限：${error.message}`};}draw(state);};
document.querySelector('#clear-site').onclick = async () => {closeSiteTools(true);const tab=activeTab();if(!tab)return;siteDataNotice=null;try{const result=await api.invoke('clearSiteData',{id:tab.id});if(result.cleared)siteDataNotice={tabId:tab.id,message:`已清理 ${result.origin} 的站点数据；请重新加载页面检查。`};}catch(error){siteDataNotice={tabId:tab.id,message:`无法清理站点数据：${error.message}`};}draw(state);};
async function requestPagePrint(tabId){
  siteDataNotice=null;
  try{
    const result=await api.invoke('printPage',{id:tabId});
    if(result.cancelled)siteDataNotice={tabId,message:'已取消打印。'};
    else if(result.error)siteDataNotice={tabId,message:result.error};
    else siteDataNotice={tabId,message:'打印任务已发送。'};
  }catch(error){siteDataNotice={tabId,message:`无法打印此页：${error.message}`};}
  if(state)draw(state);
}
document.querySelector('#print-page').onclick=()=>{closeSiteTools(true);const tab=activeTab();if(tab)void requestPagePrint(tab.id);};
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
function tabElement(tab, room){
  const el=document.createElement('div');
  el.className=tab.pinned?'tab pinned':'tab'; el.dataset.active=String(tab.active); el.dataset.tabId=tab.id;
  if(tab.pinned) el.dataset.pinned='true';
  const main=document.createElement('button'); main.type='button'; main.className='tab-main'; main.tabIndex=0;main.setAttribute('aria-haspopup','menu');main.setAttribute('aria-expanded','false');main.setAttribute('aria-controls','tab-menu');
  if(tab.active)main.setAttribute('aria-current','page');
  if(tab.pinned){ const pin=document.createElement('img'); pin.className='pin-icon'; pin.alt='已固定'; pin.title='已固定'; pin.draggable=false; pin.src=PIN_ICON; main.append(pin); }
  const icon=document.createElement('img'); icon.className='favicon'; icon.alt=''; icon.draggable=false; icon.src=tab.faviconUrl || FALLBACK_FAVICON;
  icon.onerror=()=>{icon.onerror=null;icon.src=FALLBACK_FAVICON;};
  const title=document.createElement('span'); title.className='tab-title'; title.textContent=tab.title || tab.url || '新标签页';
  main.append(icon,title);
  main.onkeydown=event=>{if(event.key==='ContextMenu'||(event.key==='F10'&&event.shiftKey)){event.preventDefault();openTabMenu(null,tab,main);}};
  const close=document.createElement('button'); close.type='button'; close.className='tab-close'; close.textContent='×'; close.setAttribute('aria-label','关闭标签页'); close.title=`关闭 ${tab.title || tab.url || '标签页'}`;
  close.onclick=event=>{event.stopPropagation();void closeTabFromUi(tab.id);};
  el.append(main,close);
  el.oncontextmenu=event=>{event.preventDefault();openTabMenu(event,tab,main);};
  main.onclick=()=>{closeTabMenu();void api.invoke('activateTab',{id:tab.id}).catch(error=>{controlError=error.message;draw(state);});};
  el.onauxclick=event=>{if(event.button===1){event.preventDefault();void closeTabFromUi(tab.id);}};
  el.onpointerdown=event=>{if(event.button!==0 || event.target===close) return;closeTabMenu();startTabDrag(event,el,room);};
  return el;
}
let tabsSignature='';
function renderTabs(room){
  // Rebuild only when the room or its tabs actually changed: frequent state
  // updates (download progress, agent activity) must not tear down the tab bar
  // while the user is dragging a tab or clicking its close button.
  const signature=[room.id,...room.tabs.map(tab=>[tab.id,tab.title,tab.url,tab.faviconUrl,tab.active,tab.pinned].join('\u0000'))].join('\u0001');
  const existing=document.querySelector('#new-tab');
  if(signature===tabsSignature && existing && existing.parentElement?.id==='tabs') return;
  tabsSignature=signature;
  const tabs=document.querySelector('#tabs'); tabs.replaceChildren();
  for(const tab of room.tabs) tabs.append(tabElement(tab,room));
  const add=button('+',()=>{void api.invoke('createTab',{id:room.id}).catch(error=>{controlError=error.message;draw(state);});});
  add.id='new-tab'; add.setAttribute('aria-label','新建标签'); tabs.append(add);
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
    {label:tab.pinned?'取消固定':'固定标签',action:()=>api.invoke('setTabPinned',{id:tab.id,pinned:!tab.pinned})},
    {label:'重新加载',action:()=>api.invoke('reload',{id:tab.id})},
    {label:'复制链接',action:()=>api.invoke('copyTabUrl',{id:tab.id})},
    {separator:true},
    {label:'关闭标签',action:()=>api.invoke('closeTabFromUser',{id:tab.id})},
    {label:'关闭其他标签',action:()=>api.invoke('closeOtherTabs',{id:tab.id})}
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
api.onFindResult(result=>{if(!findOpen || result.tabId!==findTabId) return;const count=document.querySelector('#find-count');if(!result.matches){count.textContent='无结果';return;}count.textContent=`${result.activeMatchOrdinal}/${result.matches}`;});
api.onFindReset(result=>{if(findTabId===result.tabId) closeFindBar();});
document.addEventListener('pointerdown',event=>{if(tabMenu && !tabMenu.contains(event.target)) closeTabMenu();},true);
