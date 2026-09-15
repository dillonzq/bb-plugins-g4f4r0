import {it,expect,vi} from 'vitest';import {JSDOM} from 'jsdom';import {viewerHtml} from '../src/viewer';
it('paints the freshest decoded frame and closes every replaced bitmap',async()=>{
 const dom=new JSDOM('<div id="viewport-skeleton"></div><canvas id="screen"></canvas><span id="resolution"></span>',{runScripts:'outside-only',pretendToBeVisual:true});
 const callbacks:Array<()=>void>=[],draw=vi.fn(),bitmaps=[1,2,3].map(n=>({width:1280,height:800,n,close:vi.fn()}));
 const acks=[vi.fn(),vi.fn(),vi.fn()];let finishFirst:(v:unknown)=>void=()=>{};
 const first=new Promise(r=>finishFirst=r);
 (dom.window as any).createImageBitmap=vi.fn().mockImplementationOnce(()=>first).mockResolvedValue(bitmaps[2]);
 dom.window.requestAnimationFrame=(cb:any)=>{callbacks.push(cb);return callbacks.length;};
 (dom.window.document.querySelector('canvas') as any).getContext=()=>({drawImage:draw});
 const code=viewerHtml.slice(viewerHtml.indexOf('let statusErrorUntil=0,'),viewerHtml.indexOf('function show(frame)'));
 dom.window.eval(`const screen=document.querySelector('canvas'),metrics={bytes:0,dropped:0,displayed:0},status={textContent:''},address={value:''};let closed=false,inViewport=true,vw=1280,vh=800,lastFrame=0,seq=0,pageLoading=false,currentUrl='',acting=false;function fit(){}function renderCopy(){};${code};window.accept=acceptFrame;window.metrics=metrics;`);
 try{
  const accept=(dom.window as any).accept;
  accept({size:1},{seq:1,width:1280,height:800},acks[0]);
  accept({size:1},{seq:2,width:1280,height:800},acks[1]);
  accept({size:1},{seq:3,width:1280,height:800},acks[2]);
  expect(acks[1]).toHaveBeenCalledOnce();
  finishFirst(bitmaps[0]);await new Promise(r=>setTimeout(r,0));
  expect(bitmaps[0].close).toHaveBeenCalledOnce();expect(callbacks).toHaveLength(1);
  expect((dom.window.document.querySelector("#viewport-skeleton") as HTMLElement).hidden).toBe(false);
  callbacks[0]();expect((dom.window.document.querySelector("#viewport-skeleton") as HTMLElement).hidden).toBe(true);expect(draw).toHaveBeenCalledWith(bitmaps[2],0,0,1280,800);
  expect(bitmaps[2].close).toHaveBeenCalledOnce();for(const ack of acks)expect(ack).toHaveBeenCalledOnce();
  expect((dom.window as any).metrics).toMatchObject({displayed:1,dropped:2});
 }finally{dom.window.close();}
});
