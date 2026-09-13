import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const context=await browser.newContext({viewport:{width:process.env.QA_MOBILE?390:1440,height:process.env.QA_MOBILE?844:960},isMobile:!!process.env.QA_MOBILE,hasTouch:!!process.env.QA_MOBILE,colorScheme:'dark'});
 await context.addInitScript(()=>{
  window.qaFrames=[];
  const observe=()=>{
   const s=document.querySelector('[data-promptbox-shell]:has(#root-compose-prompt)'),h=s?.closest('[class~="@container/page"]')?.parentElement,c=document.querySelector('.silk-wallpaper');
   if(s&&h){const a=s.getBoundingClientRect(),b=h.getBoundingClientRect();window.qaFrames.push({dy:Math.abs((a.top+a.bottom-b.top-b.bottom)/2),ready:c?.hasAttribute('data-ready'),alpha:c?.hasAttribute('data-ready')?c.getContext('2d').getImageData(0,0,1,1).data[3]:null});}
   requestAnimationFrame(observe);
  };requestAnimationFrame(observe);
 });
 const page=await context.newPage();
 await context.route('**/api/v1/plugins/silk/rpc/get',async route=>{const response=await route.fetch();await new Promise(r=>setTimeout(r,1800));await route.fulfill({response});});
 await page.goto('http://127.0.0.1:38886');await page.locator('.silk-wallpaper[data-ready]').waitFor();
 await page.waitForTimeout(200);
 const load=await page.evaluate(()=>({frames:qaFrames.length,maxCenterError:Math.max(...qaFrames.map(f=>f.dy)),blankReadyFrames:qaFrames.filter(f=>f.ready&&f.alpha"'!==255).length}));
 console.log('"'loading',load);assert(load.maxCenterError<12);assert.equal(load.blankReadyFrames,0);
 await page.evaluate(()=>qaFrames=[]);
 for(let i=0;i<28;i++)await page.setViewportSize({width:1440-i*25,height:960-i*13});
 for(let i=27;i>=0;i--)await page.setViewportSize({width:1440-i*25,height:960-i*13});
 await page.waitForTimeout(300);
 const resize=await page.evaluate(()=>({frames:qaFrames.length,maxCenterError:Math.max(...qaFrames.map(f=>f.dy)),blankReadyFrames:qaFrames.filter(f=>f.ready&&f.alpha"'!==255).length}));
 console.log('"'continuous resize',resize);assert(resize.maxCenterError<12);assert.equal(resize.blankReadyFrames,0);
 await context.close();
}finally{await browser.close();}
