# Browse lifecycle validation

Validated on 2026-09-16 on the local Linux thread host.

## Shipped policy

- Managed sessions default to 3 per thread and 8 in total.
- Idle sessions close after 15 minutes by default. The three values are configurable in Browse settings.
- Browser actions, direct clicks, typing, scrolling, active jobs, recordings, credential prompts, and active agent threads renew or protect the session lease.
- Frame inspection and an unattended viewer do not renew the lease.
- Closing a Browse panel releases its managed browser after the panel has first been observed. A failed tab-state read is not treated as a close.
- Hidden viewers close their stream and input sockets. Returning to the panel reconnects them.
- Released sessions remain reconnectable while a Browse panel references them. Closed panels are removed from session storage, including stale records found after a plugin restart.

## Validation results

The full TypeScript check and 183-test suite passed. Focused tests cover:

- the fourth session in one thread being rejected with reuse/close guidance;
- the ninth global session being rejected with reuse/idle-cleanup guidance;
- a running agent thread renewing sessions while an idle thread does not;
- tab-close cleanup only after a successful, previously observed panel state;
- hidden video socket teardown and bounded frame credit;
- concurrent release, active-job cancellation, pointer reset, and worker-lease cleanup.

Live production-path checks used disposable loopback pages:

- Three sessions connected successfully. A fourth was rejected as 3/3.
- Cold connection jobs completed in 3.75 s, 7.53 s, and 7.33 s while three browsers started concurrently. The browser processes themselves reported ready in 0.98–1.09 s; control and first-frame setup accounted for the remainder.
- Reconnecting a released profile completed in 2.95 s and preserved the profile ID.
- Releasing three sessions removed their Chrome processes. Host used memory fell by about 912 MiB from the three-session sample to the no-session sample.

An isolated real-Fortress stress run measured proportional set size (PSS), which accounts for shared pages without counting them fully in every process:

| Sessions | Total test-tree PSS | Increment from baseline |
| ---: | ---: | ---: |
| 0 | 158 MiB | — |
| 1 | 637 MiB | 479 MiB |
| 3 | 1,229 MiB | 1,071 MiB |
| 8 | 2,453 MiB | 2,295 MiB |
| 0 after cleanup | 169 MiB | 11 MiB |

All eight sessions released, the harness retained zero worker leases, and the process count returned from 144 to 6. Raw measurements are in [memory.json](validation/lifecycle-2026-09-16/memory.json).

## Limits of this validation

- The eight-session memory run used about:blank. Complex pages and active video viewers use more memory and CPU.
- The memory run measured the local server host. It does not predict WAN latency or client decode performance.
- Browser-panel close behavior is covered by the plugin integration harness; this pass did not require a person to close a real client tab.
- Process recovery was exercised through release and profile reconnect. A real operating-system crash can still lose the last unflushed page state, although the profile remains available for reconnect.
- The current BB server process was already using about 5.2 GB RSS during the live pass. That is server-wide memory and cannot be attributed to Browse from these measurements.
- These checks cover the known lifecycle boundaries; they are not exhaustive coverage of every browser, page, or host failure.
