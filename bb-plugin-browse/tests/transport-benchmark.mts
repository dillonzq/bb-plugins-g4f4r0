// Opt-in local transport comparison. Never attaches to a user browser or uses
// external ICE/STUN/TURN. Capture permissions are auto-granted only in these
// temporary test profiles, removed in finally.
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { Cdp } from "../src/cdp";
import { acquireDisplay, managedEnv, chromeArgs } from "../src/managed";
import { chromeExecutable } from "../src/runtime";
import { AdaptiveStream } from "../src/adaptive-stream";
const mode = process.argv[2] || "jpeg",
  seconds = Number(process.argv[3] || 20);
const shaped = process.argv.includes("--shaped");
const adaptiveEnabled = process.argv.includes("--adaptive");
const root = join(process.env.HOME!, ".bb/plugins/browse/host-data");
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const directory = await fs.mkdtemp(join(tmpdir(), "browse-transport-"));
const children: ReturnType<typeof spawn>[] = [],
  cdps: Cdp[] = [];
const abort = new AbortController();
const display = await acquireDisplay(root, managedEnv(root), abort.signal);
let streamClosed = false;
const fixture = `<!doctype html><title>Browse Transport Benchmark</title><style>html,body{margin:0;background:#fff}canvas{display:block}</style><canvas width="1280" height="800"></canvas><script>
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');let signal=0,frames=0;window.change=()=>++signal;
function paint(t){frames++;ctx.fillStyle='#f7f7f7';ctx.fillRect(0,0,1280,800);ctx.fillStyle='#151515';ctx.font='20px sans-serif';ctx.fillText('Browse transport benchmark — readable text, motion and interaction',40,45);for(let i=0;i<24;i++){const y=80+i*30;ctx.fillStyle=i%2?'#f0f0f0':'#fff';ctx.fillRect(20,y-22,1000,28);ctx.fillStyle='#252525';ctx.fillText('Browser row '+i+' • Scrolling, hover states, forms and text selection',40,y);ctx.fillStyle='#4285f4';ctx.fillRect(650+Math.sin(t/700+i/8)*130,y-16,40,16);}ctx.fillStyle=signal%2?'rgb(255,0,0)':'rgb(0,255,0)';ctx.fillRect(0,0,20,20);window.sourceFrames=frames;requestAnimationFrame(paint)}requestAnimationFrame(paint);
window.startRTC=async()=>{const media=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:60,width:1280,height:800},audio:false,preferCurrentTab:true});window.media=media;media.getVideoTracks()[0].contentHint='detail';const pc=window.sender=new RTCPeerConnection({iceServers:[]});const sender=pc.addTrack(media.getVideoTracks()[0],media);const p=sender.getParameters();p.encodings=[{maxBitrate:8000000,maxFramerate:60}];await sender.setParameters(p);await pc.setLocalDescription(await pc.createOffer());await new Promise(r=>{if(pc.iceGatheringState==='complete')r();else pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete')r()}});return pc.localDescription.toJSON();};
</script>`;
const receiver = `<!doctype html><title>Browse receiver benchmark</title><style>html,body{margin:0;background:#111}canvas,video{width:1280px;height:800px}</style><canvas id="screen" width="1280" height="800"></canvas><video autoplay muted playsinline hidden></video><script>
const screen=document.querySelector('canvas'),paint=screen.getContext('2d'),video=document.querySelector('video');window.stats={displayed:0,bytes:0,dropped:0,tier:0};let pending=null,decoding=false,decoded=null,scheduled=false;
function draw(){scheduled=false;const item=decoded;decoded=null;if(!item)return;paint.drawImage(item.bitmap,0,0,1280,800);item.bitmap.close();stats.displayed++;item.ack();}
async function decode(){if(decoding||!pending)return;decoding=true;const item=pending;pending=null;try{const bitmap=await createImageBitmap(item.blob);if(decoded){decoded.bitmap.close();decoded.ack();stats.dropped++}decoded={bitmap,ack:item.ack};if(!scheduled){scheduled=true;requestAnimationFrame(draw)}}finally{decoding=false;if(pending)decode()}}
window.startJPEG=()=>{let meta;const ws=window.socket=new WebSocket('ws://'+location.host+'/jpeg');ws.onmessage=e=>{if(typeof e.data==='string'){meta=JSON.parse(e.data);return;}const m=meta,at=performance.now();stats.bytes+=e.data.size;stats.tier=m.tier;const ack=()=>ws.readyState===1&&ws.send(JSON.stringify({ack:m.seq,clientMs:performance.now()-at}));if(pending){pending.ack();stats.dropped++}pending={blob:e.data,ack};decode();};};
window.startReceiver=async offer=>{screen.hidden=true;video.hidden=false;const pc=window.receiver=new RTCPeerConnection({iceServers:[]});pc.ontrack=e=>{video.srcObject=e.streams[0];video.play();};await pc.setRemoteDescription(offer);await pc.setLocalDescription(await pc.createAnswer());await new Promise(r=>{if(pc.iceGatheringState==='complete')r();else pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete')r()}});function shown(){stats.displayed++;video.requestVideoFrameCallback(shown)}video.requestVideoFrameCallback(shown);return pc.localDescription.toJSON();};
window.snapshot=async()=>{if(window.receiver){for(const s of(await receiver.getStats()).values()){if(s.type==='inbound-rtp'&&s.kind==='video'){stats.bytes=s.bytesReceived;stats.decoded=s.framesDecoded;stats.dropped=s.framesDropped;stats.decodeSeconds=s.totalDecodeTime;stats.jitterBufferSeconds=s.jitterBufferDelay;stats.jitterFrames=s.jitterBufferEmittedCount;}}}return {...stats,heap:performance.memory?.usedJSHeapSize,at:performance.now()};};
window.pixel=()=>{if(window.receiver)paint.drawImage(video,0,0,1280,800);return [...paint.getImageData(8,8,1,1).data]};
</script>`;
const http = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(req.url === "/source" ? fixture : receiver);
});
await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
const port = (http.address() as any).port;
const wss = new WebSocketServer({ server: http, path: "/jpeg" });
let source: Cdp, viewer: Cdp;
let transferred = 0;
wss.on("connection", (ws) => {
  const credit = new Map<number, { at: number; bytes: number }>(),
    policy = new AdaptiveStream();
  let after = 0,
    nextSend = Date.now();
  let done = false;
  ws.on("close", () => (done = true));
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw)),
      f = credit.get(m.ack);
    if (!f) return;
    const acknowledge = () => {
      credit.delete(m.ack);
      policy.sample(Date.now() - f.at, m.clientMs);
    };
    if (shaped) setTimeout(acknowledge, 40);
    else acknowledge();
  });
  void (async () => {
    while (!done && !streamClosed) {
      if (
        credit.size >= 8 ||
        [...credit.values()].reduce((n, f) => n + f.bytes, 0) >= 4 * 1024 * 1024
      ) {
        await pause(2);
        continue;
      }
      await source.configureLiveCast(adaptiveEnabled ? policy.tier : 0);
      const f = await source.nextLiveFrame(after);
      if (f.seq <= after) continue;
      after = f.seq;
      const bytes = Buffer.from(f.data, "base64");
      credit.set(f.seq, { at: Date.now(), bytes: bytes.length });
      transferred += bytes.length;
      if (shaped) {
        nextSend = Math.max(Date.now(), nextSend) + (bytes.length * 8) / 8000;
        await pause(Math.max(0, nextSend - Date.now()));
      }
      if (done) break;
      const send = () => {
        if (ws.readyState === 1) {
          ws.send(
            JSON.stringify({
              seq: f.seq,
              tier: adaptiveEnabled ? policy.tier : 0,
            }),
          );
          ws.send(bytes);
        }
      };
      if (shaped) setTimeout(send, 40);
      else send();
    }
  })().catch((e) => {
    if (!done && !streamClosed) console.error(e);
  });
});
async function launch(name: string) {
  const profile = join(directory, name);
  await fs.mkdir(profile);
  const binary = (await chromeExecutable(root))!;
  const child = spawn(
    binary,
    [
      ...chromeArgs(profile).filter((a) => a !== "about:blank"),
      "--autoplay-policy=no-user-gesture-required",
      "--auto-select-tab-capture-source-by-title=Browse Transport Benchmark",
      "--enable-usermedia-screen-capturing",
      "--allow-http-screen-capture",
      "--auto-select-desktop-capture-source=Browse Transport Benchmark",
      "about:blank",
    ],
    { env: display.env, stdio: ["ignore", "ignore", "ignore"] },
  );
  children.push(child);
  for (let i = 0; i < 150; i++) {
    try {
      const [port, path] = (
        await fs.readFile(join(profile, "DevToolsActivePort"), "utf8")
      )
        .trim()
        .split("\n");
      const c = await Cdp.connect("ws://127.0.0.1:" + port + path, true);
      cdps.push(c);
      await c.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      });
      return c;
    } catch {
      await pause(50);
    }
  }
  throw Error("Chrome did not start");
}
function descendants() {
  const rows = execFileSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((r) => r.trim().split(/\s+/).map(Number));
  const ids = new Set(children.map((c) => c.pid!));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of rows)
      if (ids.has(parent) && !ids.has(pid)) {
        ids.add(pid);
        changed = true;
      }
  }
  return [...ids];
}
async function memory() {
  let pss = 0,
    cpuTicks = 0;
  for (const pid of descendants()) {
    try {
      const [m, s] = await Promise.all([
        fs.readFile("/proc/" + pid + "/smaps_rollup", "utf8"),
        fs.readFile("/proc/" + pid + "/stat", "utf8"),
      ]);
      pss += Number(m.match(/^Pss:\s+(\d+)/m)?.[1] || 0);
      const stat = s.slice(s.lastIndexOf(")") + 2).split(" ");
      cpuTicks += Number(stat[11]) + Number(stat[12]);
    } catch {}
  }
  return { pssMiB: pss / 1024, cpuTicks };
}
try {
  source = await launch("source");
  viewer = await launch("receiver");
  await source.send("Page.navigate", {
    url: "http://127.0.0.1:" + port + "/source",
  });
  await viewer.send("Page.navigate", {
    url: "http://127.0.0.1:" + port + "/receiver",
  });
  await pause(500);
  if (mode === "rtc") {
    const offer = await source.evaluate("startRTC()");
    const answer = await viewer.evaluate(
      "startReceiver(" + JSON.stringify(offer) + ")",
    );
    await source.evaluate(
      "sender.setRemoteDescription(" + JSON.stringify(answer) + ")",
    );
  } else await viewer.evaluate("startJPEG()");
  await pause(1500);
  const sourceBefore = await source.evaluate("sourceFrames");
  const before = await viewer.evaluate("snapshot()");
  const memBefore = await memory();
  await pause(seconds * 1000);
  const after = await viewer.evaluate("snapshot()"),
    sourceAfter = await source.evaluate("sourceFrames"),
    memAfter = await memory();
  const latency: number[] = [];
  for (let i = 0; i < 12; i++) {
    const expected = await source.evaluate("change()%2");
    const at = performance.now();
    for (let j = 0; j < 150; j++) {
      const pixel = await viewer.evaluate("pixel()");
      if (pixel[expected ? 0 : 1] > 200 && pixel[expected ? 1 : 0] < 50) {
        latency.push(performance.now() - at);
        break;
      }
      await pause(8);
    }
    await pause(80);
  }
  if (latency.length !== 12)
    throw Error("Missing rendered latency samples: " + latency.length);
  const sorted = [...latency].sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      mode,
      shaped,
      adaptiveEnabled,
      seconds,
      sourceFps: ((sourceAfter - sourceBefore) * 1000) / (after.at - before.at),
      cpuCores:
        (memAfter.cpuTicks - memBefore.cpuTicks) /
        Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" })) /
        seconds,
      fps:
        ((after.displayed - before.displayed) * 1000) / (after.at - before.at),
      mbps: ((after.bytes - before.bytes) * 8) / (after.at - before.at) / 1000,
      dropped: after.dropped - before.dropped,
      finalTier: after.tier,
      latencyMs: {
        samples: latency,
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
      },
      memoryBefore: memBefore,
      memoryAfter: memAfter,
      heapBytes: after.heap,
      rtc:
        mode === "rtc"
          ? {
              decodeMs:
                (1000 * (after.decodeSeconds - before.decodeSeconds)) /
                (after.decoded - before.decoded),
              jitterMs:
                (1000 *
                  (after.jitterBufferSeconds - before.jitterBufferSeconds)) /
                (after.jitterFrames - before.jitterFrames),
            }
          : undefined,
    }),
  );
} finally {
  streamClosed = true;
  for (const ws of wss.clients) ws.close();
  for (const c of cdps) c.close();
  for (const child of children) {
    child.kill("SIGTERM");
  }
  await pause(500);
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGKILL");
  await display.release();
  wss.close();
  http.close();
  await fs.rm(directory, { recursive: true, force: true });
}
