# Multi-host browser validation — 14 September 2026

Browse defaults new managed sessions to the thread environment’s host. Passing `hostId` selects another connected host. Existing sessions and reconnect remain on their original host/profile, even when the thread moves.

## Verified

- Typecheck and 109 tests across 20 files passed. Coverage includes native lease limits, failed-acquisition cleanup, preserving pre-existing tabs, refreshed generations, refusing to replay a mutation, host selection, native credential routing, viewer input locks, distinct panel tabs, handoff evidence, non-Linux display setup and detached-page detection.
- Linux managed Chrome started on the server without a desktop shell. Its viewer displayed a 1280×800 image, correct host/session identity, and live status in a separate browser client. Reveal reported a visible-frame acknowledgment.
- macOS managed Chrome started on `pro` after fixing an unconditional Xvfb requirement. Its frames traveled through BB on the server to a browser viewer. Navigation through that viewer changed the URL on `pro`, verified by a separate agent read. Reconnect reused the profile on `pro`.
- An actual BB native tab on `pro` was created and acquired successfully with a 30-minute lease. This previously failed after tab creation because Browse requested eight hours.
- The native tab received a temporary local test form on Example.com. The user submitted the provided dummy values through BB’s private form. The credentials job reported `filled:true`; a subsequent read confirmed “Dummy login succeeded in this exact native session.” The test form did not send credentials to Example.com.
- Real Chrome smoke tests exercised both the managed path and the native host/Bridge path: one submission, page-change rejection, cancellation, automation locks and continued frames while credentials were pending.
- Live tab discovery accepted a deliberately stale generation by refreshing discovery before the native read. Unit tests changed generations between acquisition and an action, confirmed no action was submitted, and reconnected the preserved tab with fresh identity.
- Filtered connector discovery found an active ClickUp connection and `CLICKUP_GET_TASK` without opening a ClickUp login page. Browse’s instructions now require connector-first discovery, bounded schema output and checking existing application settings before proposing code changes. Agent Plugins’ catalog API itself is outside this change.
- Browse, Beacon, Dusk and Sidetree were running from the permanent repository after deployment.

## Limits observed

- BB’s native capture and CDP screencast on `pro` timed out when the native page was not rendering. Native page inspection and private login still worked. Browse now reports this clearly and offers a separate managed browser on the same host. The managed fallback streamed successfully; it has its own login profile.
- No physical BB Desktop restart was completed during these checks. Actual generation-change recovery across a desktop restart remains a manual validation item; refreshed stale requests and the generation-change code path were tested as described above.
- The automated viewer client used BB’s local origin. A fresh browser visiting the public Connect URL correctly required the owner’s getbb.app sign-in. The user-facing native credential form was exercised, but automated verification of the authenticated public Connect viewer was not completed. Visible-frame acknowledgments do not establish which client belongs to the current user.
- Plugin panels stream Browse-controlled sessions; they are not Electron-native browser tabs. Arbitrary Chrome windows and website-created popups are not automatically imported as independent sessions.
- Headed Chrome on macOS/Windows uses the host’s interactive desktop. Closing its tab can disconnect the session. Linux can use a private virtual display. A server browser does not inherit desktop cookies, password managers, passkeys or another session’s login.
- CAPTCHA and website restrictions can still require user interaction or another browser host. Credentials remain bound to the selected document and session; unsupported/changed forms fail closed.

The private form’s redundant “Your details stay out of chat” footer was removed at the user’s request.
