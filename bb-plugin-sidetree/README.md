# Sidetree

A file tree in the BB thread side panel. Tab label: **Files**.

```
npm install
bb plugin install .
```

In a thread, **+ → Files**. Click a folder to expand it. Click a file to
open Sidetree's editor (Save, copy, download, delete).

## Layout

- `server.ts` — resolve the thread workspace, list one directory.
- `app.tsx` — Files tab; files are `FileLink`s.
- `opener.tsx` — file tab; CodeMirror for text, ⋮ menu for save/copy/download/delete.
- `code-editor.tsx` — CodeMirror 6, themed from BB's code theme.
- `tree.ts` — path confinement used by the server and the test.

```
bb plugin reload sidetree
```
