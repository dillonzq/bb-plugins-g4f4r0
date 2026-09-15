# Remote scrolling, 15 September

The user tested jackfir.com through g4f4r0.getbb.app with one H.264 viewer. Scrolling, especially alongside marquee animation, remained the worst interaction. Timing samples confirmed gaps exceeding a second, while typical decoding remained below 10 ms. Available server memory stayed above 5.68 GiB during the resource capture. This does not rule out CPU scheduling, rendering, encoding, or network pressure. The capture contains only timing summaries, not a frame-by-frame attribution of each action. Idle periods naturally increase frame gaps.

The binary relay previously adapted capture FPS on encoder backlog overflow but never adapted video bitrate to delayed display acknowledgements. The new controller reduces 4000 → 3000 → 2250 → 2000 kbps after sustained delay (at least six slow ACKs over two seconds), at most once per five seconds. The threshold accounts for the best observed round trip, with a 300 ms floor and 500 ms ceiling. It holds quality steady after reducing it; a new viewing connection resets the controller. No Chrome restart or viewport resize is involved. The pinned Selkies `vb` opcode updates the encoder live.

ACK delay includes network transfer, decoding, painting and return transport; this is a pressure signal, not a measurement of network latency alone. Reducing bitrate trades some motion detail for less traffic. It cannot remove geographic latency or guarantee local-browser responsiveness.

`display-engine-benchmark.mts --video-kbps=2500` now serializes binary delivery at 2.5 Mbps. Together with `--ack-delay=80 --scroll --binary-relay`, this exercises limited bandwidth and scrolling. `--fixed-bitrate` observes adjustment decisions without applying them, providing the control run. Unlike a full network emulator, this does not introduce packet loss or rate-limit the independent input connection.

## Controlled comparison

The 2.5 Mbps test did not congest: no adjustments were requested in either run (~26 FPS). The 1 Mbps test exercised all three reductions. Sequential 20-second scrolling runs with 80 ms additional ACK delay produced:

| Metric | Fixed bitrate | Adaptive bitrate |
| --- | ---: | ---: |
| Delivered FPS | 6.26 | 12.97 |
| Aggregate CPU cores | 1.37 | 1.05 |
| Server CPU cores | 1.03 | 0.72 |
| Frame gap p95 (ms) | 290.4 | 135.4 |
| Maximum frame gap (ms) | 319.2 | 183.5 |
| Gaps over 250 ms | 33.0 | 0.0 |
| Server PSS at end (MiB) | 445.3 | 441.3 |
| Client PSS at end (MiB) | 840.6 | 838.9 |

This small synthetic run supports the congestion response, not a claim of 60 FPS, local-browser latency, or a measured improvement on the user’s connection. Both compared runs completed all 12 visual/input checks. Shared-server load can vary between runs. Raw synthetic data: pressure-congested-before.json and pressure-congested-after.json. The runtime received bounded live bitrate updates without recreating Chrome. Remote user confirmation remains outstanding.
