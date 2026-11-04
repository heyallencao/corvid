import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require=createRequire(import.meta.url);
const chromeImport=require('../desktop/chrome-import.cjs');

async function withChromeProfile(run){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'corvid-import-categories-'));
  const profile=path.join(root,'Default');fs.mkdirSync(profile);
  fs.writeFileSync(path.join(root,'Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'Fixture'}}}}));
  try{return await run({root,profile});}
  finally{fs.rmSync(root,{recursive:true,force:true});}
}

test('Chrome 数据预览按类别隔离读取错误',async()=>withChromeProfile(({root,profile})=>{
  fs.writeFileSync(path.join(profile,'Bookmarks'),JSON.stringify({roots:{bookmark_bar:{children:[{type:'url',name:'Fixture',url:'https://example.test/'}]}}}));
  fs.writeFileSync(path.join(profile,'History'),'not a SQLite database');

  const preview=chromeImport.readProfilePreview(root,'Default');
  assert.equal(preview.bookmarks.length,1);
  assert.equal(preview.errors.bookmarks,undefined);
  assert.deepEqual(preview.history,[]);
  assert.equal(preview.errors.history,true);

  const selected=chromeImport.readSelectedProfile(root,'Default',['bookmarks']);
  assert.equal(selected.bookmarks.length,1);
  assert.deepEqual(selected.history,[],'unselected History must not be opened');
  assert.throws(()=>chromeImport.readSelectedProfile(root,'Default',['history']),/数据库/,'selecting the unreadable category must preserve the original read failure');
}));

test('仅导入扩展时不会读取损坏的书签或历史数据库',async()=>withChromeProfile(({root,profile})=>{
  fs.writeFileSync(path.join(profile,'Bookmarks'),'{invalid');
  fs.writeFileSync(path.join(profile,'History'),'not a SQLite database');
  const selected=chromeImport.readSelectedProfile(root,'Default',['extensions']);
  assert.deepEqual(selected,{bookmarks:[],history:[],cookieCount:null});
  const preview=chromeImport.readProfilePreview(root,'Default');
  assert.equal(preview.errors.bookmarks,true);
  assert.equal(preview.errors.history,true);
}));

test('Chrome Cookie 计数损坏只影响 Cookie 类别的预览',async()=>withChromeProfile(({root,profile})=>{
  fs.writeFileSync(path.join(profile,'Bookmarks'),JSON.stringify({roots:{bookmark_bar:{children:[{type:'url',name:'Fixture',url:'https://example.test/'}]}}}));
  fs.writeFileSync(path.join(profile,'Cookies'),'not a SQLite database');

  const preview=chromeImport.readProfilePreview(root,'Default');
  assert.equal(preview.bookmarks.length,1,'an unreadable Cookie database must not hide readable bookmarks');
  assert.deepEqual(preview.history,[],'a missing History database remains an empty readable category');
  if(process.platform==='darwin'){
    assert.equal(preview.cookieCount,null);
    assert.equal(preview.errors.cookies,true,'macOS Cookie count failure must be isolated to Cookies');
  }else{
    assert.equal(preview.cookieCount,null);
    assert.equal(preview.errors.cookies,undefined,'unsupported platforms must not read Chrome Cookies during preview');
  }

  const selected=chromeImport.readSelectedProfile(root,'Default',['bookmarks']);
  assert.equal(selected.bookmarks.length,1,'selecting bookmarks must not open the unreadable Cookie database');
  assert.deepEqual(selected.history,[]);
}));
