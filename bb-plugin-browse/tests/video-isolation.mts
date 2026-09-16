// Opt-in live Linux test: disposable Fortress profiles and isolated displays.
import { launchManaged } from '../src/managed';
import { Cdp } from '../src/cdp';
import { BrowserDriver } from '../src/driver';
import { SelkiesStream } from '../src/selkies';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root=join(process.env.HOME!,'.bb/plugins/browse/host-data');
const browsers:Awaited<ReturnType<typeof launchManaged>>[]=[];
const controls:Cdp[]=[];const drivers:BrowserDriver[]=[];
const ids=[`ab-video-test-${Date.now()}-a`,`ab-video-test-${Date.now()}-b`];
let stream:SelkiesStream|undefined;
try {
  for(const id of ids)browsers.push(await launchManaged(root,id,new AbortController().signal,true));
  assert.notEqual(browsers[0].displayEnv!.DISPLAY,browsers[1].displayEnv!.DISPLAY);
  for(const [i,b] of browsers.entries()){
    const cdp=await Cdp.connect(b.endpoint,false);controls.push(cdp);
    const driver=await BrowserDriver.connect(root,cdp,new AbortController().signal);drivers.push(driver);
    await cdp.send('Page.navigate',{url:'about:blank'});
    await cdp.evaluate(`document.body.innerHTML='<h1>Isolated browser ${i}</h1><input id="input">';document.body.style.background='${i?'blue':'red'}';`);
    assert.equal(await cdp.evaluate('document.querySelector("h1").textContent'),`Isolated browser ${i}`);
  }
  stream=await SelkiesStream.start(root,browsers[0].displayEnv!);
  let packets:string[]=[];
  for(let i=0;i<10&&!packets.length;i++)packets=await stream.read();
  assert.ok(packets.length);
  const pid=stream.processId!;await stream.stop();stream=undefined;
  await new Promise(r=>setTimeout(r,200));
  assert.throws(()=>process.kill(pid,0));
  console.log(JSON.stringify({distinctDisplays:true,fortressBoundBoth:true,encodedFrame:true,encoderStopped:true}));
} finally {
  await stream?.stop();
  for(const d of drivers)await d.close().catch(()=>{});
  for(const c of controls)c.close();
  for(const b of browsers)await b.close();
  for(const id of ids)await fs.rm(join(root,'profiles',id),{recursive:true,force:true});
}
