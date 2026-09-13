import { deepQuerySource } from "./observe";
/** Page-context fetch respects authentication and CORS; reads at most the advertised bound. */
export function downloadExpression(selector: string, href?: string) {
  return `(async()=>{${deepQuerySource}
 let url;
 ${href === undefined ? `const matches=deepQuery(${JSON.stringify(selector)});if(matches.length!==1)throw new Error('Download selector must identify one link; found '+matches.length);const e=matches[0];if(!e.hasAttribute('href'))throw new Error('Direct downloads require a link with href; native button downloads are blocked by BB');url=new URL(e.getAttribute('href'),e.baseURI);` : `url=new URL(${JSON.stringify(href)},document.baseURI);`}
 if(!['http:','https:','blob:','data:'].includes(url.protocol))throw new Error('Unsupported download URL');
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),30000);
 try{const r=await fetch(url,{credentials:'include',signal:abort.signal});if(!r.ok)throw new Error('Download failed: HTTP '+r.status);const stream=r.body?.getReader();if(!stream)throw new Error('Download body unavailable');const limit=16*1024*1024;if(Number(r.headers.get('content-length'))>limit){await stream.cancel();throw new Error('Direct link downloads are limited to 16 MB');}const chunks=[];let size=0;for(;;){const part=await stream.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await stream.cancel();throw new Error('Direct link downloads are limited to 16 MB');}chunks.push(part.value);}const blob=new Blob(chunks,{type:r.headers.get('content-type')||'application/octet-stream'});return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Cannot read downloaded file'));reader.readAsDataURL(blob);});}finally{clearTimeout(timer)}})()`;
}
