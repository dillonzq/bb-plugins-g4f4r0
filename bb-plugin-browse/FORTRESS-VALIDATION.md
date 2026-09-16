# Fortress migration validation — 2026-09-16

Browse compared the previous Chrome 153 + Stagehand 4.1 stack, Chrome 153 + deterministic CDP, and Fortress 151 + deterministic CDP on the same Debian 13 x64 host. Each task loaded a local form, took an interactive observation, filled two fields, selected an option, checked a checkbox, submitted, clicked through an open shadow root, and verified the final state.

## Controlled task benchmark

| Stack | Success | Launch | Task p50 | Task p95 | Worst | Process-tree RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chrome + Stagehand | 30/30 | 666 ms | 770 ms | 1,092 ms | 1,106 ms | 1,623 MiB |
| Chrome + direct CDP | 30/30 | 337 ms | 433 ms | 627 ms | 6,764 ms | 1,501 MiB |
| Fortress + direct CDP | 30/30 | 443 ms | 502 ms | 627 ms | 1,156 ms | 1,193 MiB |

The process-tree RSS sample is a point-in-time comparison from one sequential run, not a steady-state PSS study. Shared-host load and browser caching can move these values. The task timings support removing Stagehand from the production path: both direct-CDP variants had materially lower median latency. Fortress was slightly slower than direct Chrome at the median but had the same p95, a much smaller worst sample in this run, and lower sampled memory.

An earlier 12-run pass also completed every task. Its medians were 743 ms (Chrome + Stagehand), 392 ms (Chrome + CDP), and 475 ms (Fortress + CDP).

## Live bot detection

The same headed sessions loaded the requested public detector pages and waited five seconds before capture.

| Stack | Sannysoft | BrowserScan | `navigator.webdriver` |
| --- | --- | --- | --- |
| Chrome + Stagehand | `WebDriver present (failed)` plus WebGL failures | **Robot** | `true` |
| Chrome + direct CDP | `WebDriver present (failed)` | **Robot** | `true` |
| Fortress + direct CDP | `WebDriver missing (passed)` and all visible top-table checks passed | **Normal** | `false` |

Evidence:

- [Chrome + Stagehand on Sannysoft](validation/artifacts/fortress/chrome-stagehand-sannysoft.png)
- [Chrome + Stagehand on BrowserScan](validation/artifacts/fortress/chrome-stagehand-browserscan.png)
- [Fortress + CDP on Sannysoft](validation/artifacts/fortress/fortress-cdp-sannysoft.png)
- [Fortress + CDP on BrowserScan](validation/artifacts/fortress/fortress-cdp-browserscan.png)

Public detectors can change and do not prove that every site will accept the browser. These captures establish the observed result on this host at the stated time.

## Production-path integration

The direct driver was also exercised against real Fortress with a local fixture covering accessibility refs, normal and closed-shadow clicks, verified fills, cross-origin iframe refs and actions, network mocking, secure credential delivery and clearing, live capture, PNG capture, and WebM recording. All checks passed with zero model calls. The full automated suite passed 179 tests, and a separate live profile test confirmed password saving, automatic sign-in, password filling, address autofill, and payment autofill remain disabled under Fortress.

Production Browse now downloads the native Fortress release, verifies the release SHA-256, launches it in the existing isolated profile/display lifecycle, and controls the owned target directly over loopback CDP. Stagehand and its extension are absent from production dependencies.
