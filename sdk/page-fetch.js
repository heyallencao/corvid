// Serialized and executed in the addressed document; no Node globals are available.
export async function fetchInDocument(input) {
  const controller=new AbortController();let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},input.timeout);
  try {
    const response=await window.fetch(input.url,{...input.request,signal:controller.signal});
    const headers={};for(const [name,value] of response.headers)headers[name]=value;
    const chunks=[];let total=0;const reader=response.body?.getReader();
    if(reader)for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>input.limit){await reader.cancel();return {error:`Response exceeds ${input.limit} byte limit`};}chunks.push(part.value);}
    const bytes=new Uint8Array(total);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.byteLength;}
    const metadata={ok:response.ok,status:response.status,statusText:response.statusText,url:response.url,headers};
    if(!input.binary)return {...metadata,body:new TextDecoder().decode(bytes)};
    let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return {...metadata,bodyBase64:btoa(binary)};
  } catch(error) {return {error:timedOut?`page.fetch timed out after ${input.timeout}ms`:String(error?.message ?? error)};}
  finally {clearTimeout(timer);}
}
