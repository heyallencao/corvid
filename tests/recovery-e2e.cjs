const {spawn}=require('node:child_process');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const electron=require('electron');
const project=path.resolve(__dirname,'..');

(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'corvid-recovery-'));
  try {
    const samples=['{broken', JSON.stringify({rooms:'invalid'}), JSON.stringify({rooms:[{id:'same',name:'a',ownership:'user',tabs:[]},{id:'same',name:'b',ownership:'user',tabs:[]}]})];
    for(const original of samples){
      const file=path.join(dir,'rooms.json');await fs.writeFile(file,original);
      const child=spawn(electron,['.'],{cwd:project,env:{...process.env,CORVID_DATA_DIR:dir,CORVID_TEST_MODE:'1'},stdio:['ignore','ignore','pipe']});
      let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
      const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
      let code;try{[code]=await once(child,'exit');}finally{clearTimeout(timer);}
      assert.equal(code,1,stderr);assert.match(stderr,/原文件未修改/);
      assert.equal(await fs.readFile(file,'utf8'),original);
      await assert.rejects(fs.stat(path.join(dir,'control.json')),{code:'ENOENT'});
    }
    console.log('PASS malformed session data is preserved and startup fails with a diagnostic');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
