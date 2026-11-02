const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

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
    if (!hasBookmarks && !hasHistory) return null;
    const metadata = info[relative] || {};
    return {id:relative,name:typeof metadata.name==='string' && metadata.name.trim()?metadata.name.trim():(relative==='Default'?'默认资料':relative),hasBookmarks,hasHistory};
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

function readProfile(root, relative) {
  const directory=profilePath(root,relative);
  return {bookmarks:readBookmarks(directory),history:readHistory(directory)};
}

module.exports={profiles,readProfile};
