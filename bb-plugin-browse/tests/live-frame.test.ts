import { it, expect } from "vitest";
import { liveFrameFromEvent } from "../src/cdp";
import { viewerHtml } from "../src/viewer";

it("reads viewport size from a screencast event", () => {
  expect(
    liveFrameFromEvent(
      {
        data: "abc",
        metadata: { deviceWidth: 390.4, deviceHeight: 600.9 },
      },
      3,
    ),
  ).toEqual({ data: "abc", width: 390, height: 601, seq: 3 });
});
it("opens a same-origin screencast websocket from the viewer", () => {
  expect(viewerHtml).toContain("WebSocket");
  expect(viewerHtml).toContain("/cast");
  expect(viewerHtml).not.toContain("setTimeout(refresh,800)");
});

it('backs off capture without demand and permits a short active pipeline',async()=>{
  const {Cdp}=await import('../src/cdp');
  const c:any=Object.create(Cdp.prototype);
  c.casting=true;c.liveAcks=new Set();c.waiters=new Set();c.seq=0;c.send=async(...args:any[])=>{calls.push(args);return{};};
  const calls:any[]=[];
  c.onScreencast({sessionId:1,data:'frame',metadata:{deviceWidth:1280,deviceHeight:800}});
  expect(calls).toHaveLength(0);
  expect((await c.nextLiveFrame()).seq).toBe(1);
  expect(calls).toEqual([['Page.screencastFrameAck',{sessionId:1}]]);
  const next=c.nextLiveFrame(1);
  c.onScreencast({sessionId:2,data:'new',metadata:{deviceWidth:1280,deviceHeight:800}});
  expect((await next).seq).toBe(2);
  expect(calls.at(-1)).toEqual(['Page.screencastFrameAck',{sessionId:2}]);
  c.lastFrameDemand=Date.now()-100;
  c.onScreencast({sessionId:3,data:'waiting',metadata:{}});await c.stopLiveCast();
  expect(calls.slice(-2)).toEqual([['Page.screencastFrameAck',{sessionId:3}],['Page.stopScreencast']]);
});
