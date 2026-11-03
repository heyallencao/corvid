const path=require('node:path');
const crypto=require('node:crypto');
const fs=require('node:fs');

function inspectProfileDeletion(profileId,{profiles,windows=[],rooms=[],downloads=[],agentTasks=[]}){
  const profile=profiles.find(item=>item.id===profileId);
  if(!profile)throw Object.assign(new Error('浏览身份不存在'),{code:'CORVID_PROFILE_NOT_FOUND'});
  const blockers=[];
  if(profileId==='default'||profile.isDefault)blockers.push({kind:'default',id:profileId});
  for(const window of windows)if(window.activeProfileId===profileId)blockers.push({kind:'window',id:window.id});
  for(const room of rooms)if(room.profileId===profileId)blockers.push({kind:'room',id:room.id,name:room.name});
  for(const download of downloads)if(download.profileId===profileId)blockers.push({kind:'download',id:download.id,status:download.status});
  for(const task of agentTasks)blockers.push({kind:'agent-task',id:task.id,status:task.status});
  return {profile:{id:profile.id,name:profile.name},blockers,canDelete:blockers.length===0};
}

function createProfileDeletion({
  getProfiles,saveProfiles,getReferences,agentWorkbench,getSession,
  partitionFor,library,managedExtensions,extensionRoot,dataDir,
  removeLoadedExtensions=()=>{},onDeleted=()=>{},
}){
  for(const [key,value] of Object.entries({getProfiles,saveProfiles,getReferences,agentWorkbench,getSession,partitionFor,library,managedExtensions,extensionRoot,dataDir}))if(!value)throw new TypeError(`${key} is required`);
  const inFlight=new Set();
  function profile(profileId){const result=getProfiles().find(item=>item.id===profileId);if(!result)throw Object.assign(new Error('浏览身份不存在'),{code:'CORVID_PROFILE_NOT_FOUND'});return result;}
  function preview(profileId){
    const current=profile(profileId),references=getReferences(profileId);
    const agentTasks=agentWorkbench.profileDeletionBlockers(profileId);
    const result=inspectProfileDeletion(profileId,{profiles:getProfiles(),...references,agentTasks});
    if(current.deletionPending)result.deletionPending=true;
    return result;
  }
  async function remove(profileId){
    if(inFlight.has(profileId))throw Object.assign(new Error('该浏览身份正在删除'),{code:'CORVID_PROFILE_DELETING'});
    const current=profile(profileId);
    if(profileId==='default'||current.isDefault)throw Object.assign(new Error('默认浏览身份不能删除'),{code:'CORVID_DEFAULT_PROFILE'});
    const status=preview(profileId);
    if(status.blockers.length){const error=Object.assign(new Error('该浏览身份仍被窗口、空间、下载或 Agent 任务引用'),{code:'CORVID_PROFILE_IN_USE'});error.blockers=status.blockers;throw error;}
    agentWorkbench.beginProfileDeletion(profileId);
    inFlight.add(profileId);
    let pendingWritten=Boolean(current.deletionPending);
    try{
      if(!pendingWritten){saveProfiles(getProfiles().map(item=>item.id===profileId?{...item,deletionPending:true}:item));pendingWritten=true;}
      const browserSession=getSession(partitionFor(profileId));
      await agentWorkbench.removeProfileData(profileId);
      await browserSession.closeAllConnections();
      await browserSession.clearStorageData();
      await browserSession.clearCache();
      await browserSession.clearAuthCache();
      await browserSession.clearCodeCaches({});
      await browserSession.clearHostResolverCache();
      for(const extension of browserSession.extensions.getAllExtensions())browserSession.extensions.removeExtension(extension.id);
      removeLoadedExtensions(profileId,browserSession);
      const root=path.resolve(extensionRoot(dataDir,profileId));
      const extensionsRoot=path.resolve(dataDir,'extensions');
      if(!root.startsWith(`${extensionsRoot}${path.sep}`))throw new Error('扩展目录越过浏览器资料目录');
      fs.rmSync(root,{recursive:true,force:true});
      managedExtensions.removeProfile(profileId);
      library.removeProfile(profileId);
      onDeleted(profileId);
      const remaining=getProfiles().filter(item=>item.id!==profileId);
      saveProfiles(remaining);
      agentWorkbench.finishProfileDeletion?.(profileId);
      return {deleted:true,profileId};
    }catch(error){if(!pendingWritten)agentWorkbench.cancelProfileDeletion?.(profileId);throw error;}
    finally{inFlight.delete(profileId);}
  }
  return Object.freeze({preview,remove});
}

function extensionProfileRoot(dataDir,profileId){
  const profileKey=crypto.createHash('sha256').update(String(profileId)).digest('hex').slice(0,24);
  return path.join(dataDir,'extensions',profileKey);
}

module.exports={inspectProfileDeletion,createProfileDeletion,extensionProfileRoot};
