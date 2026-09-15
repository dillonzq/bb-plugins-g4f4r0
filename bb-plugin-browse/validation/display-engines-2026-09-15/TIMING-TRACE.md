# Bounded remote timing trace

POST `/trace` with a session `id` and `durationMs` (1–120 seconds, default 90) enables collection. GET `/trace?id=...` returns up to 45 per-client report windows; unpolled records expire from the map when pruned five minutes after capture ends. At most 32 sessions are retained. The viewer receives remaining duration in its normal four-second presence response and stops collecting automatically. Each metric has at most 128 numeric samples per report; only count, median, p95 and maximum are sent. No input values, page content, screenshot, URL or cookie is added to the trace.

Metrics use local elapsed time, not comparisons between machine clocks:
- inputQueue: viewer event queue delay before sending; coalesced events preserve the oldest queued wheel timestamp.
- inputRtt: send-to-ack, including network, routing and host work.
- hostInput: host elapsed processing/checks/CDP dispatch for a batch, excluding transport.
- hostQueue: maximum encoded-frame queue residence in each host metadata interval.
- hostPacketGap: maximum gap between accepted encoded packets at the host (includes idle/capture/encoding/recovery delays).
- videoAck: relay send-to-display-ACK round trip; includes both directions of network and receiver work.
- receiveGap: interval between incoming video packets in the viewer.
- decode: WebCodecs submit-to-output elapsed time, including decoder queueing.
- paintWait: decoded-frame arrival on the main thread to its draw callback.
- paintGap: interval between displayed frames; idle pages naturally have large gaps.

These measurements do not separate Chrome rendering from encoding, identify which frame reflects a specific scroll event, or establish one-way network latency. A controlled visual marker page is needed for exact input-to-picture attribution. Compare windows with active input, exclude startup/idle transitions, and do not subtract p95 values as if they were paired samples. CPU/memory sampling is separate and includes other work on the server.
