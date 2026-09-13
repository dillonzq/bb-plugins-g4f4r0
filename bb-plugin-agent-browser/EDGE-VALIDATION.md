# Browser edge-case improvements — 2026-09-13

This pass tests the actual plugin in visible BB tabs on `pro`, plus failure-prone host/transport behavior with the public BB SDK test harness. It does not establish universal website reliability or an agent benchmark score.

## Delivered

- Removed the Agent Browser global sidebar entry. The thread panel, native BB browser tabs, four agent tools and CLI remain available.
- Added `sequence`: up to 50 known operations run beside the browser in one job, with per-step timing and completed-step results. Failure stops remaining steps without replaying mutations.
- Element actions wait for missing, obscured, moving or replaced targets before input; ambiguous, disabled and read-only controls fail. Large targets use the part inside the viewport.
- Field fills focus/select the field and insert text directly, removing redundant mouse events and BB's preliminary pointer screenshot dependency. The actual value is checked afterward.
- Cancellation during a sequence releases held pointer input before closing the control channel. Remaining steps do not run.
- All screenshot paths use the capture fallback. A screenshot timeout during recording preserves that recording instead of starting/stopping another screencast.
- Downloads support top-page CSS selectors through open shadow roots, document base URLs, early size checks, and bounded page fetch deadlines.
- UTF-8 decoding preserves characters split across subprocess chunks; output limits count bytes. Failed command batches retain partial results without irrelevant runtime bookkeeping.
- Short jobs get a 400 ms completion window to avoid an extra poll; ordinary successful job polls avoid an unnecessary host session inspection.
- Back/forward navigation uses browser history commands and waits through changing execution contexts without replaying navigation. This fixes an observed false failure after a successful Back action.
- Corrected iframe guidance: Vercel Agent Browser locator commands follow the selected frame; its `eval` executes in the top page. DOM observations label that distinction.

## Saved artifacts

The [readable test-page screenshot](validation/artifacts/edge-cases/1789290148181-screenshot.png) was visually inspected. The exported text file's exact UTF-8 contents were verified again after upload. Earlier PNGs were decoded with pdf-lib; the sample PDF loaded successfully as two pages. WebM recording returned captured/output frame counts and its saved file has the expected container header. This is a short recording check, not a video of the entire test suite.

Additional captures, canvas PNGs, PDFs and recordings remain under [validation/artifacts/edge-cases](validation/artifacts/edge-cases).

## Evidence and caveats

The fixture independently checks field values, click counts, uploads, and whether operations after a failure executed. A successful tool response alone is insufficient. Expected rejection of disabled/ambiguous/missing targets counts as a passed guard check, not a successful user task.

Initial baseline logs are preserved, including failures. A hidden/not-yet-rendering tab produced BB screenshot timeouts that also blocked pointer input. BB's desktop adapter performs a screenshot before the first pointer input following navigation. Direct field filling now avoids that dependency; this plugin cannot guarantee that every hidden desktop view will render.

A visible baseline reproduced an incorrect click on an `aria-disabled` button. An initial iframe assertion assumed `eval` followed the selected frame; fixing the assertion and documenting the actual upstream behavior also removed the resulting wrong-frame download test failure. Those harness mistakes are not reported as plugin accuracy gains.

The initial lifecycle check exposed a Back command returning an error even though the browser had navigated. The history-command implementation addresses this failure without issuing a second navigation.

One expanded run detected a field changing after its successful fill (an added `is.` suffix); the cause was not isolated. Repeated-run counters and top-level `const` declarations also survived `document.open()`, so fixture setup resets its counters and evaluates setup snippets in a local scope. These earlier results remain in `validation/edge-improved-expanded.json` rather than being discarded.

Vercel automatically handles alert dialogs by default; the first manual-alert acceptance test therefore found no dialog to accept. The final test uses a confirmation dialog and verifies its answer. Reconnecting creates a new session ID, so artifact retention is checked against the session that created the files, rather than the new empty artifact directory.

## Remaining platform limits

BB explicitly prevents native downloads in its automation browser session. Button-triggered native downloads and native download-directory control remain unavailable; authenticated link-content export supports up to 16 MB and observes page CORS rules. PDF files are image based. Screenshots contain page content, not browser/OS chrome. Closed shadow roots, cross-origin frame behavior, login-heavy sites and arbitrary production workflows are not certified by this fixture.

No paid browser service or additional model was introduced. The previous Browser Automation plugin remains disabled.

## Reproduce

Start an explicitly owned automation tab using fresh discovery, then save the `start`/`reconnect` JSON (containing `session`) to a file. The fixture overwrites that test tab's document; use a dedicated test tab.

```sh
npm run check
npm test
python3 scripts/edge-cases.py SESSION_JSON validation/repeat.json --advanced
python3 scripts/lifecycle-edge.py SESSION_JSON validation/repeat-lifecycle.json
```

The lifecycle script uses the fixture tab, uploads its exported test file, tests cancellation/reconnection and navigation, then releases control while preserving the tab. It updates the session JSON after reconnecting.
