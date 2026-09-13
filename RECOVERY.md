# Plugin recovery — September 13, 2026

Browse and Silk had been installed from personal thread workspaces. BB later retired those environments after the threads were archived. The plugin registrations survived, but their source directories did not. Silk was recovered in an earlier thread; this recovery preserved its current permanent source.

## What was preserved and restored

- **Browse:** recovered 59 files by replaying 209 recorded file-write, text-edit, and formatting steps from archived Codex session `01a09977-1f88-7ee1-8aa4-f7ca381b05b4`, associated with BB thread `thr_nfj7iedwnm`. Source transformations ran against an in-memory filesystem; historical browser actions, installations, and other runtime commands were not replayed. The final server-host browser mode, machine settings UI, session reuse, and shutdown fixes are present.
- **Beacon and Sidetree:** copied their current source and dependencies to this permanent directory. Compared all source files against the original locations before migration; they matched. Their original workspace copies remain available, with guidance pointing future work to the installed permanent sources.
- **Silk:** kept the already recovered permanent source. Typechecking and rebuilding passed. This operation did not replace its UI code with the earlier archived version.
- **Plugin registrations:** changed the local source paths in place, keeping the existing IDs and BB-owned settings/data. No plugin was removed, and no user browser profile was deleted.

Browse's original lockfile and some historical validation artifacts were unavailable. Its manifest was reconstructed from the scaffold and recorded package changes, aligned with the installed BB SDK, and given a fresh lockfile. Previously unspecified direct dependency versions were pinned to the versions verified here. Runtime source was recovered from the recorded edits, not rewritten from the conversation summary.

One PDF unit test depended on an old Paint screenshot. It now embeds a tiny PNG fixture and checks PDF output independently of archived artifacts. Historical reports remain as historical reports; missing screenshots and old JSON results have not been fabricated.

## Verification

- Browse: typecheck and frontend/server/host builds passed; **69 automated tests passed**.
- Browse real server-host lifecycle audit: **42 checks passed** across three cycles, including resized viewing/input, cancellation, worker-lease release, concurrent shutdown, and the final active-job shutdown fix.
- Beacon: typecheck, build, and **54 tests passed**; its installed CLI returned a live server snapshot.
- Browse installed-plugin integration: **22 checks passed**, covering button downloads, PDF export, live viewer input, recording, input/automation exclusion, cancellation, reconnect, profile storage, artifact retention, and process shutdown.
- Sidetree: typecheck, build, and **4 tests passed**; its installed RPC listed the current thread's workspace.
- Silk: typecheck and build passed; the live BB homepage displayed its background control and its saved settings were readable through the installed RPC.
- Installation audit: all four plugins are enabled, running, and resolved to real directories under `/home/g4f4r0/.bb/local-plugins`.
- Deployment helper: invalid/path-traversal IDs and deployment of uncommitted source were rejected before mutation.
- Checked 30 dependency symlinks: none was broken or pointed into a thread workspace or `/tmp`.

Fresh reports are in `bb-plugin-agent-browser/validation/recovery-host-audit.json`, `bb-plugin-agent-browser/validation/recovery-managed-live.json`, and `maintenance/reports/live-check.json`. These generated reports are included in the source archive but ignored by Git. Browse Settings was inspected in the running BB app; the server's runtime, Chrome, and FFmpeg were ready. Desktop-native browser attachment was not retested. Archived Paint screenshots and recordings are not part of this restoration.

Two initial verification attempts exposed assumptions in the test driver: Silk's current control is `.silk-background-edit`, and the reconnect fixture must use the session's recorded URL. Correcting those test-driver assumptions produced the passing run above. The recovered reconnect behavior still uses the session's recorded URL; navigation-history restoration was not changed or claimed.

## Prevention

The source packages and dependency lockfiles are now kept in one local Git repository. The deployment helper creates a Git bundle before applying future changes. Source archives are stored separately under `/home/g4f4r0/.bb/plugin-backups`.

`/home/g4f4r0/.bb/AGENTS.md` gives all newly constructed BB agent sessions the permanent-path rule and requires a full local-plugin audit after a shared deployment failure. The Beacon and Sidetree workspaces also point to their new source locations.

This prevents these four installations from depending on thread-workspace retention. It does not modify BB's core cleanup implementation or stop someone from bypassing the deployment helper. The Git repository and backups are local to this server; an off-server backup is still needed for server-loss protection.
