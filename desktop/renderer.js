const api = window.browserShell;
let state, libraryKind = null, controlError = '', siteDataNotice = null, piBinding = null, piContextPreview = null, piTasks = [], piPromptDraft = '', piContinueTaskId = null, piContinuationPreview = null, piContinuationDraft = '', piContinuationConsent = false;
let chromeImportOnboardingPrompted=false;
const button = (text, action, selected = false) => { const b = document.createElement('button'); b.textContent = text; b.className = selected ? 'selected' : ''; b.onclick = action; return b; };
async function openShellDialog(selector, focusSelector) {
  await api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});
  await api.invoke('setShellModal',{open:true});
  const dialog=document.querySelector(selector);dialog.showModal();
  if(focusSelector)document.querySelector(focusSelector).focus();
}
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>{void api.invoke('setShellModal',{open:false});});
function activeTab() { const room = state?.rooms.find(s => s.id === state.activeRoomId); return room?.tabs.find(t => t.active); }
function draw(value) {
  state = value;
  if(state.needsChromeImportOnboarding&&!chromeImportOnboardingPrompted){chromeImportOnboardingPrompted=true;void openShellDialog('#chrome-import-onboarding');}
  if(piBinding&&(piBinding.profileId!==state.activeProfileId||!state.rooms.some(room=>room.id===piBinding.roomId&&room.tabs.some(tab=>tab.id===piBinding.tabId)))){piBinding=null;piContextPreview=null;}
  const dialogView=document.querySelector('#page-dialog');
  if(dialogView.open && !state.rooms.some(room=>room.tabs.some(tab=>tab.id===dialogTabId && tab.dialog))) dialogView.close();
  if (libraryKind === 'pi-workbench') void renderPiTasks(); else if (libraryKind) void renderLibrary();
  document.querySelector('#show-agent-rooms').setAttribute('aria-expanded',String(libraryKind==='agent-rooms'));
  document.querySelector('#show-pi-workbench').setAttribute('aria-expanded',String(libraryKind==='pi-workbench'));
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
  profileAction('新建 Profile',async()=>{await openShellDialog('#new-profile','#profile-name');});
  profileAction('重命名当前 Profile',async()=>{renameProfileId=state.activeProfileId;const profile=state.profiles.find(item=>item.id===renameProfileId);document.querySelector('#renamed-profile-name').value=profile.name;document.querySelector('#rename-profile-error').textContent='';await openShellDialog('#rename-profile','#renamed-profile-name');document.querySelector('#renamed-profile-name').select();});
  const roomMenu=document.querySelector('#room-menu');roomMenu.replaceChildren();
  const roomAction=(label,fn)=>{const item=button(label,()=>{roomMenu.hidden=true;fn();});item.setAttribute('role','menuitem');roomMenu.append(item);};
  roomAction('新建 Room',async()=>{await openShellDialog('#new-room','#room-name');});
  if(state.activeRoomId)roomAction('关闭当前 Room',async()=>{const id=state.activeRoomId;controlError='';try{await api.invoke('closeRoomFromUser',{id});}catch(error){controlError=error.message;draw(state);}});
  const roomActions=document.querySelector('#room-actions');roomActions.replaceChildren();
  const newWindow=button('＋  新建窗口',async()=>{controlError='';try{await api.invoke('createWindow',{});}catch(error){controlError=error.message;draw(state);}});
  newWindow.className='new-window-button';
  roomActions.append(newWindow);
  const room = state.rooms.find(s => s.id === state.activeRoomId);
  if (!room) {document.querySelector('#tabs').replaceChildren();tabsSignature='';document.querySelector('#address').value='';document.querySelector('#status').textContent='';return;}
  renderTabs(room);
  const active = activeTab(),address=document.querySelector('#address');
  if(document.activeElement!==address)address.value=active?.navigationError?.url || (active?.url === 'about:blank' ? '' : active?.url || '');
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
  if(libraryKind==='agent-rooms'){renderAgentRooms();return;}
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
function renderAgentRooms(){
  const panel=document.querySelector('#library'),items=document.querySelector('#library-items');
  panel.dataset.kind='agent-rooms';
  document.querySelector('#library-title').textContent='Agent 工作区';
  document.querySelector('#library-search').hidden=true;
  const rooms=state.rooms.filter(room=>room.profileId===state.activeProfileId&&(room.ownership==='agent'||room.yielded||room.finished));
  items.replaceChildren();
  for(const room of rooms){
    const row=document.createElement('div');row.className='agent-room-entry';
    const name=document.createElement('span');name.className='agent-room-name';name.textContent=room.name;name.title=room.name;
    const status=document.createElement('span');status.className='agent-room-state';
    const ownershipLabel=room.executionRisk?'页面执行状态未知':room.userResumePending?'正在接管':room.finished?'已结束':room.ownership==='agent'?'Agent 控制中':room.yielded?'用户控制中':'空闲';
    status.textContent=`${ownershipLabel} · ${room.tabs.length} 个标签`;
    const view=button('查看',async()=>{libraryKind=null;panel.hidden=true;delete panel.dataset.kind;await api.invoke('setPanel',{open:false});await api.invoke('activateRoom',{id:room.id});});
    view.setAttribute('aria-label',`查看 ${room.name}`);
    row.append(name,status,view);
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
  if(!rooms.length){const empty=document.createElement('p');empty.className='workspace-empty-state';empty.textContent='当前 Profile 暂无 Agent Room。通过 SDK/CLI 启动的工作区会显示在这里。';items.append(empty);}
}
async function renderPiTasks(){
  if(libraryKind!=='pi-workbench')return;
  const profileId=state.activeProfileId,result=await api.invoke('piTasks',{profileId});
  if(libraryKind!=='pi-workbench'||state.activeProfileId!==profileId)return;
  piTasks=result.tasks;
  if(piContinueTaskId&&!piTasks.some(task=>task.id===piContinueTaskId)){piContinueTaskId=null;piContinuationPreview=null;}
  const items=document.querySelector('#library-items'),list=document.querySelector('#pi-task-list');
  if(!list)return;
  list.replaceChildren();
  const labels={preparing:'准备中',running:'Pi 正在运行',waiting_for_user:'等待用户',completed:'已完成',failed:'失败',interrupted:'结果待检查'};
  for(const task of piTasks){
    const row=document.createElement('article');row.className='pi-task-entry';
    const title=document.createElement('strong');title.className='pi-task-title';title.textContent=task.conversation?.find(turn=>turn.role==='user')?.text||task.prompt||'浏览任务';title.title=title.textContent;row.append(title);
    const context=document.createElement('div');context.className='pi-task-context';context.textContent=`${task.runtime||'Pi SDK'} · ${task.page?.title||task.page?.url||'页面'}`;row.append(context);
    const meta=document.createElement('div');meta.className='pi-task-meta';
    const roomState=state.rooms.find(room=>room.id===task.roomId);const controlLabel=roomState?.executionRisk?'页面执行状态未知':roomState?.userResumePending?'接管中':roomState?.ownership==='user'?'用户控制中':'';
    const status=document.createElement('span');status.className='pi-task-state';status.dataset.status=task.status;status.textContent=labels[task.status]||task.status;status.setAttribute('role','status');meta.append(status);
    if(controlLabel){const control=document.createElement('span');control.className='pi-task-control-state';control.textContent=controlLabel;control.setAttribute('role','status');meta.append(control);}
    meta.append(button('打开 Room',async()=>{await api.invoke('activateRoom',{id:task.roomId});}));
    if(task.status==='running')meta.append(button('停止任务',async()=>{await api.invoke('stopPiTask',{taskId:task.id});await renderPiTasks();}));
    else {
      if(task.piSessionFile&&['completed','interrupted','failed','waiting_for_user'].includes(task.status)){const resume=button(piContinueTaskId===task.id?'收起继续对话':'继续对话',()=>{piContinueTaskId=piContinueTaskId===task.id?null:task.id;piContinuationPreview=null;piContinuationConsent=false;renderPiTasks();});resume.disabled=Boolean(roomState&&(roomState.ownership!=='agent'||roomState.userResumePending||roomState.executionRisk));resume.title=resume.disabled?'先交还 Room 控制权并处理执行风险，再继续 Pi 任务':'';meta.append(resume);}
      meta.append(button('移除记录',async()=>{await api.invoke('clearPiTask',{taskId:task.id});if(piContinueTaskId===task.id)piContinueTaskId=null;await renderPiTasks();}));
    }
    row.append(meta);
    for(const turn of task.conversation||[]){const message=document.createElement('div');message.className=`pi-task-output ${turn.role==='user'?'from-user':'from-pi'}`;message.dataset.role=turn.role;message.setAttribute('aria-label',turn.role==='user'?'你':'Pi');message.textContent=turn.text|| (turn.status==='running'?'Pi 正在回复…':'');row.append(message);}
    for(const event of task.events||[]){const line=document.createElement('div');line.className='pi-task-event';line.dataset.type=event.type;line.textContent=event.text;line.setAttribute('role',event.type==='error'?'alert':'status');row.append(line);}
    if(task.error){const error=document.createElement('div');error.setAttribute('role','alert');error.textContent=task.error;row.append(error);}
    if(piContinueTaskId===task.id)appendContinuationComposer(row,task);
    list.append(row);
  }
  if(!piTasks.length){const empty=document.createElement('p');empty.className='workspace-empty-state';empty.textContent='任务发起后会显示在这里。每项任务都有自己的 Agent Room；发送前可以检查并确认页面上下文。';list.append(empty);}
}
function appendContinuationComposer(row,task){
  const form=document.createElement('section');form.className='pi-task-entry';
  const prompt=document.createElement('textarea');prompt.setAttribute('aria-label','继续这项浏览任务');prompt.placeholder='补充问题或告诉 Pi 下一步要做什么';prompt.value=piContinuationDraft;prompt.oninput=()=>{piContinuationDraft=prompt.value;};form.append(prompt);
  const preview=button('预览后继续',async()=>{try{piContinuationPreview=await api.invoke('preparePiTask',{profileId:task.profileId,roomId:task.roomId,tabId:task.tabId});piContinuationConsent=false;renderPiTasks();}catch(error){message.textContent=`无法继续任务：${error.message}`;}});form.append(preview);
  if(piContinuationPreview){
    const details=document.createElement('div');details.className='pi-context';details.textContent=`Pi 将收到：\n${piContinuationPreview.title}\n${piContinuationPreview.url}${piContinuationPreview.snapshotTruncated?'\n页面快照过长，以下预览与发送内容均截断至 12 KB。':''}\n\n${piContinuationPreview.snapshot}`;form.append(details);
    const consent=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.id='pi-continuation-consent';check.checked=piContinuationConsent;consent.append(check,document.createTextNode('我已检查以上内容，同意将当前页面上下文和继续指令发送给 Pi'));form.append(consent);
    const send=button('发送并继续',async()=>{try{await api.invoke('continuePiTask',{taskId:task.id,message:prompt.value,includePageContext:check.checked,contextPreview:piContinuationPreview});piContinuationPreview=null;piContinuationDraft='';piContinuationConsent=false;piContinueTaskId=null;await renderPiTasks();}catch(error){message.textContent=`任务未能继续：${error.message}`;}});send.disabled=!check.checked||!prompt.value.trim();check.onchange=()=>{piContinuationConsent=check.checked;send.disabled=!check.checked||!prompt.value.trim();};prompt.oninput=()=>{piContinuationDraft=prompt.value;send.disabled=!check.checked||!prompt.value.trim();};form.append(send);
  }
  const message=document.createElement('div');message.setAttribute('role','alert');form.append(message);row.append(form);
}
function renderPiWorkbench(){
  if(piBinding&&piBinding.profileId!==state.activeProfileId){piBinding=null;piContextPreview=null;}
  const panel=document.querySelector('#library'),items=document.querySelector('#library-items');
  panel.dataset.kind='pi-workbench';document.querySelector('#library-title').textContent='Pi Agent 工作台';document.querySelector('#library-search').hidden=true;items.replaceChildren();
  const activeRoom=state.rooms.find(room=>room.id===state.activeRoomId),current=activeRoom?.tabs.find(tab=>tab.active);
  if(!piBinding&&activeRoom?.ownership==='agent'&&current?.label)piBinding={roomId:activeRoom.id,tabId:current.id,profileId:activeRoom.profileId};
  const form=document.createElement('section');form.id='pi-task-form';
  const page=document.createElement('div');page.className='pi-page-binding';page.setAttribute('role','status');
  const bound=piBinding&&state.rooms.find(room=>room.id===piBinding.roomId)?.tabs.find(tab=>tab.id===piBinding.tabId);
  if(bound){const room=state.rooms.find(value=>value.id===piBinding.roomId);page.textContent=`任务页面：${room.name} / ${bound.label} · ${bound.title||bound.url}`;}
  else page.textContent=current?`当前页面：${current.title||current.url}`:'请先打开一个 HTTP(S) 页面';
  form.append(page);
  if(!bound&&current&&/^https?:/i.test(current.url)){
    const create=button('为当前页创建 Pi Room',async()=>{try{const room=await api.invoke('createPiRoom',{sourceTabId:current.id,sourceUrl:current.url,name:'Pi Agent 任务'});piBinding={roomId:room.id,tabId:room.tabs[0].id,profileId:room.profileId};piContextPreview=null;renderPiWorkbench();}catch(error){page.textContent=`无法创建 Pi Room：${error.message}`;}});create.className='pi-create-room';form.append(create);
  }
  const prompt=document.createElement('textarea');prompt.id='pi-task-prompt';prompt.setAttribute('aria-label','描述要完成的浏览任务');prompt.placeholder='例如：阅读此页并提炼三个要点';prompt.value=piPromptDraft;prompt.oninput=()=>{piPromptDraft=prompt.value;};form.append(prompt);
  const previewButton=button('检查并预览页面上下文',async()=>{if(!piBinding){page.textContent='请先为当前页创建 Pi Room';return;}try{piContextPreview=await api.invoke('preparePiTask',piBinding);renderPiWorkbench();}catch(error){page.textContent=`无法读取页面上下文：${error.message}`;}});previewButton.className='pi-secondary-action';previewButton.disabled=!piBinding;form.append(previewButton);
  if(piContextPreview){
    const details=document.createElement('div');details.className='pi-context';details.textContent=`Pi 将收到：\n${piContextPreview.title}\n${piContextPreview.url}${piContextPreview.snapshotTruncated?'\n页面快照过长，以下预览与发送内容均截断至 12 KB。':''}\n\n${piContextPreview.snapshot}`;form.append(details);
    const consent=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.id='pi-context-consent';consent.className='pi-consent';consent.append(check,document.createTextNode('我已检查以上内容，同意将此页面上下文和任务发送给当前 Pi 模型'));form.append(consent);
    const start=button('启动 Pi Agent',async()=>{try{await api.invoke('startPiTask',{...piBinding,prompt:prompt.value,includePageContext:check.checked,contextPreview:piContextPreview});piContextPreview=null;piPromptDraft='';renderPiWorkbench();}catch(error){page.textContent=`Pi Agent 未启动：${error.message}`;}});start.className='pi-primary-action';start.disabled=!bound||!check.checked||!prompt.value.trim();check.onchange=()=>{start.disabled=!bound||!check.checked||!prompt.value.trim();};prompt.oninput=()=>{piPromptDraft=prompt.value;start.disabled=!bound||!check.checked||!prompt.value.trim();};form.append(start);
  }
  items.append(form);
  const list=document.createElement('div');list.id='pi-task-list';items.append(list);void renderPiTasks();
}
async function showLibrary(kind) {if(libraryKind!==kind)document.querySelector('#library-search').value='';libraryKind=kind;document.querySelector('#library').hidden=false; await api.invoke('setPanel',{open:true,workspace:true});await renderLibrary();}
let bookmarksRenderVersion=0;
async function renderBookmarksBar() {
  const version=++bookmarksRenderVersion, profileId=state?.activeProfileId;
  if(!profileId)return;
  const result=await api.invoke('bookmarks',{profileId});
  if(version!==bookmarksRenderVersion || state?.activeProfileId!==profileId)return;
  const bar=document.querySelector('#bookmarks-bar');bar.replaceChildren();
  const items=result.bookmarks.slice(0,12);
  for(const item of items){
    const link=document.createElement('a');link.className='bookmark-item';link.href='#';link.title=item.url;
    const icon=document.createElement('img');icon.alt='';icon.src=`${new URL(item.url).origin}/favicon.ico`;icon.onerror=()=>{icon.remove();};
    const label=document.createElement('span');label.textContent=item.title||item.url;
    link.append(icon,label);link.onclick=async event=>{event.preventDefault();const tab=activeTab();if(tab)await api.invoke('navigate',{id:tab.id,url:item.url});};bar.append(link);
  }
  if(result.bookmarks.length>items.length){const more=button('更多书签',()=>showLibrary('bookmarks'));more.className='bookmark-item';bar.append(more);}
}
api.onState(draw); api.onPiTasks(()=>void renderPiTasks()); api.invoke('state').then(draw);
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
    const row=document.createElement('article');row.className='profile-extension';row.setAttribute('role','listitem');
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
document.querySelector('#show-settings').onclick=async()=>{settingsProfileId=state.activeProfileId;const settings=await api.invoke('settings',{profileId:settingsProfileId});const preset=document.querySelector('#search-preset');const known=[...preset.options].some(option=>option.value===settings.searchTemplate);preset.value=known?settings.searchTemplate:'custom';document.querySelector('#search-template').value=settings.searchTemplate;document.querySelector('#settings-error').textContent='';await renderProfileExtensions();await openShellDialog('#settings');};
document.querySelector('#search-preset').onchange=event=>{if(event.target.value!=='custom')document.querySelector('#search-template').value=event.target.value;};
document.querySelector('#search-template').oninput=()=>{document.querySelector('#search-preset').value='custom';};
document.querySelector('#settings-form').onsubmit=async event=>{event.preventDefault();try {await api.invoke('saveSettings',{profileId:settingsProfileId,searchTemplate:document.querySelector('#search-template').value});document.querySelector('#settings').close();}catch(error){document.querySelector('#settings-error').textContent=error.message;}};
document.querySelector('#cancel-settings').onclick=()=>document.querySelector('#settings').close();
document.querySelector('#settings').onclose=()=>api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});
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
  catch(reason){error.textContent=reason.message;}
};
document.querySelectorAll('input[name="chrome-category"]').forEach(input=>input.onchange=updateChromeImportButton);
document.querySelector('#chrome-import-target-profile').onchange=event=>{if(!chromeImportProfileLocked)chromeImportProfileId=event.target.value;};
document.querySelector('#chrome-cookie-consent-check').onchange=updateChromeImportButton;
document.querySelector('#chrome-extension-choices').onchange=updateChromeImportButton;
document.querySelector('#cancel-chrome-import').onclick=()=>chromeImportDialog.close();
chromeImportDialog.onclose=()=>{if(chromeSourceToken)void api.invoke('releaseChromeImportSource',{sourceToken:chromeSourceToken});chromeSourceToken='';return api.invoke('setPanel',{open:Boolean(libraryKind),workspace:Boolean(libraryKind)});};
document.querySelector('#address-form').onsubmit = event => { event.preventDefault(); const tab=activeTab(); if(tab) api.invoke('navigate',{id:tab.id,url:document.querySelector('#address').value}); };
document.querySelectorAll('[data-action]').forEach(el => el.onclick = () => {const tab=activeTab();if(tab) api.invoke(el.dataset.action,{id:tab.id});});
document.querySelector('#bookmark-current').onclick = async () => {const tab=activeTab();if(!tab || !/^https?:/i.test(tab.url)) return;await api.invoke('addBookmark',{url:tab.url,title:tab.title});void renderBookmarksBar();};
document.querySelector('#show-bookmarks').onclick = () => showLibrary('bookmarks');
document.querySelector('#show-history').onclick = () => {if(libraryKind==='history'){libraryKind=null;document.querySelector('#library').hidden=true;void api.invoke('setPanel',{open:false});}else void showLibrary('history');};
document.querySelector('#show-downloads').onclick = () => showLibrary('downloads');
document.querySelector('#library-search').oninput=()=>{void renderLibrary();};
document.querySelector('#site-permissions').onclick = async () => {document.querySelector('#site-tools').hidden=true;document.querySelector('#more-tools').setAttribute('aria-expanded','false');const tab=activeTab();if(!tab)return;siteDataNotice=null;try{const result=await api.invoke('reviewSitePermissions',{id:tab.id});if(result.revoked)siteDataNotice={tabId:tab.id,message:`已撤销 ${result.origin} 的本次授权。`};}catch(error){siteDataNotice={tabId:tab.id,message:`无法管理站点权限：${error.message}`};}draw(state);};
document.querySelector('#clear-site').onclick = async () => {document.querySelector('#site-tools').hidden=true;document.querySelector('#more-tools').setAttribute('aria-expanded','false');const tab=activeTab();if(!tab)return;siteDataNotice=null;try{const result=await api.invoke('clearSiteData',{id:tab.id});if(result.cleared)siteDataNotice={tabId:tab.id,message:`已清理 ${result.origin} 的站点数据；请重新加载页面检查。`};}catch(error){siteDataNotice={tabId:tab.id,message:`无法清理站点数据：${error.message}`};}draw(state);};
document.querySelector('#more-tools').onclick=event=>{const menu=document.querySelector('#site-tools');menu.hidden=!menu.hidden;event.currentTarget.setAttribute('aria-expanded',String(!menu.hidden));};
document.addEventListener('pointerdown',event=>{const menu=document.querySelector('#site-tools'),trigger=document.querySelector('#more-tools');if(!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const menu=document.querySelector('#site-tools');if(!menu.hidden){menu.hidden=true;document.querySelector('#more-tools').setAttribute('aria-expanded','false');document.querySelector('#more-tools').focus();}}});
document.querySelector('#close-library').onclick = () => {libraryKind=null;document.querySelector('#library').hidden=true;delete document.querySelector('#library').dataset.kind;document.querySelector('#show-agent-rooms').setAttribute('aria-expanded','false');document.querySelector('#show-pi-workbench').setAttribute('aria-expanded','false');api.invoke('setPanel',{open:false});};
document.querySelector('#show-agent-rooms').onclick=async()=>{if(libraryKind==='agent-rooms'){libraryKind=null;document.querySelector('#library').hidden=true;delete document.querySelector('#library').dataset.kind;document.querySelector('#show-agent-rooms').setAttribute('aria-expanded','false');await api.invoke('setPanel',{open:false});}else{libraryKind='agent-rooms';document.querySelector('#library-search').value='';document.querySelector('#library').hidden=false;document.querySelector('#show-agent-rooms').setAttribute('aria-expanded','true');await api.invoke('setPanel',{open:true,workspace:true});await renderAgentRooms();}};
document.querySelector('#show-pi-workbench').onclick=async()=>{if(libraryKind==='pi-workbench'){libraryKind=null;document.querySelector('#library').hidden=true;delete document.querySelector('#library').dataset.kind;document.querySelector('#show-pi-workbench').setAttribute('aria-expanded','false');await api.invoke('setPanel',{open:false});}else{libraryKind='pi-workbench';document.querySelector('#library-search').value='';document.querySelector('#library').hidden=false;document.querySelector('#show-pi-workbench').setAttribute('aria-expanded','true');await api.invoke('setPanel',{open:true,workspace:true});renderPiWorkbench();}};

// ---- 日常浏览：标签栏（favicon/拖拽排序/中键关闭）与页内查找 ----
const FALLBACK_FAVICON='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="#8a94a6" stroke-width="1.4"/><path d="M1.5 7h11M7 1.5c2 2 2 9 0 11M7 1.5c-2 2-2 9 0 11" stroke="#8a94a6" stroke-width="1.2" fill="none"/></svg>');
const PIN_ICON='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16"><path d="M6 1.5h4l-.6 4.2 2.1 2.1v1.2H8.9V15h-1.8V9H4.5V7.8l2.1-2.1L6 1.5Z" fill="#4a5568"/></svg>');
let findOpen=false, findTabId=null, tabMenu=null, tabMenuTabId=null;
function tabElement(tab, room){
  const el=document.createElement('div');
  el.className=tab.pinned?'tab pinned':'tab'; el.setAttribute('role','tab'); el.setAttribute('aria-selected',tab.active?'true':'false'); el.dataset.tabId=tab.id;
  if(tab.pinned) el.dataset.pinned='true';
  const main=document.createElement('button'); main.type='button'; main.className='tab-main'; main.tabIndex=0;
  if(tab.pinned){ const pin=document.createElement('img'); pin.className='pin-icon'; pin.alt='已固定'; pin.title='已固定'; pin.draggable=false; pin.src=PIN_ICON; main.append(pin); }
  const icon=document.createElement('img'); icon.className='favicon'; icon.alt=''; icon.draggable=false; icon.src=tab.faviconUrl || FALLBACK_FAVICON;
  icon.onerror=()=>{icon.onerror=null;icon.src=FALLBACK_FAVICON;};
  const title=document.createElement('span'); title.className='tab-title'; title.textContent=tab.title || tab.url || '新标签页';
  main.append(icon,title);
  const close=document.createElement('button'); close.type='button'; close.className='tab-close'; close.textContent='×'; close.setAttribute('aria-label','关闭标签页'); close.title=`关闭 ${tab.title || tab.url || '标签页'}`;
  close.onclick=event=>{event.stopPropagation();void closeTabFromUi(tab.id);};
  el.append(main,close);
  main.onclick=()=>{closeTabMenu();void api.invoke('activateTab',{id:tab.id}).catch(error=>{controlError=error.message;draw(state);});};
  el.onauxclick=event=>{if(event.button===1){event.preventDefault();void closeTabFromUi(tab.id);}};
  el.oncontextmenu=event=>{event.preventDefault();openTabMenu(event,tab,room);};
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
function closeTabMenu(){const menu=tabMenuElement();if(menu && !menu.hidden){menu.hidden=true;menu.replaceChildren();}tabMenu=null;tabMenuTabId=null;}
function openTabMenu(event,tab,room){
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
    entry.onclick=async()=>{closeTabMenu();controlError='';try{await item.action();}catch(error){controlError=error.message;draw(state);}};
    menu.append(entry);
  }
  menu.hidden=false;
  const menuWidth=180, menuHeight=items.length*30+8;
  menu.style.left=`${Math.max(4,Math.min(event.clientX,window.innerWidth-menuWidth-4))}px`;
  menu.style.top=`${Math.max(4,Math.min(event.clientY,window.innerHeight-menuHeight-4))}px`;
  tabMenuTabId=tab.id; tabMenu=menu;
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
document.addEventListener('keydown',event=>{if(event.key==='Escape' && tabMenu && !tabMenu.hidden){event.preventDefault();closeTabMenu();}});
