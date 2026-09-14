---
name: dusk-shortcuts
description: Apply or inspect Dusk's explicit T3-inspired keyboard shortcut preset without changing settings automatically.
---

# Dusk shortcuts

Dusk provides an opt-in keyboard preset inspired by T3 Code's command layout.
It changes only BB commands exposed by the current plugin SDK and does not run
when Dusk loads.

## Commands

```sh
bb dusk shortcuts apply
bb dusk shortcuts list
bb dusk shortcuts list --json
bb dusk shortcuts reset
```

`apply` snapshots the current overrides for Dusk-managed commands, then applies
the preset. Settings unrelated to the preset remain unchanged. `reset` restores
the snapshot from immediately before the first apply. Both operations are
app-wide because BB keyboard settings are app-owned, not theme-local.

The preset currently covers the left sidebar, right panel, command palette,
terminal opening, thread search, file picker, diff view, new thread, thread
navigation, model picker, and preferred workspace. BB's terminal split, preview,
pin, settle, and thread-reference commands are not included because they are
not exposed by the installed BB plugin SDK as replaceable commands.
