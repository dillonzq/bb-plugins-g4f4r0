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
Use `BROWSE_TEST_PORT=46115` to retain the same test URL when restarting.

Signaling is proxied through the shared HTTP server. Video prefers direct ICE/UDP, with passive ICE-TCP fallback on port 59010.
The remote receiver uses Google STUN for NAT discovery; the public server
uses ICE-lite. There is no TURN relay in this prototype. Networks that block
both UDP and direct TCP to that port can still fail even when the viewer loads. Do not expose this unauthenticated
loopback fixture through a public tunnel without access control. Full plugin
integration still needs authenticated per-session signaling, reconnect handling,
measured remote results, and a fallback for networks that block direct UDP.

## Remote connection repair

The first remote attempt reached signaling but never established ICE. Its
client supplied only mDNS host candidates, which the server could not resolve;
that does not alone prove the cause, because client-initiated checks to a public
server can still work. There was no client STUN configuration or TCP fallback.

Added client STUN, server ICE-lite, fixed UDP/TCP mux ports, bounded diagnostic
reports (connection state, decoded frames, bytes, RTT, protocol; no SDP), and a
25-second visible failure with Retry. The same URL was restarted. The isolated
live smoke check verified actual frames and the visible failure state. Remote
client success is still awaiting a retry; no claim that its network is fixed.

`npx tsx tests/webrtc-live.mts HOST_DATA http://127.0.0.1:46115/viewer?id=bench`

Run this only before handing the single-controller prototype to the user: a
second receiver replaces the current controller. Production sessions are not
affected.

## Second remote failure: reachability

The remote receiver gathered STUN server-reflexive candidates, but remained in
ICE checking. Its signaling socket closed before the 25-second UI timeout.
Added a two-second application keepalive, filtered out by the signaling proxy,
and close-code logging on both sides. The exact source of that socket closure
has not yet been established.

A probe run on the enrolled `pro` machine timed out connecting to TCP 59010 on
both the public server address and its Tailscale address. The server had active
listeners on both addresses. `/etc/ufw/ufw.conf` has `ENABLED=yes`; inspecting
rules or changing them requires sudo authentication, unavailable to this agent.
This establishes an unreachable TCP fallback, not proof of the exact firewall
rule or of UDP failure. Further remote testing requires fixing direct media
reachability or adding a reachable TURN relay. BB Connect's HTTP share alone
does not forward this port. Do not claim another retry will solve it.

## Embedded BB test

`--remote-test --embedded --binary-relay` writes a 30-minute, owner-readable
endpoint capability to `~/.cache/browse-stream-bench/embedded.json`. The temporary
HTTP/WebSocket fixture rejects requests without its random bearer token. BB's
normal authenticated routes proxy only the enumerated test endpoints; arbitrary
client-supplied URLs and ports are not accepted. The token remains server-side.
No Connect share or public port is needed for the viewer/signaling path.

Open a Browse `live` panel with `paramsJson: {"streamTest":true}`. This renders
the test iframe directly inside BB, rather than inside another managed Chrome.
It is an isolated Jackfir browser, not a user's existing session. The overlay
identifies Trying WebRTC, WebRTC, or Current stream · WebRTC unavailable. ICE
failure/timeout switches to the existing binary H.264 relay. This fallback
is not evidence that remote WebRTC works. The existing network blocker remains.

The opt-in live check with `--embedded` verified actual WebRTC frames followed
by actual H.264 frames after a forced connection failure. The fixture cleans
its capability file and browser processes on timeout/shutdown. The persisted
BB test tab then shows that the test has ended. Tailscale Serve still requires
administrator access and has not been configured.
