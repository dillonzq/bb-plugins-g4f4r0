# Responsiveness trial

2026-09-15. The user prioritizes reaction speed over picture quality.

The viewer now lets WebCodecs choose its decoder instead of forcing software. The encoder target drops from 8 to 4 Mbps. When the local encoded backlog exceeds eight frames or its 1 MiB threshold, it acknowledges/discards the old backlog and resumes only at a keyframe. Requests are throttled with a 550 ms retry while waiting, including when capture becomes silent; recovery and stop clear the retry. A single frame retains the existing 4 MiB ceiling. In-flight relay packets are still bounded separately to six and are not discarded.

Sequential disposable fixture runs: `npx tsx tests/display-engine-benchmark.mts custom 10 --binary-relay --ack-delay=80`. Both browsers run locally. Only acknowledgements have artificial delay; this is not a full WAN simulation. CPU and PSS include source and receiver Chrome, X display and encoder. Shared-host load and short single runs limit conclusions.

| Candidate | Delivered FPS | Input-to-pixel median / p95 | Change-to-pixel median / p95 | Mbps | CPU cores | End PSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before | 11.64 | 1245 / 2843 ms | 610 / 3348 ms | 1.32 | 1.27 | 1137 |
| Decoder and bitrate only | 13.02 | 916 / 3429 ms | 618 / 3375 ms | 0.82 | 2.08 | 1236 |
| Bounded backlog and recovery | 23.48 | 508 / 1126 ms | 219 / 901 ms | 1.51 | 3.23 | 1269 |

Raw data: latency-before.json, latency-after.json, latency-bounded.json. Initial backlog candidate without throttled retries failed rendered latency sampling (6/12) and was not deployed. The corrected run completed all 12 visual and all 12 input samples. The test does not directly quantify scrolling fidelity, and 60 FPS/instant input remains unachieved. More frames increased CPU and bandwidth versus baseline; this is not a memory or CPU saving claim. Real remote-client validation remains necessary.

## Capture cadence follow-up

User reports improved responsiveness but alternating sharp/blocky frames and half-second pauses. Candidate caps capture at 30 FPS (same 4 Mbps budget) and reduces keyframe retry to 300 ms, above the pinned encoder's 250 ms controller throttle. A second recovery inside the throttle window now schedules its remaining delay even when no further frames arrive. Regression coverage includes this silent second recovery.

Same short delayed-ACK fixture completed all samples: delivered 18.05 FPS, input-to-pixel median 293 ms / p95 534 ms, change-to-pixel median 82 ms / p95 122 ms, 2.83 aggregate CPU cores, 1.96 Mbps. Raw cadence-30.json. Compared with the preceding run, latency and aggregate CPU improve while delivered FPS decreases and bandwidth increases. This is a responsiveness tradeoff, not a claim of higher FPS or measured picture fidelity. Shared-server variability and local-only media/input remain limitations; remote visual comparison is outstanding.
