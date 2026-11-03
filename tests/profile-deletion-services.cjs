const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const createLibrary=require('../desktop/library.cjs');
const {createStore}=require('../desktop/chrome-extensions.cjs');
const {createAgentWorkbench}=require('../desktop/agent-workbench.cjs');
const {createProfileDeletion,extensionProfileRoot}=require('../desktop/profile-deletion.cjs');

function tempDir(){return fs.mkdtempSync(path.join(os.tmpdir(),'corvid-profile-delete-'));}
function fakeRuntime({resume=false,removeTaskData=()=>{}}={}){
  return {id:'test-runtime',version:'1',canResume:()=>resume,createSession:async()=>{},readPageContext:async()=>({snapshot:{},label:'p1',url:'https://fixture.test',title:'Fixture'}),removeTaskData,getModelSelection:()=>null,resolveModel:async()=>null};
}
function savedTask(id,{status='completed',conversation=[],profileId='work'}={}){
  return {id,profileId,roomId:`room-${id}`,tabId:`tab-${id}`,status,conversation,events:[]};
}
function identity(){return {issueAgentCredential:async()=>({id:'credential',token:'token'}),revokeAgentCredential:async()=>{}};}

(async()=>{
  const libraryDir=tempDir();
  fs.writeFileSync(path.join(libraryDir,'library.json'),JSON.stringify({schemaVersion:1,
    history:[{id:'default-history',profileId:'default'},{id:'work-history',profileId:'work'}],
    bookmarks:[{id:'default-bookmark',profileId:'default'},{id:'work-bookmark',profileId:'work'}],
    downloads:[{id:'default-download',profileId:'default'},{id:'work-download',profileId:'work'}]}));
  const library=createLibrary(libraryDir);
  assert.throws(()=>library.removeProfile('default'),/default profile/);
  const original=fs.readFileSync(path.join(libraryDir,'library.json'),'utf8');
  const rename=fs.renameSync;
  try{
    fs.renameSync=(from,to)=>{if(to===path.join(libraryDir,'library.json'))throw new Error('injected replace failure');return rename(from,to);};
    assert.throws(()=>library.removeProfile('work'),/injected replace failure/);
  }finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(path.join(libraryDir,'library.json'),'utf8'),original,'failed atomic replacement preserves the original library file');
  library.removeProfile('work');
  assert.deepEqual(library.history('default').map(item=>item.id),['default-history']);
  assert.deepEqual(library.bookmarks('work'),[]);
  assert.deepEqual(library.downloads('default').map(item=>item.id),['default-download']);

  const extensionDir=tempDir();
  fs.writeFileSync(path.join(extensionDir,'managed-extensions.json'),JSON.stringify([
    {id:'default-extension',profileId:'default'},{id:'work-extension',profileId:'work'}]));
  const extensions=createStore(extensionDir);
  assert.throws(()=>extensions.removeProfile('default'),/default profile/);
  assert.equal(extensions.removeProfile('work').length,1);
  assert.deepEqual(extensions.all().map(item=>item.id),['default-extension']);

  const taskDir=tempDir();
  fs.writeFileSync(path.join(taskDir,'agent-tasks.json'),JSON.stringify({schemaVersion:2,tasks:[
    savedTask('completed-clean'),savedTask('recoverable',{conversation:[{role:'assistant',text:'A saved answer'}]}),savedTask('default-task',{profileId:'default'})]}));
  const removed=[];
  const workbench=createAgentWorkbench({dataDir:taskDir,runtime:fakeRuntime({removeTaskData:id=>removed.push(id)}),...identity()});
  assert.throws(()=>workbench.beginProfileDeletion('default'),/default profile/);
  const before=JSON.stringify(workbench.list());
  assert.throws(()=>workbench.beginProfileDeletion('work'),error=>error.code==='CORVID_PROFILE_IN_USE'&&error.blockers.some(item=>item.id==='recoverable'));
  assert.equal(JSON.stringify(workbench.list()),before,'a recoverable conversation blocks without changing task state');
  workbench.clear('recoverable');
  workbench.beginProfileDeletion('work');
  await assert.rejects(workbench.start({profileId:'work',roomId:'room-new',tabId:'tab-new',prompt:'test',includePageContext:true,contextPreview:{}}),error=>error.code==='CORVID_PROFILE_DELETING');
  assert.equal(await workbench.removeProfileData('work'),1);
  assert.deepEqual(removed,['recoverable','completed_clean']);
  assert.deepEqual(workbench.list().map(task=>task.id),['default-task']);

  const retryDir=tempDir();
  fs.writeFileSync(path.join(retryDir,'agent-tasks.json'),JSON.stringify({schemaVersion:2,tasks:[savedTask('retry-one'),savedTask('retry-two')]}));
  let fail=true;const retryRemoved=[];
  const retryWorkbench=createAgentWorkbench({dataDir:retryDir,runtime:fakeRuntime({removeTaskData:id=>{retryRemoved.push(id);if(id==='retry_two'&&fail)throw new Error('injected runtime cleanup failure');}}),...identity()});
  retryWorkbench.beginProfileDeletion('work');
  await assert.rejects(retryWorkbench.removeProfileData('work'),/injected runtime cleanup failure/);
  assert.equal(retryWorkbench.list('work').length,2,'failed cleanup retains task records for retry');
  fail=false;
  assert.equal(await retryWorkbench.removeProfileData('work'),2);
  assert.deepEqual(retryRemoved,['retry_one','retry_two','retry_one','retry_two'],'retry safely repeats idempotent runtime cleanup');
  assert.equal(retryWorkbench.list('work').length,0);

  const coordinatorDir=tempDir();
  let profiles=[{id:'default',name:'默认',isDefault:true},{id:'work',name:'Work'}];
  const events=[];let failStorageClear=true;let downloadPath=path.join(coordinatorDir,'kept-download.zip');fs.writeFileSync(downloadPath,'user file');
  const browserSession={closeAllConnections:async()=>events.push('close-connections'),clearStorageData:async()=>{events.push('clear-storage');if(failStorageClear)throw new Error('injected session clear failure');},clearCache:async()=>events.push('clear-cache'),clearAuthCache:async()=>events.push('clear-auth'),clearCodeCaches:async()=>events.push('clear-code'),clearHostResolverCache:async()=>events.push('clear-host-cache'),extensions:{getAllExtensions:()=>[{id:'loaded'}],removeExtension:id=>events.push(`unload:${id}`)}};
  let blockers=[];let agentLocked=false;
  const agentService={profileDeletionBlockers:()=>blockers,beginProfileDeletion:()=>{agentLocked=true;events.push('lock-agent');},removeProfileData:async()=>{events.push('clear-agent');},cancelProfileDeletion:()=>{agentLocked=false;},finishProfileDeletion:()=>{agentLocked=false;}};
  const extensionRoot=(directory,profileId)=>extensionProfileRoot(directory,profileId);
  const workExtensionDir=path.join(extensionRoot(coordinatorDir,'work'),'extension','1.0.0');fs.mkdirSync(workExtensionDir,{recursive:true});fs.writeFileSync(path.join(workExtensionDir,'manifest.json'),'{}');
  const coordinator=createProfileDeletion({
    getProfiles:()=>profiles,
    saveProfiles:next=>{events.push(next.some(item=>item.id==='work'&&item.deletionPending)?'mark-pending':'save-profiles');profiles=next;},
    getReferences:()=>({windows:[],rooms:[],downloads:[]}),
    agentWorkbench:agentService,getSession:()=>browserSession,partitionFor:id=>`persist:corvid-profile-${id}`,
    library:{removeProfile:id=>events.push(`clear-library:${id}`)},managedExtensions:{list:id=>[{id:'ext',version:'1.0.0',profileId:id}],removeProfile:id=>events.push(`clear-extension-records:${id}`)},
    extensionRoot,dataDir:coordinatorDir,removeLoadedExtensions:()=>events.push('unload-profile'),onDeleted:id=>events.push(`deleted:${id}`),
  });
  blockers=[{kind:'window',id:'window-1'}];
  assert.equal(coordinator.preview('work').canDelete,false);
  await assert.rejects(coordinator.remove('work'),error=>error.code==='CORVID_PROFILE_IN_USE');
  assert.equal(profiles.some(item=>item.deletionPending),false,'blocked deletion does not persist a pending marker');
  blockers=[];
  await assert.rejects(coordinator.remove('work'),/injected session clear failure/);
  assert.equal(profiles.find(item=>item.id==='work').deletionPending,true,'failed cleanup retains a durable retry marker');
  assert.equal(agentLocked,true,'failed cleanup keeps Agent work from restarting');
  assert.equal(fs.existsSync(path.join(workExtensionDir,'manifest.json')),true,'later cleanup stages have not run when Session clearing fails');
  failStorageClear=false;
  assert.deepEqual(await coordinator.remove('work'),{deleted:true,profileId:'work'});
  assert.deepEqual(profiles.map(item=>item.id),['default']);
  assert.equal(agentLocked,false);
  assert.equal(fs.existsSync(extensionRoot(coordinatorDir,'work')),false);
  assert.equal(fs.readFileSync(downloadPath,'utf8'),'user file','downloaded files are outside Profile cleanup');
  assert.ok(events.indexOf('clear-agent')<events.indexOf('clear-storage'));
  assert.ok(events.indexOf('clear-library:work')<events.indexOf('save-profiles'));
  assert.ok(events.includes('deleted:work'));
  assert.throws(()=>coordinator.preview('work'),error=>error.code==='CORVID_PROFILE_NOT_FOUND');

  const boundaryDir=tempDir(),outsideDir=tempDir(),outsideMarker=path.join(outsideDir,'must-remain');fs.writeFileSync(outsideMarker,'outside');
  let boundaryProfiles=[{id:'default',name:'默认',isDefault:true},{id:'work',name:'Work'}];
  const boundaryCoordinator=createProfileDeletion({getProfiles:()=>boundaryProfiles,saveProfiles:next=>{boundaryProfiles=next;},getReferences:()=>({windows:[],rooms:[],downloads:[]}),
    agentWorkbench:{profileDeletionBlockers:()=>[],beginProfileDeletion(){},removeProfileData:async()=>{},finishProfileDeletion(){}},
    getSession:()=>browserSession,partitionFor:id=>`persist:corvid-profile-${id}`,library:{removeProfile(){}},managedExtensions:{list:()=>[],removeProfile(){}},
    extensionRoot:()=>path.join(outsideDir,'malicious-target'),dataDir:boundaryDir,
  });
  await assert.rejects(boundaryCoordinator.remove('work'),/越过浏览器资料目录/);
  assert.equal(fs.readFileSync(outsideMarker,'utf8'),'outside','an injected extension path cannot delete outside the data directory');

  for(const directory of [libraryDir,extensionDir,taskDir,retryDir,coordinatorDir,boundaryDir,outsideDir])fs.rmSync(directory,{recursive:true,force:true});
  console.log('PASS Profile reference guards and retryable data cleanup contracts');
})().catch(error=>{console.error(error);process.exitCode=1;});
