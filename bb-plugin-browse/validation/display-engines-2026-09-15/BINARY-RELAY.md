# Continuous binary relay — 2026-09-15

The server-hosted video path now uses a private loopback WebSocket from the host worker to the BB server, then BB's existing authenticated viewer WebSocket. Video packets remain binary; they no longer pass through JSON/base64 host RPC results. The private port binds only 127.0.0.1 and requires a random single-use 256-bit bearer credential, which is never sent to the viewer. Each relay remains bound to its owning browser session and viewer lease.

A six-frame sliding window replaces the old batch barrier: one acknowledgement permits one replacement frame while the others remain in flight. Encoder queues remain capped at 60 packets / 4 MiB, with a byte threshold for the relay window and a five-second stalled-receiver cutoff. Frames are decoded in order; encoded delta frames are not arbitrarily dropped. Browser URL/status reads run separately so a slow metadata query does not block video delivery. Encoder stop closes the private listener and viewer connection. Stream failures retain JPEG fallback.

This optimization works when the browser host and BB server share loopback networking. On other connected machines, a failed authenticated loopback handshake leaves the existing host RPC fallback in place. This is not WebRTC or a direct connection from the user's device to the host. Human input still uses the existing CDP control route. The software-decoder preference, fixed resolution, single-viewer limit, and known receiver memory retention are unchanged.

## Validation method

The existing disposable 1280 × 800 animated fixture compares the original custom relay against the new relay. Both use the same viewer/decoder, with an artificial 80 ms delay on each viewer acknowledgement. The delay does not simulate full WAN conditions: media delivery and input are still local, and bandwidth/loss are not shaped. The old fixture also omits actual BB host RPC overhead. Runs are short and sequential on a shared server, not repeated statistical trials.

```sh
node --import tsx tests/display-engine-benchmark.mts custom 10 --ack-delay=80 --lifecycle --no-bfcache
node --import tsx tests/display-engine-benchmark.mts custom 10 --binary-relay --ack-delay=80 --lifecycle --no-bfcache
```

The first candidate attempt was invalid because the test proxy forwarded text ACKs as binary messages, causing protocol rejection and repeated reconnects. The corrected proxy forwards ACKs as text, matching the real BB route. The recorded candidate JSON is the corrected run. The old run also overlapped a unit-test run during its later lifecycle/latency phases, so its tail latency is additionally confounded by CPU contention; it should not be used as a stable quantitative latency baseline.

Network tests cover invalid credentials, single-viewer access, six-frame bounded delivery, resuming after one ACK, listener/encoder cleanup on disconnect, and integration through BB's WebSocket handler without any `videoRead` RPC calls. Private credentials are absent from outgoing viewer messages. Original RPC fallback tests remain in place.

## Results

| Relay | Presented FPS | Mbps | Visual median / p95 | Input median / p95 |
|---|---:|---:|---:|---:|
| [Old batch relay](batch-ack80.json) | 7.9 | 1.52 | 707 / 4019 ms | 1403 / 6246 ms |
| [Binary sliding window](binary-ack80.json) | 16.5 | 1.76 | 452 / 3504 ms | 1328 / 3492 ms |

The new path delivered more frames in this diagnostic run, but it still suffered multi-second delays. These results do not establish acceptable remote interaction or 60 FPS. Receiver PSS was 839 MiB active and 759 MiB after disconnect; memory retention is unresolved. Server PSS was 412 MiB active and 259 MiB after encoder shutdown. The reported candidate used synchronous fixture metadata; the final relay moves real metadata reads off the delivery path and retains the same packet window.

Deploy as the requested next trial, with automatic fallback retained. Measure the actual client using `/viewer-metrics`; `transport` distinguishes `h264-binary`, `h264-rpc`, and `jpeg`. A video's requested frame rate and a page's animation counter are not client presentation measurements.
