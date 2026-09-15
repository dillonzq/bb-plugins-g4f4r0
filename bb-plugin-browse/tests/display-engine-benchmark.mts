import { SelkiesStream } from "../src/selkies";
import { viewerHtml } from "../src/viewer";
import { DirectInput } from "../src/direct-input";
// Opt-in Linux display-engine comparison using private extracted packages.
// Loopback-only fixture and viewers, disposable profiles; no user browser.
// See validation/display-engines-2026-09-15/README.md for setup and measurement limits.
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { Cdp } from "../src/cdp";
import { acquireDisplay, managedEnv, chromeArgs } from "../src/managed";
import { chromeExecutable } from "../src/runtime";
import { AdaptiveStream } from "../src/adaptive-stream";
const mode = process.argv[2] || "selkies",
  seconds = Number(process.argv[3] || 20);
if (!["jpeg", "selkies", "kasm", "custom"].includes(mode))
  throw Error("Expected jpeg, selkies, or kasm");
if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600)
  throw Error("Duration must be between 0 and 3600 seconds");
const shaped = process.argv.includes("--shaped");
if (shaped && mode !== "jpeg")
  throw Error("Traffic shaping is implemented only for the JPEG reference");
const adaptiveEnabled = process.argv.includes("--adaptive");
const damageOnly = process.argv.includes("--damage-only");
const cache = join(process.env.HOME!, ".cache/browse-stream-bench");
const root = join(process.env.HOME!, ".bb/plugins/browse/host-data");
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const directory = await fs.mkdtemp(join(tmpdir(), "browse-transport-"));
const children: ReturnType<typeof spawn>[] = [],
  cdps: Cdp[] = [];
const abort = new AbortController();
let display = await acquireDisplay(root, managedEnv(root), abort.signal);
let enginePort = 0;
let streamClosed = false;
let customStream:SelkiesStream|undefined;
const extraPids=new Set<number>();
const fixture = `<!doctype html><title>Browse Transport Benchmark</title><style>html,body{margin:0;background:#fff}canvas{display:block}</style><canvas width="1280" height="800"></canvas><script>
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');let signal=0,frames=0;window.idle=false;window.change=()=>++signal;window.currentSignal=()=>signal;document.addEventListener("click",()=>window.change());
function paint(t){if(window.idle){requestAnimationFrame(paint);return;}frames++;ctx.fillStyle='#f7f7f7';ctx.fillRect(0,0,1280,800);ctx.fillStyle='#151515';ctx.font='20px sans-serif';ctx.fillText('Browse transport benchmark — readable text, motion and interaction',40,45);for(let i=0;i<24;i++){const y=80+i*30;ctx.fillStyle=i%2?'#f0f0f0':'#fff';ctx.fillRect(20,y-22,1000,28);ctx.fillStyle='#252525';ctx.fillText('Browser row '+i+' • Scrolling, hover states, forms and text selection',40,y);ctx.fillStyle='#4285f4';ctx.fillRect(650+Math.sin(t/700+i/8)*130,y-16,40,16);}ctx.fillStyle=signal%2?'rgb(255,0,0)':'rgb(0,255,0)';ctx.fillRect(0,0,20,20);window.sourceFrames=frames;requestAnimationFrame(paint)}requestAnimationFrame(paint);
</script>`;
const receiver = `<!doctype html><title>Browse receiver benchmark</title><style>html,body{margin:0;background:#111}canvas,video{width:1280px;height:800px}</style><canvas id="screen" width="1280" height="800"></canvas><video autoplay muted playsinline hidden></video><script>
const screen=document.querySelector('canvas'),paint=screen.getContext('2d'),video=document.querySelector('video');window.stats={displayed:0,bytes:0,dropped:0,tier:0};let pending=null,decoding=false,decoded=null,scheduled=false;
function draw(){scheduled=false;const item=decoded;decoded=null;if(!item)return;paint.drawImage(item.bitmap,0,0,1280,800);item.bitmap.close();stats.displayed++;item.ack();}
async function decode(){if(decoding||!pending)return;decoding=true;const item=pending;pending=null;try{const bitmap=await createImageBitmap(item.blob);if(decoded){decoded.bitmap.close();decoded.ack();stats.dropped++}decoded={bitmap,ack:item.ack};if(!scheduled){scheduled=true;requestAnimationFrame(draw)}}finally{decoding=false;if(pending)decode()}}
window.startJPEG=()=>{let meta;const ws=window.socket=new WebSocket('ws://'+location.host+'/jpeg');ws.onmessage=e=>{if(typeof e.data==='string'){meta=JSON.parse(e.data);return;}const m=meta,at=performance.now();stats.bytes+=e.data.size;stats.tier=m.tier;const ack=()=>ws.readyState===1&&ws.send(JSON.stringify({ack:m.seq,clientMs:performance.now()-at}));if(pending){pending.ack();stats.dropped++}pending={blob:e.data,ack};decode();};};
window.snapshot=()=>({...stats,heap:performance.memory?.usedJSHeapSize,at:performance.now()});
window.pixel=()=>[...paint.getImageData(8,8,1,1).data];
</script>`;
const http = createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  if(mode==="custom") {
    const url=new URL(req.url!,"http://127.0.0.1");
    if(url.pathname==="/viewer"){res.end(viewerHtml);return;}
    if(url.pathname!=="/source"){res.setHeader("content-type","application/json");res.end(JSON.stringify(url.pathname==="/viewer-info"?{hostLabel:"Fixture",url:"http://127.0.0.1:"+port+"/source"}:{}));return;}
  }
  res.end(req.url === "/source" ? fixture : receiver);
});
await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
const port = (http.address() as any).port;
const wss = new WebSocketServer({ server: http });
let source: Cdp, viewer: Cdp;
wss.on("connection", (ws,req) => {
  if(mode==="custom") {
    if(req.url!.startsWith("/control")){const direct=new DirectInput(source);let chain=Promise.resolve();ws.on("message",raw=>{chain=chain.then(async()=>{try{const m=JSON.parse(String(raw));const result=await direct.run("bench",m.events);ws.send(JSON.stringify({seq:m.seq,...result}));}catch{ws.close();}});});ws.on("close",()=>void chain.finally(()=>direct.reset()));return;}
    if(!req.url!.startsWith("/video")){ws.close();return;}
    let done=false,outstanding=0;
    ws.on("close",()=>{done=true;void customStream?.stop();});ws.on("message",()=>outstanding--);
    void(async()=>{customStream=await SelkiesStream.start(root,display.env);if(customStream.processId)extraPids.add(customStream.processId);try{while(!done){if(outstanding>0){await pause(2);continue;}const packets=await customStream.read();if(done)break;ws.send(JSON.stringify({url:"http://127.0.0.1:"+port+"/source",loading:false}));for(const packet of packets){outstanding++;ws.send(Buffer.from(packet,"base64"));}}}finally{await customStream.stop();}})().catch(e=>{console.error(e);ws.close();});return;
  }
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
      ...(name === "receiver"
        ? ["--headless=new"]
        : [
            "--kiosk",
            "--disable-infobars",
            "--window-position=0,0",
            "--app=http://127.0.0.1:" + port + "/source",
          ]),
      ...(name === "receiver" && process.argv.includes("--no-bfcache")
        ? ["--disable-features=BackForwardCache"]
        : []),
      "--autoplay-policy=no-user-gesture-required",
      ...(name === "receiver" ? ["about:blank"] : []),
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
      const c = await Cdp.connect(
        "ws://127.0.0.1:" + port + path,
        name === "receiver",
      );
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
  const ids = new Set([...children.map((c) => c.pid!),...extraPids]);
  try {
    ids.add(
      Number(
        readFileSync(
          "/tmp/.X" + display.env.DISPLAY!.slice(1) + "-lock",
          "utf8",
        ).trim(),
      ),
    );
  } catch {}
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
    cpuTicks = 0,
    clientPss = 0,
    clientCpuTicks = 0;
  const rows = execFileSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((r) => r.trim().split(/\s+/).map(Number));
  const clients = new Set([children.at(-1)!.pid!]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of rows)
      if (clients.has(parent) && !clients.has(pid)) {
        clients.add(pid);
        changed = true;
      }
  }
  for (const pid of descendants()) {
    try {
      const [m, s] = await Promise.all([
        fs.readFile("/proc/" + pid + "/smaps_rollup", "utf8"),
        fs.readFile("/proc/" + pid + "/stat", "utf8"),
      ]);
      const value = Number(m.match(/^Pss:\s+(\d+)/m)?.[1] || 0);
      pss += value;
      if (clients.has(pid)) clientPss += value;
      const stat = s.slice(s.lastIndexOf(")") + 2).split(" ");
      const ticks = Number(stat[11]) + Number(stat[12]);
      cpuTicks += ticks;
      if (clients.has(pid)) clientCpuTicks += ticks;
    } catch {}
  }
  return {
    pssMiB: pss / 1024,
    cpuTicks,
    serverPssMiB: (pss - clientPss) / 1024,
    clientPssMiB: clientPss / 1024,
    serverCpuTicks: cpuTicks - clientCpuTicks,
    clientCpuTicks,
  };
}

let returnFromInspect = false;
const instrument = `window.bench={displayed:0,bytes:0,dropped:0};window.benchErrors=[];addEventListener('error',e=>benchErrors.push(e.message));let dirty=false;const NativeWS=WebSocket;window.WebSocket=new Proxy(NativeWS,{construct(Target,args){const socket=new Target(...args);socket.addEventListener('message',e=>{bench.bytes+=typeof e.data==='string'?e.data.length:e.data.size||e.data.byteLength||0});return socket}});for(const [klass,methods] of [[CanvasRenderingContext2D,['drawImage','putImageData']],[WebGLRenderingContext,['drawArrays','drawElements']],[WebGL2RenderingContext,['drawArrays','drawElements']],[ImageBitmapRenderingContext,['transferFromImageBitmap']]]){for(const method of methods){const original=klass.prototype[method];klass.prototype[method]=function(...args){if(this.canvas.width>=960)dirty=true;return original.apply(this,args)}}}function tick(){if(dirty){if(!bench.video)bench.displayed++;dirty=false;}requestAnimationFrame(tick)}requestAnimationFrame(tick);`;
const workerProbe = (process.argv.includes("--canvas-sink") ? "self.VideoTrackGenerator=undefined;" : "") + `let probeBytes=0,probeFrames=0;const ProbeWS=WebSocket;self.WebSocket=new Proxy(ProbeWS,{construct(T,args){const ws=new T(...args);ws.addEventListener('message',e=>{probeBytes+=typeof e.data==='string'?e.data.length:e.data.size||e.data.byteLength||0});return ws}});if(typeof OffscreenCanvasRenderingContext2D!=='undefined'){const draw=OffscreenCanvasRenderingContext2D.prototype.drawImage;OffscreenCanvasRenderingContext2D.prototype.drawImage=function(...args){const result=draw.apply(this,args);if(this.canvas.width>=960)probeFrames++;return result;};}setInterval(()=>{if(probeBytes||probeFrames)self.postMessage({type:'browseBench',bytes:probeBytes,frames:probeFrames});probeBytes=probeFrames=0},500);`;
const workerInstrument = `const OriginalBlob=Blob;window.Blob=new Proxy(OriginalBlob,{construct(T,args){if(args[1]?.type?.includes('javascript')&&args[0]?.every(p=>typeof p==='string')&&args[0].some(p=>p.includes('new WebSocket(')||p.includes('function present(f)')))args=[[${JSON.stringify(workerProbe)},...args[0]],args[1]];return new T(...args)}});window.benchWorkers=[];const OriginalWorker=Worker;window.Worker=new Proxy(OriginalWorker,{construct(T,args){const worker=new T(...args);benchWorkers.push(worker);worker.addEventListener('message',e=>{if(e.data?.type==='browseBench'){bench.bytes+=e.data.bytes;if(!bench.video)bench.displayed+=e.data.frames}});return worker}});`;
const videoInstrument = `const videos=new WeakSet();function bindVideos(){for(const video of document.querySelectorAll('video')){if(videos.has(video))continue;videos.add(video);function frame(){if(video.videoWidth>=960){bench.video=true;bench.displayed++}video.requestVideoFrameCallback(frame)}video.requestVideoFrameCallback(frame)}}new MutationObserver(bindVideos).observe(document,{childList:true,subtree:true});bindVideos();`;
async function startEngine() {
  if (mode === "jpeg" || mode === "custom") return;
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  enginePort = (server.address() as any).port;
  await new Promise<void>((r) => server.close(() => r()));
  let command: string,
    args: string[],
    env = { ...display.env };
  if (mode === "selkies") {
    command = "python3";
    args = [
      "-m",
      "selkies",
      "--addr",
      "127.0.0.1",
      "--port",
      String(enginePort),
      "--enable-basic-auth",
      "false",
      "--enable-https",
      "false",
      "--audio-enabled",
      "false",
      "--microphone-enabled",
      "false",
      "--webcam-enabled",
      "false",
      "--gamepad-enabled",
      "false",
      "--enable-clipboard",
      "false",
      "--file-transfers",
      "disabled",
      "--command-enabled",
      "false",
      "--enable-resize",
      "false",
      "--video-streaming-mode",
      damageOnly ? "false" : "true",
      "--encoder",
      "h264enc",
      "--framerate",
      "60",
      "--video-bitrate",
      "8000",
      "--rate-control-mode",
      "cbr",
    ];
    env.PYTHONPATH = join(
      cache,
      "selkies/opt/selkies/lib/python3.13/site-packages",
    );
  } else {
    // Replace this test's private Xvfb only; no installed Browse displays are touched.
    const number = Number(env.DISPLAY!.slice(1));
    await display.release();
    const overlay = join(directory, "overlay");
    await fs.mkdir(overlay);
    await fs.mkdir(join(overlay, "upper"));
    await fs.mkdir(join(overlay, "work"));
    const script =
      'set -eu\nmount -t overlay overlay -o "lowerdir=/usr/bin,upperdir=$BENCH_OVERLAY/upper,workdir=$BENCH_OVERLAY/work" /usr/bin\ncp "$BENCH_XKBCOMP" /usr/bin/xkbcomp\nexec "$@"';
    env.BENCH_OVERLAY = overlay;
    env.BENCH_XKBCOMP = join(root, "linux-deps/root/usr/bin/xkbcomp");
    env.XKB_CONFIG_ROOT = join(root, "linux-deps/root/usr/share/X11/xkb");
    command = "unshare";
    args = [
      "-rm",
      "--",
      "sh",
      "-c",
      script,
      "bench",
      join(cache, "kasm/usr/bin/Xkasmvnc"),
      ":" + number,
      "-geometry",
      "1280x800",
      "-depth",
      "24",
      "-ac",
      "-interface",
      "127.0.0.1",
      "-websocketPort",
      String(enginePort),
      "-httpd",
      join(cache, "kasm/usr/share/kasmvnc/www"),
      "-DisableBasicAuth",
      "1",
      "-SecurityTypes",
      "None",
      "-sslOnly",
      "0",
      "-FrameRate",
      "60",
      "-nolisten",
      "tcp",
    ];
    display = { env, release: async () => {} };
  }
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  children.push(child);
  let errors = "";
  child.stderr!.on("data", (b) => {
    errors = (errors + b).slice(-8000);
    void fs.writeFile(join(cache, mode + "-engine.log"), errors);
  });
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw Error("Engine failed: " + errors);
    try {
      execFileSync(
        "curl",
        ["-fsS", "--max-time", "1", "http://127.0.0.1:" + enginePort + "/"],
        { stdio: "ignore" },
      );
      return;
    } catch {}
    await pause(100);
  }
  throw Error("Engine startup timeout: " + errors);
}

try {
  await startEngine();
  source = await launch("source");
  viewer = await launch("receiver");
  await source.send("Page.navigate", {
    url: "http://127.0.0.1:" + port + "/source",
  });
  viewer.onEvent((method, params) => {
    if (method === "Runtime.consoleAPICalled" && params.type === "error")
      console.error(JSON.stringify(params.args));
  });
  await viewer.send("Runtime.enable");
  await viewer.send("Page.enable");
  await viewer.send("Page.addScriptToEvaluateOnNewDocument", {
    source:
      instrument +
      videoInstrument +
      (mode === "selkies" ? workerInstrument : ""),
  });
  await viewer.send("Page.navigate", {
    url:
      mode === "custom" ? "http://127.0.0.1:"+port+"/viewer?id=bench&video=1" : mode === "jpeg"
        ? "http://127.0.0.1:" + port + "/receiver"
        : "http://127.0.0.1:" +
          enginePort +
          (mode === "kasm"
            ? "/?autoconnect=true&resize=scale&show_control_bar=false"
            : "/"),
  });
  await pause(500);
  if (mode === "jpeg") await viewer.evaluate("startJPEG()");
  else {
    await pause(8000);
    if (process.argv.includes("--inspect")) {
      console.log(
        JSON.stringify(
          await viewer.evaluate(
            `({text:document.body.innerText.slice(0,2000),keys:Object.keys(window).filter(k=>/selk|rfb|stats|app/i.test(k)),canvases:[...document.querySelectorAll('canvas')].map(c=>({id:c.id,width:c.width,height:c.height})),errors:window.benchErrors,bench:window.bench,pixels:[...document.querySelectorAll('canvas')].filter(c=>c.width>=960).map(c=>{try{const copy=window.pixelCanvas||(window.pixelCanvas=document.createElement('canvas'));if(copy.width!==1||copy.height!==1){copy.width=1;copy.height=1;}const ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(c,8,8,1,1,0,0,1,1);return {id:c.id,pixel:[...ctx.getImageData(0,0,1,1).data]}}catch(e){return {id:c.id,error:String(e)}}}),system:window.system_stats,network:window.network_stats})`,
          ),
        ),
      );
      const shot = await viewer.send("Page.captureScreenshot", {
        format: "png",
      });
      await fs.writeFile(
        join(cache, mode + "-inspect.png"),
        Buffer.from(shot.data, "base64"),
      );
      returnFromInspect = true;
    }
    if (returnFromInspect) throw Error("Inspect complete");
    await viewer.evaluate(
      `window.snapshot=()=>({...window.browseMetrics||window.bench,heap:performance.memory?.usedJSHeapSize,at:performance.now()});window.pixel=()=>{const c=[...document.querySelectorAll('video')].find(v=>v.videoWidth>=960)||[...document.querySelectorAll('canvas')].filter(c=>c.width>=960&&c.height>=600).at(-1);if(!c)return[];const copy=window.pixelCanvas||(window.pixelCanvas=document.createElement('canvas'));if(copy.width!==1||copy.height!==1){copy.width=1;copy.height=1;}const ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(c,8*(c.videoWidth||c.width)/1280,8*(c.videoHeight||c.height)/800,1,1,0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]};`,
    );
  }
  await pause(1500);
  const sourceBefore = await source.evaluate("sourceFrames");
  const before = await viewer.evaluate("snapshot()");
  const memBefore = await memory();
  const memorySamples = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += 5) {
    await pause(Math.min(5, seconds - elapsed) * 1000);
    memorySamples.push(await memory());
  }
  const after = await viewer.evaluate("snapshot()"),
    sourceAfter = await source.evaluate("sourceFrames"),
    memAfter = await memory();
  await source.evaluate("window.idle=true");
  await pause(3000);
  const idleBefore = await memory();
  const idleViewBefore = await viewer.evaluate("snapshot()");
  await pause(10000);
  const idleAfter = await memory();
  const idleViewAfter = await viewer.evaluate("snapshot()");
  await source.evaluate("window.idle=false");
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
  const inputLatency: number[] = [];
  if (mode !== "jpeg") {
    for (let i = 0; i < 12; i++) {
      const expected = 1 - ((await source.evaluate("currentSignal()")) % 2);
      const at = performance.now();
      await viewer.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: 200,
        y: 150,
      });
      await viewer.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: 200,
        y: 150,
        button: "left",
        clickCount: 1,
      });
      await viewer.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: 200,
        y: 150,
        button: "left",
        clickCount: 1,
      });
      for (let j = 0; j < 150; j++) {
        const pixel = await viewer.evaluate("pixel()");
        if (pixel[expected ? 0 : 1] > 200 && pixel[expected ? 1 : 0] < 50) {
          inputLatency.push(performance.now() - at);
          break;
        }
        await pause(8);
      }
      await pause(80);
    }
    if (inputLatency.length !== 12)
      throw Error("Missing input-to-pixel samples: " + inputLatency.length);
  }
  const sortedInput = [...inputLatency].sort((a, b) => a - b);
  let disconnected;
  if (process.argv.includes("--lifecycle")) {
    await source.evaluate("window.idle=true");
    if (process.argv.includes("--teardown"))
      await viewer.evaluate(
        `(()=>{for(const video of document.querySelectorAll('video')){video.pause();video.srcObject?.getTracks().forEach(t=>t.stop());video.srcObject=null;video.removeAttribute('src');video.load();}window.selkiesTransport?.close();for(const worker of window.benchWorkers||[])worker.terminate();})()`,
      );
    await viewer.send("Page.navigate", { url: "about:blank" });
    await pause(3000);
    const before = await memory();
    await pause(10000);
    const after = await memory();
    const targets = await viewer.send("Target.getTargets");
    disconnected = {
      targets: targets.targetInfos.map((t: any) => ({
        type: t.type,
        url: t.url.replace(/:\d+/, ":PORT"),
      })),
      before,
      after,
      serverCpuCores: (after.serverCpuTicks - before.serverCpuTicks) / 100 / 10,
    };
  }
  const sorted = [...latency].sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      mode,
      disconnected,
      shaped,
      adaptiveEnabled,
      damageOnly,
      canvasSink: process.argv.includes("--canvas-sink"),
      backForwardCacheDisabled: process.argv.includes("--no-bfcache"),
      explicitTeardown: process.argv.includes("--teardown"),
      seconds,
      sourceFps: ((sourceAfter - sourceBefore) * 1000) / (after.at - before.at),
      cpuCores:
        (memAfter.cpuTicks - memBefore.cpuTicks) /
        Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" })) /
        seconds,
      fps:
        ((after.displayed - before.displayed) * 1000) / (after.at - before.at),
      mbps: ((after.bytes - before.bytes) * 8) / (after.at - before.at) / 1000,
      dropped: mode === "jpeg" ? after.dropped - before.dropped : undefined,
      finalTier: after.tier,
      inputLatencyMs: inputLatency.length
        ? { samples: inputLatency, p50: sortedInput[6], p95: sortedInput[11] }
        : undefined,
      latencyMs: {
        samples: latency,
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
      },
      idle: {
        fps:
          ((idleViewAfter.displayed - idleViewBefore.displayed) * 1000) /
          (idleViewAfter.at - idleViewBefore.at),
        mbps:
          ((idleViewAfter.bytes - idleViewBefore.bytes) * 8) /
          (idleViewAfter.at - idleViewBefore.at) /
          1000,
        before: idleBefore,
        after: idleAfter,
        cpuCores: (idleAfter.cpuTicks - idleBefore.cpuTicks) / 100 / 10,
        serverCpuCores:
          (idleAfter.serverCpuTicks - idleBefore.serverCpuTicks) / 100 / 10,
      },
      memorySamples,
      serverCpuCores:
        (memAfter.serverCpuTicks - memBefore.serverCpuTicks) / 100 / seconds,
      memoryBefore: memBefore,
      memoryAfter: memAfter,
      heapBytes: after.heap,
    }),
  );
} catch (error) {
  if (!returnFromInspect) throw error;
} finally {
  streamClosed = true;
  await customStream?.stop();
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
