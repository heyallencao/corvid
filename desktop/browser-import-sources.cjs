const fs=require('node:fs');
const path=require('node:path');

const definitions=Object.freeze({
  chrome:Object.freeze({id:'chrome',name:'Google Chrome',supportsCookieImport:true}),
  edge:Object.freeze({id:'edge',name:'Microsoft Edge',supportsCookieImport:false}),
});

function getImportSource(id){
  const source=definitions[id];
  if(!source)throw new Error('请选择受支持的浏览器来源');
  return source;
}

function defaultDirectory(id,{platform=process.platform,home=osHome(),localAppData,appData}={}){
  getImportSource(id);
  const paths=platform==='win32'?path.win32:path;
  if(platform==='darwin')return id==='chrome'
    ?paths.join(home,'Library','Application Support','Google','Chrome')
    :paths.join(home,'Library','Application Support','Microsoft Edge');
  if(platform==='win32'){
    const local=localAppData||paths.join(paths.dirname(appData||paths.join(home,'AppData','Roaming')),'Local');
    return id==='chrome'
      ?paths.join(local,'Google','Chrome','User Data')
      :paths.join(local,'Microsoft','Edge','User Data');
  }
  return id==='chrome'?paths.join(home,'.config','google-chrome'):paths.join(home,'.config','microsoft-edge');
}

function osHome(){return process.env.HOME||process.env.USERPROFILE||'.';}

function listImportSources(options={}){
  const exists=options.exists||fs.existsSync;
  return Object.values(definitions).map(source=>{
    const directory=defaultDirectory(source.id,options);
    return {...source,installed:exists(directory)};
  });
}

module.exports=Object.freeze({definitions,getImportSource,defaultDirectory,listImportSources});
