# Isolated display-engine comparison

This experiment runs synthetic content in disposable Chrome profiles. It does not change Browse's production transport, use account sessions, or expose the test viewers outside loopback.

## Reproduce

Linux x86-64 / Debian 13, Node 24, Python 3.13, and Browse's existing private Chrome/Xvfb dependencies are required. Kasm's extracted binary needs `xkbcomp` at `/usr/bin/xkbcomp`; the harness supplies that path through an unprivileged user/mount namespace and a temporary overlay. A host that disables unprivileged namespaces will need a different package setup. No system files are installed or modified.

Extract these packages beneath `~/.cache/browse-stream-bench`, into `selkies/` and `kasm/` respectively, using `dpkg-deb -x`. Package sizes and SHA-256 hashes are recorded in [environment.json](environment.json).

- [Selkies 2.0.0rc0, Debian trixie amd64](https://github.com/selkies-project/selkies/releases/download/2.0.0rc0/selkies-2.0.0rc0-trixie-amd64.deb)
- [KasmVNC 1.5.0, Debian trixie amd64](https://github.com/kasmtech/KasmVNC/releases/download/v1.5.0/kasmvncserver_trixie_1.5.0_amd64.deb)

From `bb-plugin-browse`, run one at a time:

```sh
node --import tsx tests/display-engine-benchmark.mts jpeg 60 --adaptive
node --import tsx tests/display-engine-benchmark.mts kasm 60
node --import tsx tests/display-engine-benchmark.mts selkies 60
node --import tsx tests/display-engine-benchmark.mts selkies 60 --damage-only
```

`--inspect` writes an engine screenshot into the cache and prints client state. `--lifecycle` also measures server resource use after disconnecting the viewing page. `--no-bfcache` disables receiver back/forward caching; `--teardown` explicitly stops its video tracks, closes its transport and terminates its workers before navigation, for lifecycle diagnosis. Engine stderr is retained in the private cache. All browser profiles and owned engine/display processes are removed when the harness exits normally or throws an exception. An external SIGKILL cannot run JavaScript cleanup.

## Method and limits

- Same 1280 × 800 animated canvas, Chrome binary and source flags; 24 text rows and continuously moving blocks. Source runs in kiosk/app mode with the Chrome-for-Testing infobar disabled. The receiver is a separate headless Chrome so it cannot obscure the source display.
- This improves the fixture over the earlier tab-capture experiment, so compare the engines within this dataset rather than comparing absolute FPS to the earlier report.
- Selkies uses software H.264 over WebSocket, WebCodecs decoding, and its video worker. Requested limit: 60 FPS, 8 Mbps CBR. The default continuous-video mode is compared with `--video-streaming-mode false`. This is not a WebRTC/UDP test.
- KasmVNC uses its supplied browser client, maximum 60 updates/s, with default adaptive region encodings. Its logs show JPEG and some WebP. Different codecs/quality settings mean equal dimensions do not imply equal visual fidelity.
- JPEG is a reference implementation using Browse's actual CDP capture and adaptive policy with its eight-frame/four-MiB delivery credits. It bypasses BB routing and is not a measurement of the installed remote UI.
- Selkies video FPS counts `requestVideoFrameCallback` callbacks; its canvas fallback counts worker presentation draws. Kasm counts animation cycles with canvas updates, avoiding counting each updated rectangle as a whole frame. JPEG counts drawn frames. These are client presentation proxies, not physical-monitor frame rates.
- WebSocket payload bytes include protocol messages for Kasm/Selkies; JPEG counts image bytes. Selkies' worker socket and canvas presentation are instrumented in temporary browser-generated JavaScript blobs, without modifying the extracted vendor files.
- Visual latency polls 12 red/green source pixel transitions. Candidate input latency sends 12 actual clicks into the viewer, through its input transport, and waits for the resulting source pixel to appear. Local CDP overhead is included; WAN delay is not. The reference JPEG fixture has no human input transport, so it has no input-latency result.
- CPU is process CPU time expressed as average cores. PSS apportions shared memory instead of summing RSS. Server figures include the source Chrome tree plus Xvfb/Selkies or Xkasmvnc; client figures include the receiver Chrome tree. The common Node test controller, BB process, OS page cache, and shared-host background activity are excluded.
- The server exposes a bochs display device but no hardware video encoder/render node. Both source and receiver compete on the same shared eight-vCPU host. Results are not independent repeated trials or a dedicated-machine capacity benchmark.
- Idle means the source stops painting while the viewer stays connected, measured for ten seconds after settling. It still has a cheap animation callback. A short idle interval and a minutes-long soak cannot prove absence of memory leaks.
- No actual user's remote client, NAT/TURN path, audio, clipboard, IME, file transfer, arbitrary website, multi-viewer collaboration, or login flow was validated in this experiment. Audio and other optional capabilities were disabled. The Selkies client still logged an AudioWorklet initialization error; video continued. That requires investigation before production integration.

## Results

These sequential runs use the configuration and local-only limits above. The continuous-video Selkies run lasted 30 seconds; the other comparison runs lasted 60 seconds. The longer damage-mode run lasted 180 seconds. Twelve latency samples per run are too few to establish a stable tail-latency distribution.

| Engine | Client FPS | Mbps | Visual median / p95 | Input median / p95 | Server PSS at end | Server CPU cores active / idle |
|---|---:|---:|---:|---:|---:|---:|
| [Adaptive JPEG reference](jpeg.json) | 30.1 | 25.98 | 146 / 368 ms | Not measured | 272 MiB | 2.48 / 0.10 |
| [KasmVNC](kasm.json) | 22.4 | 15.21 | 172 / 244 ms | 176 / 270 ms | 262 MiB | 1.57 / 0.13 |
| [Selkies continuous](selkies.json) | 46.6 | 3.58 | 83 / 216 ms | Not measured | 381 MiB | 1.32 / 0.85 |
| [Selkies damage mode](selkies-damage.json) | 45.6 | 3.55 | 73 / 203 ms | 127 / 240 ms | 372 MiB | 1.52 / 0.28 |
| [Selkies damage, 180 s](selkies-soak.json) | 47.4 | 3.64 | 83 / 201 ms | 149 / 212 ms | 377 MiB | 1.42 / 0.33 |

The initial raw candidate results contain a `dropped: 0` placeholder. Candidate dropped-frame counts were not measured; this is not evidence of zero drops. The final harness omits that field for candidates.

Selkies damage mode stopped delivering video frames on the idle fixture; the remaining approximately 0.00038 Mbps was control traffic. Its connected-idle server CPU was 0.28–0.33 cores, versus 0.85 in the continuous-video run. JPEG was about 0.10 and Kasm about 0.13 cores in their idle intervals.

The 180-second run settled from about 408 MiB during warmup to 372 MiB, then ended at 377 MiB. That modest upward drift needs a longer soak; this does not prove leak-free operation. Client PSS ended around 361 MiB. After navigating the receiver away, server PSS fell to 341 MiB and CPU to 0.15 cores, while client PSS rose to 597 MiB. The [cache-disabled follow-up](selkies-lifecycle-no-bfcache.json) still retained 636 MiB in the client after navigation, so disabling back/forward caching did not resolve it. The remaining targets were `about:blank` and two Chrome browser-UI targets, with no viewer worker targets reported. The [explicit-teardown follow-up](selkies-lifecycle-teardown.json), which stopped video tracks, closed the socket and terminated workers, still retained about 596 MiB after navigation. This is memory retention, not proof of a JavaScript leak; allocator or media-process retention still needs investigation. The [JPEG control](jpeg-lifecycle.json) fell from 337 MiB active client PSS to 257 MiB after navigation, with the same cache-disabled Chrome setup and target types. The retention therefore was not reproduced by the JPEG control; the Selkies/video path remains a production blocker until repeated open/close tests and actual BB iframe teardown establish bounded resource use.

[Negotiated settings](selkies-negotiated.json) were read from the running viewer: H.264, 1280 × 800, 60 FPS requested, 8 Mbps, 4:2:0 color, continuous streaming disabled. Its own instantaneous FPS counter read 58; the report uses the lower measured client presentation rate instead.

## Decision

Selkies damage mode wins the speed comparison, but its client memory retention blocks a production switch. It is the strongest candidate for an isolated authenticated remote-client prototype with explicit lifecycle diagnostics. In this fixture it delivered more frames with much less bandwidth and lower active server CPU than the JPEG reference, costing roughly 100 MiB additional server PSS. Kasm was the lightest server process group, but its frame rate and bandwidth did not win this comparison.

Keep production Browse unchanged until that prototype validates the actual BB remote client. Retain the existing JPEG path as a fallback. Integrate only the display/input transport under the existing BB toolbar and session identity; Stagehand automation can continue using the same Chrome session.

Before shipping: verify authenticated stream routing, viewer unmount/decoder teardown, last-viewer encoder shutdown, reconnect behavior, idle session limits, and remote latency/quality. Do not keep a video encoder running for every idle automation session. No universal 60 FPS, two-second startup, or memory-leak guarantee follows from this experiment.

Validation: the package typecheck and all 150 existing tests passed. The reference, both display engines, damage mode, a three-minute soak, click delivery, and the lifecycle control runs completed. Production runtime files were not changed.

## Integration follow-up

The [opt-in prototype](PROTOTYPE.md) adds the existing Browse UI and input to the Selkies encoder. It passed local display-isolation and encoder-cleanup checks, but its receiver memory and presentation rate did not meet the acceptance criteria. Reusing the benchmark pixel probe did not eliminate retention. Production remains unchanged; consult that report before treating Selkies as a validated replacement.
