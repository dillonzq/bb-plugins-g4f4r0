import {it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {viewerTrace} from '../src/viewer-trace';
import {viewerInteraction} from '../src/viewer-interaction';
function viewer(){
 const dom=new JSDOM('<main id="viewport"><canvas id="screen"></canvas><button id="control-toggle"><span data-kind="cursor"></span><span data-kind="loading" hidden></span><span>Take control</span></button></main><input id="url"><button id="back"></button><button id="forward"></button><button id="reload"></button>',{url:'http://localhost/viewer?id=test',runScripts:'outside-only',pretendToBeVisual:true});
 dom.window.eval(`${viewerTrace}
 let closed=false,inViewport=true,statusErrorUntil=0,cast=null,pendingFrame=null,decodedFrame=null;
 const id='test',clientId='test-client',screen=document.querySelector('#screen'),viewport=document.querySelector('#viewport'),address=document.querySelector('#url'),status={textContent:''},metrics={inputLatencyMs:0,maxInputQueue:0};
 const vh=800;function point(){return{x:0,y:0}}function openCast(){}
 class Socket {static OPEN=1;static urls=[];readyState=1;sent=[];constructor(url){Socket.urls.push(url);queueMicrotask(()=>this.onopen?.());}send(v){this.sent.push(JSON.parse(v));}close(){this.readyState=3;this.onclose?.();}}
 window.WebSocket=Socket;
 ${viewerInteraction}
 window.test={keyboard,screen,directQueue,flushDirect,socketUrls:Socket.urls,request(action,options){withHumanControl(action,options);},grant(){control.onopen();control.onmessage({data:JSON.stringify({type:'control',state:'human'})});},take(){controlToggle.click();this.grant();control.sent.length=0;},get control(){return control},ack(){control.onmessage({data:JSON.stringify({seq:inflight.keys().next().value})})}};
 `);
 return {dom,test:(dom.window as any).test};
}
it('stays view-only until control is explicitly taken and releases on disconnect',()=>{
 const {dom,test}=viewer();
 try{
  expect(test.control).toBeNull();
  test.take();expect(test.control).not.toBeNull();
  test.control.close();
  expect(test.control).toBeNull();
  expect(dom.window.document.querySelector('#viewport')?.getAttribute('data-control')).toBe('agent');
 }finally{dom.window.close();}
});
it('uses the viewer identity for both control and toolbar input',()=>{
 const {dom,test}=viewer();
 try{
  test.take();
  expect(test.socketUrls[0]).toContain('id=test');
  expect(test.socketUrls[0]).toContain('clientId=');
  expect(new URL(test.socketUrls[0]).searchParams.get('clientId')).toBe('test-client');
 }finally{dom.window.close();}
});
it('keeps the takeover label while showing a disabled loading icon',()=>{
 const {dom}=viewer();
 try{
  const button=dom.window.document.querySelector('#control-toggle') as HTMLButtonElement;
  button.click();
  expect(button.disabled).toBe(true);
  expect(button.textContent).toContain('Take control');
  expect((button.querySelector('[data-kind="cursor"]') as HTMLElement).hidden).toBe(true);
  expect((button.querySelector('[data-kind="loading"]') as HTMLElement).hidden).toBe(false);
 }finally{dom.window.close();}
});
it('runs a toolbar action immediately after it acquires human control',()=>{
 const {dom,test}=viewer();let applied=0;
 try{
  test.request(()=>applied++);expect(applied).toBe(0);
  test.grant();expect(applied).toBe(1);
  expect(dom.window.document.querySelector('#viewport')?.getAttribute('data-control')).toBe('human');
 }finally{dom.window.close();}
});
it('acquires control for toolbar actions without showing takeover loading or stealing focus',()=>{
 const {dom,test}=viewer();let applied=0;
 try{
  const button=dom.window.document.querySelector('#control-toggle') as HTMLButtonElement;
  test.request(()=>applied++,{silent:true});
  expect(applied).toBe(0);
  expect(dom.window.document.querySelector('#viewport')?.getAttribute('data-control')).toBe('agent');
  expect(button.disabled).toBe(false);
  expect((button.querySelector('[data-kind="cursor"]') as HTMLElement).hidden).toBe(false);
  expect((button.querySelector('[data-kind="loading"]') as HTMLElement).hidden).toBe(true);
  test.grant();expect(applied).toBe(1);
  expect(dom.window.document.activeElement).not.toBe(test.keyboard);
 }finally{dom.window.close();}
});
it('splits paste bursts below the server message limit without losing order',()=>{
 const {dom,test}=viewer();test.take();
 try{
  for(let i=0;i<10;i++)test.directQueue.push({kind:'text',text:String(i).repeat(10000)});
  test.flushDirect();expect(test.control.sent).toHaveLength(1);
  expect(JSON.stringify(test.control.sent[0]).length).toBeLessThan(65536);
  test.ack();expect(test.control.sent).toHaveLength(2);
  expect(test.control.sent.flatMap((m:any)=>m.events).map((e:any)=>e.text[0])).toEqual(['0','1','2','3','4','5','6','7','8','9']);
 }finally{dom.window.close();}
});
it('treats AltGraph characters as text keys rather than clipboard shortcuts',()=>{
 const {dom,test}=viewer();test.take();
 try{
  const event=new dom.window.KeyboardEvent('keydown',{key:'c',code:'KeyC',ctrlKey:true,altKey:true,cancelable:true});
  Object.defineProperty(event,'getModifierState',{value:(key:string)=>key==='AltGraph'});
  test.keyboard.dispatchEvent(event);test.flushDirect();
  expect(test.control.sent[0].events).toEqual([{kind:'keyboard',type:'down',key:'c',code:'KeyC',modifiers:0,repeat:false}]);
 }finally{dom.window.close();}
});
it('commits IME text once when compositionend is followed by beforeinput',()=>{
 const {dom,test}=viewer();test.take();
 try{
  test.keyboard.dispatchEvent(new dom.window.CompositionEvent('compositionstart'));
  test.keyboard.dispatchEvent(new dom.window.CompositionEvent('compositionend',{data:'語'}));
  test.keyboard.dispatchEvent(new dom.window.InputEvent('beforeinput',{inputType:'insertText',data:'語',cancelable:true}));
  test.flushDirect();expect(test.control.sent[0].events).toEqual([{kind:'text',text:'語'}]);
 }finally{dom.window.close();}
});

it('pipelines bounded input batches instead of waiting for every round trip',()=>{
 const {dom,test}=viewer();test.take();
 try{
  for(let i=0;i<5;i++){test.directQueue.push({kind:'wheel',x:0,y:0,deltaX:0,deltaY:i,modifiers:0});test.flushDirect();}
  expect(test.control.sent).toHaveLength(3);
  expect(test.directQueue).toHaveLength(2);
  test.ack();expect(test.control.sent).toHaveLength(4);
  expect(test.control.sent.flatMap((m:any)=>m.events).map((e:any)=>e.deltaY)).toEqual([0,1,2,3,4]);
  test.control.close();expect(test.directQueue).toHaveLength(0);
 }finally{dom.window.close();}
});
