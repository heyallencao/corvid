const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

module.exports = function createLibrary(directory) {
  const SCHEMA_VERSION = 1;
  const file = path.join(directory, 'library.json');
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    data = {schemaVersion: SCHEMA_VERSION, history: [], bookmarks: [], downloads: []};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid library data');
  if (data.schemaVersion !== undefined && data.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported library schema version: ${data.schemaVersion}`);
  data.schemaVersion = SCHEMA_VERSION;
  if (!Array.isArray(data.history) || !Array.isArray(data.bookmarks)) throw new Error('Invalid library data');
  if (data.downloads === undefined) data.downloads = [];
  if (!Array.isArray(data.downloads)) throw new Error('Invalid download history');
  let failChromeImportSaveForTest=process.env.CORVID_TEST_MODE==='1'&&process.env.CORVID_TEST_CHROME_LIBRARY_IMPORT_FAIL_RENAME_ONCE==='1';
  const save = (next=data,purpose='general') => {
    const tmp=`${file}.tmp`;
    try{
      fs.writeFileSync(tmp,JSON.stringify(next),{mode:0o600});
      if(purpose==='chrome-import'&&failChromeImportSaveForTest){failChromeImportSaveForTest=false;throw new Error('测试注入：Chrome 导入浏览资料库替换失败');}
      fs.renameSync(tmp,file);
    }catch(error){try{fs.rmSync(tmp,{force:true});}catch{}throw error;}
  };
  let interrupted = false;
  for (const item of data.downloads) if (item.status === 'progressing') { item.status = 'interrupted'; interrupted = true; }
  if (interrupted) save();
  const validUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol); } catch { return false; } };
  return {
    history: profileId => data.history.filter(item=>(item.profileId ?? 'default')===profileId).reverse(),
    historySuggestions(profileId, query, limit=6) {
      if(typeof query!=='string'||!query.trim())return [];
      const needle=query.trim().toLocaleLowerCase();
      const matches=data.history
        .filter(item=>(item.profileId ?? 'default')===profileId&&validUrl(item.url))
        .map(item=>{
          const url=item.url.toLocaleLowerCase(),title=(item.title||'').toLocaleLowerCase();
          const rank=url.startsWith(needle)?0:title.startsWith(needle)?1:url.includes(needle)?2:title.includes(needle)?3:Infinity;
          return {item,rank};
        })
        .filter(match=>Number.isFinite(match.rank))
        .sort((left,right)=>left.rank-right.rank||String(right.item.visitedAt).localeCompare(String(left.item.visitedAt)));
      const seen=new Set(),suggestions=[];
      for(const {item} of matches){
        if(seen.has(item.url))continue;
        seen.add(item.url);suggestions.push({id:item.id,url:item.url,title:item.title||item.url,visitedAt:item.visitedAt});
        if(suggestions.length>=Math.max(1,Math.min(10,limit)))break;
      }
      return suggestions;
    },
    frequentSites(profileId, limit=8) {
      const sites=new Map();
      for(const item of data.history){
        if((item.profileId ?? 'default')!==profileId||!validUrl(item.url))continue;
        let url;try{url=new URL(item.url);}catch{continue;}
        const origin=url.origin,current=sites.get(origin);
        if(!current){sites.set(origin,{origin,visitCount:1,url:item.url,title:item.title||origin,visitedAt:item.visitedAt||''});continue;}
        current.visitCount++;
        if(String(item.visitedAt||'')>=String(current.visitedAt)){current.url=item.url;current.title=item.title||origin;current.visitedAt=item.visitedAt||'';}
      }
      const count=Number.isInteger(limit)&&limit>0?Math.min(20,limit):8;
      return [...sites.values()]
        .sort((left,right)=>right.visitCount-left.visitCount||String(right.visitedAt).localeCompare(String(left.visitedAt))||left.origin.localeCompare(right.origin))
        .slice(0,count);
    },
    bookmarks: profileId => data.bookmarks.filter(item=>(item.profileId ?? 'default')===profileId),
    downloads: profileId => data.downloads.filter(item=>(item.profileId ?? 'default')===profileId).reverse(),
    removeProfile(profileId) {
      if(profileId==='default')throw new Error('Cannot remove the default profile library');
      const next={...data,
        history:data.history.filter(item=>(item.profileId ?? 'default')!==profileId),
        bookmarks:data.bookmarks.filter(item=>(item.profileId ?? 'default')!==profileId),
        downloads:data.downloads.filter(item=>(item.profileId ?? 'default')!==profileId),
      };
      save(next);
      data=next;
    },
    addDownload(item) { data.downloads.push(item); save(); return item; },
    updateDownload(id, fields, persist = true) { const item=data.downloads.find(x=>x.id===id); if(!item) throw new Error('Download not found'); Object.assign(item,fields); if(persist) save(); return item; },
    visit(url, title, profileId) { if (!validUrl(url)) return null; const item={id:randomUUID(),profileId,url,title:title || url,visitedAt:new Date().toISOString()}; data.history.push(item); save(); return item; },
    title(id,title) { const item=data.history.find(x=>x.id===id); if(item && title && item.title!==title){item.title=title;save();} },
    removeHistory(id,profileId) { const before=data.history.length; data.history=data.history.filter(x=>x.id!==id || (x.profileId ?? 'default')!==profileId); if(before!==data.history.length) save(); return before!==data.history.length; },
    addBookmark(url,title,profileId) { if(!validUrl(url)) throw new Error('Bookmark URL must be HTTP or HTTPS'); const existing=data.bookmarks.find(x=>x.url===url && (x.profileId ?? 'default')===profileId); if(existing) return existing; const item={id:randomUUID(),profileId,url,title:typeof title==='string' && title ? title : url,createdAt:new Date().toISOString()}; data.bookmarks.push(item);save();return item; },
    importChromeData({bookmarks=[],history=[]},profileId,categories) {
      const next={...data,bookmarks:[...data.bookmarks],history:[...data.history]};
      const result={bookmarks:{imported:0,skipped:0},history:{imported:0,skipped:0}};
      if(categories.includes('bookmarks')){
        const seen=new Set(next.bookmarks.filter(item=>(item.profileId ?? 'default')===profileId).map(item=>item.url));
        for(const source of bookmarks){if(!validUrl(source.url)||seen.has(source.url)){result.bookmarks.skipped++;continue;}seen.add(source.url);next.bookmarks.push({id:randomUUID(),profileId,url:source.url,title:typeof source.title==='string'&&source.title?source.title:source.url,createdAt:new Date().toISOString()});result.bookmarks.imported++;}
      }
      if(categories.includes('history')){
        const seen=new Set(next.history.filter(item=>(item.profileId ?? 'default')===profileId).map(item=>`${item.url}\u0000${item.visitedAt}`));
        for(const source of history){if(!validUrl(source.url)||typeof source.visitedAt!=='string'){result.history.skipped++;continue;}const key=`${source.url}\u0000${source.visitedAt}`;if(seen.has(key)){result.history.skipped++;continue;}seen.add(key);next.history.push({id:randomUUID(),profileId,url:source.url,title:typeof source.title==='string'&&source.title?source.title:source.url,visitedAt:source.visitedAt});result.history.imported++;}
      }
      if(result.bookmarks.imported || result.history.imported){save(next,'chrome-import');data=next;}
      return result;
    },
    removeBookmark(id,profileId) { const before=data.bookmarks.length;data.bookmarks=data.bookmarks.filter(x=>x.id!==id || (x.profileId ?? 'default')!==profileId);if(before!==data.bookmarks.length) save();return before!==data.bookmarks.length; }
  };
};
