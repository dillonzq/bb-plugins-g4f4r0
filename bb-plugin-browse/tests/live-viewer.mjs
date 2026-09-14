// Opt-in integration check against two disposable Browse sessions on this host.
// node tests/live-viewer.mjs <fixture-profile-id> <viewer-profile-id-or-CDP-port> [soak-seconds]
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const [sourceProfile,viewerProfile,soakArg='60']=process.argv.slice(2);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(profile,kind){
 assert.match(profile??'',/^(ab-[a-f0-9-]+|[0-9]{1,5})$/);
 const port=/^[0-9]+$/.test(profile)?profile:(await fs.readFile(`${process.env.HOME}/.bb/plugins/browse/host-data/profiles/${profile}/DevToolsActivePort`,'utf8')).split('\n')[0];
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const target=targets.find(t=>t.type==='page'&&(kind==='fixture'?t.url==='http://127.0.0.1:39114/':t.url.startsWith('http://127.0.0.1:38886/api/v1/plugins/browse/http/viewer?')));
 assert.ok(target,`Missing disposable ${kind} page`);
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
 let seq=0;const pending=new Map();ws.on('message',raw=>{const m=JSON.parse(String(raw)),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timed out: ${method}`));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 return {ws,send,evaluate};
}
const source=await connect(sourceProfile,'fixture'),viewer=await connect(viewerProfile,'viewer');
const out=(test,result)=>console.log(JSON.stringify({at:new Date().toISOString(),test,...result}));
const evaluate=viewer.evaluate;
const settle=()=>evaluate(`(async()=>{const start=Date.now();while(inflight||directQueue.length||sendScheduled){if(Date.now()-start>12000)throw Error('Input did not settle');await new Promise(r=>setTimeout(r,20));}return true;})()`);
async function pointer(type,x,y,buttons=0){await evaluate(`(()=>{const r=screen.getBoundingClientRect();screen.dispatchEvent(new PointerEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,isPrimary:true,pointerId:1,pointerType:'mouse',button:0,buttons:${buttons},clientX:r.left+${x}*r.width/vw,clientY:r.top+${y}*r.height/vh}));})()`);}
async function click(selector){const p=await source.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await pointer('pointerdown',p.x,p.y,1);await pointer('pointerup',p.x,p.y);await settle();}
async function key(key,code,modifiers={}){await evaluate(`(()=>{for(const type of ['keydown','keyup'])keyboard.dispatchEvent(new KeyboardEvent(type,{key:${JSON.stringify(key)},code:${JSON.stringify(code)},bubbles:true,cancelable:true,...${JSON.stringify(modifiers)}}));})()`);await settle();}
try{
 await source.send('Page.navigate',{url:'http://127.0.0.1:39114/'});await sleep(500);
 await viewer.send('Page.bringToFront');
 await evaluate(`(async()=>{const start=Date.now();while(!screen.dataset.frame||control?.readyState!==WebSocket.OPEN){if(Date.now()-start>12000)throw Error('Viewer not connected');await new Promise(r=>setTimeout(r,30));}})()`);
 // Synthetic events exercise viewer handlers and transport, not OS pointer capture.
 // Native capture is checked separately with real browser gestures.
 await evaluate(`screen.setPointerCapture=()=>{};screen.hasPointerCapture=()=>false;`);
 await source.evaluate(`window.testKeyUps=[];document.addEventListener('keyup',e=>testKeyUps.push(e.key));window.testKeys=[];document.addEventListener('keydown',e=>testKeys.push(e.key));document.body.insertAdjacentHTML('beforeend','<textarea id="multiline" style="position:fixed;right:10px;top:400px"></textarea>');`);
 await click('#edit');await key('a','KeyA');await key('b','KeyB');
 assert.equal(await source.evaluate('document.querySelector("#edit").value'),'ab');
 assert.deepEqual(await source.evaluate('testKeys.slice(-2)'),['a','b']);out('ordinary-key-events',{pass:true});
 await key('a','KeyA',{ctrlKey:true});
 const copied=await evaluate(`(()=>{const d=new DataTransfer();keyboard.dispatchEvent(new ClipboardEvent('copy',{clipboardData:d,cancelable:true}));return d.getData('text/plain')})()`);
 assert.equal(copied,'ab');
 await evaluate(`(()=>{const d=new DataTransfer();keyboard.dispatchEvent(new ClipboardEvent('cut',{clipboardData:d,cancelable:true}));})()`);await settle();
 assert.equal(await source.evaluate('document.querySelector("#edit").value'),'');
 await evaluate(`(()=>{const d=new DataTransfer();d.setData('text/plain','Paste ✓');keyboard.dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,cancelable:true}));})()`);await settle();
 assert.equal(await source.evaluate('document.querySelector("#edit").value'),'Paste ✓');out('copy-cut-unicode-paste',{pass:true,scope:'DOM clipboard events; not operating-system clipboard permissions'});
 await evaluate(`keyboard.dispatchEvent(new CompositionEvent('compositionstart'));keyboard.dispatchEvent(new CompositionEvent('compositionend',{data:'語'}));keyboard.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:'語',cancelable:true}));`);await settle();
 assert.equal(await source.evaluate('document.querySelector("#edit").value'),'Paste ✓語');out('composition-commit-once',{pass:true});
 await click('#multiline');await key('x','KeyX');await key('Enter','Enter');await key('y','KeyY');
 assert.equal(await source.evaluate('document.querySelector("#multiline").value'),'x\ny');out('multiline-enter',{pass:true});
 await click('#edit');await evaluate(`keyboard.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',code:'ControlLeft',ctrlKey:true,cancelable:true}));`);await settle();
 await sleep(6200);assert.equal(await source.evaluate("testKeyUps.filter(k=>k==='Control').length"),0);await key('a','KeyA',{ctrlKey:true});
 await evaluate(`keyboard.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',code:'ControlLeft',cancelable:true}));`);await settle();out('long-held-modifier',{pass:true});
 await pointer('pointerdown',740,240,1);await settle();
 assert.equal(await source.evaluate('drag'),true);
 await evaluate('control.close()');await sleep(800);
 assert.equal(await source.evaluate('drag'),false);out('disconnect-releases-pointer',{pass:true});
 await sleep(300);await click('#edit');await key('z','KeyZ');out('reconnected-input',{pass:true});
 const before=await evaluate('({...browseMetrics,at:performance.now()})');
 const seconds=Math.max(10,Math.min(3600,Number(soakArg)||60));
 for(let elapsed=0;elapsed<seconds;elapsed+=10){await sleep(10000);const m=await evaluate('({...browseMetrics,at:performance.now(),heap:performance.memory?.usedJSHeapSize,canvasPixels:screen.width*screen.height})');out('soak-sample',{elapsed:elapsed+10,metrics:m});}
 const after=await evaluate('({...browseMetrics,at:performance.now()})');
 out('display-rate',{seconds:(after.at-before.at)/1000,fps:(after.displayed-before.displayed)*1000/(after.at-before.at),mbps:(after.bytes-before.bytes)*8/(after.at-before.at)/1000,dropped:after.dropped-before.dropped,maxInputQueue:after.maxInputQueue});
 await evaluate(`viewport.style.display='none'`);await sleep(500);
 assert.deepEqual(await evaluate('({visible:inViewport,cast:cast?.readyState??null,control:control?.readyState??null})'),{visible:false,cast:null,control:null});
 const stopped=await evaluate('browseMetrics.displayed');await sleep(14000);
 assert.equal(await evaluate('browseMetrics.displayed'),stopped);out('hidden-panel-stops-stream',{pass:true});
 await evaluate(`viewport.style.display=''`);await sleep(1000);
 assert.ok(await evaluate('inViewport&&cast?.readyState===WebSocket.OPEN&&control?.readyState===WebSocket.OPEN'));
 assert.ok(await evaluate(`browseMetrics.displayed>${stopped}`));out('visible-panel-resumes',{pass:true});
}finally{source.ws.close();viewer.ws.close();}
