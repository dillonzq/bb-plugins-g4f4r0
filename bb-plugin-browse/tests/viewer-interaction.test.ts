import {it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {viewerTrace} from '../src/viewer-trace';
import {viewerInteraction} from '../src/viewer-interaction';
function viewer(){
 const dom=new JSDOM('<canvas id="screen"></canvas>',{url:'http://localhost/viewer?id=test',runScripts:'outside-only',pretendToBeVisual:true});
 dom.window.eval(`${viewerTrace}
 let closed=false,inViewport=true,statusErrorUntil=0,cast=null,pendingFrame=null,decodedFrame=null;
 const id='test',screen=document.querySelector('#screen'),status={textContent:''},metrics={inputLatencyMs:0,maxInputQueue:0};
 const vh=800;function point(){return{x:0,y:0}}function openCast(){}
 class Socket {static OPEN=1;readyState=1;sent=[];constructor(){queueMicrotask(()=>this.onopen?.());}send(v){this.sent.push(JSON.parse(v));}close(){this.readyState=3;this.onclose?.();}}
 window.WebSocket=Socket;
 ${viewerInteraction}
 window.test={keyboard,screen,directQueue,flushDirect,get control(){return control},ack(){control.onmessage({data:JSON.stringify({seq:inflight.keys().next().value})})}};
 `);
 return {dom,test:(dom.window as any).test};
}
it('splits paste bursts below the server message limit without losing order',()=>{
 const {dom,test}=viewer();
 try{
  for(let i=0;i<10;i++)test.directQueue.push({kind:'text',text:String(i).repeat(10000)});
  test.flushDirect();expect(test.control.sent).toHaveLength(1);
  expect(JSON.stringify(test.control.sent[0]).length).toBeLessThan(65536);
  test.ack();expect(test.control.sent).toHaveLength(2);
  expect(test.control.sent.flatMap((m:any)=>m.events).map((e:any)=>e.text[0])).toEqual(['0','1','2','3','4','5','6','7','8','9']);
 }finally{dom.window.close();}
});
it('treats AltGraph characters as text keys rather than clipboard shortcuts',()=>{
 const {dom,test}=viewer();
 try{
  const event=new dom.window.KeyboardEvent('keydown',{key:'c',code:'KeyC',ctrlKey:true,altKey:true,cancelable:true});
  Object.defineProperty(event,'getModifierState',{value:(key:string)=>key==='AltGraph'});
  test.keyboard.dispatchEvent(event);test.flushDirect();
  expect(test.control.sent[0].events).toEqual([{kind:'keyboard',type:'down',key:'c',code:'KeyC',modifiers:0,repeat:false}]);
 }finally{dom.window.close();}
});
it('commits IME text once when compositionend is followed by beforeinput',()=>{
 const {dom,test}=viewer();
 try{
  test.keyboard.dispatchEvent(new dom.window.CompositionEvent('compositionstart'));
  test.keyboard.dispatchEvent(new dom.window.CompositionEvent('compositionend',{data:'語'}));
  test.keyboard.dispatchEvent(new dom.window.InputEvent('beforeinput',{inputType:'insertText',data:'語',cancelable:true}));
  test.flushDirect();expect(test.control.sent[0].events).toEqual([{kind:'text',text:'語'}]);
 }finally{dom.window.close();}
});

it('pipelines bounded input batches instead of waiting for every round trip',()=>{
 const {dom,test}=viewer();
 try{
  for(let i=0;i<5;i++){test.directQueue.push({kind:'wheel',x:0,y:0,deltaX:0,deltaY:i,modifiers:0});test.flushDirect();}
  expect(test.control.sent).toHaveLength(3);
  expect(test.directQueue).toHaveLength(2);
  test.ack();expect(test.control.sent).toHaveLength(4);
  expect(test.control.sent.flatMap((m:any)=>m.events).map((e:any)=>e.deltaY)).toEqual([0,1,2,3,4]);
  test.control.close();expect(test.directQueue).toHaveLength(0);
 }finally{dom.window.close();}
});
