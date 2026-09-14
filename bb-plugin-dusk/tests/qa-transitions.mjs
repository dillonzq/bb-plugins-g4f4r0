import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const context = await browser.newContext({viewport:{width:1440,height:960},colorScheme:'dark'});
  await context.route('**/api/v1/plugins/dusk/rpc/get', async route => {
    await new Promise(r=>setTimeout(r,1200));
    await route.fulfill({json:{ok:true,result:{image:null}}});
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:38886');
  await page.locator('.dusk-wallpaper[data-ready]').waitFor();
  await page.waitForTimeout(1100);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForTimeout(150);
  const before = await page.locator('.dusk-wallpaper').evaluate(c=>c.toDataURL());
  await page.setViewportSize({width:1150,height:750});
  await page.waitForTimeout(250);
  await page.setViewportSize({width:1440,height:960});
  await page.waitForTimeout(250);
  const after = await page.locator('.dusk-wallpaper').evaluate(c=>c.toDataURL());
  assert.equal(after,before,'Resizing must retain the current ambient phase');
  const layers = await page.locator('.dusk-wallpaper, .dusk-shield, .dusk-composer-shadow').evaluateAll(nodes=>nodes.map(n=>({opacity:getComputedStyle(n).opacity,transition:getComputedStyle(n).transitionDuration})));
  assert(layers.every(l=>l.opacity==='1' && l.transition==='0s'),'All background layers respect reduced motion');
  await page.emulateMedia({reducedMotion:'no-preference'});
  const durations=await page.locator('.dusk-wallpaper').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).transitionDuration));
  assert(durations.every(d=>d==='0.24s'),'Only wallpaper fades');
  assert((await page.locator('.dusk-shield, .dusk-composer-shadow').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).transitionDuration))).every(d=>d==='0s'),'Bottom overlay and composer protection must never fade');
  await context.close();
  console.log('PASS ambient phase survives resize; synchronized layer fades; reduced motion');
} finally {await browser.close();}
