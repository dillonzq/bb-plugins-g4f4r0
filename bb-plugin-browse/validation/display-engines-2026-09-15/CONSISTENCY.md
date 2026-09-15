# Consistency follow-up

The encoder now backs off only after two backlog overflows within five seconds. Capture steps from 30 to 24, 20, then 15 FPS, at most once per five seconds. It does not automatically accelerate again during that encoder/viewing connection; reopening creates a fresh 30 FPS stream. This deliberately avoids repeatedly returning to an unsustainable rate. Uses the pinned runtime's `_arg_fps` live-update opcode; Chrome, credentials and the encoder are preserved. Bitrate and dimensions remain fixed. Unit coverage checks repeated-overload detection, cooldown and the minimum rate.

The benchmark records gaps between actual canvas paints during the active measurement interval, bounded to 20,000 samples. A `--scroll` workload adds a long page and sends wheel events through the viewer's direct-input queue every 33 ms, reversing every 60 events, for the active interval. The fixed 20-pixel signal square remains available for subsequent visual/input latency measurements. Continuous-scroll results and ordinary animated-fixture results are different workloads and must not be compared as an A/B improvement.

Sequential animated-fixture runs: `custom 20 --binary-relay --ack-delay=80`.

| | Before | Adaptive capture |
| --- | ---: | ---: |
| Delivered FPS | 18.47 | 17.45 |
| Input median | 358 ms | 229 ms |
| Input p95 | 1356 ms | 492 ms |
| Frame-gap p95 | 124.5 ms | 123.1 ms |
| Maximum frame gap | 261 ms | 307 ms |
| Gaps above 250 ms | 1 | 1 |
| Aggregate CPU cores | 2.98 | 3.46 |

Input-latency tail improves in this short comparison, but displayed-frame consistency does not materially improve and CPU was higher. Shared-server load changed during sequential runs, so neither causality nor durable CPU savings is established. This is not a full network simulation: only ACKs have artificial delay; video and input travel locally. Raw files consistency-before.json and consistency-after.json. Remote scrolling quality remains a user-side validation requirement.

Sustained-scroll candidate run (`--scroll`): 23.66 delivered FPS; frame-gap measurements {"samples": 564, "p95": 78.29999999701977, "max": 149.5, "over250": 0}; input median 229 ms / p95 353 ms after scrolling; 3.05 aggregate CPU cores. All 12 visual and 12 input samples completed. Raw consistency-scroll.json. No scrolling baseline was measured in this trial.
