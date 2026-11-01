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
  const room = state.rooms.find(s => s.id === state.activeRoomId);
  if (!room) {document.querySelector('#tabs').replaceChildren();tabsSignature='';document.querySelector('#address').value='';document.querySelector('#status').textContent='';return;}
  renderTabs(room);
  const active = activeTab(); document.querySelector('#address').value = active?.url === 'about:blank' ? '' : active?.url || '';
  if(findOpen && (!active || active.id!==findTabId)) closeFindBar();
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
