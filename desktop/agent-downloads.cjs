const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

// The manager owns only the temporary directory it creates, never a user-selected file.
module.exports=function agentDownloads(tempDir) {
  let root;
  const arms=new Map(), entries=new Map();
  function entry(tabId,id) {const value=entries.get(id);if(!value || value.tabId!==tabId)throw new Error('Download is unavailable');return value;}
  function arm(tabId,timeout) {
    if(!Number.isInteger(timeout) || timeout<100 || timeout>60000)throw new Error('Download timeout must be 100–60000 ms');
    if(arms.has(tabId))throw new Error('A download wait is already active');
    const value={id:crypto.randomUUID(),tabId,status:'armed'};entries.set(value.id,value);arms.set(tabId,value);
    value.timer=setTimeout(()=>{if(arms.get(tabId)===value)arms.delete(tabId);value.status='expired';value.timer=setTimeout(()=>entries.delete(value.id),60000);},timeout);
    return {id:value.id};
  }
  function cancelArm(tabId,id) {const value=entries.get(id);if(!value || value.tabId!==tabId || value.status!=='armed')return;clearTimeout(value.timer);if(arms.get(tabId)===value)arms.delete(tabId);entries.delete(id);}
  function capture(tabId,item) {
    const value=arms.get(tabId);if(!value)return false;
    clearTimeout(value.timer);arms.delete(tabId);
    try {
      root ||= fs.mkdtempSync(path.join(tempDir,'corvid-download-'));
      value.file=path.join(root,value.id);value.url=item.getURL();value.filename=path.basename(item.getFilename()) || 'download';value.item=item;value.status='progressing';
      item.setSavePath(value.file);
      item.once('done',(_event,state)=>{value.status=state;value.item=null;});
    } catch(error) {value.status='failed';value.error=error.message;throw error;}
    return true;
  }
  function info(tabId,id) {const value=entry(tabId,id);return {id:value.id,status:value.status,...(value.url===undefined?{}:{url:value.url,filename:value.filename}),...(value.status==='completed'?{path:value.file}:{}),...(value.error?{error:value.error}:{})};}
  function cancel(tabId,id) {const value=entry(tabId,id);if(value.status==='armed'){cancelArm(tabId,id);return;}if(value.status==='progressing')value.item.cancel();}
  function discard(tabId,id) {const value=entry(tabId,id);if(value.status==='armed'){cancelArm(tabId,id);return;}if(value.status==='progressing')throw new Error('Cancel and wait for the download before deleting it');if(value.file)fs.rmSync(value.file,{force:true});entries.delete(id);}
  function cancelTab(tabId) {const value=arms.get(tabId);if(value)cancelArm(tabId,value.id);}
  function cleanup() {for(const value of entries.values())clearTimeout(value.timer);arms.clear();entries.clear();if(root)fs.rmSync(root,{recursive:true,force:true});root=undefined;}
  return {arm,capture,info,cancel,discard,cancelTab,cleanup};
};
