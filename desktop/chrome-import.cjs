const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const execFileAsync=promisify(execFile);

const safeUrl = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
};

function profilePath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Chrome Profile 路径无效');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Chrome Profile 路径超出所选目录');
  const canonicalRoot=fs.realpathSync(root),canonicalProfile=fs.realpathSync(resolved);
  if(!canonicalProfile.startsWith(`${canonicalRoot}${path.sep}`))throw new Error('Chrome Profile 符号链接超出所选目录');
  return resolved;
}

function sourceFile(directory,name) {
  const file=path.join(directory,name);
  if(!fs.existsSync(file))return file;
  const root=fs.realpathSync(directory),resolved=fs.realpathSync(file);
  if(!resolved.startsWith(`${root}${path.sep}`))throw new Error(`Chrome 源文件符号链接超出资料目录：${name}`);
  return resolved;
}

function profiles(root) {
  const base = path.resolve(root);
  let info = {};
  try { info = JSON.parse(fs.readFileSync(sourceFile(base, 'Local State'), 'utf8'))?.profile?.info_cache || {}; }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw new Error(`无法读取 Chrome Profile 清单：${error.message}`); }
  const dirs = fs.readdirSync(base, {withFileTypes:true}).filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
  const found = dirs.map(entry => {
    const relative = entry.name;
    const directory = profilePath(base, relative);
    const hasBookmarks = fs.existsSync(sourceFile(directory, 'Bookmarks'));
    const hasHistory = fs.existsSync(sourceFile(directory, 'History'));
    const hasExtensions = fs.existsSync(sourceFile(directory, 'Extensions'));
    if (!hasBookmarks && !hasHistory && !hasExtensions) return null;
    const metadata = info[relative] || {};
    return {id:relative,name:typeof metadata.name==='string' && metadata.name.trim()?metadata.name.trim():(relative==='Default'?'默认资料':relative),hasBookmarks,hasHistory,hasExtensions};
  }).filter(Boolean);
  return found.sort((a,b)=>a.id==='Default'?-1:b.id==='Default'?1:a.name.localeCompare(b.name));
}

function readBookmarks(directory) {
  const file = sourceFile(directory, 'Bookmarks');
  let data;
  try { data=JSON.parse(fs.readFileSync(file,'utf8')); }
  catch (error) { if(error.code==='ENOENT') return []; throw new Error(`无法读取书签文件：${error.message}`); }
  const result=[];
  const walk=nodes=>{for(const node of Array.isArray(nodes)?nodes:[]){if(node.type==='url'){const url=safeUrl(node.url);if(url)result.push({url,title:typeof node.name==='string'?node.name:url});}else if(node.type==='folder')walk(node.children);}};
  for(const root of Object.values(data.roots || {})) if(root && typeof root==='object') walk(root.children);
  return result;
}

function readHistory(directory) {
  const file=sourceFile(directory,'History');
  if(!fs.existsSync(file)) return [];
  sourceFile(directory,'History-wal');sourceFile(directory,'History-shm');
  let database;
  try {
    database=new DatabaseSync(file,{readOnly:true});
    const statement=database.prepare('SELECT url, title, last_visit_time FROM urls WHERE last_visit_time > 0 ORDER BY last_visit_time DESC');
    statement.setReadBigInts(true);
    const rows=statement.all();
    return rows.map(row=>{
      const url=safeUrl(row.url);if(!url)return null;
      const millis=Number((row.last_visit_time-11644473600000000n)/1000n);
      const visitedAt=new Date(millis).toISOString();
      return {url,title:typeof row.title==='string'&&row.title?row.title:url,visitedAt};
    }).filter(Boolean).sort((a,b)=>a.visitedAt.localeCompare(b.visitedAt));
  } catch(error) { throw new Error(`无法读取 Chrome 历史数据库（请先关闭 Chrome 后重试）：${error.message}`); }
  finally { database?.close(); }
}

function readCookieRows(directory) {
  const file=sourceFile(directory,'Cookies');
  if(!fs.existsSync(file))return [];
  sourceFile(directory,'Cookies-wal');sourceFile(directory,'Cookies-shm');
  let database;
  try{
    database=new DatabaseSync(file,{readOnly:true});
    const statement=database.prepare('SELECT * FROM cookies');statement.setReadBigInts(true);
    return statement.all();
  }catch(error){throw new Error(`无法只读读取 Chrome Cookie 数据库（请先关闭 Chrome 后重试）：${error.message}`);}
  finally{database?.close();}
}

function cookieCount(directory){
  try{return readCookieRows(directory).length;}catch{return null;}
}

async function chromeCookieKey(){
  if(process.platform!=='darwin')throw new Error('Cookie 导入目前只支持 macOS。');
  let stdout;
  try{({stdout}=await execFileAsync('/usr/bin/security',['find-generic-password','-w','-s','Chrome Safe Storage','-a','Chrome'],{timeout:15000,maxBuffer:4096,windowsHide:true}));}
  catch(error){throw new Error(`无法通过 macOS 钥匙串读取 Chrome Safe Storage。请在系统提示中允许访问后重试。${error.message?`（${error.message}）`:''}`);}
  const password=stdout.replace(/[\r\n]+$/,'');
  if(!password)throw new Error('Chrome Safe Storage 钥匙串条目为空，无法导入 Cookie。');
  return crypto.pbkdf2Sync(Buffer.from(password,'utf8'),Buffer.from('saltysalt'),1003,16,'sha1');
}

function decodeCookieRows(rows,key){
  const cookies=[];
  let unsupported=0;
  for(const row of rows){
    const host=typeof row.host_key==='string'?row.host_key:'';
    const name=typeof row.name==='string'?row.name:'';
    const domain=host.replace(/^\./,'');
    if(!domain || typeof row.name!=='string' || (typeof row.top_frame_site_key==='string' && row.top_frame_site_key)){unsupported++;continue;}
    const encrypted=Buffer.from(row.encrypted_value || []);
    let value=typeof row.value==='string'?row.value:'';
    if(encrypted.length){
      if(encrypted.subarray(0,3).toString('ascii')!=='v10'){unsupported++;continue;}
      try{const decipher=crypto.createDecipheriv('aes-128-cbc',key,Buffer.alloc(16,0x20));value=Buffer.concat([decipher.update(encrypted.subarray(3)),decipher.final()]).toString('utf8');}
      catch{unsupported++;continue;}
    }
    let url;
    const cookiePath=typeof row.path==='string'&&row.path?row.path:'/';
    try{const parsed=new URL(`${row.is_secure?'https':'http'}://${domain}/`);parsed.pathname=cookiePath;url=parsed.href;}catch{unsupported++;continue;}
    const cookie={url,name,value,sourceDomain:host,hostOnly:!host.startsWith('.'),path:cookiePath,secure:Boolean(row.is_secure),httpOnly:Boolean(row.is_httponly)};
    if(row.has_expires){
      try{const expiresUtc=BigInt(row.expires_utc),seconds=Number(expiresUtc-11644473600000000n)/1000000;if(Number.isFinite(seconds)&&seconds>0)cookie.expirationDate=seconds;else{unsupported++;continue;}}
      catch{unsupported++;continue;}
    }
    const sameSite=Number(row.samesite);
    cookie.sameSite=({0:'unspecified',1:'no_restriction',2:'lax',3:'strict'})[sameSite] || 'unspecified';
    cookies.push(cookie);
  }
  return {cookies,unsupported};
}

function readCookiesWithKey(directory,key){return decodeCookieRows(readCookieRows(directory),key);}

async function readCookies(directory){
  const rows=readCookieRows(directory),key=await chromeCookieKey();
  return decodeCookieRows(rows,key);
}

function readProfile(root, relative) {
  const directory=profilePath(root,relative);
  return {bookmarks:readBookmarks(directory),history:readHistory(directory),cookieCount:process.platform==='darwin'?cookieCount(directory):null};
}

module.exports={profiles,readProfile,readCookies,readCookiesWithKey};
