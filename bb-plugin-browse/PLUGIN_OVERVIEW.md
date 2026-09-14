# Browse

Runs managed Chromium on each thread’s execution host using Vercel Agent Browser; explicit native mode also controls BB desktop tabs. No cloud browser subscription or additional model is required.

- `app.tsx`: dependency Settings and private credential form; no navigation or new-tab launcher.
- `src/managed.ts`: browser installation, private Linux dependencies, launch and shutdown.
- `src/viewer.ts`: on-demand authenticated viewer.
- `src/native-download.ts`: event-driven button downloads.
- `server.ts`: public BB SDK integration, leases, host routing, RPC, CLI and five agent tools.
- `host.ts`: cancellable jobs, native runtime, tab binding, gestures, captures and artifacts.
- `src/bridge.ts`: private local CDP compatibility adapter.
- `src/cdp.ts`: bounded CDP calls for screenshots and precise input.
- `src/observe.ts`: accessibility supplements and open shadow DOM targets.
- `src/element.ts`, `src/sequence.ts`: guarded input and ordered local operations.
- `src/download.ts`: bounded authenticated link exports.
- `src/runtime.ts`: pinned, integrity-verified native binary provisioning.
- `skills/browse/SKILL.md`: agent workflow and commands.
- `tests/`: lifecycle, routing, protocol, cancellation and observation checks.

Install locally with `bb plugin install . --yes`. Builds are in `dist/`. Keep BB’s native Browser enabled.

- `src/credentials.ts`, `components/credential-form.tsx`: transient private login forms and document-bound CDP delivery.
- `scripts/credential-smoke.ts`: real Chromium test with dummy credentials, stale-page rejection, and request locking.
