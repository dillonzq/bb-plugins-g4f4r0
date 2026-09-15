// Opt-in check against a disposable fixture session on the local installed BB.
// Usage: node tests/live-adaptive.mjs <session-id>
import assert from "node:assert/strict";
import WebSocket from "ws";
const id = process.argv[2];
assert.match(id || "", /^ab-[a-f0-9-]+$/);
const base = "http://127.0.0.1:38886/api/v1/plugins/browse/http";
const info = await (await fetch(base + "/viewer-info?id=" + id)).json();
assert.match(
  info.url,
  /^http:\/\/127\.0\.0\.1:39114\/interactive-fixture\.html$/,
);
const html = await (await fetch(base + "/viewer?id=" + id)).text();
assert.ok(html.includes("clientMs:Math.round"));
const ws = new WebSocket(
  base.replace("http:", "ws:") + "/cast?id=" + id + "&binary=1",
);
const started = Date.now(),
  transitions = [],
  logical = new Set(),
  rasters = new Set();
let metadata,
  lastTier,
  frames = 0;
function size(b) {
  let i = 2;
  while (i < b.length) {
    assert.equal(b[i++], 255);
    const marker = b[i++];
    const length = b.readUInt16BE(i);
    if (marker === 192 || marker === 194)
      return [b.readUInt16BE(i + 5), b.readUInt16BE(i + 3)];
    i += length;
  }
  throw Error("Missing JPEG size");
}
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 35000);
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on("message", (raw, binary) => {
      try {
        if (!binary) {
          metadata = JSON.parse(String(raw));
          if (metadata.error) throw Error(metadata.error);
          return;
        }
        frames++;
        const elapsed = Date.now() - started;
        logical.add(metadata.width + "x" + metadata.height);
        const raster = size(raw);
        rasters.add(metadata.streamTier + ":" + raster.join("x"));
        if (lastTier !== metadata.streamTier) {
          lastTier = metadata.streamTier;
          transitions.push({ ms: elapsed, tier: lastTier, raster });
        }
        ws.send(
          JSON.stringify({
            ack: metadata.seq,
            clientMs: elapsed < 7000 ? 45 : 0,
          }),
        );
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  });
  assert.ok(transitions.some((t) => t.tier === 2));
  assert.equal(lastTier, 0);
  assert.equal(logical.size, 1);
  assert.ok([...rasters].some((s) => s === "2:960x600"));
  console.log(
    JSON.stringify({
      frames,
      transitions,
      logical: [...logical],
      rasters: [...rasters],
      scope:
        "Installed frame route and JPEG decoding headers; deliberately reported slow client processing for seven seconds, then immediate acknowledgements. Not a remote-client latency measurement.",
    }),
  );
} finally {
  ws.close();
}
