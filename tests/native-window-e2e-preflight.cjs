const {execFileSync}=require('node:child_process');

function frontmostBundleId({platform=process.platform,run=execFileSync}={}){
  if(platform!=='darwin')return null;
  try{
    const front=run('lsappinfo',['front'],{encoding:'utf8',timeout:1500,stdio:['ignore','pipe','ignore']});
    const asn=front.match(/\bASN:\S+/)?.[0];
    if(!asn)return null;
    const info=run('lsappinfo',['info','-only','bundleID',asn],{encoding:'utf8',timeout:1500,stdio:['ignore','pipe','ignore']});
    return info.match(/"CFBundleIdentifier"="([^"]+)"/)?.[1]||null;
  }catch{
    return null;
  }
}

function applyMacLockScreenSkip({env=process.env,variable,platform=process.platform,run=execFileSync}={}){
  if(env[variable]==='1')return {skip:true,reason:'explicit',bundleId:null};
  const bundleId=frontmostBundleId({platform,run});
  const skip=platform==='darwin'&&bundleId==='com.apple.loginwindow';
  if(skip)env[variable]='1';
  return {skip,reason:skip?'macos-lock-screen':'unlocked-or-unknown',bundleId};
}

module.exports={applyMacLockScreenSkip,frontmostBundleId};
