Open a thread, click **+** in the right panel, and pick **Files**. The tab
lists the workspace that thread is running in: the project checkout or
worktree, one folder at a time.

## What you get

- A Files tab in the thread side panel. Nothing in the left sidebar, no
  full-page explorer.
- Folders expand on click. A large repo costs the same as a small one until
  you open a folder.
- Click a file to open BB's own preview. Right-click for Open with, copy
  path, and the rest of BB's file menu. Sidetree does not ship an editor.

## How it works

Each listing is one directory on the machine that owns the environment. The
tree never walks `node_modules` or the rest of the disk on its own. File
opens go through BB, so a preview or a plugin file opener (for example File
Editor) handles the bytes.
