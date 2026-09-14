# Browse for BB

A browser automation plugin built around **Vercel Agent Browser 0.37.1**. By default, Browse launches Chromium on **the machine where your BB thread executes**. An explicit `hostId` can select any other connected machine. Existing sessions stay on that host when the thread moves. It works independently of the client device. Explicit native mode can also control BB desktop tabs.

**Browse** is the plugin name, ID (`browse`), CLI (`bb browse`), and agent tools (`browse_session`, `browse_action`, `browse_job`, `browse_discover`, `browse_credentials`). Vercel Agent Browser is the Chromium driver.

No Browserbase, Browser Use Cloud, AI Gateway, Stagehand API, or second model is required. Your existing BB agent makes the decisions. Browse and its local Chromium driver execute them.

## Use it

Browse runs through agent tools and the `bb browse` CLI. It adds a dependency page in Settings and a Browser tab in the thread side panel. The plugin remains visible in BB’s Installed plugins management list.

Start with `bb browse start '{"url":"https://example.com"}'` from a BB thread. Browse resolves that thread’s environment host and opens headed Chrome. The live page appears in the thread panel. Run `probe` to check readiness and `setup` to install dependencies, including Xvfb, xkbcomp, and XKB keymap data on Linux hosts without a display. Settings lists all enrolled machines with independent checks and installation actions; offline machines are shown separately.

The viewer is a custom authenticated web view. It streams JPEG screencast frames from headed Chrome over a plugin WebSocket, with clicking, typing/pasting, navigation keys and scrolling. Each session opens as its own BB side-panel tab, with its host in the title. Native sessions can use the same viewer when their desktop supports streaming. The Browser launcher lists this thread’s sessions across hosts. Routine refreshes preserve your selected tab. It is not BB’s native Electron browser surface. Relative viewer URLs resolve against the current BB web origin.

`mode:"native"` retains the existing desktop backend and requires fresh hostId, instanceId and generation. The legacy preferredHost applies only to native discovery; it never changes managed placement.

Agents get five tools:

| Tool                     | Purpose                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `browse_discover` | Machines, desktops, and this thread’s sessions                           |
| `browse_session`  | Attach/create, tabs, setup, reveal, release, explicit close, files       |
| `browse_action`   | Inspection, commands, batches, shadow DOM controls, strokes and captures |
| `browse_credentials` | Private user form → bound browser login, with device AutoFill |
| `browse_job`      | Poll or cancel long actions                                              |

Tools and the bundled skill become available when BB refreshes the agent session. The same functionality is available immediately through `bb browse help`.

## Private login forms

Browse can request username, password, or verification-code fields through BB's private input UI, using the same SDK mechanism as the built-in Secrets plugin. Device password managers such as 1Password can fill this form. No vault connection or service account is required. Environment-variable requests still use Secrets.

The request starts a credentials job immediately (agents poll it; the CLI waits). It works on the selected managed or native session, locks automation for up to five minutes, keeps the live view available, binds to the original document and fields, then fills and clicks once. Values are excluded from its result and job history, and are not written to dotenv files. Existing input nodes are cleared after delivery. Cancellation before filling preserves the page.

Fields may be in the top document, an open shadow root, or an iframe that uniquely matches. Continue may be a button, `input type=submit|button`, or `role=button`. HTTPS or loopback HTTP fixtures and same-origin POST forms are required when a form is present. Stop recording before requesting. Unsupported forms, ambiguous matches, and page changes fail closed. A delivery result is not proof of successful login; inspect the following page. Browser/host access remains trusted: destination scripts can retain submitted values, and this feature does not isolate secrets from arbitrary browser scripting or shell access.

On iPhone, use AutoFill → Passwords and choose 1Password. Since the form is on BB's domain, selecting another site's login may require manual selection and Allow Once. iPhone hardware validation is separate from the automated Chromium tests.

## What improves browser use

- **Local execution:** each command, batch or continuous gesture runs beside the browser instead of round-tripping every mouse move through the agent/server.
- **Richer observations:** accessibility refs plus visible DOM controls, open shadow roots, labels, selectors, colors and CSS-pixel bounds. Useful for canvas apps and custom elements whose basic accessibility snapshot is incomplete.
- **Precise interaction:** unique-element matching, bounded waits for stable/uncovered targets, disabled/read-only checks, verified field filling without redundant mouse events, and continuous pointer paths with guaranteed release on normal completion or gesture cancellation.
- **Explicit tab binding:** each managed session owns an isolated profile and pinned page; native mode pins the selected BB tab. Failed setup never falls back to another machine.
- **Short and long operations:** quick commands return directly; longer work returns a job ID, progress timing and cancellation. A failed action is never silently replayed.
- **Artifacts:** actual PNG files, original canvas export, native PDF (image-based in desktop mode), link/button downloads and WebM recording, with BB file-preview links and inline image output for agents.

This improves the execution and observation layer. It is not a claim that every model or website will achieve a particular success rate or benchmark score.

## Architecture

```text
BB agent / CLI / Settings / live viewer
                  │ typed RPC / authenticated viewer routes
                  ▼
            BB plugin server
                  │ resolves thread → environment → host
                  ▼
           Thread execution host
   Host worker ── Vercel Agent Browser daemon
          └──── private CDP ── managed Chromium
```

Chromium’s debugging endpoint binds to loopback and is never sent to the client. Viewer routes use BB’s origin authentication and only accept bounded actions, never arbitrary CDP. The native desktop backend keeps its scoped connection adapter and BB control leases.

The pinned engine is integrity verified. Its browser installer downloads Chrome for Testing. On Debian/Ubuntu, Browse can download and extract missing Chromium libraries and FFmpeg into its private data directory without administrator access. Other operating systems use their installed browser libraries and FFmpeg. Dependency checks distinguish an installed executable from a successful browser launch. Close managed sessions before updating dependencies.

## Action examples

```json
{"kind":"observe","screenshot":true}
{"kind":"command","args":["click","@e3"]}
{"kind":"batch","commands":[["fill","@e4","hello"],["click","@e5"]]}
{"kind":"element","action":"fill","selector":"my-app >>> input[name='query']","value":"hello"}
{"kind":"gesture","strokes":[[{"x":100,"y":100},{"x":110,"y":105},{"x":120,"y":120}]],"intervalMs":8}
{"kind":"screenshot","fullPage":false}
{"kind":"canvas","selector":"paint-app >>> paint-canvas >>> canvas.main"}
{"kind":"record","action":"start","fps":20}
{"kind":"record","action":"stop","fps":20}
```

`element` actions use the top document and open shadow roots. For ordinary iframes, use the engine’s `frame` command and regular locator commands in that frame. Upstream `eval`, DOM observations, and canvas exports use the top page; verify iframe values with `get value` or an explicit same-origin frame lookup. Gesture points remain relative to the top viewport; account for iframe offsets. Closed shadow roots and cross-origin frame restrictions can limit inspection/export.

`sequence` runs up to 50 known operations in one local job, stopping on the first failure and reporting completed step indexes, durations, and artifacts. It never retries completed steps. Use small sequences between decisions:

```json
{"kind":"sequence","steps":[{"kind":"element","action":"fill","selector":"#name","value":"Alice"},{"kind":"element","action":"fill","selector":"#city","value":"Berlin"},{"kind":"observe"}]}
```

Element `waitMs` defaults to 3000 (maximum 30000; zero fails immediately when not ready). Waits only retry missing, moving, replaced, hidden, or covered target checks **before input**. Ambiguous or disabled targets fail immediately. A timed-out input is never replayed. Screenshots during recording preserve the recording if native capture fails.

## Lifecycle and limits

- Managed sessions last eight hours and refresh while the live view or inspect is used. Plugin reload or disable still stops Chrome. Expiry, release, or disconnection never silently reacquires control. Reconnect opens a new window at the last URL with cookies and storage, not the previous DOM.
- Managed release/close and plugin reload/disable stop Chromium, keeping profile data and saved artifacts. Reconnect reopens the last known URL with cookies/local storage, not unsaved page state. Native release preserves the BB tab. A thread host change requires a new profile on that host; profiles are not silently copied.
- One job runs per session. Default deadline is 120 seconds; maximum 600. Ordinary output is bounded to 512 KB; observations inspect at most 12,000 DOM nodes and return at most 150 candidates.
- Cancelling a continuous gesture releases its held pointer. Cancelling another operation closes the control channel and stops managed Chrome to prevent remaining daemon-side work; reconnect before further actions. Already completed page changes are not rolled back.
- Managed PDF uses Chromium printing and preserves text where supported. Native mode exports an image-based capture PDF.
- Direct link downloads support accessible HTTP(S), blob and data URLs up to 16 MB through the authenticated page. CORS can block cross-origin files. Managed `downloadClick` captures one button-triggered browser download, up to 128 MB, with a 60-second completion deadline. Native mode supports link fetches only. CSS download selectors resolve against the top page’s base URI and support open shadow roots; absolute-href accessibility refs are also accepted.
- Screenshots capture the web page, excluding BB/OS chrome. Full-page capture includes scrollable content. A tainted canvas may refuse PNG export.
- Artifact links expire after an hour; refresh the files list for new links. Files remain on the browser machine. Use BB’s host-aware file APIs to transfer them.
- No automatic mutation retries, credential import, paid backend, or autonomous secondary agent.

The previous Browser Automation plugin can be disabled after validation. BB’s native browser remains installed and visible, and the core `bb browser` command remains available. A plugin cannot remove BB core capabilities from the shell.

## Develop

Requires BB >=0.43 and SDK >=0.4.87. The SDK is pinned at 0.4.87.

```sh
npm install
npm run check
npm test
npm run build
bb plugin install . --yes
```

After source changes: build, then `bb plugin reload browse`. Reload releases active control, so reconnect existing tabs afterward.

See [EDGE-VALIDATION.md](EDGE-VALIDATION.md) for the latest edge-case and speed checks, and [VALIDATION.md](VALIDATION.md) for actual test results and known limitations. The project uses only public BB SDK entrypoints.

## Upstream

- [Vercel Agent Browser](https://github.com/vercel-labs/agent-browser), Apache-2.0
- [Agent Browser documentation](https://agent-browser.dev/)
- `ws`, MIT

This is an independently authored BB integration, not a Vercel or BB official plugin.

See [managed implementation validation](MANAGED-VALIDATION.md) for live Settings/viewer evidence, test results, artifacts and platform limits.

### Session reuse and cleanup

Managed starts at the same current URL reuse a session belonging to the current thread and host, including concurrent starts. `newTab:true` requests a separate isolated browser. Navigate an existing session with an `open` action to avoid opening additional browsers for unrelated URLs. Reuse preserves the current page state and reports any active job.

Release is idempotent and stops the owned Chromium process and its scoped automation daemon. Cancelled non-gesture actions invalidate and release their session; reconnect reopens its saved profile. Finished job results are evicted oldest-first above 200 entries or an 8 MiB serialized-payload budget, retaining the most recent result and running jobs. This is a history bound, not a total process-memory limit; profiles and saved artifacts remain on disk.

### Handoff and native recovery

`reveal` reports whether a panel handoff was requested, recent visible-frame acknowledgments, the session/host identity, and a viewer URL. An agent call cannot identify your current client; `ok` does not prove that you saw the page. Open the returned URL against your current BB address when the panel is unavailable.

Native leases use BB’s 30-minute maximum. Fresh discovery replaces stale generations before acquisition; a generation change during an active session requires explicit reconnect and never replays an action. Failed starts close newly created tabs where possible and report the tab identity and cleanup result. Existing tabs are preserved. Private login needs six minutes remaining on a native lease.

Linux hosts need no desktop shell: managed Chrome uses a virtual display. Browse panels are streamed pages inside BB, not Electron-native tabs. Browse does not attach arbitrary existing Chrome windows or automatically expose website-created popup windows. Different managed sessions have isolated login cookies. Native capture can require the desktop tab to remain visible. CAPTCHA, passkeys and device-specific login may require manual interaction; website anti-bot restrictions are not removed by remote viewing.

See [multi-host validation](MULTI-HOST-VALIDATION.md) for the September 2026 browser handoff, login and recovery checks. macOS and Windows use their own desktop display; Xvfb is required only on Linux without a display. A native session’s panel offers a separate managed browser on the same host when native rendering is unavailable; that browser has a separate login profile.

### Native launcher visibility

While Browse is enabled, its client content script hides BB’s built-in “Open browser” action and its reorder handle. The Browse “Browser” action remains available. Disabling Browse restores the native launcher. This is a scoped UI override using the core action’s DOM ID; it does not disable the native browser engine, existing tabs, external-link preferences or core shortcuts. A BB update that changes that ID will need a selector update.

### Web links

While viewing a thread, ordinary clicks on absolute external HTTP(S) links in the BB app open a managed Browse session on that thread's host. This includes ordinary clicks on links marked `_blank`. Repeated clicks during launch are coalesced, and an existing session at that URL can be reused. The resulting session opens in a Browse panel; failures offer Retry.

Modified clicks, middle clicks, downloads, named frame targets, editable content, relative URLs, same-origin BB routes and links outside a thread keep their normal behavior. Viewer iframe links stay within that browser. A container can opt out with `data-browse-link-routing="off"`. Disabling Browse removes the listener. Programmatic core navigation, native shortcuts and the native engine remain available; this does not change BB's saved browser preference.
