import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const out='/tmp/silk-qa';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
 for(const mobile of [false,true]) {
 const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:960},isMobile:mobile,hasTouch:mobile,colorScheme:'dark'});
 let config={image:null};let delayGet=1800;let failSave=false;
 await context.route('**/api/v1/plugins/silk/rpc/*',async route=>{
  if(route.request().url().endsWith('/save')) {
   await new Promise(r=>setTimeout(r,700));
   if(failSave) {await route.fulfill({status:500,json:{ok:false,error:{message:'Test save failure'}}});return;}
   config=route.request().postDataJSON();
  }else if(delayGet) {await new Promise(r=>setTimeout(r,delayGet));delayGet=0;}
  await route.fulfill({json:{ok:true,result:config}});
 });
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:38886');
 await page.locator('[id="root-compose-prompt"]').waitFor();
 await page.screenshot({path:"'`${out}/${mobile?'"'mobile':'desktop'}-loading.png"'`});
 await page.locator('"'.silk-customize:not([disabled])').waitFor();
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=900;let x=c.getContext('2d');x.fillStyle='#728bba';x.fillRect(0,0,1600,900);x.fillStyle='#ece2c9';x.beginPath();x.arc(800,450,240,0,Math.PI*2);x.fill();return c.toDataURL().split(',')[1];});
 await page.getByLabel('Choose wallpaper image').setInputFiles({name:'qa.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.waitForFunction(()=>document.querySelector('.silk-customize')?.getAttribute('aria-busy')==='true');
 assert(await page.locator('.silk-customize').isDisabled());
 assert.equal(await page.locator('.silk-customize .animate-spin').count(),1);
 await page.waitForFunction(()=>document.querySelector('.silk-customize')?.getAttribute('aria-busy')==='false');
 await page.locator('[id="root-compose-prompt"]').fill('QA draft — do not submit.');
 const sizes=mobile?[[320,568],[390,844],[844,390],[390,390]]:[[1024,768],[768,650],[767,650],[600,500],[1440,500],[2560,1440],[3440,1440]];
 for(const [width,height] of sizes) {
  await page.setViewportSize({width,height});await page.waitForTimeout(350);
  const state=await page.evaluate(()=>{
   const host=document.querySelector('.silk-home'), shell=document.querySelector('[data-promptbox-shell]'),c=document.querySelector('.silk-wallpaper'),b=document.querySelector('.silk-customize');
   const h=host.getBoundingClientRect(),s=shell.getBoundingClientRect(),r=b.getBoundingClientRect();
   return {overflow:document.documentElement.scrollWidth>innerWidth,center:[(s.left+s.right-h.left-h.right)/2,(s.top+s.bottom-h.top-h.bottom)/2],shell:[s.top,s.bottom],buttonVisible:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b,ratioError:Math.abs(c.width/c.height-c.clientWidth/c.clientHeight),canvasCount:document.querySelectorAll('.silk-wallpaper').length};
  });
  console.log(JSON.stringify({mobile,width,height,...state}));
  assert("'!state.overflow);assert(state.buttonVisible);assert.equal(state.canvasCount,1);
  await page.screenshot({path:`${out}/${mobile?'"'mobile':'desktop'}-"'${width}-${height}.png`});
 }
 await page.setViewportSize({width:mobile?390:1440,height:mobile?844:960});
 await page.locator('"'[id="root-compose-prompt"]').fill(Array.from({length:30},(_,i)=>"'`Line ${i+1} of a longer draft.`).join('"'\\n'));
 await page.waitForTimeout(350);await page.screenshot({path:"'`${out}/${mobile?'"'mobile':'desktop'}-long-draft.png"'`});
 await page.emulateMedia({colorScheme:'"'light'});await page.waitForTimeout(350);await page.screenshot({path:"'`${out}/${mobile?'"'mobile':'desktop'}-light.png"'`});
 failSave=true;
 await page.getByLabel('"'Choose wallpaper image').setInputFiles({name:'qa2.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.waitForFunction(()=>document.querySelector('.silk-customize')?.getAttribute('aria-busy')==='true');
 await page.waitForFunction(()=>document.querySelector('.silk-customize')?.getAttribute('aria-busy')==='false');
 assert(config.image);assert(await page.locator('.silk-customize').isEnabled());
 const savedBeforeInvalid=config.image;
 await page.getByLabel('Choose wallpaper image').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
 await page.waitForTimeout(300);
 assert.equal(config.image,savedBeforeInvalid,'Invalid upload must retain saved image');
 assert(await page.locator('.silk-customize').isEnabled());
 if(mobile) {
   await page.setViewportSize({width:390,height:320});await page.waitForTimeout(400);
   await page.screenshot({path:`${out}/mobile-long-short-viewport.png`});
 }

 assert.deepEqual(errors,[]);await context.close();
 }
}finally{await browser.close();}
console.log('PASS extended QA; screenshots '+out);
