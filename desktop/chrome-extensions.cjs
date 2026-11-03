const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const MAX_EXTENSION_BYTES=64*1024*1024;
const chromeIdPattern=/^[a-p]{32}$/;

function inside(root,candidate){return candidate===root||candidate.startsWith(`${root}${path.sep}`);}
function safeDirectory(root,relative){
  const base=fs.realpathSync(root),candidate=path.resolve(base,relative);
  if(!inside(base,candidate)||candidate===base)throw new Error('Chrome 扩展路径超出资料目录');
  const actual=fs.realpathSync(candidate);
  if(!inside(base,actual)||actual===base)throw new Error('Chrome 扩展符号链接超出资料目录');
  if(!fs.statSync(actual).isDirectory())throw new Error('Chrome 扩展资料不是目录');
  return actual;
}
function versionParts(version){return String(version).split(/[.+-]/).map(part=>/^\d+$/.test(part)?Number(part):part.toLowerCase());}
function compareVersions(a,b){
  const left=versionParts(a),right=versionParts(b);
  for(let index=0;index<Math.max(left.length,right.length);index++){
    const x=left[index]??0,y=right[index]??0;
    if(x===y)continue;
    if(typeof x==='number'&&typeof y==='number')return x-y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}
function resolveName(manifest,root){
  const raw=typeof manifest.name==='string'?manifest.name:'';
  if(!/^__MSG_[A-Za-z0-9_]+__$/.test(raw))return raw;
  const locale=typeof manifest.default_locale==='string'?manifest.default_locale:'';
  if(!locale)return raw;
  try{
    const messages=JSON.parse(fs.readFileSync(path.join(root,'_locales',locale,'messages.json'),'utf8'));
    return messages[raw.slice(6,-2)]?.message||raw;
  }catch{return raw;}
}
function permissions(manifest){
  const strings=values=>Array.isArray(values)?values.filter(value=>typeof value==='string').slice(0,100):[];
  return {
    required:strings(manifest.permissions),
    hosts:strings(manifest.host_permissions),
    optional:strings(manifest.optional_permissions),
    optionalHosts:strings(manifest.optional_host_permissions),
  };
}
function discover(profileDir){
  const extensionsPath=path.join(profileDir,'Extensions');
  if(!fs.existsSync(extensionsPath))return [];
  const profileRoot=fs.realpathSync(profileDir),extensionsRoot=fs.realpathSync(extensionsPath),found=[];
  if(!inside(profileRoot,extensionsRoot)||extensionsRoot===profileRoot)throw new Error('Chrome Extensions 目录超出所选 Profile');
  for(const entry of fs.readdirSync(extensionsRoot,{withFileTypes:true})){
    if(!entry.isDirectory()||!chromeIdPattern.test(entry.name))continue;
    const id=entry.name;
    const idPath=safeDirectory(extensionsRoot,id);
    const versions=[];
    for(const versionEntry of fs.readdirSync(idPath,{withFileTypes:true})){
      if(!versionEntry.isDirectory())continue;
      const versionPath=safeDirectory(idPath,versionEntry.name);
      const manifestPath=path.join(versionPath,'manifest.json');
      if(!fs.existsSync(manifestPath))continue;
      let manifest;
      try{manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));}catch{continue;}
      if(!manifest||typeof manifest!=='object'||![2,3].includes(manifest.manifest_version)||typeof manifest.version!=='string')continue;
      versions.push({id,name:resolveName(manifest,versionPath)||id,version:manifest.version,manifestVersion:manifest.manifest_version,permissions:permissions(manifest),sourcePath:versionPath});
    }
    versions.sort((a,b)=>compareVersions(b.version,a.version));
    if(versions[0])found.push({...versions[0],warning:'Electron 仅支持部分 Chrome 扩展 API；Corvid 尚未集成扩展工具栏弹窗。导入后仍需验证扩展功能。'});
  }
  return found.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
function managedPath(dataDir,profileId,id,version){
  if(!chromeIdPattern.test(id))throw new Error('Chrome 扩展 ID 无效');
  const profileKey=crypto.createHash('sha256').update(String(profileId)).digest('hex').slice(0,24);
  const safeVersion=String(version).replace(/[^0-9A-Za-z._-]/g,'_');
  return path.join(dataDir,'extensions',profileKey,id,safeVersion);
}
function copyTree(source,destination,root,state){
  if(fs.lstatSync(source).isSymbolicLink())throw new Error('Chrome 扩展包含不支持的符号链接');
  const actual=fs.realpathSync(source);
  if(!inside(root,actual))throw new Error('Chrome 扩展包含资料目录外的符号链接');
  const stat=fs.lstatSync(actual);
  if(stat.isDirectory()){
    fs.mkdirSync(destination,{recursive:true,mode:0o700});
    for(const name of fs.readdirSync(actual))copyTree(path.join(actual,name),path.join(destination,name),root,state);
    return;
  }
  if(!stat.isFile())throw new Error('Chrome 扩展包含不支持的文件类型');
  state.bytes+=stat.size;
  if(state.bytes>MAX_EXTENSION_BYTES)throw new Error('Chrome 扩展超过 64 MiB 导入上限');
  fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
  fs.copyFileSync(actual,destination,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination,0o600);
}
function copyToCorvid(extension,dataDir,profileId){
  const sourceRoot=fs.realpathSync(path.dirname(path.dirname(extension.sourcePath)));
  const sourcePath=fs.realpathSync(extension.sourcePath);
  if(!inside(sourceRoot,sourcePath))throw new Error('Chrome 扩展源路径无效');
  const destination=managedPath(dataDir,profileId,extension.id,extension.version);
  if(fs.existsSync(destination))return {path:destination,created:false};
  const parent=path.dirname(destination),stage=`${destination}.import-${crypto.randomUUID()}`;
  fs.mkdirSync(parent,{recursive:true,mode:0o700});
  try{
    const state={bytes:0};copyTree(sourcePath,stage,sourceRoot,state);
    if(!fs.existsSync(path.join(stage,'manifest.json')))throw new Error('扩展 manifest.json 缺失');
    fs.renameSync(stage,destination);
    return {path:destination,created:true,bytes:state.bytes};
  }catch(error){fs.rmSync(stage,{recursive:true,force:true});throw error;}
}
function createStore(dataDir){
  const file=path.join(dataDir,'managed-extensions.json');
  let items=[];
  try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(saved))items=saved;}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  const save=next=>{const temp=`${file}.tmp`;fs.writeFileSync(temp,JSON.stringify(next),{mode:0o600});fs.renameSync(temp,file);items=next;};
  return {
    list(profileId){return items.filter(item=>item.profileId===profileId).map(item=>({...item}));},
    find(profileId,id){return items.find(item=>item.profileId===profileId&&item.id===id)||null;},
    add(record){if(items.some(item=>item.profileId===record.profileId&&item.id===record.id))throw new Error('该扩展已在目标 Profile 中');save([...items,record]);},
    setEnabled(profileId,id,enabled){const record=this.find(profileId,id);if(!record)throw new Error('Corvid 扩展不存在');save(items.map(item=>item.profileId===profileId&&item.id===id?{...item,enabled:Boolean(enabled)}:item));},
    remove(profileId,id){const record=this.find(profileId,id);if(!record)throw new Error('Corvid 扩展不存在');save(items.filter(item=>item.profileId!==profileId||item.id!==id));return record;},
    removeProfile(profileId){
      if(profileId==='default')throw new Error('Cannot remove extensions from the default profile');
      const removed=items.filter(item=>item.profileId===profileId).map(item=>({...item}));
      if(removed.length)save(items.filter(item=>item.profileId!==profileId));
      return removed;
    },
    all(){return items.map(item=>({...item}));},
  };
}

module.exports={discover,managedPath,copyToCorvid,createStore,MAX_EXTENSION_BYTES,chromeIdPattern};
