# Browse interaction and performance validation

Validated on the Linux server on 2026-09-15 (Berlin). This work targets interactive viewing of the same browser session used by the agent. It does not establish an absolute performance optimum or exhaustive website compatibility.

## Shipped design

- Stagehand remains the agent automation engine. Human input uses a separate authenticated, session-bound WebSocket and direct CDP input; it creates no agent jobs.
- Pointer capture, dragging, text selection, keyboard down/up events, editing shortcuts, Unicode paste and composition commits reach the selected browser. Pointer motion and compatible wheel events coalesce.
- Input is ordered, bounded, and never replayed after reconnect. Disconnect, blur and a lost heartbeat release held buttons/keys. Long holds maintain a heartbeat. Agent work and private credential entry exclude competing viewer input.
- JPEG quality 80, capture up to 1920 × 1080, binary viewer delivery. At most eight frames / 4 MiB await acknowledgement; one additional bounded frame may be held while waiting for byte credit. The viewer retains only the latest pending encoded and decoded frames. Decoded bitmaps close after replacement or drawing.
- Capture acknowledgements allow a 50 ms read-ahead window for active consumers, then withhold credit when demand stops. Every frame is acknowledged individually, including frames carrying the same CDP session ID. Hidden documents and CSS-hidden BB panels stop their connections. Capture stops after 12 seconds without frame requests; the page remains available for later automation until normal session expiry. Closing the session tab releases Chrome. Profiles survive release; unsaved DOM does not survive a later reconnect.
- Host identity stays in the lower-right corner. The existing BB-style toolbar, Hugeicons, tooltips, transparent copy action and status dot remain.
- Console history and request history now cap the size of individual retained entries as well as their count.

## Measurements and scope

All measurements below used disposable local fixtures. The viewer ran against the installed plugin through BB's HTTP/WebSocket routes. They are **not measurements from the user's remote authenticated BB client**. A fetch to the public viewer without that authentication correctly returned HTTP 403.

| Check | Result | Scope |
| --- | --- | --- |
| Earlier JSON stream | 44.78 received FPS over 10 seconds | Receipt, not displayed frames; not an identical comparison |
| First binary viewer check | 56.44 displayed FPS over 18.3 seconds | Local, short run; about 15.39 Mbps JPEG payload |
| Automation-enabled viewer browser | 42.48 displayed FPS over 180.3 seconds | An extra Stagehand-enabled Chrome was itself displaying the stream; this adds substantial test overhead |
| Plain viewer, sustained run | 52.39 displayed FPS over 600.7 seconds; 14.56 Mbps JPEG payload | Ten-minute run against revision 2697a12 |
| Click to displayed pixel before render refinement | 129.7 ms median; 163.8 ms p95; 167.1 ms max | 30 synthetic viewer clicks, including local transport and rendering; excludes physical OS input and WAN |
| Render revision | 49.09 displayed FPS over 120.2 seconds; click median 127.3 ms, p95 151.9 ms, max 349.5 ms | Revision de5081e; shared server load and 30 synthetic click samples |
| Capture pacing revision | 48.97 displayed FPS over 120.1 seconds; final intervals 58–59 FPS | Revision 3b61735; 13.56 Mbps JPEG payload |
| Final static-recovery revision | 53.73 displayed FPS over 60.1 seconds; 115.3 ms median / 150.2 ms p95 / 164.7 ms max click-to-display | Revision acecad6; 15.33 Mbps JPEG payload; 30 click samples |

Input acknowledgement is a different metric from visible response. Individual acknowledgements ranged from about 15 ms to hundreds of milliseconds under load. One earlier 30-click sample measured 114.6 ms median, 569.5 ms p95 and a 1,195.7 ms maximum visible-response delay. The latest sample after the static-recovery fix was better (table above), but these small shared-host samples do not prove that long-tail stalls are eliminated. It would be misleading to describe the entire click-to-display path as 15 ms.

The plain viewer has no Stagehand extension of its own, matching the separation between a user's BB client and the automation browser more closely. The earlier nested automation-viewer test showed much larger memory overhead in its extension process. This is an observation about that test setup, not a diagnosed upstream memory leak.

Aggregate RSS double-counts shared Chromium mappings. Memory checks therefore also sum Linux proportional set size (PSS) and private pages across each owned process tree. These figures cover Chrome trees, not all BB server processes. JavaScript heap is reported separately and is not total browser memory.

During the sustained run, the automation Chrome tree stayed within 382.7–392.1 MiB PSS (207.9–218.6 MiB private pages); the plain viewer tree stayed within 321.1–353.3 MiB PSS (152.5–182.2 MiB private pages). Viewer JS heap samples ranged from 0.74 to 1.53 MiB. The source PSS ended lower than its first sample; neither tree showed sustained growth over this interval. Both owned process trees reached zero processes after cleanup. This is a finite soak result, not a proof that no page can leak memory.

The static recovery test was strengthened to make five successive changes while paused. It exposed stale cached frames; revision acecad6 restarts capture when resuming from a backed-up stream, forcing a fresh compositor image. The final live matrix passed, including the strengthened five-change case: the latest static image appeared within 74 ms of resumption. Discovery also now derives its managed lifetime from the actual 15-minute timeout instead of the stale eight-hour value.

## Checks

- Typecheck and 139 automated tests passed across 25 files before final deployment.
- Live fixture checks: ordinary DOM key events, text selection/copy/cut through clipboard events, Unicode paste, composition committed once, multiline Enter, modifiers held longer than five seconds, pointer release after control disconnect, input after reconnection, hidden-panel suspension and visible-panel resumption.
- Real browser gestures in the earlier interaction run selected text, clicked inputs, moved a draggable element and scrolled the remote page. The reusable scripted matrix uses synthetic viewer events and does not independently validate operating-system pointer capture.
- Live slow-client check: delivery stopped at three unacknowledged frames (97,797 JPEG bytes in that sample). Acknowledging one delivered a fresh sequence, jumping from 24,994 to 25,141 rather than replaying intervening frames.
- Final capture-side backpressure check: after three unacknowledged viewer frames, a 2.5-second stall advanced capture by only five additional frame sequences before the next acknowledgement. An earlier immediate-ack implementation advanced by 147 in a comparable stalled-viewer check. These are frame counts, not a direct CPU benchmark.
- Automated bounds cover both frame count and bytes, oversize paste bursts, input ordering and reset on disconnect, invalid protocol requests, AltGraph characters, composition duplication, bitmap disposal and oversized retained diagnostics.
- A live one-million-character console message returned an 8,433-character result with an explicit truncation marker.
- The strengthened five-change static-page test passed after the fix, with a fresh image in 74 ms. Automated coverage also checks concurrent resumption requests.
- Host allocation remains thread based. Installed Browse, Beacon, Sidetree, Dusk and Reserve sources were checked against the permanent checkout.

A pacing prototype reduced throughput to roughly 30 FPS because it deduplicated repeated screencast session IDs. Live protocol inspection showed 29 frames repeating the same ID. The final implementation retains one acknowledgement per frame and has a regression test for this case. The rejected-run metrics are retained for traceability.

## Remaining limits

- Sustained 60 FPS is not guaranteed by CDP screencasting. CPU encoding, Chrome rendering, server contention, network bandwidth and client decoding all matter. JPEG uses materially more bandwidth than an inter-frame video codec. The render refinement did not establish a statistically meaningful latency improvement in these small, shared-host samples. A future WebRTC/video transport needs a separate authenticated transport design and measurement; changing the automation SDK alone cannot solve that.
- The user's public-client FPS, latency and clipboard permissions still require an authenticated client trial. The bounded `/viewer-metrics` endpoint exposes recent displayed-frame and acknowledgement samples without page content or credentials.
- Native OS dialogs, file pickers, browser menus, audio, full DevTools UI, touch pinch/pan and accessibility semantics equivalent to the remote DOM are not provided by the canvas viewer. Existing agent tools still support file upload/download, inspection and other automation operations.
- Copying a selection inside a cross-origin iframe is not implemented by the top-document selection bridge. Password-field selections are intentionally excluded. Full real-OS IME and clipboard coverage is not established by synthetic event tests.
- Browser-reserved shortcuts may be consumed by the user's client browser. A streamed page cannot transparently replace every native browser behavior.
- Session expiry releases memory but cannot preserve unsaved page state. Profile retention supports later login continuity, not restoration of the previous DOM. Capture suspension preserves a still-running session; it does not freeze arbitrary page JavaScript.
- No live user credentials, Shopify configuration or ClickUp content were changed during this phase. Existing secure-login tests are part of the suite; no new real-account login was performed.

## Reference implementations inspected

[T3 Code's preview manager](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/preview/Manager.ts), [Synara's browser manager](https://github.com/Emanuele-web04/synara/blob/main/apps/desktop/src/browserManager.ts), and [Craft Agents' browser pane manager](https://github.com/lukilabs/craft-agents-oss/blob/main/apps/electron/src/main/browser-pane-manager.ts) use Electron browser surfaces. Their native rendering/input path differs from transmitting a server browser into a remote BB web client. Useful patterns were keeping input direct, separating browser state from presentation, and suspending hidden views. No source code was copied.

Protocol references: [CDP Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/), [CDP Page](https://chromedevtools.github.io/devtools-protocol/1-3/Page/), and [WebCodecs guidance](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs).

## Evidence

Raw fixture metrics are retained in [validation/interaction-2026-09-15](validation/interaction-2026-09-15). They contain timing, frame counts and process-memory samples, not credentials or real account content.

## Completion state

All disposable test browsers were released, the fixture HTTP server was stopped, and the final cleanup check found zero active Browse sessions and zero owned test Chrome processes. Temporary standalone browser profiles were removed. The plugin remains installed from the permanent checkout. The report automation is scheduled for 2026-09-16 at 09:00 Europe/Berlin in this thread.


## Adaptive streaming and transport comparison — September 15 afternoon

The viewer now reports capture tier and frame acknowledgement delay alongside displayed FPS, JPEG bandwidth, dropped frames and input acknowledgement latency. These are bounded, short-lived diagnostics without page content. Input acknowledgement latency is not the same as click-to-visible-pixel latency.

Capture starts at JPEG quality 80 (maximum 1920 × 1080). Sustained delivery delay above 180 ms or client decode/display delay above 35 ms lowers quality to 65 (1280 × 800), then 50 (960 × 600). Five healthy sampling windows restore one tier. Static pages do not need to produce 60 frames each second. The logical page viewport and input coordinates remain unchanged. Lower capture tiers trade text sharpness for responsiveness. The weakest active viewer controls the shared capture tier; its demand expires after 12 seconds. Recording forces full quality. Capture reconfiguration is serialized with concurrent requests.

### Reproducible transport experiment

Run `npx tsx tests/transport-benchmark.mts jpeg 20 [--adaptive] [--shaped]` or `... rtc 20` from the Browse package. The harness uses disposable Chrome profiles, an animated text-heavy canvas at 1280 × 800, and a separate local Chrome receiver. It removes its profiles and closes its browsers. The WebRTC prototype captures the actual source tab with test-only permission flags and uses local ICE candidates. It is not enabled in Browse or exposed to remote clients.

The shaped JPEG cases simulate an 8 Mbps link with 40 ms delay in each direction. This is application-level shaping, not a real WAN or an equivalent WebRTC network-shaping test. WebRTC uses its default codec and an 8 Mbps bitrate ceiling. All runs lasted 20 seconds after warmup, on the shared Linux host. They do not establish statistical significance or represent the earlier, lighter fixture's frame rate.

| Transport | Link | Displayed FPS | Mbps | Visual delay median / p95 | Chrome CPU cores | Combined Chrome PSS at end |
|---|---|---:|---:|---:|---:|---:|
| Fixed JPEG | Local | 8.2 | 19.04 | 345 / 704 ms | 3.23 | 605 MiB |
| Adaptive JPEG | Local | 16.1 | 12.04 | 282 / 597 ms | 3.53 | 602 MiB |
| WebRTC prototype | Local | 19.5 | 0.73 | 323 / 529 ms | 4.52 | 644 MiB |
| Fixed JPEG | Shaped | 2.1 | 5.45 | 678 / 1445 ms | 2.74 | 619 MiB |
| Adaptive JPEG | Shaped | 9.4 | 6.34 | 365 / 524 ms | 3.01 | 603 MiB |

Visual delay measures 12 source-pixel changes reaching the receiver, polled through local CDP. It excludes the incoming user-input network trip. CPU is average aggregate Chrome process-tree CPU time in cores; PSS includes source and receiver and excludes Node/BB/Xvfb. These short runs do not prove absence of memory leaks. The animated source itself rendered only about 32–38 FPS in these runs, limiting every transport.

Decision: enable adaptive JPEG, retain WebRTC as an experiment. Adaptive JPEG improved the shaped test from 2.1 to 9.4 FPS and reduced median visual delay from 678 to 365 ms. The local WebRTC prototype used dramatically less bandwidth and delivered more frames than fixed JPEG, but consumed more CPU and retained substantial visual delay. A production switch requires authenticated signaling, capture permission/lifecycle integration, remote ICE/TURN connectivity, reconnect handling and measurements from the user's actual client. No universal 60 FPS claim is supported.

References: [Chrome tab capture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture), [WebRTC getStats](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/getStats), [inbound video statistics](https://developer.mozilla.org/en-US/docs/Web/API/RTCInboundRtpStreamStats). Raw results: [transport comparison](validation/transport-2026-09-15).

Deployment validation: typecheck and all 150 tests passed (26 files, two test workers). An earlier run alongside browser benchmarks timed out in two UI tests; rerunning without benchmark contention passed. Runtime commit `f3bce64` was built and reloaded. Browse, Beacon, Sidetree, Dusk and Reserve were running from their permanent checkout paths.

The installed `/cast` path delivered 697 frames during a 35-second controlled-acknowledgement check, stepped from tier 0 through 1 to 2, and recovered to tier 0. JPEG headers confirmed 960 × 600 capture at the reduced tier while logical dimensions remained 1280 × 800. A frame already in flight can retain the preceding tier's raster size at a transition. The served viewer contained the updated acknowledgement protocol. No remote-client telemetry was available (`clients: []`), so this validates the installed transport, not user-perceived smoothness. See [installed check](validation/transport-2026-09-15/installed-adaptive.json) and [reusable live check](tests/live-adaptive.mjs).

The disposable installed test session was released and removed from Browse history; its loopback fixture server was stopped. All temporary transport-benchmark Chrome profiles/processes were cleaned up. Adaptive streaming is enabled; WebRTC remains an isolated benchmark, not a production transport.

### Display-engine comparison (2026-09-15)

[Selkies/KasmVNC benchmark report](validation/display-engines-2026-09-15/README.md) compares private extracted display engines with the adaptive JPEG reference, including server/client PSS, CPU, idle traffic, visible response to real clicks, and a three-minute soak. Selkies damage-based H.264 is the leading candidate for a remote-client prototype. This experiment did not replace or reload the production Browse viewer. See the report for resource-retention findings and the limits of local measurements.

### Opt-in video integration trial (2026-09-15)

[Prototype results and limitations](validation/display-engines-2026-09-15/PROTOTYPE.md): private Selkies encoder, isolated per-session displays, existing Browse UI/input, bounded authenticated relay, and explicit teardown. Real Stagehand/display-isolation tests passed. The custom receiver delivered roughly 31–35 FPS and retained about 766–773 MiB after disconnect on this server; it did not meet the acceptance criteria. No production switch or remote-client performance claim. The default remains adaptive JPEG.
