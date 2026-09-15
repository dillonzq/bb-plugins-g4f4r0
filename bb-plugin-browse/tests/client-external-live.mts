// Opt-in smoke test against the deployed viewer in isolated Chrome.
import {launchManaged} from '../src/managed';
import {Cdp} from '../src/cdp';
import {promises as fs} from 'node:fs';
const root=process.argv[2], sessionId=process.argv[3];if(!root||!sessionId)throw Error('host-data path and a released session ID required');
const browser=await launchManaged(root,`ab-linkcheck-${Date.now()}`,AbortSignal.timeout(30000));let cdp:Cdp|undefined;
try {
 const targets=await(await fetch(`http://${new URL(browser.endpoint).host}/json/list`)).json() as any[];
 cdp=await Cdp.connect(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await cdp.send('Page.navigate',{url:'http://127.0.0.1:38886/api/v1/plugins/browse/http/viewer?id='+encodeURIComponent(sessionId)});
 let result:any;
 for(let i=0;i<50;i++){
  result=await cdp.send('Runtime.evaluate',{expression:`(()=>{const b=document.querySelector('#open-external');if(!b||!b.onclick)return null;currentUrl='https://jackfir.com/';window.bbDesktop={openExternalUrl:url=>window.externalTest=url};b.click();const r=b.getBoundingClientRect();return {url:window.externalTest,label:b.getAttribute('aria-label'),width:r.width,height:r.height,icons:b.querySelector('svg')?.dataset.iconLibrary};})()`,returnByValue:true});
  if(result.result.value)break;await new Promise(r=>setTimeout(r,100));
 }
 const value=result.result.value;
 if(value?.url!=='https://jackfir.com/'||value?.width!==28||value?.height!==28||value?.icons!=='hugeicons')throw Error(JSON.stringify(result));
 console.log(JSON.stringify(value));
} finally {cdp?.close();await browser.close();await fs.rm(browser.profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
