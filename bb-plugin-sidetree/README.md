# Sidetree

A file tree in the BB thread side panel. Tab label: **Files**.

```
npm install
bb plugin install .
```

In a thread, **+ → Files**. Click a folder to expand it. Click a file to
open BB's preview.

## Layout

- `server.ts` — resolve the thread workspace, list one directory.
- `app.tsx` — Files tab; files are `FileLink`s.
- `tree.ts` — path confinement used by the server and the test.

```
bb plugin reload sidetree
```
