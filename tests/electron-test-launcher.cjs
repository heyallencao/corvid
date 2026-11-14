const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
const electron=require('electron');

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function alive(pid){try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}}
async function stopPid(pid){
  if(!Number.isSafeInteger(pid)||pid<=1||pid===process.pid)return;
  try{process.kill(pid,'SIGTERM');}catch(error){if(error.code==='ESRCH')return;throw error;}
  const deadline=Date.now()+3000;
  while(Date.now()<deadline&&alive(pid))await delay(50);
  if(alive(pid))try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
}

function launchElectronTestApp({projectDir,env}){
  // 沙箱 home（#438）：依赖 os.homedir() 的功能（如外部 Agent 自动接入）在测试里
  // 绝不触碰真实 home。需要预置 host 配置痕迹的测试显式传 CORVID_TEST_HOME。
  const testHome=env.CORVID_TEST_HOME || fsSync.mkdtempSync(path.join(os.tmpdir(),'corvid-test-home-'));
  env={...env,HOME:testHome};
  if(process.platform==='win32')env.USERPROFILE=testHome;
  const launchServices=process.platform==='darwin';
  const appBundle=path.resolve(path.dirname(electron),'..','..');
  const child=launchServices
    ? spawn('/usr/bin/open',['-na',appBundle,'--args',projectDir],{cwd:projectDir,env,stdio:['ignore','pipe','pipe']})
    : spawn(electron,['.'],{cwd:projectDir,env,stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',chunk=>output+=chunk);
  child.stderr.on('data',chunk=>output+=chunk);
  child.on('error',error=>output+=`${error.message}\n`);

  return {
    child,
    get output(){return output;},
    async stop(){
      const removeTestHome=async()=>{
        if(env.CORVID_TEST_HOME)return;
        await fs.rm(testHome,{recursive:true,force:true}).catch(()=>{});
      };
      if(!launchServices){
        if(child.exitCode===null&&child.signalCode===null){
          child.kill('SIGTERM');
          await Promise.race([once(child,'exit'),delay(3000)]);
          if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
        }
        await removeTestHome();
        return;
      }
      const progressPath=path.join(env.CORVID_DATA_DIR,'startup-progress.json');
      let pid=null;
      for(let attempt=0;attempt<40&&!pid;attempt++){
        try{const progress=JSON.parse(await fs.readFile(progressPath,'utf8'));if(Number.isSafeInteger(progress.pid))pid=progress.pid;}
        catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
        if(!pid)await delay(25);
      }
      if(pid)await stopPid(pid);
      if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
      await removeTestHome();
    },
  };
}

module.exports={launchElectronTestApp};
