# Stagehand migration — 2026-09-14

The runtime is Stagehand 4.1.0, using deterministic Page/Locator APIs. The BB host worker retains one SDK connection per session, bound by Chromium target id. No Agent Browser binary is downloaded or executed. `runtime/package-lock.json` pins the host installation, including extension assets. Chrome for Testing is pinned at 153.0.8010.36.

## Verified before deployment

- Typecheck and 114 automated tests, including target binding, missing-target rejection, reference invalidation, ambiguity rejection and no action replay.
- Real Linux Chrome: navigation, snapshot references, clicks, fill, closed-shadow-root interaction through snapshot references, cross-origin iframe controls, live JPEG frames, WebM recording, screenshots, private credential binding/delivery/cleanup using dummy values, and a mocked network response.
- No Stagehand AI primitives or hosted Browserbase methods are called.
- Stagehand's extension is allowed by its specific origin; Chrome is not configured with wildcard remote origins.

Run the integration fixture on a prepared host:

```sh
BROWSE_TEST_ROOT=/absolute/browse/host-data npx tsx tests/stagehand-live.ts
```

## Limits

- This is not a 60 FPS streaming upgrade or a comparative speed benchmark.
- Native BB Desktop needs extension installation/debugging support, which its scoped CDP connection may reject. Managed mode on that host is the supported fallback; it has a separate profile.
- Snapshot references changed from legacy `@eN` to Stagehand `@frame-node` ids. Legacy `find` and `diff` commands are removed; command subcommands are explicitly bounded in the adapter.
- Closed-root interaction passed using snapshot references. A compound CSS selector crossing a closed root did not work in this fixture. `iframe >> selector` passed for a cross-origin iframe.
- Raw DOM eval/export retains its existing page-origin restrictions. The private credential helper still uses CDP and does not gain closed-shadow-root support merely because the automation driver changed.
- Recording samples the shared JPEG cast at the requested rate; repeated frames are possible. Node >=22.18, npm, Chrome and FFmpeg are host requirements.
- Old runtime downloads remain on disk; profiles and saved artifacts are preserved.
