import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'dark'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:38886');
 await page.locator('.silk-thread-meta time').first().waitFor();
 const rows=page.locator('[data-silk-thread-row]');assert(await rows.count()>0);
 const info=await rows.evaluateAll(ns=>ns.map(n=>{const title=n.querySelector('.bb-thread-title').getBoundingClientRect(),meta=n.querySelector('.silk-thread-meta').getBoundingClientRect(),r=n.getBoundingClientRect();return {topGap:title.top-r.top,bottomGap:r.bottom-meta.bottom,titleBottom:title.bottom,metaTop:meta.top,metaBottom:meta.bottom,rowBottom:r.bottom,count:n.querySelectorAll('.silk-thread-meta').length};}));
 for(const r of info){assert.equal(r.topGap,6,'Title has 6px top inset');assert.equal(r.bottomGap,6,'Metadata has 6px bottom inset');assert(r.metaTop>=r.titleBottom);assert(r.metaBottom<=r.rowBottom);assert.equal(r.count,1)}
 // BB replaces className when selection/read state changes. Track every frame.
 await page.evaluate(() => {
   window.rowHeights = []; window.sampleRows = true;
   const sample = () => { if (!window.sampleRows) return;
     document.querySelectorAll('[data-silk-thread-row]').forEach(n => window.rowHeights.push(n.getBoundingClientRect().height));
     requestAnimationFrame(sample);
   }; requestAnimationFrame(sample);
 });
 const links = page.locator('[data-silk-thread-row] > a[data-sidebar-thread-id]');
 await links.nth(0).click(); await page.waitForTimeout(200);
 await links.nth(1).click(); await page.waitForTimeout(200);
 const heights = await page.evaluate(() => { window.sampleRows = false; return window.rowHeights; });
 assert(heights.length > 0 && heights.every(h => h === 48), 'Selection must never collapse the two-line rows');
 const calls=[];
 await page.route(/\/api\/v1\/threads\/[^/]+\/(?:unpin|pin)$/,async route=>{calls.push(route.request().url());await route.fulfill({status:500,json:{error:'QA: simulated failure; no pin changed'}})});
 for(const label of ['Pin thread','Unpin thread']){
  const button=page.getByRole('button',{name:label,exact:true}).first();assert(await button.count());
  const row=button.locator('xpath=ancestor::*[@data-silk-thread-row]');
  await row.hover();const before=page.url();
  const geo=await row.evaluate(n=>{const pin=n.querySelector('.silk-pin-slot button').getBoundingClientRect(),archive=n.querySelector('button[aria-label="Archive thread"]').getBoundingClientRect(),title=n.querySelector('.bb-thread-title').getBoundingClientRect();return {pinRight:pin.right,archiveLeft:archive.left,pinWidth:pin.width,archiveWidth:archive.width,titleRight:title.right,pinLeft:pin.left,titleMask:getComputedStyle(n.querySelector('.bb-thread-title')).maskImage}});
  assert(geo.pinRight<=geo.archiveLeft);assert.equal(geo.pinWidth,geo.archiveWidth);assert(geo.titleMask.includes('linear-gradient'),'Title must fade behind the action area');
  await button.click();await page.waitForTimeout(700);assert.equal(page.url(),before,'Pin must not navigate');
 }
 assert(calls.some(x=>x.endsWith('/pin')));assert(calls.some(x=>x.endsWith('/unpin')));
 await page.setViewportSize({width:900,height:800});await page.waitForTimeout(250);
 assert(await page.locator('.silk-thread-meta').count()>0);
 await page.screenshot({path:'/tmp/silk-sidebar-details-hover.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS real sidebar metadata, no title overlap, native pin/unpin routing with failure rollback, action order/size, no navigation, responsive rendering');
}finally{await browser.close()}
