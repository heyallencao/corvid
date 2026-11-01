// One owner per WebContents. Dialog events must remain observable while the
// action that opened them is still pending, including across SDK connections.
const states=new WeakMap();
const crypto=require('node:crypto');

async function ensure(contents,onChange) {
  let state=states.get(contents);
  if(!state) {
    state={owned:false,dialog:null,promptReply:null,chooser:null,onChange:onChange || (()=>{}),network:{known:false,everEnabled:false,inflight:new Set(),lastActivity:performance.now()}};states.set(contents,state);
    contents.debugger.on('message',(_event,method,params)=>{
      if(method==='Page.javascriptDialogOpening') {state.dialog={type:params.type,message:params.message,url:params.url,defaultPrompt:params.defaultPrompt ?? ''};state.onChange();}
      if(method==='Page.javascriptDialogClosed' && !state.promptReply) {state.dialog=null;state.onChange();}
      if(method==='Page.fileChooserOpened' && state.chooser?.status==='armed') {state.chooser.status='open';state.chooser.mode=params.mode;state.chooser.backendNodeId=params.backendNodeId ?? null;state.onChange();}
      if(method==='Network.requestWillBeSent'){state.network.inflight.add(params.requestId);state.network.lastActivity=performance.now();}
      if(method==='Network.loadingFinished' || method==='Network.loadingFailed'){if(state.network.inflight.delete(params.requestId))state.network.lastActivity=performance.now();}
    });
    contents.debugger.on('detach',()=>{state.owned=false;state.network.known=false;state.network.inflight.clear();if(!state.promptReply)state.dialog=null;if(state.chooser){clearTimeout(state.chooser.timer);state.chooser=null;}state.onChange();});
  } else if(onChange) state.onChange=onChange;
  if(state.owned && contents.debugger.isAttached()) return state;
  if(contents.debugger.isAttached()) throw new Error('Another debugger is attached');
  contents.debugger.attach('1.3');state.owned=true;
  try {await contents.debugger.sendCommand('Page.enable');await contents.debugger.sendCommand('Network.enable');state.network.known=!state.network.everEnabled && contents.getURL()==='about:blank';state.network.everEnabled=true;state.network.lastActivity=performance.now();}
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
  await contents.debugger.sendCommand('Page.handleJavaScriptDialog',{accept,...(promptText===undefined?{}:{promptText})});
  return {ok:true};
}
function openPrompt(contents,message,defaultPrompt,reply){const state=states.get(contents);if(!state || state.dialog)throw new Error('A dialog is already open');state.promptReply=reply;state.dialog={type:'prompt',message,defaultPrompt,url:contents.getURL()};state.onChange();}
async function armChooser(contents,timeoutMs) {
  if(!Number.isInteger(timeoutMs) || timeoutMs<100 || timeoutMs>60000) throw new Error('Chooser timeout must be 100–60000 ms');
  const state=await ensure(contents);if(state.chooser)throw new Error('A file chooser is already armed');
  const chooser={id:crypto.randomUUID(),status:'armed',mode:null,backendNodeId:null,timer:null,inflight:null};state.chooser=chooser;
  try {await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog',{enabled:true});}
  catch(error){if(state.chooser===chooser)state.chooser=null;throw error;}
  if(state.chooser!==chooser) throw new Error('File chooser was cancelled while arming');
  chooser.timer=setTimeout(()=>{cancelChooser(contents,chooser.id).catch(()=>{});},timeoutMs);
  return {id:chooser.id};
}
function getChooser(contents,id){const chooser=states.get(contents)?.chooser;if(!chooser || chooser.id!==id)throw new Error('File chooser expired or unavailable');return {id:chooser.id,status:chooser.status,mode:chooser.mode,supported:chooser.status!=='open' || chooser.backendNodeId!==null};}
async function cancelChooser(contents,id) {
  const state=states.get(contents),chooser=state?.chooser;if(!chooser || (id && chooser.id!==id))return {ok:true};
  if(chooser.inflight) await chooser.inflight.catch(()=>{});
  if(state.chooser!==chooser)return {ok:true};
  if(state.owned && contents.debugger.isAttached()) await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog',{enabled:false,cancel:true});
  clearTimeout(chooser.timer);state.chooser=null;state.onChange();return {ok:true};
}
async function chooseFiles(contents,id,files) {
  const state=states.get(contents),chooser=state?.chooser;
  if(!chooser || chooser.id!==id || chooser.status!=='open')throw new Error('File chooser is not open');
  if(chooser.inflight)throw new Error('File chooser is already being handled');
  if(chooser.backendNodeId===null)throw new Error('This file chooser is not backed by a file input');
  if(chooser.mode==='selectSingle' && files.length>1)throw new Error('File input does not allow multiple files');
  chooser.inflight=(async()=>{
    const resolved=await contents.debugger.sendCommand('DOM.resolveNode',{backendNodeId:chooser.backendNodeId,objectGroup:'corvid-chooser'});
    const objectId=resolved.object?.objectId;if(!objectId)throw new Error('File input is no longer available');
    try {
      const check=await contents.debugger.sendCommand('Runtime.callFunctionOn',{objectId,returnByValue:true,functionDeclaration:'function(){return this.isConnected && this.localName === "input" && this.type === "file" && !this.disabled && !this.webkitdirectory}'});
      if(check.exceptionDetails || check.result.value!==true)throw new Error('File input is stale or unsupported');
      await contents.debugger.sendCommand('DOM.setFileInputFiles',{objectId,files});
    } finally {if(contents.debugger.isAttached())await contents.debugger.sendCommand('Runtime.releaseObjectGroup',{objectGroup:'corvid-chooser'}).catch(()=>{});}
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
module.exports={ensure,get,handle,openPrompt,available,networkState,armChooser,getChooser,cancelChooser,chooseFiles,prepareClose};
