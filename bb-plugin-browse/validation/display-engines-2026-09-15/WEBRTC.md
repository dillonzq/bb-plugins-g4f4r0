# WebRTC prototype — September 15, 2026

The installed Selkies runtime can deliver H.264 over WebRTC/UDP. The opt-in
benchmark now uses it with Browse's existing canvas presentation and direct
WebSocket input path. Production Browse is unchanged.

## First successful local run

`npx tsx tests/display-engine-benchmark.mts custom 15 --webrtc --scroll`

1280×800, 30 FPS target, 4 Mbps initial encoder bitrate, CPU encoding. Source
and receiver are separate disposable Chrome processes on the same server.
Fifteen seconds of automated scrolling, followed by idle and 12 visual plus
12 click-to-pixel samples. Raw results: `webrtc-local-scroll.json`.

- Displayed: 29.76 FPS.
- Frame gap: p95 47.9 ms; maximum 99.7 ms; none above 250 ms.
- Click-to-pixel: median 84.3 ms, p95 94.9 ms.
- Video-only change-to-pixel: median 50.5 ms, p95 57.9 ms.
- Combined source/encoder/display/receiver CPU: 1.09 cores; server portion 0.62.
- End-of-active server PSS: 455 MiB; receiver PSS: 901 MiB.
- Idle delivery remained around 10.6 FPS: still an optimization opportunity.

This establishes functioning video and input, **not a remote performance win**.
There is no matched WebSocket run yet. The fixture scrolls rows; it is not
Jackfir's combined marquee workload. The first result's `mbps: 0` is an
instrumentation limitation: the existing counter measured WebSocket bytes.
The harness now reads WebRTC inbound RTP byte counters for the active window.
Idle byte counters still omit RTP. ICE statistics in the raw result confirm
UDP connectivity; a same-host route does not validate a remote client's path.

## Temporary remote test

`npx tsx tests/display-engine-benchmark.mts custom 15 --webrtc --remote-test`

Starts an isolated Jackfir browser and prints a loopback viewer port. Expose
that port with `bb connect expose PORT`; the share requires the owner's BB
Connect session. Open the share in the client's external browser, not inside
another remote Browse viewer. This avoids streaming a stream.

The test uses WebRTC video, existing direct WebSocket input, no audio, no file
transfer, and no saved user profile. It exits and cleans up after 30 minutes
or SIGINT/SIGTERM. The updated harness also removes its Connect share on exit.
The first manually started instance predates that automatic unexpose change;
its share must be removed with `bb connect unexpose 46115` after testing.

Signaling is proxied through the shared HTTP server. Video uses direct ICE/UDP;
there is no TURN fallback in this prototype. A restrictive client network can
therefore fail even when the viewer URL loads. Do not expose this unauthenticated
loopback fixture through a public tunnel without access control. Full plugin
integration still needs authenticated per-session signaling, reconnect handling,
measured remote results, and a fallback for networks that block direct UDP.
