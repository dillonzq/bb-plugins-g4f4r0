# Sidetree

A file tree in the thread side panel. The tab is Files.

```
npm install
bb plugin install .
```

In a thread, + then Files. Click a folder to expand it. Click a file to open
it. That tab is titled Editor. The ⋮ menu saves, copies, downloads, and
deletes.

Most text files open in CodeMirror. `.md` and `.markdown` open as a page you
edit. Toggle Code for the source. `.mdx` stays in CodeMirror. Select text
and add it to chat. Colors come from BB's code theme.

Type / for a command. Image asks for a URL. Headings, lists, and tables are
in that list too. Sidetree does not put image files in the markdown.

```
bb plugin reload sidetree
```

Reopen the file tab after a reload. The old tab still has the previous bundle.

## Layout

- `server.ts` lists one directory under the thread workspace.
- `app.tsx` is the Files tab. Files are `FileLink`s.
- `opener.tsx` is the file tab, markdown or CodeMirror, and the ⋮ menu.
- `markdown-editor.tsx` is the TipTap page for `.md` / `.markdown`.
- `code-editor.tsx` is CodeMirror 6, themed from BB's code theme.
- `tree.ts` keeps paths inside the workspace. The test uses it too.
