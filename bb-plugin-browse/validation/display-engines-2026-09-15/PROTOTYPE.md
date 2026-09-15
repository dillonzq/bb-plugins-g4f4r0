# Selkies integration experiment — 2026-09-15

**Rollout update:** The user subsequently requested full installation. Video is now the preferred transport for new managed sessions and reconnects, with automatic JPEG fallback. The findings below describe the earlier experiment and remain unresolved limitations; the rollout does not imply improved measurements.

## Outcome

The opt-in prototype works with Browse's existing toolbar and CDP input. It does **not** meet the smoothness/memory acceptance criteria. Keep adaptive JPEG as the default. The integration was tested locally, not through the user's authenticated remote BB client. Production was not reloaded: another thread has an active browser session, and the prototype results do not justify interrupting it.

The implementation uses Selkies only as a private H.264 encoder, an authenticated BB WebSocket route, and a small WebCodecs worker. This is video over WebSocket, **not WebRTC**. Stagehand still controls the same tab. No vendor desktop UI, audio, clipboard service, or extra AI model is used.

## Measurements

Short sequential runs on the same shared server; 10 seconds of active measurement plus warmup, idle, 12 visual transitions, 12 clicks, and disconnect checks. These are diagnostic trials, not confidence intervals. Client and source run on the same server; physical display presentation and WAN latency are unmeasured. The custom fixture bypasses BB's host RPC relay, so deployed performance can be worse.

| Trial | Presented FPS | Mbps | Client PSS active / after disconnect | Server PSS active / after disconnect |
|---|---:|---:|---:|---:|
| [Custom client, initial](custom-video.json) | 34.8 | 3.77 | 868 / 773 MiB | 412 / 255 MiB |
| [Custom client, reused pixel probe](custom-video-reused-probe.json) | 30.8 | 3.58 | 884 / 767 MiB | 409 / 254 MiB |
| [Custom client, software decoder preference](custom-video-software.json) | 31.9 | 3.64 | 879 / 766 MiB | 406 / 251 MiB |
| [Supplied Selkies client, reused probe](selkies-reused-probe.json) | 38.5 | 3.19 | 398 / 629 MiB | 406 / 339 MiB |

The software preference is a WebCodecs hint, not proof of the selected decoder. The custom worker explicitly closes frames and terminates on viewer teardown. The custom server encoder exits on disconnect; the vendor benchmark backend remains running until test cleanup, so its disconnected server memory is not directly comparable. Receiver memory remains substantial in both implementations. These measurements do not distinguish Chrome allocator retention from a leak or prove unbounded growth. They do rule out claiming the memory issue is fixed.

The initial pixel probe allocated a new one-pixel canvas for every read. The revised probe reuses one canvas and requests a readback context. This did not eliminate retention. A separate [vendor canvas-sink trial](selkies-canvas.json) also retained memory; replacing VideoTrackGenerator alone was insufficient. Earlier report figures remain the results of their original harness, not revised measurements.

The current custom software run measured 227 ms median / 329 ms p95 input-to-visible-change latency across twelve clicks. Source animation ran around 60 FPS; the receiver presented about 32. Lower bandwidth alone is not sufficient evidence of a better browsing experience.

## Isolation and lifecycle

[Real-process check](video-isolation.json), reproduced with `node --import tsx tests/video-isolation.mts`:

- Two managed Chrome profiles acquired different private X displays.
- Stagehand connected to each exact app-window target.
- The first display produced H.264 packets.
- Stopping the stream terminated its encoder process.
- Test profiles, browser processes, and private displays were cleaned up.

Unit tests verify opt-in routing to the selected host, no additional packets before acknowledgement, stop requests on disconnect, and rejection of video for normal shared-display sessions. They do not replace remote authentication testing. The implementation reserves each viewer lease before asynchronous encoder startup, waits for Chrome readiness, rejects a second video viewer, limits queued encoded data to 60 packets / 4 MiB, and stops a stalled reader. Decoder/backpressure errors fall back to the existing JPEG viewer.

## Reproduction and limits

The prototype is explicitly selected with `video: true` in the Browse `start` RPC/CLI. It is not a new default or a toolbar preference. A reload is required before using the new contract in a running installation. Reconnect preserves the flag. The selected host must be Linux; the installed private runtime in this experiment is Debian 13 amd64 / Python 3.13 only.

For this experiment the pinned Selkies package listed in [environment.json](environment.json) was extracted with `dpkg-deb -x` into Browse's host data directory as `selkies-runtime/`; Python modules live under `selkies-runtime/opt/selkies/lib/python3.13/site-packages`. Verify SHA-256 `ca42bc605fcfd0e396886a88a3d2844ef976e0cf43ff8d97e90432c3a340c0b9` before extraction. Nothing was installed system-wide. There is no cross-platform dependency installer for this prototype. Missing encoder dependencies cause fallback. Never reuse a shared X display for video capture or expose the Selkies port publicly.

Run custom measurements from the plugin directory:

```sh
node --import tsx tests/display-engine-benchmark.mts custom 10 --lifecycle --no-bfcache
```

Current limits: one video viewer per session, fixed 1280 × 800, no audio, H.264 4:2:0 text quality, no actual remote-client authentication/latency validation, no repeated-open/close memory soak, and no guarantee of 60 FPS or two-second startup. The BB relay uses bounded host RPC packets; it adds serialization and round-trip costs not present in the fixture. The lower-memory supplied client remains a comparison candidate; the custom decoder is not established as the best implementation.

Validation: package typecheck, 152 unit tests, four completed client/decoder comparison runs plus the vendor canvas-sink run, and the two-display real-process check. Keep the experiment off until client resource retention and relay performance are resolved and remote-client behavior is measured.

Packaging check: `bb plugin build` succeeded for backend, frontend, and host bundles in a disposable build-only copy using the permanent checkout dependencies. That copy was never installed and was removed after validation. The running installation and its bundles were not replaced. Runtime prototype commit: `74c5006`.
