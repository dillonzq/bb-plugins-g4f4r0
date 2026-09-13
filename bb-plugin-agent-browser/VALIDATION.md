> Latest changes and expanded test results: [EDGE-VALIDATION.md](EDGE-VALIDATION.md). This file records the original Paint validation.

# Validation — 13 September 2026

Tested in BB 0.43.1, using public Plugin SDK 0.4.87, with the browser on the connected macOS machine **pro**. The agent and coordinating server ran on a different Linux host. No server browser was launched by this plugin.

## Automated checks

- TypeScript check and BB server/app/host builds pass.
- 21 tests cover host routing, lease cleanup, cross-thread tool boundaries, existing-controller and personal-tab protections, command validation, shell-free invocation, cancellation, CDP multiplexing, shadow selectors, occlusion, pointer release, the thread panel, PDF output, and capture fallback boundaries.
- Dependency audit: no known vulnerabilities at the time of validation.

## Live Paint demonstration

Paint at `https://paint.js.org` uses nested open shadow roots. The basic interactive accessibility snapshot returned no controls; the plugin’s DOM inspection found the tools, color swatches, and canvases.

The app’s Attributes dialog resized the blank canvas to 800 × 600 through visible controls. The brush and palette were operated through pointer input. Drawing used actual continuous mouse strokes, not canvas drawing APIs.

| Check                            | Result                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| Blank screenshot before drawing  | Passed                                                                                         |
| Red head, two eyes, curved smile | Passed: 4 strokes, 474 points                                                                  |
| Blue capital TEST                | Passed: 7 strokes, 366 points                                                                  |
| Final screenshot                 | Passed                                                                                         |
| Original canvas PNG              | Passed: 800 × 600                                                                              |
| Pure colors                      | 4,350 red pixels (`#FF0000`), 2,911 blue pixels (`#0000FF`), no other non-white colors         |
| Video recording                  | Passed: WebM, 20 fps, 483 output frames; 127 distinct captured frames                          |
| Drawing sequence duration        | 21.96 seconds from recording start to final screenshot, excluding earlier setup and inspection |

[Before screenshot](validation/artifacts/paint-before.png) · [After screenshot](validation/artifacts/paint-after.png) · [Canvas PNG](validation/artifacts/paint-canvas.png) · [Video](validation/artifacts/paint-demo.webm)

The video covers the recorded drawing run, not plugin installation or earlier setup. Screenshots include the full web-page viewport, not BB/OS chrome. The canvas was already loaded and resized when timing began; this is **not a page-load benchmark** or a comparison against another framework.

During development, a platform select-all shortcut failed to replace a field fully; verified direct field selection fixed this. A hidden color input was correctly rejected by the occlusion guard, then the visible swatch was used. No missed or broken strokes occurred in the completed drawing run. The two gesture jobs took 4.828 and 3.789 seconds on the browser host, with an intentional 8 ms pause between points.

## Other live checks

- Accessibility snapshot, URL/title queries, and command batches passed.
- Typical short host actions took about 20–80 ms. The optimized CLI harness generally took 1.3–1.6 seconds end-to-end for quick actions; network/process overhead varies. These are observed samples, not general performance guarantees.
- Visible and full-page PNG captures passed.
- A direct blob-link download saved the exact 36-byte verification file.
- Image-based PDF export passed and produced a valid 34,849-byte PDF.
- Cancelling a 10-second wait stopped the job; releasing control kept the tab; reconnect attached to the same native tab.
- Saved artifacts remained accessible after plugin reload and desktop restart.
- After the desktop restarted, its previous tab list was empty. The plugin did not recreate missing tabs automatically. Testing continued in an explicitly created new tab on pro.

## Boundaries found in BB

- Native `Page.printToPDF` and download-directory control are unavailable through BB’s scoped connection. PDF export therefore embeds page-capture images; direct downloads fetch accessible links through the authenticated page, with a 16 MB cap and normal CORS restrictions. Native button-triggered downloads are not implemented.
- Captures temporarily timed out after the desktop restarted, then succeeded again. The cause was not conclusively isolated. Keeping the owning thread and native tab visible is recommended for reliable capture. A PNG compositor-frame fallback is implemented and unit-tested; full-page requests never silently fall back to a cropped viewport.
- Control leases last at most 30 minutes. Human takeover, expiry, and connection loss require explicit reconnect. A plugin cannot remove BB’s core browser command or make desktop tabs survive the desktop closing them.
- Open shadow roots are supported; closed roots and some frame/browser-level operations remain constrained by Chromium and BB’s scoped API.

The older **Browser Automation** plugin is disabled. **Agent Browser** is installed and enabled; BB’s native browser remains in place.
