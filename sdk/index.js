import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';
import { urlMatcher } from './url-matcher.js';
import { fetchInDocument } from './page-fetch.js';
import { CODES, CorvidError, errorFromResponse } from './errors.js';

/** Connect to the desktop control service without exposing a browser debugging endpoint. */
export async function connect({ dataDir = process.env.CORVID_DATA_DIR || join(homedir(), '.corvid') } = {}) {
  const config = JSON.parse(await readFile(join(dataDir, 'control.json'), 'utf8'));
  if (!config.baseUrl || !config.token) throw new Error('Invalid corvid control file');
  const api = async (path, options = {}) => {
    const response = await fetch(new URL(path, config.baseUrl), {
      method: options.method || 'GET',
      headers: { authorization: `Bearer ${config.token}`, ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    if (!response.ok) {
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch {}
      if (!payload) payload = { error: `Desktop request failed: ${response.status} ${text}` };
      throw errorFromResponse(response.status, payload);
    }
    return response.status === 204 ? null : response.json();
  };
  return new Client(api);
}

class Client {
  constructor(api) { this.api = api; }
  async rooms() {
    const result = await this.api('/rooms');
    return (Array.isArray(result) ? result : result.rooms).map(item => new Room(this, item));
  }
  async profiles() { return (await this.api('/profiles')).profiles; }
  async createProfile(name) { return this.api('/profiles', { method: 'POST', body: { name } }); }
  async createRoom(name, { profileId } = {}) {
    const result = await this.api('/rooms', { method: 'POST', body: { name, ...(profileId === undefined ? {} : { profileId }) } });
    return new Room(this, result.room || result);
  }
  async openRoom(identifier, {profileId} = {}) {
    const info=await this.api('/rooms/open',{method:'POST',body:{identifier,...(profileId===undefined?{}:{profileId})}});
    return new Room(this,info);
  }
  async claimRoom(id) {const info=await this.api(`/rooms/${encodeURIComponent(id)}/claim`,{method:'POST',body:{}});return new Room(this,info);}
  async room(id) {
    const room = (await this.rooms()).find(item => item.id === id);
    if (!room) throw new CorvidError(CODES.NOT_FOUND,`Room not found: ${id}`);
    return room;
  }
  async disconnect() { /* HTTP calls do not retain a browser connection. */ }
}

class Room {
  constructor(client, info) { this.client = client; this.info = info; this.id = info.id; this.roomId=info.id;this.name = info.name;this.ownership=info.ownership; }
  async tabs() { return (await this.client.room(this.id)).info.tabs || []; }
  async pages() { return (await this.tabs()).filter(tab=>tab.label).map(tab=>new Page(this.client,tab.id,this.id,tab.label,tab.openedBy)); }
  userPage() {const tab=(this.info.tabs || []).find(item=>item.active);return tab ? new Page(this.client,tab.id,this.id,tab.label,tab.openedBy) : null;}
  async open(url = 'about:blank') {
    const result = await this.client.api(`/rooms/${encodeURIComponent(this.id)}/tabs`, { method: 'POST', body: { url } });
    const tab=result.tab || result;return new Page(this.client,tab.id,this.id,tab.label,tab.openedBy);
  }
  async newPage() { return this.open(); }
  page(ref) {if(typeof ref!=='string' || !ref)throw new Error('Page label or ID is required');return new Page(this.client,null,this.id,ref);}
  async adopt(page,options={}) {if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>key!=='as'))throw new Error('Invalid adopt options');const tabId=typeof page==='string'?page:page instanceof Page?await page.resolveId():page?.id;if(typeof tabId!=='string' || !tabId)throw new Error('A tab or tab ID is required');if(page instanceof Page && page.roomId!==this.id)throw new Error('Page belongs to a different room');const tab=await this.client.api(`/rooms/${encodeURIComponent(this.id)}/adopt`,{method:'POST',body:{tabId,...options}});return new Page(this.client,tab.id,this.id,tab.label,tab.openedBy);}
  async release(label) {return this.client.api(`/rooms/${encodeURIComponent(this.id)}/release`,{method:'POST',body:{label}});}
  async finish(options) {if(!options || typeof options!=='object' || Array.isArray(options) || !Object.hasOwn(options,'keep') || Object.keys(options).some(key=>key!=='keep'))throw new Error('finish requires a keep option');return this.client.api(`/rooms/${encodeURIComponent(this.id)}/finish`,{method:'POST',body:{keep:options.keep}});}
  async close() { return this.client.api(`/rooms/${encodeURIComponent(this.id)}`, { method: 'DELETE' }); }
  async yieldControl() { return this.client.api(`/rooms/${encodeURIComponent(this.id)}/yieldControl`, { method: 'POST', body: {} }); }
  async resumeControl() { return this.client.api(`/rooms/${encodeURIComponent(this.id)}/resumeControl`, { method: 'POST', body: {} }); }
  async waitForControl(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['interval','timeout'].includes(key))) throw new TypeError('waitForControl accepts interval and timeout options');
    const { interval = 20000, timeout = 600000 } = options;
    for (const [name,value] of Object.entries({interval,timeout})) if (typeof value!=='number' || !Number.isFinite(value) || value <= 0 || value > 2147483647) throw new RangeError(`${name} must be a positive number no greater than 2147483647 ms`);
    const deadline=performance.now()+timeout;
    for (;;) {
      const current=await this.client.room(this.id),info=current.info;
      if(info.ownership==='agent' && !info.finished && !info.userResumePending && !info.executionRisk) {this.info=info;this.ownership=info.ownership;return;}
      const remaining=deadline-performance.now();
      if(remaining<=0) throw new CorvidError(CODES.TIMEOUT,`task.waitForControl timed out after ${timeout}ms`);
      await new Promise(resolve=>setTimeout(resolve,Math.min(interval,remaining)));
    }
  }
}

function mouseOptions(options) {if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>key!=='button'))throw new Error('Only the mouse button option is supported');return options;}
class Page {
  constructor(client, tabId,roomId,label,openedBy) { this.client = client; this.tabId = tabId;this.roomId=roomId;this.label=label;this.openedBy=openedBy;this.mouse={move:(x,y)=>this.action('mouseMove',{x,y}),down:(options={})=>this.action('mouseDown',mouseOptions(options)),up:(options={})=>this.action('mouseUp',mouseOptions(options)),click:(x,y,options={})=>this.action('mouseClick',{x,y,...mouseOptions(options)}),wheel:(deltaX,deltaY)=>this.action('mouseWheel',{deltaX,deltaY})};this.keyboard={down:key=>this.action('keyboardDown',{key}),up:key=>this.action('keyboardUp',{key}),press:key=>this.action('keyboardPress',{key}),type:text=>this.action('keyboardType',{text}),insertText:text=>this.action('keyboardInsertText',{text}),paste:input=>this.action('keyboardPaste',typeof input==='string'?{text:input}:input)}; }
  async resolveId() {if(this.tabId)return this.tabId;const room=await this.client.room(this.roomId),tab=(room.info.tabs || []).find(item=>item.id===this.label || item.label===this.label);if(!tab)throw new CorvidError(CODES.NOT_FOUND,`Page not found: ${this.label}`);this.tabId=tab.id;this.label=tab.label;this.openedBy=tab.openedBy;return tab.id;}
  async action(operation, args = {}) { if(this.popupArm)await this.popupArm;if(this.downloadArm)await this.downloadArm;return this.client.api(`/tabs/${encodeURIComponent(await this.resolveId())}/action`, { method: 'POST', body: { operation, args, pageLabel:this.label } }); }
  async navigate(url) { return this.action('navigate', { url }); }
  async goto(url) { return this.navigate(url); }
  async currentTab() {
    const id=await this.resolveId(),room=await this.client.room(this.roomId),info=room.info;
    if(info.ownership!=='agent' || info.userResumePending)throw new CorvidError(CODES.CONTROL_LOST,'Room is under user control or resumeControl is pending');
    if(info.executionRisk)throw new CorvidError(CODES.EXECUTION_RISK,'Room has an unresolved execution risk');
    const tab=(info.tabs || []).find(item=>item.id===id);
    if(!tab)throw new CorvidError(CODES.NOT_FOUND,'Page not found');
    if(tab.label!==this.label)throw new CorvidError(CODES.STALE_REFERENCE,'Page label is stale or no longer manages this tab');
    if(!tab.label)throw new CorvidError(CODES.CONTROL_LOST,'Tab is unmanaged; adopt it before agent operations');
    return tab;
  }
  async url() {return (await this.currentTab()).url;}
  async title() {return (await this.currentTab()).title;}
  async info() {
    const tab=await this.currentTab();
    return {label:tab.label,targetId:tab.id,roomId:this.roomId,openedBy:tab.openedBy,url:tab.url,title:tab.title,ready:tab.ready,domReady:tab.domReady,loadComplete:tab.loadComplete,dialog:tab.dialog ?? null};
  }
  async reload() { await this.currentTab(); return this.client.api(`/tabs/${encodeURIComponent(await this.resolveId())}/reload`,{method:'POST',body:{pageLabel:this.label}}); }
  async dblclick(target) { return this.action('dblclick', { target }); }
  async focus(target) { return this.action('focus', { target }); }
  async waitForTimeout(ms) {
    if(typeof ms!=='number' || !Number.isFinite(ms) || ms<0 || ms>2147483647) throw new RangeError('waitForTimeout expects a non-negative number of milliseconds no greater than 2147483647');
    await new Promise(resolve=>setTimeout(resolve,ms));
  }
  async events() {
    const id=await this.resolveId(),base=`/tabs/${encodeURIComponent(id)}/popups`,label=encodeURIComponent(this.label);
    if(this.eventCursor===undefined) { const first=await this.client.api(`${base}?pageLabel=${label}`); this.eventCursor=first.cursor; return []; }
    const drained=[];
    for(;;) {
      const {event,cursor}=await this.client.api(`${base}?after=${this.eventCursor}&pageLabel=${label}`);
      this.eventCursor=cursor;
      if(!event) return drained;
      drained.push(event);
    }
  }
  async cdp(method, params = {}) {
    if(typeof method!=='string' || !method) throw new TypeError('cdp method must be a nonempty string');
    if(params===null || typeof params!=='object' || Array.isArray(params)) throw new TypeError('cdp params must be an object');
    return (await this.action('cdp',{method,params})).result;
  }
  async waitForURL(expected,options={}) {
    if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>key!=='timeout'))throw new TypeError('waitForURL accepts only the timeout option');
    const timeout=options.timeout ?? 10000;
    if(typeof timeout!=='number' || !Number.isFinite(timeout) || timeout<=0 || timeout>2147483647)throw new RangeError('timeout must be a positive number no greater than 2147483647 ms');
    const matcher=urlMatcher(expected),deadline=performance.now()+timeout;let last='';
    for(;;) {
      last=await this.url();if(matcher.matches(last))return;
      const remaining=deadline-performance.now();if(remaining<=0)throw new CorvidError(CODES.TIMEOUT,`page.waitForURL timed out after ${timeout}ms: expected ${matcher.description}; last URL was ${JSON.stringify(last)}`);
      await new Promise(resolve=>setTimeout(resolve,Math.min(100,remaining)));
    }
  }
  async waitForLoadState(state='load',options={}) {
    if(!['load','domcontentloaded'].includes(state))throw new TypeError('waitForLoadState supports load and domcontentloaded; networkidle is not yet supported');
    if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>key!=='timeout'))throw new TypeError('waitForLoadState accepts only the timeout option');
    const timeout=options.timeout ?? 10000;
    if(typeof timeout!=='number' || !Number.isFinite(timeout) || timeout<=0 || timeout>2147483647)throw new RangeError('timeout must be a positive number no greater than 2147483647 ms');
    const deadline=performance.now()+timeout;
    for(;;){const tab=await this.currentTab();if(state==='load'?tab.loadComplete:tab.domReady)return;const remaining=deadline-performance.now();if(remaining<=0)throw new CorvidError(CODES.TIMEOUT,`page.waitForLoadState timed out after ${timeout}ms waiting for ${state}`);await new Promise(resolve=>setTimeout(resolve,Math.min(50,remaining)));}
  }
  async snapshot() { return this.action('snapshot'); }
  async click(target) { if(this.chooserArm) await this.chooserArm; return this.action('click', { target }); }
  async hover(target) { return this.action('hover', { target }); }
  async dragAndDrop(source,target,options={}) { if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).length)throw new Error('dragAndDrop options are not supported');return this.action('dragAndDrop',{source,target}); }
  async fill(target, value) { return this.action('fill', { target, value }); }
  async press(target, key) { return this.action('press', { target, key }); }
  async selectOption(target, choices, options = {}) { if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).length) throw new Error('selectOption options are not supported');return (await this.action('select', { target, choices })).selected; }
  async select(target, choices, options) { return this.selectOption(target, choices, options); }
  async setInputFiles(target, files) { return this.action('setInputFiles', { target, files: Array.isArray(files) ? files : [files] }); }
  async waitForFileChooser({ timeout = 10000 } = {}) {
    if (!Number.isInteger(timeout) || timeout<100 || timeout>60000) throw new Error('Chooser timeout must be 100–60000 ms');
    if(this.chooserArm) throw new Error('A file chooser wait is already active');
    const end=Date.now()+timeout;
    const arm=(async()=>{const base=`/tabs/${encodeURIComponent(await this.resolveId())}/chooser`;const result=await this.client.api(`${base}/arm`,{method:'POST',body:{timeoutMs:timeout,pageLabel:this.label}});return {...result,base};})();this.chooserArm=arm;
    let id,base,completed=false;
    try {
      ({id,base}=await arm);
      while(Date.now()<end) {
        const state=await this.client.api(`${base}?id=${encodeURIComponent(id)}&pageLabel=${encodeURIComponent(this.label)}`);
        if(state.status==='open') {if(!state.supported)throw new Error('File chooser is not backed by a file input');completed=true;return new FileChooser(this.client,base,id,state.mode,this.label);}
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      throw new CorvidError(CODES.TIMEOUT,'File chooser timed out');
    } finally {
      if(this.chooserArm===arm)this.chooserArm=null;
      if(id && !completed)await this.client.api(`${base}/cancel`,{method:'POST',body:{chooserId:id,pageLabel:this.label}}).catch(()=>{});
    }
  }
  async waitForEvent(event,options={}) {
    if(event==='download')return this.waitForDownload(options);
    if(event!=='popup')throw new TypeError('waitForEvent supports popup and download');
    if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>key!=='timeout'))throw new TypeError('waitForEvent accepts only the timeout option');
    const timeout=options.timeout ?? 10000;
    if(typeof timeout!=='number' || !Number.isFinite(timeout) || timeout<=0 || timeout>2147483647)throw new RangeError('timeout must be a positive number no greater than 2147483647 ms');
    if(this.popupArm)throw new Error('A popup wait is already active on this Page handle');
    const deadline=performance.now()+timeout;
    const arm=(async()=>{const id=await this.resolveId();const base=`/tabs/${encodeURIComponent(id)}/popups`,label=encodeURIComponent(this.label);const result=await this.client.api(`${base}?pageLabel=${label}`);return {base,label,cursor:result.cursor};})();
    this.popupArm=arm;
    try {
      const {base,label,cursor}=await arm;
      for(;;) {
        const {event:popup}=await this.client.api(`${base}?after=${cursor}&pageLabel=${label}`);
        if(popup?.status==='closed')throw new Error('Popup closed before it could be observed');
        if(popup?.status==='ready') {
          if(popup.label)return new Page(this.client,popup.tabId,this.roomId,popup.label,popup.openedBy);
          return await (await this.client.room(this.roomId)).adopt(popup.tabId);
        }
        const remaining=deadline-performance.now();
        if(remaining<=0)throw new CorvidError(CODES.TIMEOUT,`page.waitForEvent("popup") timed out after ${timeout}ms`);
        await new Promise(resolve=>setTimeout(resolve,Math.min(50,remaining)));
      }
    } finally {if(this.popupArm===arm)this.popupArm=null;}
  }
  async waitForDownload(options={}) {
    if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>key!=='timeout'))throw new TypeError('Download wait accepts only timeout');
    const timeout=options.timeout ?? 10000;
    if(!Number.isInteger(timeout) || timeout<100 || timeout>60000)throw new RangeError('Download timeout must be 100–60000 ms');
    if(this.downloadArm)throw new Error('A download wait is already active on this Page handle');
    const deadline=performance.now()+timeout;
    const arm=(async()=>{const id=await this.resolveId(),base=`/tabs/${encodeURIComponent(id)}/agent-download`,label=this.label;const result=await this.client.api(`${base}/arm`,{method:'POST',body:{timeoutMs:timeout,pageLabel:label}});return {base,label,id:result.id};})();
    this.downloadArm=arm;let binding,observed=false;
    try {
      binding=await arm;
      while(performance.now()<deadline) {
        const state=await this.client.api(`${binding.base}?id=${encodeURIComponent(binding.id)}&pageLabel=${encodeURIComponent(binding.label)}`);
        if(state.status==='expired')throw new CorvidError(CODES.TIMEOUT,`page.waitForEvent("download") timed out after ${timeout}ms`);
        if(state.status!=='armed'){observed=true;return new Download(this.client,binding,this,state);}
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      throw new CorvidError(CODES.TIMEOUT,`page.waitForEvent("download") timed out after ${timeout}ms`);
    } finally {
      if(this.downloadArm===arm)this.downloadArm=null;
      if(binding && !observed)await this.client.api(`${binding.base}/cancel`,{method:'POST',body:{downloadId:binding.id,pageLabel:binding.label}}).catch(()=>{});
    }
  }
  async wait(target, options = {}) {
    if (Object.keys(options).some(key => key !== 'timeout')) throw new Error('wait supports only the timeout option');
    return this.action('wait', { target, options });
  }
  async waitForSelector(target,options={}) {
    if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>!['timeout','state'].includes(key)))throw new TypeError('waitForSelector accepts state and timeout options');
    const {state='visible',timeout=10000}=options;
    if(!['attached','detached','visible','hidden'].includes(state))throw new TypeError('Invalid selector state');
    if(typeof timeout!=='number' || !Number.isFinite(timeout) || timeout<=0 || timeout>2147483647)throw new RangeError('timeout must be a positive number no greater than 2147483647 ms');
    const deadline=performance.now()+timeout;
    for(;;) {
      const result=await this.action('selector-state',{target});
      if(({attached:result.attached,detached:!result.attached,visible:result.visible,hidden:!result.visible})[state])return true;
      const remaining=deadline-performance.now();
      if(remaining<=0)throw new CorvidError(CODES.TIMEOUT,`page.waitForSelector timed out after ${timeout}ms waiting for ${state}`);
      await new Promise(resolve=>setTimeout(resolve,Math.min(100,remaining)));
    }
  }
  async waitForFunction(fn,arg,options={}) {
    if(typeof fn!=='function' && typeof fn!=='string')throw new TypeError('waitForFunction expects a function or expression string');
    if(typeof fn==='string' && arg!==undefined)throw new TypeError('Arguments require a function');
    if(arguments.length===2 && typeof fn==='function' && fn.length===0 && arg && typeof arg==='object' && !Array.isArray(arg) && Object.keys(arg).some(key=>['timeout','polling'].includes(key)))throw new TypeError('waitForFunction options are the third argument; pass undefined when omitting the callback argument');
    if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>!['timeout','polling'].includes(key)))throw new TypeError('waitForFunction accepts timeout and polling options');
    const {timeout=10000,polling=100}=options;
    for(const [name,value] of Object.entries({timeout,polling}))if(typeof value!=='number' || !Number.isFinite(value) || value<=0 || value>2147483647)throw new RangeError(`${name} must be a positive number no greater than 2147483647 ms`);
    const serialized=arg===undefined?'undefined':JSON.stringify(arg);
    if(serialized===undefined)throw new TypeError('waitForFunction argument must be JSON serializable');
    const source=typeof fn==='function'?`(${fn.toString()})(${serialized})`:`(${fn})`;
    const expression=`(async()=>{try{return {ok:true,value:Boolean(await (${source}))}}catch(error){return {ok:false,error:String(error?.message ?? error)}}})()`,deadline=performance.now()+timeout;
    for(;;) {
      const remaining=deadline-performance.now();
      if(remaining<=0)throw new CorvidError(CODES.TIMEOUT,`page.waitForFunction timed out after ${timeout}ms`);
      const result=await this.evaluate(expression,undefined,{timeoutMs:Math.max(100,Math.min(60000,Math.ceil(remaining)))});
      if(!result.ok)throw new Error(`waitForFunction predicate failed: ${result.error}`);
      if(result.value)return true;
      const left=deadline-performance.now();
      if(left<=0)throw new CorvidError(CODES.TIMEOUT,`page.waitForFunction timed out after ${timeout}ms`);
      await new Promise(resolve=>setTimeout(resolve,Math.min(polling,left)));
    }
  }
  async screenshot(options={}) {
    if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>!['path','fullPage','clip'].includes(key)))throw new TypeError('screenshot supports path, fullPage and clip');
    if(options.path!==undefined && (typeof options.path!=='string' || !isAbsolute(options.path)))throw new TypeError('screenshot path must be absolute');
    if(options.fullPage!==undefined && typeof options.fullPage!=='boolean')throw new TypeError('fullPage must be boolean');
    if(options.fullPage && options.clip!==undefined)throw new TypeError('fullPage and clip cannot be combined');
    const result=await this.action('screenshot',{fullPage:options.fullPage,clip:options.clip});const image=Buffer.from(result.base64,'base64');
    if(options.path===undefined)return image;
    await mkdir(dirname(options.path),{recursive:true});await writeFile(options.path,image);return options.path;
  }
  async dialog() { const id=await this.resolveId();return (await this.client.api(`/tabs/${encodeURIComponent(id)}/dialog?pageLabel=${encodeURIComponent(this.label)}`)).dialog; }
  async acceptDialog(promptText) { return this.client.api(`/tabs/${encodeURIComponent(await this.resolveId())}/dialog`, {method:'POST',body:{accept:true,pageLabel:this.label,...(promptText===undefined?{}:{promptText})}}); }
  async dismissDialog() { return this.client.api(`/tabs/${encodeURIComponent(await this.resolveId())}/dialog`, {method:'POST',body:{accept:false,pageLabel:this.label}}); }
  async evaluate(fn, arg, options = {}) {
    if (typeof fn !== 'function' && typeof fn !== 'string') throw new TypeError('evaluate expects a function or expression string');
    if (typeof fn === 'string' && arg !== undefined) throw new TypeError('Arguments require a function');
    const serialized = arg === undefined ? 'undefined' : JSON.stringify(arg);
    if (serialized === undefined) throw new TypeError('evaluate argument must be JSON serializable');
    const expression = typeof fn === 'function' ? `(${fn.toString()})(${serialized})` : fn;
    const result = await this.action('evaluate', { expression, ...options });
    if (result.status === 'timed_out') { const error = new Error('Page evaluation timed out; execution may continue'); Object.assign(error, result); throw error; }
    return result.value;
  }
  async fetch(url,options={}) {
    if(typeof url!=='string' || !url.trim())throw new TypeError('fetch URL must be a nonempty string');
    const allowed=['timeout','saveAs','method','headers','body','cache','credentials','integrity','keepalive','mode','redirect','referrer','referrerPolicy'];
    if(!options || typeof options!=='object' || Array.isArray(options) || Object.keys(options).some(key=>!allowed.includes(key)))throw new TypeError('Invalid page.fetch options');
    const {timeout=10000,saveAs,...request}=options;
    if(!Number.isInteger(timeout) || timeout<100 || timeout>59000)throw new RangeError('fetch timeout must be 100–59000 ms');
    if(saveAs!==undefined && (typeof saveAs!=='string' || !isAbsolute(saveAs)))throw new TypeError('fetch saveAs must be an absolute path');
    for(const [key,value] of Object.entries(request)) {
      if(key==='headers'){if(!value || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) || Object.values(value).some(item=>typeof item!=='string'))throw new TypeError('fetch headers must be a string record');}
      else if(key==='keepalive'){if(typeof value!=='boolean')throw new TypeError('fetch keepalive must be boolean');}
      else if(typeof value!=='string')throw new TypeError(`fetch ${key} must be a string`);
    }
    const result=await this.evaluate(fetchInDocument,{url,request,timeout,binary:saveAs!==undefined,limit:8*1024*1024},{timeoutMs:timeout+1000});
    if(result.error)throw new Error(`page.fetch: ${result.error}`);
    if(saveAs!==undefined){const {bodyBase64,...metadata}=result;await mkdir(dirname(saveAs),{recursive:true});await writeFile(saveAs,Buffer.from(bodyBase64,'base64'));return {...metadata,savedPath:saveAs};}
    return result;
  }
  async text(target = 'body') { return (await this.action('text', { target })).value; }
  async close() { return this.client.api(`/tabs/${encodeURIComponent(await this.resolveId())}`, { method: 'DELETE', body:{pageLabel:this.label} }); }
}

class FileChooser {
  constructor(client,base,id,mode,pageLabel){this.client=client;this.base=base;this.id=id;this.mode=mode;this.pageLabel=pageLabel;}
  async setFiles(files){return this.client.api(`${this.base}/files`,{method:'POST',body:{chooserId:this.id,pageLabel:this.pageLabel,files:Array.isArray(files)?files:[files]}});}
  async cancel(){return this.client.api(`${this.base}/cancel`,{method:'POST',body:{chooserId:this.id,pageLabel:this.pageLabel}});}
}
class Download {
  constructor(client,binding,page,state){this.client=client;this.binding=binding;this.source=page;this.initial=state;}
  page(){return this.source;}
  url(){return this.initial.url;}
  suggestedFilename(){return this.initial.filename;}
  async state(){const {base,id,label}=this.binding;return this.client.api(`${base}?id=${encodeURIComponent(id)}&pageLabel=${encodeURIComponent(label)}`);}
  async settled(){for(;;){const result=await this.state();if(result.status!=='progressing' && result.status!=='armed')return result;await new Promise(resolve=>setTimeout(resolve,50));}}
  async failure(){const result=await this.settled();return result.status==='completed'?null:(result.error || result.status);}
  async path(){const result=await this.settled();if(result.status!=='completed')throw new Error(`Download failed: ${result.error || result.status}`);return result.path;}
  async saveAs(destination){if(typeof destination!=='string' || !isAbsolute(destination))throw new TypeError('Download destination must be absolute');const source=await this.path();await mkdir(dirname(destination),{recursive:true});await copyFile(source,destination);}
  async cancel(){const {base,id,label}=this.binding;await this.client.api(`${base}/cancel`,{method:'POST',body:{downloadId:id,pageLabel:label}});}
  async delete(){const {base,id,label}=this.binding;await this.client.api(`${base}/delete`,{method:'POST',body:{downloadId:id,pageLabel:label}});}
}

export { CODES, CorvidError, isCorvidError } from './errors.js';
