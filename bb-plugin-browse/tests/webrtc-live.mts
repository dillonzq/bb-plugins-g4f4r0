// Opt-in check of an already running private WebRTC fixture.
import {launchManaged} from '../src/managed';
import {Cdp} from '../src/cdp';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {promises as fs} from 'node:fs';
const root=process.argv[2], url=process.argv[3];
if(!root||!url)throw Error('host-data path and loopback test URL required');
if(new URL(url).hostname!=='127.0.0.1')throw Error('Use the private loopback fixture');
const browser=await launchManaged(root,`ab-rtccheck-${Date.now()}`,AbortSignal.timeout(30000));let cdp:Cdp|undefined;
try {
 const targets=await(await fetch(`http://${new URL(browser.endpoint).host}/json/list`)).json() as any[];
 cdp=await Cdp.connect(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 if(process.argv.includes('--embedded')){const config=JSON.parse(await fs.readFile(join(homedir(),'.cache/browse-stream-bench/embedded.json'),'utf8'));await cdp.send('Network.enable');await cdp.send('Network.setExtraHTTPHeaders',{headers:{authorization:`Bearer ${config.token}`}});}
 await cdp.send('Page.navigate',{url});
 let value:any;
 for(let i=0;i<100;i++){
  value=await cdp.evaluate(`({state:window.testPeer?.connectionState,frame:document.querySelector('#screen')?.dataset.frame,frames:window.browseMetrics?.displayed})`);
  if(value?.frame==='true')break;
  await new Promise(r=>setTimeout(r,200));
 }
 if(value?.state!=='connected'||value?.frame!=='true')throw Error(JSON.stringify(value));
 await cdp.evaluate(`rtcFail('Test connection failure')`);
 if(process.argv.includes('--embedded')){let fallback:any;for(let i=0;i<100;i++){fallback=await cdp.evaluate(`({transport:window.browseMetrics?.transport,label:transportBadge.textContent,frames:window.browseMetrics?.displayed})`);if(fallback.transport?.startsWith('h264')&&fallback.frames>value.frames)break;await new Promise(r=>setTimeout(r,200));}if(!fallback.transport?.startsWith('h264'))throw Error(JSON.stringify(fallback));console.log(JSON.stringify({video:value,fallback}));}else{
 const failure=await cdp.evaluate(`({visible:!document.querySelector('#viewport-skeleton').hidden,text:document.querySelector('#viewport-skeleton').textContent,button:document.querySelector('#viewport-skeleton button')?.textContent})`);
 if(!failure.visible||failure.button!=='Retry'||!failure.text.includes('Test connection failure'))throw Error(JSON.stringify(failure));
 console.log(JSON.stringify({video:value,failure}));}
} finally {cdp?.close();await browser.close();await fs.rm(browser.profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
