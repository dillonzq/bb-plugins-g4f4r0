# Sidetree

A file tree in the BB thread side panel, and an editor when you open a file.
Tab label: **Files**. Opener title: **Editor**.

```
npm install
bb plugin install .
```

In a thread, **+ → Files**. Click a folder to expand it. Click a file to open
it. Save, copy, download, and delete live in the ⋮ menu.

Text files use CodeMirror. `.md` and `.markdown` open as pretty markdown;
toggle **Code** for the source. `.mdx` stays in CodeMirror. Select text and
add it to chat. Syntax colors and the selection wash follow BB's code theme.

```
bb plugin reload sidetree
```

Reopen the file tab after a reload.

## Layout

- `server.ts` — resolve the thread workspace, list one directory.
- `app.tsx` — Files tab; files are `FileLink`s.
- `opener.tsx` — file tab; pretty markdown or CodeMirror; ⋮ menu.
- `markdown-editor.tsx` — TipTap WYSIWYG for `.md` / `.markdown`.
- `code-editor.tsx` — CodeMirror 6, themed from BB's code theme.
- `tree.ts` — path confinement used by the server and the test.
