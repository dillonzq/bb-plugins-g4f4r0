Open a thread, click **+** in the right panel, and pick **Files**. The tab
lists the workspace that thread is running in: the project checkout or
worktree, one folder at a time.

## What you get

- A Files tab in the thread side panel. Nothing in the left sidebar, no
  full-page explorer.
- Folders expand on click. A large repo costs the same as a small one until
  you open a folder.
- Click a file to open Sidetree's CodeMirror editor. The ⋮ menu copies contents or
  path, downloads, and deletes (with a confirm dialog). Cmd/Ctrl+S saves.
  Sidetree does not use BB's built-in preview for claimed extensions.

## How it works

Each listing is one directory on the machine that owns the environment. The
tree never walks `node_modules` or the rest of the disk on its own. File
opens go through Sidetree's `fileOpener` for the extensions it claims.
