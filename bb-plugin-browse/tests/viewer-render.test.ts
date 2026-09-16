import {viewerTrace} from '../src/viewer-trace';
import {it,expect,vi} from 'vitest';import {JSDOM} from 'jsdom';import {viewerHtml} from '../src/viewer';
it('paints the freshest decoded frame and closes every replaced bitmap',async()=>{
 const dom=new JSDOM('<div id="viewport"></div><div id="viewport-skeleton"></div><canvas id="screen"></canvas><span id="resolution"></span>',{runScripts:'outside-only',pretendToBeVisual:true});
 const callbacks:Array<()=>void>=[],draw=vi.fn(),bitmaps=[1,2,3].map(n=>({width:1280,height:800,n,close:vi.fn()}));
 const wide={width:1280,height:800,n:4,close:vi.fn()},mobile={width:412,height:915,n:5,close:vi.fn()};
 const acks=[vi.fn(),vi.fn(),vi.fn(),vi.fn(),vi.fn()];let finishFirst:(v:unknown)=>void=()=>{};
 const first=new Promise(r=>finishFirst=r);
 (dom.window as any).createImageBitmap=vi.fn().mockImplementationOnce(()=>first).mockResolvedValueOnce(bitmaps[2]).mockResolvedValueOnce(wide).mockResolvedValueOnce(mobile);
 dom.window.requestAnimationFrame=(cb:any)=>{callbacks.push(cb);return callbacks.length;};
 (dom.window.document.querySelector('canvas') as any).getContext=()=>({drawImage:draw});
 const code=viewerHtml.slice(viewerHtml.indexOf('let statusErrorUntil=0,'),viewerHtml.indexOf('function show(frame)'));
 dom.window.eval(`${viewerTrace}const screen=document.querySelector('canvas'),metrics={bytes:0,dropped:0,displayed:0},status={textContent:''},address={value:''};let closed=false,inViewport=true,vw=1280,vh=800,lastFrame=0,seq=0,pageLoading=false,currentUrl='',acting=false,responsiveEnabled=false,responsiveWidth=412,responsiveHeight=915;function fit(){}function renderCopy(){};${code};window.accept=acceptFrame;window.metrics=metrics;window.enableResponsive=()=>responsiveEnabled=true;`);
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
  expect(bitmaps[2].close).toHaveBeenCalledOnce();for(const ack of acks.slice(0,3))expect(ack).toHaveBeenCalledOnce();
  expect((dom.window as any).metrics).toMatchObject({displayed:1,dropped:2});
  (dom.window as any).enableResponsive();
  accept({size:1},{seq:4,width:1280,height:800},acks[3]);await new Promise(r=>setTimeout(r,0));callbacks.shift()?.();
  expect(draw).toHaveBeenCalledTimes(1);expect(wide.close).toHaveBeenCalledOnce();expect(acks[3]).toHaveBeenCalledOnce();
  accept({size:1},{seq:5,width:412,height:915},acks[4]);await new Promise(r=>setTimeout(r,0));callbacks.shift()?.();
  expect(draw).toHaveBeenLastCalledWith(mobile,0,0,412,915);expect(mobile.close).toHaveBeenCalledOnce();expect(acks[4]).toHaveBeenCalledOnce();
 }finally{dom.window.close();}
});
