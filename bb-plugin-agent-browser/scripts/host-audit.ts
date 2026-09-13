import {experimental_createHostEntryHarness} from '@get-bb/plugin-sdk/testing/host';
import entry from '../host';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
const root=join(homedir(),'.bb/plugins/agent-browser/host-data');
const h=experimental_createHostEntryHarness(entry,{experimental_paths:{dataDir:root,tempDir:'/tmp'}});
const rows:any[]=[];
function check(name:string,ok:boolean,details:any={}){rows.push({name,pass:ok,...details});console.log(JSON.stringify(rows.at(-1)));if(!ok)throw Error(name);}
async function wait(j:any){const end=Date.now()+30000;while(j.status==='running'){if(Date.now()>end)throw Error('Job timeout');await new Promise(r=>setTimeout(r,50));j=await h.experimental_call('job',{id:j.id});}return j;}
try {
 for(let cycle=0;cycle<3;cycle++){
  const id=`ab-audit-${randomUUID().slice(0,8)}`;
  let j=await wait(await h.experimental_call('connect',{id,mode:'managed',url:'about:blank',expiresAt:Date.now()+60000}));check(`cycle ${cycle+1}: real host connects`,j.status==='succeeded',{error:j.error});
  j=await wait(await h.experimental_call('submit',{id,operation:{kind:'command',args:['set','viewport','390','600']}}));check(`cycle ${cycle+1}: viewport resize`,j.status==='succeeded');
  const frame=await h.experimental_call('frame',{id});check(`cycle ${cycle+1}: viewer dimensions match resized browser`,frame.width===390&&frame.height===600&&frame.data.length>100,{width:frame.width,height:frame.height});
  if(cycle===0)await writeFile('validation/artifacts/managed/resized-viewer.jpg',Buffer.from(frame.data,'base64'));
  j=await wait(await h.experimental_call('submit',{id,operation:{kind:'command',args:['eval',"document.body.innerHTML='<button style=\"position:fixed;left:150px;top:280px;width:100px;height:40px\" onclick=\"window.auditClicks++\">Click</button><div style=\"height:3000px\"></div>';window.auditClicks=0;true"]}}));check(`cycle ${cycle+1}: fixture`,j.status==='succeeded');
  await wait(await h.experimental_call('input',{id,input:{kind:'click',x:195,y:300}}));
  j=await wait(await h.experimental_call('submit',{id,operation:{kind:'command',args:['eval',"(()=>{if(window.auditClicks!==1)throw Error('Missed or repeated click');return true})()"]}}));check(`cycle ${cycle+1}: resized viewer click lands exactly once`,j.status==='succeeded');
  await wait(await h.experimental_call('input',{id,input:{kind:'scroll',deltaY:400}}));await new Promise(r=>setTimeout(r,150));
  j=await wait(await h.experimental_call('submit',{id,operation:{kind:'command',args:['eval',"(()=>{if(scrollY===0)throw Error('Scroll missed viewport');return true})()"]}}));check(`cycle ${cycle+1}: resized viewer scroll works`,j.status==='succeeded');
  j=await h.experimental_call('submit',{id,operation:{kind:'command',args:['wait','10000']}});check(`cycle ${cycle+1}: long job running`,j.status==='running');
  await h.experimental_call('cancel',{id:j.id});j=await wait(j);check(`cycle ${cycle+1}: job cancels`,j.status==='cancelled');
  const deadline=Date.now()+8000;while(h.experimental_getRetainedWorkerLeaseCount()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  check(`cycle ${cycle+1}: cancellation releases worker leases without explicit close`,h.experimental_getRetainedWorkerLeaseCount()===0);
  check(`cycle ${cycle+1}: cancelled session released`,(await h.experimental_call('inspect',{id})).status==='released');
  const closingId=`ab-close-${randomUUID().slice(0,8)}`;
  j=await wait(await h.experimental_call('connect',{id:closingId,mode:'managed',url:'about:blank',expiresAt:Date.now()+60000}));
  check(`cycle ${cycle+1}: close fixture connects`,j.status==='succeeded');
  j=await h.experimental_call('submit',{id:closingId,operation:{kind:'sequence',steps:[{kind:'gesture',strokes:[Array.from({length:100},(_,i)=>({x:i,y:20}))],intervalMs:30}]}});
  check(`cycle ${cycle+1}: close fixture job running`,j.status==='running');
  const closeStarted=performance.now();
  await Promise.all(Array.from({length:5},()=>h.experimental_call('release',{id:closingId})));
  const closeMs=Math.round(performance.now()-closeStarted);
  check(`cycle ${cycle+1}: active-job close avoids fallback timeout`,closeMs<1500,{closeMs});
  check(`cycle ${cycle+1}: concurrent active-job close releases all leases`,h.experimental_getRetainedWorkerLeaseCount()===0);

 }
}finally{await h.experimental_dispose();await writeFile(process.env.BROWSE_AUDIT_OUTPUT ?? 'validation/host-audit.json',JSON.stringify(rows,null,2)+'\n');}
