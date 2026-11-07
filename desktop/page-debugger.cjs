// One owner per WebContents. Dialog events must remain observable while the
// action that opened them is still pending, including across SDK connections.
const states=new WeakMap();
const crypto=require('node:crypto');
const chooserTargetTimeoutMs=2000;
const choosersByClient=new Map();

function trackChooser(contents,chooser) {
  if(!chooser.clientId)return;
  let active=choosersByClient.get(chooser.clientId);
  if(!active){active=new Set();choosersByClient.set(chooser.clientId,active);}
  active.add(contents);
}
function untrackChooser(contents,chooser) {
  if(!chooser?.clientId)return;
  const active=choosersByClient.get(chooser.clientId);
  active?.delete(contents);
  if(active?.size===0)choosersByClient.delete(chooser.clientId);
}
function command(contents,method,params={},sessionId=null) {
  return contents.debugger.sendCommand(method,params,sessionId || undefined);
}
function chooserTargets(state) {
  return [...state.targetSessions.values()].sort((a,b)=>b.depth-a.depth);
}
function registerChooserFrameTree(state,record,tree) {
  const visit=node=>{
    const frameId=node?.frame?.id;
    if(frameId){record.frameIds.push(frameId);state.frameSessions.set(frameId,record);}
    for(const child of node?.childFrames || [])visit(child);
  };
  visit(tree?.frameTree);
}
function removeChooserFrameMappings(state,record) {
  for(const frameId of record.frameIds)if(state.frameSessions.get(frameId)===record)state.frameSessions.delete(frameId);
}
async function enableAutoAttach(contents,state,parentSessionId) {
  if(state.autoAttachParents.has(parentSessionId))return;
  state.autoAttachParents.add(parentSessionId);
  try {
    await command(contents,'Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'iframe'}]},parentSessionId);
  } catch(error) {
    state.autoAttachParents.delete(parentSessionId);
    throw error;
  }
}
async function configureChooserTarget(contents,state,record,chooserId,waitingForDebugger) {
  const chooser=state.chooser;
  if(!chooser || chooser.id!==chooserId || !['armed','open'].includes(chooser.status))return;
  await command(contents,'Page.enable',{},record.sessionId);
  const frameTree=await command(contents,'Page.getFrameTree',{},record.sessionId);
  registerChooserFrameTree(state,record,frameTree);
  await command(contents,'Page.setInterceptFileChooserDialog',{enabled:true},record.sessionId);
  record.interceptEnabled=true;
  await enableAutoAttach(contents,state,record.sessionId);
  if(waitingForDebugger)await command(contents,'Runtime.runIfWaitingForDebugger',{},record.sessionId);
}
function attachChooserTarget(contents,state,parentSessionId,params) {
  const targetInfo=params.targetInfo || {};
  if(targetInfo.type!=='iframe' || !params.sessionId)return;
  const existing=state.targetSessions.get(params.sessionId);
  if(existing)return;
  const chooser=state.chooser;
  const parent=parentSessionId ? state.targetSessions.get(parentSessionId) : null;
  const record={sessionId:params.sessionId,targetId:targetInfo.targetId,url:targetInfo.url || '',parentSessionId,depth:(parent?.depth ?? 0)+1,frameIds:[],interceptEnabled:false,ready:Promise.resolve()};
  state.targetSessions.set(record.sessionId,record);
  if(targetInfo.targetId)state.targetById.set(targetInfo.targetId,record);
  if(chooser && ['armed','open'].includes(chooser.status)) {
    record.ready=configureChooserTarget(contents,state,record,chooser.id,Boolean(params.waitingForDebugger));
    record.ready.catch(error=>{
      if(state.chooser?.id===chooser.id) {
        state.chooser.setupError=error;
        state.onChange();
        cancelChooser(contents,chooser.id).catch(()=>{});
      }
    });
  } else if(params.waitingForDebugger) {
    record.ready=command(contents,'Runtime.runIfWaitingForDebugger',{},record.sessionId);
    record.ready.catch(()=>{});
  }
}
async function waitForCurrentOutOfProcessFrames(contents,state,chooser) {
  let expected=[];
  try {
    const main=contents.mainFrame;
    expected=(main?.framesInSubtree || [])
      .filter(frame=>frame!==main && frame.processId!==frame.parent?.processId)
      .map(frame=>String(frame.url || 'about:blank'));
  } catch {}
  if(!expected.length)return;
  const deadline=Date.now()+chooserTargetTimeoutMs;
  for(;;) {
    if(state.chooser!==chooser)throw new Error('File chooser was cancelled while arming');
    if(chooser.setupError)throw chooser.setupError;
    const records=chooserTargets(state);
    const matched=[];
    const remaining=new Map();
    for(const url of expected)remaining.set(url,(remaining.get(url) || 0)+1);
    for(const record of records) {
      const count=remaining.get(record.url) || 0;
      if(count>0){matched.push(record);remaining.set(record.url,count-1);}
    }
    if([...remaining.values()].every(count=>count===0)) {
      await Promise.all(matched.map(record=>record.ready));
      if(chooser.setupError)throw chooser.setupError;
      return;
    }
    if(Date.now()>=deadline)throw new Error('Could not secure every out-of-process frame for file selection');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
}
async function stopChooserAutoAttach(contents,state) {
  for(let attempt=0;attempt<4;attempt++) {
    const parents=[...state.autoAttachParents];
    if(!parents.length)return;
    await Promise.allSettled(parents.map(async sessionId=>{
      await command(contents,'Target.setAutoAttach',{autoAttach:false,waitForDebuggerOnStart:false,flatten:true},sessionId);
      state.autoAttachParents.delete(sessionId);
    }));
    await Promise.allSettled(chooserTargets(state).map(record=>record.ready));
  }
  if(state.autoAttachParents.size)throw new Error('Could not safely stop iframe file chooser interception');
}
async function detachChooserTargets(contents,state) {
  const records=chooserTargets(state);
  if(!records.length)return;
  const settled=await Promise.allSettled(records.map(record=>command(contents,'Target.detachFromTarget',{sessionId:record.sessionId},record.parentSessionId)));
  records.forEach((record,index)=>{
    if(settled[index].status!=='fulfilled')return;
    state.targetSessions.delete(record.sessionId);
    removeChooserFrameMappings(state,record);
    if(record.targetId)state.targetById.delete(record.targetId);
    state.autoAttachParents.delete(record.sessionId);
  });
  if(settled.some(result=>result.status==='rejected'))throw new Error('Could not detach every out-of-process frame session for file selection');
}
async function ensure(contents,onChange) {
  let state=states.get(contents);
  if(!state) {
    state={owned:false,dialog:null,promptReply:null,chooser:null,targetSessions:new Map(),targetById:new Map(),frameSessions:new Map(),autoAttachParents:new Set(),onChange:onChange || (()=>{}),network:{known:false,everEnabled:false,inflight:new Set(),lastActivity:performance.now()}};states.set(contents,state);
    contents.debugger.on('message',(event,method,params)=>{
      if(method==='Page.javascriptDialogOpening') {state.dialog={type:params.type,message:params.message,url:params.url,defaultPrompt:params.defaultPrompt ?? ''};state.onChange();}
      if(method==='Page.javascriptDialogClosed' && !state.promptReply) {state.dialog=null;state.onChange();}
      if(method==='Page.fileChooserOpened' && state.chooser?.status==='armed') {const frameSession=state.frameSessions.get(params.frameId) || state.targetById.get(params.frameId);state.chooser.status='open';state.chooser.mode=params.mode;state.chooser.backendNodeId=params.backendNodeId ?? null;state.chooser.frameId=params.frameId ?? null;state.chooser.sessionId=frameSession?.sessionId ?? event?.sessionId ?? null;state.onChange();}
      if(method==='Page.frameStartedNavigating' && state.chooser?.frameId===params.frameId)cancelChooser(contents,state.chooser.id).catch(()=>{});
      if(method==='Page.frameNavigated' && state.chooser?.frameId===params.frame?.id)cancelChooser(contents,state.chooser.id).catch(()=>{});
      if(method==='Page.frameDetached' && state.chooser?.frameId===params.frameId)cancelChooser(contents,state.chooser.id).catch(()=>{});
      if(method==='Target.attachedToTarget')attachChooserTarget(contents,state,event?.sessionId ?? null,params);
      if(method==='Target.detachedFromTarget') {
        const record=state.targetSessions.get(params.sessionId);
        if(record) {
          state.targetSessions.delete(record.sessionId);
          removeChooserFrameMappings(state,record);
          if(record.targetId)state.targetById.delete(record.targetId);
          state.autoAttachParents.delete(record.sessionId);
          if(state.chooser?.sessionId===record.sessionId) {
            const chooser=state.chooser;chooser.status='unavailable';state.onChange();
            cancelChooser(contents,chooser.id).catch(()=>{});
          } else state.onChange();
        }
      }
      if(method==='Network.requestWillBeSent'){state.network.inflight.add(params.requestId);state.network.lastActivity=performance.now();}
      if(method==='Network.loadingFinished' || method==='Network.loadingFailed'){if(state.network.inflight.delete(params.requestId))state.network.lastActivity=performance.now();}
    });
    contents.debugger.on('detach',()=>{state.owned=false;state.network.known=false;state.network.inflight.clear();state.targetSessions.clear();state.targetById.clear();state.frameSessions.clear();state.autoAttachParents.clear();if(!state.promptReply)state.dialog=null;if(state.chooser){clearTimeout(state.chooser.timer);untrackChooser(contents,state.chooser);state.chooser=null;}state.onChange();});
    if(typeof contents.on==='function')contents.on('did-start-navigation',(_event,_url,_isInPlace,isMainFrame)=>{const chooser=state.chooser;if(isMainFrame && chooser)cancelChooser(contents,chooser.id).catch(()=>{});});
  } else if(onChange) state.onChange=onChange;
  if(state.owned && contents.debugger.isAttached()) return state;
  if(contents.debugger.isAttached()) throw new Error('Another debugger is attached');
  contents.debugger.attach('1.3');state.owned=true;
  try {await command(contents,'Page.enable');await command(contents,'Network.enable');state.network.known=!state.network.everEnabled && contents.getURL()==='about:blank';state.network.everEnabled=true;state.network.lastActivity=performance.now();}
  catch(error) {if(state.owned && contents.debugger.isAttached()) contents.debugger.detach();throw error;}
  return state;
}
function get(contents){return states.get(contents)?.dialog || null;}
function available(contents){const state=states.get(contents);return Boolean(state?.promptReply || (state?.owned && contents.debugger.isAttached()));}
function networkState(contents){const state=states.get(contents);if(!state?.owned || !contents.debugger.isAttached() || !state.network.known)return {known:false};return {known:true,inflight:state.network.inflight.size,idleForMs:Math.max(0,performance.now()-state.network.lastActivity)};}
async function handle(contents,accept,promptText) {
  const state=states.get(contents);
  if(!state?.dialog) throw new Error('No JavaScript dialog is open');
  if(typeof accept!=='boolean' || (promptText!==undefined && typeof promptText!=='string')) throw new Error('Invalid dialog response');
  if(state.promptReply){const reply=state.promptReply, value=promptText ?? state.dialog.defaultPrompt;state.promptReply=null;state.dialog=null;reply(accept ? value : null);state.onChange();return {ok:true};}
  if(!state.owned || !contents.debugger.isAttached()) throw new Error('Page debugger is unavailable');
  await command(contents,'Page.handleJavaScriptDialog',{accept,...(promptText===undefined?{}:{promptText})});
  return {ok:true};
}
function openPrompt(contents,message,defaultPrompt,reply){const state=states.get(contents);if(!state || state.dialog)throw new Error('A dialog is already open');state.promptReply=reply;state.dialog={type:'prompt',message,defaultPrompt,url:contents.getURL()};state.onChange();}
async function armChooser(contents,timeoutMs,clientId=null) {
  if(!Number.isInteger(timeoutMs) || timeoutMs<100 || timeoutMs>60000) throw new Error('Chooser timeout must be 100–60000 ms');
  if(clientId!==null && (typeof clientId!=='string' || !clientId))throw new Error('Invalid chooser client identity');
  const state=await ensure(contents);if(state.chooser)throw new Error('A file chooser is already armed');
  const chooser={id:crypto.randomUUID(),clientId,status:'armed',mode:null,backendNodeId:null,frameId:null,sessionId:null,timer:null,inflight:null,cancelPromise:null,setupError:null};state.chooser=chooser;trackChooser(contents,chooser);
  chooser.timer=setTimeout(()=>{cancelChooser(contents,chooser.id).catch(()=>{});},timeoutMs);
  try {
    const setup=await Promise.allSettled([
      enableAutoAttach(contents,state,null),
      command(contents,'Page.setInterceptFileChooserDialog',{enabled:true}),
    ]);
    const failure=setup.find(result=>result.status==='rejected');
    if(failure)throw failure.reason;
    await waitForCurrentOutOfProcessFrames(contents,state,chooser);
  } catch(error) {
    await cancelChooser(contents,chooser.id).catch(()=>{});
    throw error;
  }
  if(state.chooser!==chooser) throw new Error('File chooser was cancelled while arming');
  return {id:chooser.id};
}
function getChooser(contents,id){const chooser=states.get(contents)?.chooser;if(!chooser || chooser.id!==id)throw new Error('File chooser expired or unavailable');return {id:chooser.id,status:chooser.cancelRequested?'unavailable':chooser.status,mode:chooser.mode,supported:chooser.status!=='open' || chooser.backendNodeId!==null};}
async function assertChooserFrameOrigin(contents,objectId,sessionId) {
  const result=await command(contents,'Runtime.callFunctionOn',{objectId,returnByValue:true,functionDeclaration:`function(){try{const view=this.ownerDocument.defaultView,origin=view.location.origin;return origin!=='null'&&origin===view.top.location.origin}catch{return false}}`},sessionId);
  if(result.exceptionDetails || result.result.value!==true)throw Object.assign(new Error('File chooser must belong to the managed page origin'),{code:'CORVID_FORBIDDEN'});
}
async function validateChooser(contents,id,files,{sameOriginOnly=false}={}) {
  const chooser=states.get(contents)?.chooser;
  if(!chooser || chooser.id!==id || chooser.status!=='open' || chooser.cancelRequested)throw new Error('File chooser is not open');
  if(chooser.backendNodeId===null)throw new Error('This file chooser is not backed by a file input');
  if(chooser.mode==='selectSingle' && files.length>1)throw new Error('File input does not allow multiple files');
  const sessionId=chooser.sessionId;
  const resolved=await command(contents,'DOM.resolveNode',{backendNodeId:chooser.backendNodeId,objectGroup:'corvid-chooser-check'},sessionId);
  const objectId=resolved.object?.objectId;if(!objectId)throw new Error('File input is no longer available');
  try {
    const check=await command(contents,'Runtime.callFunctionOn',{objectId,returnByValue:true,functionDeclaration:`function(){return this.isConnected && this.localName === "input" && this.type === "file" && !this.disabled && !this.webkitdirectory && (this.multiple || ${files.length} <= 1)}`},sessionId);
    if(check.exceptionDetails || check.result.value!==true)throw new Error('File input is stale or unsupported');
    if(sameOriginOnly)await assertChooserFrameOrigin(contents,objectId,sessionId);
  } finally {if(contents.debugger.isAttached())await command(contents,'Runtime.releaseObjectGroup',{objectGroup:'corvid-chooser-check'},sessionId).catch(()=>{});}
  return {ok:true};
}
async function cancelChooser(contents,id) {
  const state=states.get(contents),chooser=state?.chooser;if(!chooser || (id && chooser.id!==id))return {ok:true};
  if(chooser.cancelPromise)return chooser.cancelPromise;
  chooser.cancelRequested=true;
  const cleanup=Promise.resolve().then(async()=>{
    if(chooser.inflight)await chooser.inflight.catch(()=>{});
    if(state.chooser!==chooser)return {ok:true};
    if(state.owned && contents.debugger.isAttached()) {
      await stopChooserAutoAttach(contents,state);
      if(state.chooser!==chooser)return {ok:true};
      chooser.status='canceling';
      const records=chooserTargets(state).filter(record=>record.interceptEnabled);
      await Promise.allSettled([
        command(contents,'Page.setInterceptFileChooserDialog',{enabled:false,cancel:true}),
        ...records.map(record=>command(contents,'Page.setInterceptFileChooserDialog',{enabled:false,cancel:true},record.sessionId)),
      ]);
      await detachChooserTargets(contents,state);
    }
    clearTimeout(chooser.timer);untrackChooser(contents,chooser);state.chooser=null;state.onChange();return {ok:true};
  });
  chooser.cancelPromise=cleanup;
  try {return await cleanup;}
  finally {if(chooser.cancelPromise===cleanup)chooser.cancelPromise=null;}
}
async function cancelChoosersForClient(clientId) {
  const contents=[...(choosersByClient.get(clientId) || [])];
  const results=await Promise.all(contents.map(async item=>{
    const chooser=states.get(item)?.chooser;
    if(chooser?.clientId!==clientId)return false;
    await cancelChooser(item,chooser.id);
    return true;
  }));
  return {cancelled:results.filter(Boolean).length};
}
async function chooseFiles(contents,id,files,beforeSelection,sameOriginOnly=false) {
  const state=states.get(contents),chooser=state?.chooser;
  if(!chooser || chooser.id!==id || chooser.status!=='open' || chooser.cancelRequested)throw new Error('File chooser is not open');
  if(chooser.inflight)throw new Error('File chooser is already being handled');
  if(chooser.backendNodeId===null)throw new Error('This file chooser is not backed by a file input');
  if(chooser.mode==='selectSingle' && files.length>1)throw new Error('File input does not allow multiple files');
  const sessionId=chooser.sessionId;
  chooser.inflight=(async()=>{
    const resolved=await command(contents,'DOM.resolveNode',{backendNodeId:chooser.backendNodeId,objectGroup:'corvid-chooser'},sessionId);
    const objectId=resolved.object?.objectId;if(!objectId)throw new Error('File input is no longer available');
    try {
      const check=await command(contents,'Runtime.callFunctionOn',{objectId,returnByValue:true,functionDeclaration:'function(){return this.isConnected && this.localName === "input" && this.type === "file" && !this.disabled && !this.webkitdirectory}'},sessionId);
      if(check.exceptionDetails || check.result.value!==true)throw new Error('File input is stale or unsupported');
      if(sameOriginOnly)await assertChooserFrameOrigin(contents,objectId,sessionId);
      const ensureChooserOpen=()=>{if(state.chooser!==chooser || chooser.status!=='open' || chooser.cancelRequested)throw new Error('File chooser is not open');};
      ensureChooserOpen();
      await beforeSelection?.();
      ensureChooserOpen();
      await command(contents,'DOM.setFileInputFiles',{objectId,files},sessionId);
    } finally {if(contents.debugger.isAttached())await command(contents,'Runtime.releaseObjectGroup',{objectGroup:'corvid-chooser'},sessionId).catch(()=>{});}
  })();
  try {await chooser.inflight;} catch(error){chooser.inflight=null;throw error;}
  chooser.inflight=null;await cancelChooser(contents,id);return {ok:true};
}
async function prepareClose(contents) {
  const state=states.get(contents);
  if(state?.dialog || state?.promptReply)throw new Error('请先处理网页对话框再关闭页面');
  await cancelChooser(contents);
  if(contents.debugger.isAttached()) {
    if(!state?.owned)throw new Error('Page debugger is owned by another client');
    contents.debugger.detach();
  }
}
module.exports={ensure,get,handle,openPrompt,available,networkState,armChooser,getChooser,validateChooser,cancelChooser,cancelChoosersForClient,chooseFiles,prepareClose};
