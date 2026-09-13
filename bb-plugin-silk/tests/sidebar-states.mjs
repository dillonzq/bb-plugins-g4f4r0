import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 await page.goto('http://127.0.0.1:38886');
 await page.locator('.silk-customize').waitFor();
 const labels=['Thread working','Thread needs user input','Unread thread failed','Unread thread succeeded','Thread has a message waiting to send','Thread has unsubmitted draft','Thread working with unsubmitted draft','Plan mode active','Goal active','Workflow running','Background agent running','Background command running','Queued message failed to send'];
 await page.evaluate(labels=>{
  const f=document.createElement('section');f.id='qa-states';f.dataset.sidebar='sidebar';f.style.cssText='position:fixed;inset:30px;z-index:99999;background:var(--sidebar);padding:24px;color:var(--foreground)';
  labels.forEach(label=>{
   const row=document.createElement('div');row.style.cssText='height:46px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-radius:7px';
   const draft=label.includes('draft');
   const link=document.createElement('a');link.dataset.sidebarThreadId='qa-'+label;link.setAttribute('aria-label','Open Preview'+(draft?' (unsubmitted draft)':''));link.textContent=label;
   const slot=document.createElement('span');slot.dataset.sidebarThreadTrailingIndicator='';slot.style.cssText='display:flex;align-items:center;justify-content:center;width:20px;height:20px';
   const glyph=document.createElement('span');glyph.setAttribute('aria-label',label);glyph.textContent='●';slot.append(glyph);row.append(link,slot);f.append(row);
  });document.body.append(f);
 },labels);
 for(const scheme of ['dark','light']){
  await page.emulateMedia({colorScheme:scheme});await page.waitForTimeout(150);
  const actual=await page.locator('#qa-states [data-sidebar-thread-trailing-indicator]').evaluateAll(slots=>slots.map(slot=>{const native=slot.firstElementChild,p=getComputedStyle(slot,'::after'),n=getComputedStyle(native);return {label:native.getAttribute('aria-label'),width:p.width,height:p.height,mask:p.maskImage,content:p.content,opacity:n.opacity,animation:n.animationName,tint:getComputedStyle(slot.parentElement).backgroundImage};}));
  actual.forEach((s,i)=>{
   assert.equal(s.label,labels[i]);assert.equal(s.opacity,'0');assert.equal(s.animation,'none');
   if(s.label==='Thread has unsubmitted draft')assert.equal(s.content,'none');
   else {const solid=['Unread thread failed','Unread thread succeeded','Queued message failed to send'].includes(s.label);assert.equal(s.width,solid?'8px':'10px');assert.equal(s.height,s.width);if("'!solid)assert(s.mask.includes('"'svg'));}
   if(s.label.includes('draft'))assert(s.tint.includes('linear-gradient'));
  });
 }
 await page.screenshot({path:'/tmp/silk-sidebar-states-light.png'});
 await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(150);
 await page.screenshot({path:'/tmp/silk-sidebar-states-dark.png'});
 await page.locator('#qa-states').evaluate(n=>n.remove());
 console.log('PASS sidebar states: all native labels preserved, static artwork, ring/solid sizing, draft tint, light/dark');
}finally{await browser.close();}
