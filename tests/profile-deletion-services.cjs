const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const createLibrary=require('../desktop/library.cjs');
const {createStore}=require('../desktop/chrome-extensions.cjs');
const {createAgentWorkbench}=require('../desktop/agent-workbench.cjs');

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

  for(const directory of [libraryDir,extensionDir,taskDir,retryDir])fs.rmSync(directory,{recursive:true,force:true});
  console.log('PASS Profile library, extension metadata and Agent task cleanup contracts');
})().catch(error=>{console.error(error);process.exitCode=1;});
