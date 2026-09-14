# Custom BB plugins

Off-server Git copy of Browse, Beacon, Sidetree, Silk, Agent Plugins, and the Studio/Composio agent-plugin packages. Remote: https://github.com/hellogafaro/bb-plugins

Live BB installations on this server still load from `/home/g4f4r0/.bb/local-plugins`. Edit and deploy there unless the install paths are migrated with a path-to-path install. The live packages must stay outside thread workspaces and disposable worktrees.

| Plugin | Stable ID | Source directory |
| --- | --- | --- |
| Browse | `browse` | `bb-plugin-browse` |
| Beacon | `beacon` | `bb-plugin-beacon` |
| Sidetree | `sidetree` | `bb-plugin-sidetree` |
| Silk | `silk` | `bb-plugin-silk` |
| Agent Plugins | `agent-plugins` | `bb-plugin-agent-plugins` |

Keep these IDs when repairing plugins so settings and saved data stay associated with them.

## Change and deploy

1. Check the installed source with `bb plugin source <id> --json` and inspect `git status` here.
2. Edit the permanent package. Preserve unrelated changes. Do not work from an old archived thread copy.
3. Use `npm ci --include=dev` when restoring dependencies from the committed lockfile. Run the package's checks, inspect the diff, and commit the relevant files. Browse and Beacon have substantial test suites; Silk also has an optional browser-based homepage test.
4. From this directory, run `node maintenance/install.mjs <id>`.
5. Verify the actual feature in BB. A successful build does not establish that its UI or host runtime works.

The installer requires a committed lockfile and clean package source, refuses paths outside this directory, checks for active Browse sessions before reload, runs available type checks and unit tests, and builds the plugin. It saves a Git bundle under `/home/g4f4r0/.bb/plugin-backups` before deployment, then verifies all local installation paths and statuses. It does not run live browser tests automatically.

Run the read-only audit at any time:

```sh
node /home/g4f4r0/.bb/local-plugins/maintenance/check-installations.mjs
```

For a new custom plugin, scaffold `bb-plugin-<id>` here, implement and test it, and commit its source and lockfile before using the installer. BB's built-in and managed Git/npm plugins keep their existing managed locations.

## Storage and recovery

Source and dependency lockfiles belong in this Git repository. Generated bundles and dependencies are ignored. BB owns settings, databases, browser profiles, and secrets elsewhere under its data directory; never copy those into this repository or remove a plugin to change its source path.

`bb plugin install path:/absolute/permanent/package --yes` can change an existing local installation's source without deleting its settings. The helper uses this during migration and `bb plugin reload <id>` for an unchanged source path.

Local Git history and bundles protect against thread-workspace cleanup and accidental source edits. The GitHub repository is the off-server backup.

To inspect a saved bundle, clone it into a separate directory under this permanent root's parent and compare the required revision. Restore reviewed files to the permanent package, commit, and deploy with the helper. Do not reset a dirty live source tree or point BB at a temporary recovery checkout.

Server-wide agent guidance is in `/home/g4f4r0/.bb/AGENTS.md`. It directs future plugin work here. This is a workflow safeguard; BB core itself has not been changed to block unsafe raw path installations.

See [RECOVERY.md](RECOVERY.md) for the September 13 recovery and its verification limits.
