# Browse: thread-host implementation and validation

Validated on 2026-09-13 with BB 0.43.1, SDK 0.4.87, Agent Browser 0.37.1 and Chrome for Testing 153.0.8010.36. Managed live tests ran on this thread’s Debian 13 x64 server (`host_wzbe6egp4i`), independently of desktop client `pro`.

## Delivered behavior

- Managed start resolves the thread’s environment host. No client browser instance is required, and failed setup never falls back to another machine. If the thread changes hosts, subsequent actions stop the old browser and require a new session on the current host.
- Isolated profiles, owned Chromium processes, loopback-only CDP, pinned page targets, serialized actions, cancellation and 30-minute expiry. Release/close/reload stops Chrome and preserves profiles/artifacts. Reconnect reopens a fresh page with cookies/local storage; it does not restore unsaved DOM state.
- Explicit native mode retains the existing BB desktop-tab adapter and control leases.
- Settings only: machine selector, runtime version, real Chrome launch check, FFmpeg check, and asynchronous dependency installation. No global navigation panel or new-tab launcher registration.
- Debian/Ubuntu dependencies are downloaded/extracted into Browse’s private directory, without sudo. Existing active managed sessions must be closed before dependencies are updated.
- Authenticated on-demand viewer with periodic JPEG frames, click, scroll, keys, typing/paste, and a bounded input queue. Input shares the automation session lock. Closing the viewer leaves the browser active.
- Browser-native button downloads, authenticated link downloads, native printable PDFs, page/canvas PNGs and WebM recording.

## Evidence

- [Final installed-build smoke check](validation/managed-final-smoke.json) passed thread-host startup, guarded viewer frames and a guarded page action after the final reload. All managed test sessions were then closed.
- 59 automated tests cover server/host boundaries, ownership, thread placement changes, cancellation ordering, restored-profile tabs, Settings RPC behavior, downloads, transport, gestures, observations and existing native behavior.
- [64 live interaction checks](validation/managed-edge.json): ambiguous/moving/replaced/covered targets, disabled/read-only controls, masked fields, Unicode, shadow DOM, iframes, checkboxes/selects, partial batch failure, screenshots, canvas, downloads, PDF and recording. All 64 passed.
- [22 managed lifecycle checks](validation/managed-lifecycle.json): exactly-once download trigger and byte comparison, PDF, viewer frames/input, recording, competing-input rejection, cancellation, profile storage after reconnect, retained artifacts and process termination. All 22 passed on the final host implementation.
- [8 viewer browser checks](validation/managed-viewer.json): a second managed browser opened the real installed HTTP viewer; a click and 15 rapidly issued characters reached the subject page in order. All 8 passed.
- Installed Settings page opened in BB. Selecting `server` and clicking **Check dependencies** produced “Browser launched successfully,” engine 0.37.1, Chrome launch verified, and FFmpeg ready. [Screenshot](validation/artifacts/managed/settings.png).
- [Installer job](validation/managed-setup.json) succeeded through the installed CLI/RPC/host path. [Host health](validation/managed-health.json) confirms the server placement and dependencies.
- A local-origin viewer frame request returned HTTP 200. A POST with `Origin: https://untrusted.example` returned HTTP 403 from BB’s real route authentication.
- WebM was decoded with FFprobe: VP8, 1280×800, 2.8 seconds in the initial managed recording test. The final lifecycle test also generated a nonempty video.

Artifacts: [viewer screenshot](validation/artifacts/managed/viewer.png), [recording](validation/artifacts/managed/recording.webm), [PDF](validation/artifacts/managed/page.pdf), [downloaded bytes](validation/artifacts/managed/button.txt).

## Findings corrected during development

Chrome was installed but initially lacked Linux libraries. The original doctor-message parser also missed the different message returned by a runnable Chrome. Private libraries, including FFmpeg’s PulseAudio/BLAS/LAPACK search paths, resolved those issues. Diagnostics now verifies an actual launch.

The frontend harness caught undefined values in a Settings RPC payload; optional keys are now omitted. A live reconnect exposed restored extra Chrome tabs; managed connections now create/select a fresh target explicitly, while native connections remain strict about leased tabs. Managed cancellation now stops the owned process after pointer release so a detached daemon cannot keep acting. Viewer keystrokes are queued, avoiding loss during overlapping requests.

## Limits and measurement scope

This is a custom web viewer, not BB’s native Electron browser embedding. It refreshes approximately every 800 ms plus capture/transport time; it is not a high-frame-rate remote desktop. Use agent actions for dragging, uploads and downloads. Screenshots capture web-page content, not BB/OS window chrome.

Managed mode was live-tested on Debian x64. Native mode retains its prior macOS evidence in EDGE-VALIDATION.md and its regression tests. Managed macOS, Windows and Linux ARM launches were not live-tested. Automatic private Linux dependency installation requires apt/dpkg; other distributions need system preparation. FFmpeg is checked on every platform, but the installer provisions it only through the Debian/Ubuntu dependency path.

The 64-check run completed and wrote all passing rows, though its outer exec session later reported exit 143; this report uses the individual operation results, not that process exit as evidence of success. The final lifecycle and viewer scripts exited successfully.

Observed managed connect jobs took roughly 1.6–2.1 seconds; example screenshots took 29–54 ms in the host, and example field-state reads took 7–20 ms. These are local development observations, not controlled competitor benchmarks or a universal success score. Earlier failed development runs are described above; final results are linked separately.

## Multiple-machine Settings update

Replaced the machine selector with BB-style per-machine sections. A lightweight machines RPC reports connection state without discovering desktop browser instances. Each connected machine checks independently and has its own Recheck/Install controls; offline machines show a compact offline row. Frontend tests verify independent results, skipping offline probes and installation on the intended host while other machines remain interactive. All 60 automated tests and type checking passed; build/reload succeeded. Live checks verified Chrome on server (Linux x64) and pro (macOS ARM64), with neo offline. A temporary-profile cleanup race found during these checks now retries cleanup without incorrectly marking a successful Chrome launch as failed. [Screenshot](validation/artifacts/managed/settings-machines.png).

## Resource, reuse and concurrency audit — September 13

This audit found and corrected duplicate managed starts, retained abort listeners, cancellation of already-completed jobs affecting a live browser, unbounded payload size in job history, concurrent release/connect races, stale busy metadata, and daemon cleanup after Chrome exits. The engine's close command must omit `--cdp`: attempting to reconnect to an already-stopped browser prevented daemon shutdown. Fourteen verified old Browse daemons were closed; two more from the previous build's disposal were cleaned up. No broad process kill was used.

Managed starts now serialize per thread and reuse a ready/connecting page at the same current URL on the same execution host. `newTab:true` forces isolation. A different URL opens another browser; navigate an existing session with `open` when that is intended. Reuse preserves DOM state and never navigates a page or takes another thread's browser. Release is idempotent. Session IDs are reserved before filesystem work. Dependency updates are blocked during active managed launches/checks. Completed jobs remove their cancellation listeners; aborted non-gesture sessions release their worker lease and automation process. Completed job history has an 8 MiB serialized-payload/200-entry eviction budget, except running jobs and the newest result. This does not cap Chromium or total host-worker memory. Profiles and artifacts remain on disk.

The live viewer now reads current viewport geometry for frames and scrolling. Three runs against the real engine verified 390×600 frames, exactly-once coordinate clicks, scrolling and cancellation cleanup. The saved JPEG is also 390×600. These checks used the SDK host harness with the real installed Chromium and engine, independently of the running BB worker.

Validation:

- 68 automated tests in 16 files passed; TypeScript checking and plugin build passed.
- [Ten-cycle live resource/reuse run](validation/resource-audit.json): 43 checks passed, including 80 concurrent reuse requests, retained page state, completed-job cancellation, explicit separate-session isolation and concurrent closing. No audit browser/daemon processes remained after each cycle.
- End-to-end median fresh start: 2260.5 ms. Median reused start: 684 ms. Timings include CLI process startup and BB RPCs, use `about:blank`, and were measured on a shared server, not a controlled benchmark.
- Active blank browser plus automation process and descendants: 284–325 MiB proportional set size (PSS), sampled once per cycle. BB server/host-worker memory, disk cache, profiles and artifacts are excluded. This is not a claim of minimum memory or total plugin cost.
- [Real host cancellation/viewport run](validation/host-audit.json): 30 checks passed over three cycles.

An initial resource assertion counted another thread's newly opened browser. The measurement was corrected to scope process accounting to audit-owned profiles/daemons; no unrelated browser was closed. A direct-host fixture initially used an overlong session ID and hit the Unix socket-path limit; it now uses short IDs like the normal server path.

Remaining validation limits: these are short repeated checks, not an overnight soak or exhaustive network-loss, OS-crash, hard-kill and multi-machine failure matrix. A forcibly killed host worker can bypass graceful cleanup. Browser memory depends heavily on the website. Windows and Linux ARM still lack live coverage; the latest resource audit is Linux x64. Do not label this implementation “10/10,” “race-free,” or “minimum memory.”

A [three-cycle process confirmation](validation/resource-audit-confirmation.json) passed all 15 checks, retaining observed daemon PIDs in the process accounting even after socket/PID files disappear. Median start/reuse was 2678/776 ms in this separate shared-server sample. Combined new live checks: 88 passing checks.

Deployment status at the end of this audit: same-URL reuse, scoped daemon shutdown, history bounding and initial lifecycle fixes were built and reloaded into BB. The final build additionally includes automatic release after non-gesture cancellation, clearing stale busy metadata, and viewport-aware viewer frames/scrolling. That final build passed the automated checks and real-engine host harness. Its BB reload is deferred because another thread has an active Browse session; reloading would close that session. No promise of uninterrupted browser survival across plugin reloads is made.

## Final three audit loops — September 13

1. **Concurrency and lifecycle review:** reproduced a circular cleanup wait when releasing an active job. The job's finally block waited for session release while session release waited for the job, forcing the 1800 ms fallback. The regression test failed at 1802 ms before the fix. The finally block now lets an already-running session release own cleanup. All 69 automated tests, TypeScript checking and the plugin build passed.
2. **Interaction accuracy:** [64 live checks](validation/final-loop-2-edges.json) passed, covering moving/replaced/covered elements, unique selector enforcement, disabled and read-only fields, Unicode input, shadow DOM, iframe input, partial batch/sequence failures without replay, canvas export, downloads, screenshots, recording and PDF.
3. **Real lifecycle and resource checks:** [42 real-engine host checks](validation/final-loop-3-host.json) and [15 installed-plugin resource/reuse checks](validation/final-loop-3-resources.json) passed. Three fixed active-job shutdowns took 71, 90 and 132 ms, with all worker leases released. Three resource cycles each exercised eight concurrent starts and five concurrent closes; audit processes returned to zero after every cycle. Median end-to-end reuse/start was 798/3184 ms. PSS samples ranged 226–380 MiB during concurrent testing on this shared server; this variability does not establish a memory improvement or regression against previous samples.

[Final machine-readable result](validation/final-three-loops.json): 69 automated tests plus 121 live checks passed. All audit-created browsers were closed. These three audit loops are complete. The latest build includes the shutdown fix and the prior pending viewer/cancellation/busy-state changes; it was verified with the real-engine host harness. BB reload remains deferred to preserve the active browser belonging to thread `thr_k5hmq4xgp3`. The installed worker's interaction/reuse tests and the latest source's host-harness tests are distinct evidence, not a claim that the latest build has been deployed.
