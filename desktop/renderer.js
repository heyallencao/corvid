const api = window.browserShell;
let state, libraryKind = null, controlError = '', siteDataNotice = null;
const button = (text, action, selected = false) => { const b = document.createElement('button'); b.textContent = text; b.className = selected ? 'selected' : ''; b.onclick = action; return b; };
function activeTab() { const room = state?.rooms.find(s => s.id === state.activeRoomId); return room?.tabs.find(t => t.active); }
function draw(value) {
  state = value;
  const dialogView=document.querySelector('#page-dialog');
  if(dialogView.open && !state.rooms.some(room=>room.tabs.some(tab=>tab.id===dialogTabId && tab.dialog))) dialogView.close();
  if (libraryKind) void renderLibrary();
  const rooms = document.querySelector('#rooms'); rooms.replaceChildren();
  const profileSelect=document.createElement('select');profileSelect.setAttribute('aria-label','Profile');
  for(const profile of state.profiles){const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;option.selected=profile.id===state.activeProfileId;profileSelect.append(option);}
  profileSelect.onchange=()=>api.invoke('activateProfile',{id:profileSelect.value});rooms.append(profileSelect);
  rooms.append(button('+ Profile',async()=>{await api.invoke('setPanel',{open:true});document.querySelector('#new-profile').showModal();document.querySelector('#profile-name').focus();}));
  rooms.append(button('重命名 Profile',async()=>{renameProfileId=state.activeProfileId;const profile=state.profiles.find(item=>item.id===renameProfileId);document.querySelector('#renamed-profile-name').value=profile.name;document.querySelector('#rename-profile-error').textContent='';await api.invoke('setPanel',{open:true});document.querySelector('#rename-profile').showModal();document.querySelector('#renamed-profile-name').select();}));
  for (const s of state.rooms.filter(s=>s.profileId===state.activeProfileId)) rooms.append(button(`${s.name} ${s.ownership === 'agent' ? '•' : ''}`, () => api.invoke('activateRoom', {id:s.id}), s.id === state.activeRoomId));
  if(state.activeRoomId)rooms.append(button('关闭当前 Room',async()=>{const id=state.activeRoomId;controlError='';try{await api.invoke('closeRoomFromUser',{id});}catch(error){controlError=error.message;draw(state);}}));
  rooms.append(button('+ Room', async () => { await api.invoke('setPanel',{open:true}); document.querySelector('#new-room').showModal(); document.querySelector('#room-name').focus(); }));
  const room = state.rooms.find(s => s.id === state.activeRoomId); const tabs = document.querySelector('#tabs'); tabs.replaceChildren();
  if (!room) {document.querySelector('#address').value='';document.querySelector('#status').textContent='';return;}
  for (const t of room.tabs) { tabs.append(button(t.title || t.url || '新标签页', () => api.invoke('activateTab', {id:t.id}), t.active)); tabs.append(button('×', async()=>{controlError='';try{await api.invoke('closeTab',{id:t.id});}catch(error){controlError=error.message;draw(state);}})); }
  tabs.append(button('+', () => api.invoke('createTab',{id:room.id})));
  const active = activeTab(); document.querySelector('#address').value = active?.url === 'about:blank' ? '' : active?.url || '';
  const status=document.querySelector('#status'); status.replaceChildren();
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
  await api.invoke('setPanel',{open:true});document.querySelector('#page-dialog').showModal();
}
async function answerPageDialog(accept) {
  const tabId=dialogTabId, tab=state.rooms.flatMap(room=>room.tabs).find(item=>item.id===tabId);
  const promptText=tab?.dialog?.type==='prompt' ? document.querySelector('#page-dialog-prompt').value : undefined;
  await api.invoke('handleDialog',{id:tabId,accept,...(promptText===undefined?{}:{promptText})});
  document.querySelector('#page-dialog').close();
}
document.querySelector('#page-dialog-form').onsubmit=event=>{event.preventDefault();void answerPageDialog(true);};
document.querySelector('#page-dialog-dismiss').onclick=()=>answerPageDialog(false);
document.querySelector('#page-dialog').onclose=()=>api.invoke('setPanel',{open:Boolean(libraryKind)});
let libraryRenderVersion=0;
async function renderLibrary() {
  if (!libraryKind) return;
  const kind = libraryKind, profileId=state.activeProfileId, version=++libraryRenderVersion; const result = await api.invoke(kind,{profileId}); if (version!==libraryRenderVersion || libraryKind !== kind || state.activeProfileId!==profileId) return;
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
      items.append(row); continue;
    }
    const link = document.createElement('a'); link.href = '#'; link.textContent = item.title || item.url; link.title = item.url;
    link.onclick = async event => { event.preventDefault(); const tab=activeTab(); if(tab) await api.invoke('navigate',{id:tab.id,url:item.url}); };
    const remove = button('删除', async () => { await api.invoke(kind === 'history' ? 'removeHistory' : 'removeBookmark',{id:item.id,profileId}); await renderLibrary(); });
    remove.setAttribute('aria-label',`删除 ${item.title || item.url}`); row.append(link,remove); items.append(row);
  }
  if (!matching.length) items.textContent = query && result[kind].length ? '没有匹配结果' : kind === 'history' ? '暂无浏览历史' : kind === 'downloads' ? '暂无下载' : '暂无书签';
}
async function showLibrary(kind) {if(libraryKind!==kind)document.querySelector('#library-search').value='';libraryKind=kind;document.querySelector('#library').hidden=false; await api.invoke('setPanel',{open:true});await renderLibrary();}
api.onState(draw); api.invoke('state').then(draw);
document.querySelector('#new-room-form').onsubmit = async event => { event.preventDefault(); const input=document.querySelector('#room-name'); const name=input.value.trim(); if(!name) return; await api.invoke('createRoom',{name,ownership:'user'}); input.value=''; document.querySelector('#new-room').close(); };
document.querySelector('#cancel-room').onclick = () => document.querySelector('#new-room').close();
document.querySelector('#new-room').onclose = () => api.invoke('setPanel',{open:Boolean(libraryKind)});
document.querySelector('#new-profile-form').onsubmit = async event => {event.preventDefault();const input=document.querySelector('#profile-name');const name=input.value.trim();if(!name)return;const profile=await api.invoke('createProfile',{name});await api.invoke('activateProfile',{id:profile.id});input.value='';document.querySelector('#new-profile').close();};
document.querySelector('#cancel-profile').onclick=()=>document.querySelector('#new-profile').close();
document.querySelector('#new-profile').onclose=()=>api.invoke('setPanel',{open:Boolean(libraryKind)});
let renameProfileId;
document.querySelector('#rename-profile-form').onsubmit=async event=>{event.preventDefault();try{await api.invoke('renameProfile',{id:renameProfileId,name:document.querySelector('#renamed-profile-name').value});document.querySelector('#rename-profile').close();}catch(error){document.querySelector('#rename-profile-error').textContent=error.message;}};
document.querySelector('#cancel-rename-profile').onclick=()=>document.querySelector('#rename-profile').close();
document.querySelector('#rename-profile').onclose=()=>api.invoke('setPanel',{open:Boolean(libraryKind)});
let settingsProfileId;
document.querySelector('#show-settings').onclick=async()=>{settingsProfileId=state.activeProfileId;const settings=await api.invoke('settings',{profileId:settingsProfileId});const preset=document.querySelector('#search-preset');const known=[...preset.options].some(option=>option.value===settings.searchTemplate);preset.value=known?settings.searchTemplate:'custom';document.querySelector('#search-template').value=settings.searchTemplate;document.querySelector('#settings-error').textContent='';await api.invoke('setPanel',{open:true});document.querySelector('#settings').showModal();};
document.querySelector('#search-preset').onchange=event=>{if(event.target.value!=='custom')document.querySelector('#search-template').value=event.target.value;};
document.querySelector('#search-template').oninput=()=>{document.querySelector('#search-preset').value='custom';};
document.querySelector('#settings-form').onsubmit=async event=>{event.preventDefault();try {await api.invoke('saveSettings',{profileId:settingsProfileId,searchTemplate:document.querySelector('#search-template').value});document.querySelector('#settings').close();}catch(error){document.querySelector('#settings-error').textContent=error.message;}};
document.querySelector('#cancel-settings').onclick=()=>document.querySelector('#settings').close();
document.querySelector('#settings').onclose=()=>api.invoke('setPanel',{open:Boolean(libraryKind)});
document.querySelector('#address-form').onsubmit = event => { event.preventDefault(); const tab=activeTab(); if(tab) api.invoke('navigate',{id:tab.id,url:document.querySelector('#address').value}); };
document.querySelectorAll('[data-action]').forEach(el => el.onclick = () => {const tab=activeTab();if(tab) api.invoke(el.dataset.action,{id:tab.id});});
document.querySelector('#bookmark-current').onclick = async () => {const tab=activeTab();if(!tab || !/^https?:/i.test(tab.url)) return;await api.invoke('addBookmark',{url:tab.url,title:tab.title});await showLibrary('bookmarks');};
document.querySelector('#show-bookmarks').onclick = () => showLibrary('bookmarks');
document.querySelector('#show-history').onclick = () => showLibrary('history');
document.querySelector('#show-downloads').onclick = () => showLibrary('downloads');
document.querySelector('#library-search').oninput=()=>{void renderLibrary();};
document.querySelector('#clear-site').onclick = async () => {const tab=activeTab();if(!tab)return;siteDataNotice=null;try{const result=await api.invoke('clearSiteData',{id:tab.id});if(result.cleared)siteDataNotice={tabId:tab.id,message:`已清理 ${result.origin} 的站点数据；请重新加载页面检查。`};}catch(error){siteDataNotice={tabId:tab.id,message:`无法清理站点数据：${error.message}`};}draw(state);};
document.querySelector('#site-permissions').onclick = async () => {const tab=activeTab();if(!tab)return;siteDataNotice=null;try{const result=await api.invoke('reviewSitePermissions',{id:tab.id});if(result.revoked)siteDataNotice={tabId:tab.id,message:`已撤销 ${result.origin} 的本次授权。`};}catch(error){siteDataNotice={tabId:tab.id,message:`无法管理站点权限：${error.message}`};}draw(state);};
document.querySelector('#close-library').onclick = () => {libraryKind=null;document.querySelector('#library').hidden=true;api.invoke('setPanel',{open:false});};
