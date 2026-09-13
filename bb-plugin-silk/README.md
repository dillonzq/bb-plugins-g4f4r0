# Silk

Silk is a local appearance plugin for BB. It changes the palette, homepage wallpaper, shared icons, composer controls, and thread sidebar. BB still owns the composer, navigation, thread state, and submission logic.

The plugin is intentionally small. If a change requires copying a whole BB component, stop and look for a narrower hook or CSS selector first.

## Using Silk

Install dependencies and the plugin from this directory:

```sh
npm install
bb plugin install .
bb theme set plugin:silk:silk
```

Open BB's welcome launcher or **New thread** to see the Silk wallpaper. Use the pencil beside the sidebar toggle on either screen to choose, change, or remove it. Changes save immediately and apply to both screens.

Silk processes uploads in the browser, converts them to WebP, and stores them in BB plugin KV. The original image does not enter the repository or leave the BB server.

Photos use Aura's animated color dithering, with a consistent two-pixel texture on desktop and mobile. The effect pauses for reduced motion and hidden pages, and retains the source texture while panels resize. Browsers without WebGL show the original image. Attribution and licenses are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Disable Silk to restore BB's native icons and layout. Switch back to the default palette with:

```sh
bb theme set default
```

## Working on the plugin

Use the development watcher while editing:

```sh
npm run dev
```

Before calling a change done, run:

```sh
npm run typecheck
bb plugin build
bb plugin reload silk
```

Install Silk from a durable checkout or local plugin directory. Do not make a temporary thread workspace the only copy of the source.

## Where things live

| File | Purpose |
| --- | --- |
| `app.tsx` | Registers frontend overlays, content scripts, provider artwork, and icon replacements. |
| `server.ts` | Stores wallpaper settings and fetches message timestamps for sidebar ages. |
| `app.css` | Handles component sizing, sidebar states, responsive layout, and small compatibility fixes. |
| `themes/silk.css` | Defines the Silk palette and semantic button colors. |
| `lib/homepage.ts` | Finds the native welcome and New thread pages, mounts the wallpaper, and positions the pencil control. |
| `lib/homepage-header.ts` | Keeps the right toggle pinned while forwarding native panel actions, and positions the pencil through sidebar transitions. |
| `lib/wallpaper.ts` | Prepares uploads and selects the photo or ambient renderer. |
| `lib/photo.ts` | Runs the photo shader, resizes without reloading the image, and handles motion and WebGL fallback. |
| `lib/photo-shaders.ts` | Attributed Aura/Paper image shaders and Aura's threshold-wave animation. |
| `lib/ambient.ts` | Draws the animated fallback when no image is set. |
| `lib/remix-icons.tsx` | Maps BB icon names to Remix Line artwork. |
| `lib/icon-layout.ts` | Makes custom icon wrappers follow BB's native SVG sizing rules. |
| `lib/sidebar.tsx` | Adds branch or location, message age, and Pin or Unpin to native thread rows. |
| `lib/observe-roots.ts` | Watches only the DOM areas Silk needs and cleans up on unload. |

## Adding a visual rule

Put palette values in `themes/silk.css`. Put component layout in `app.css`.

Scope rules to a stable BB attribute such as `data-testid`, `data-sidebar`, `data-promptbox`, or an accessible label. Avoid broad rules such as `button`, `svg`, or `.rounded-md`. Those leak into menus and panels that have nothing to do with the change.

Add both light and dark values when color is involved. Prefer semantic variables such as `--primary`, `--background`, and `--sidebar-accent` over repeated hex values.

## Adding or changing an icon

Import the Remix component in `lib/remix-icons.tsx`, then add it to the exported name map using BB's icon name.

Provider logos are registered separately in `app.tsx`. Keep brand artwork out of the shared monochrome icon map.

Custom icons receive a wrapper from BB. Do not fix sizing with a global SVG rule. Extend `lib/icon-layout.ts` only when BB introduces a host selector that does not work with that wrapper.

## Adding homepage behavior

Keep the native welcome actions and composer intact. `lib/homepage.ts` locates the welcome signature or `#root-compose-prompt`, then adds only Silk-owned elements around it.

New homepage behavior should follow the same pattern:

1. Find a stable native root.
2. Add a clearly named `silk-*` element or class.
3. Keep observers scoped to that root.
4. Remove every class, node, observer, timer, and listener when the content script unloads.

For motion, animate `transform` or `opacity`. Match BB's duration and easing when an element moves with native UI. Add a `prefers-reduced-motion` fallback.

The wallpaper pencil follows the page's existing motion without a second transition. Its position is clamped beside the left toggle as the sidebar collapses. The homepage right toggle stays fixed across BB's native header handoff and forwards clicks to the current native action; leaving the homepage removes that presentation and restores the native controls.

## Adding a setting or RPC

The wallpaper is currently the only user setting. To add another persisted value:

1. Add it to `Config` and `DEFAULTS` in `lib/config.ts`.
2. Validate it in `configSchema` inside `server.ts`.
3. Add it to the `get` and `save` flow.
4. Read it through `useBackground` or a new focused hook in `app.tsx`.
5. Keep payloads bounded. BB plugin KV has a size limit.

For a new server operation, add the input and output schema to `rpcContract`, register the handler in `server.ts`, and call it with `useRpc` on the frontend. Treat browser input and stored values as untrusted.

## Adding sidebar details or actions

Use `experimental_useSidebarThreads` for thread data and `experimental_useSidebarThreadActions` for native actions. Keep the existing row and link. Add content with a portal instead of replacing the row.

Status artwork belongs in the native trailing-indicator slot. Preserve BB's accessible labels because they describe the real state to screen readers and define state priority.

## QA checklist

Check a fresh page after reloading the plugin. Existing tabs can retain an older content-script bundle.

At minimum, test:

- Desktop at 1440 x 960 with the left sidebar open and closed.
- Mobile at 390 x 844 with the sidebar open and closed.
- Empty and typed composers.
- Voice recording, cancel, and confirm states.
- Right panel open and closed.
- Working, draft, success, and failure thread states.
- Light, dark, and reduced-motion modes.
- Navigation between the welcome launcher and New thread, then away and back again.

Inspect positions frame by frame when Silk moves with native UI. Matching final coordinates is not enough. The two elements must start, progress, and finish together.

After a BB upgrade, recheck every selector that depends on BB's DOM. The main ones are the welcome `role="img"`/`aria-label="bb"` signature, `#root-compose-prompt`, `data-promptbox-shell`, `data-sidebar`, and the sidebar trigger test IDs.
