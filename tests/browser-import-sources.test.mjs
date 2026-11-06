import test from 'node:test';
import assert from 'node:assert/strict';
import browserImports from '../desktop/browser-import-sources.cjs';

const {defaultDirectory,listImportSources,getImportSource}=browserImports;

test('Google Chrome and Microsoft Edge use their platform user data roots',()=>{
  const options={home:'/Users/person',localAppData:'C:\\Users\\person\\AppData\\Local'};
  assert.equal(defaultDirectory('chrome',{...options,platform:'darwin'}),'/Users/person/Library/Application Support/Google/Chrome');
  assert.equal(defaultDirectory('edge',{...options,platform:'darwin'}),'/Users/person/Library/Application Support/Microsoft Edge');
  assert.equal(defaultDirectory('chrome',{...options,platform:'win32'}),'C:\\Users\\person\\AppData\\Local\\Google\\Chrome\\User Data');
  assert.equal(defaultDirectory('edge',{...options,platform:'win32'}),'C:\\Users\\person\\AppData\\Local\\Microsoft\\Edge\\User Data');
  assert.equal(defaultDirectory('chrome',{...options,platform:'linux'}),'/Users/person/.config/google-chrome');
  assert.equal(defaultDirectory('edge',{...options,platform:'linux'}),'/Users/person/.config/microsoft-edge');
});

test('Windows roots derive Local from appData when LOCALAPPDATA is absent',()=>{
  assert.equal(defaultDirectory('edge',{platform:'win32',home:'C:\\Users\\person',appData:'C:\\Users\\person\\AppData\\Roaming'}),'C:\\Users\\person\\AppData\\Local\\Microsoft\\Edge\\User Data');
});

test('source listing checks only known directory existence and retains explicit source identity',()=>{
  const checked=[];
  const sources=listImportSources({platform:'darwin',home:'/Users/person',exists:directory=>{checked.push(directory);return directory.endsWith('Microsoft Edge');}});
  assert.deepEqual(checked,[
    '/Users/person/Library/Application Support/Google/Chrome',
    '/Users/person/Library/Application Support/Microsoft Edge',
  ]);
  assert.deepEqual(sources.map(({id,name,installed,supportsCookieImport})=>({id,name,installed,supportsCookieImport})),[
    {id:'chrome',name:'Google Chrome',installed:false,supportsCookieImport:true},
    {id:'edge',name:'Microsoft Edge',installed:true,supportsCookieImport:false},
  ]);
});

test('unknown source identifiers are rejected',()=>{
  assert.throws(()=>getImportSource('other'),/受支持的浏览器来源/);
  assert.throws(()=>defaultDirectory('other',{platform:'darwin',home:'/Users/person'}),/受支持的浏览器来源/);
});
