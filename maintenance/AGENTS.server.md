# Custom BB plugins

Custom plugins on this server live in `/home/g4f4r0/.bb/local-plugins`.
Read that directory's `README.md` before creating, changing, installing, or recovering one.

- Never install a plugin from a personal thread workspace, temporary directory, or disposable worktree. Archiving a thread can delete its workspace and every installed plugin inside it.
- Resolve the installed source with `bb plugin source <id> --json` before editing. Edit the permanent source, not an old workspace copy.
- Preserve the existing plugin ID, settings, data, and features during repairs. Recover original source where possible; do not rebuild a partial approximation and call it complete.
- Keep source and lockfiles in Git. Verify the package's checks and live behavior, commit the relevant change, then use `maintenance/install.mjs` for deployment. Never remove/reinstall an existing local plugin in a way that deletes its settings; a path-to-path install preserves them.
- Run `node /home/g4f4r0/.bb/local-plugins/maintenance/check-installations.mjs` after installation or recovery. Check all custom plugins when one exposes a shared deployment problem.
- A local Git repository and local archives protect against workspace cleanup, not loss of the server. Do not claim an off-server backup exists without verifying it.
