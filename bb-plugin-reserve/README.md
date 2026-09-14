# Reserve

Leftover agent usage and resets, from the sidebar footer.

Reserve sits next to Beacon. Open it for unique login windows across enrolled machines, then the login on each host. The same account on server and pro is one leftover, not two added together.

Codex can offer banked resets from the Codex CLI on this BB server. Grok shows the weekly pool reset time. Extra Grok credits are bought in Grok settings; Reserve does not purchase them.

Needs BB 0.43 and Plugin SDK 0.4.87. Not published.

## Install

On this server:

```sh
bb plugin install path:/home/g4f4r0/projects/bb-plugins/bb-plugin-reserve --yes
bb plugin reload reserve
```

Reload after a source change:

```sh
bb plugin build bb-plugin-reserve
bb plugin reload reserve
```

## What the numbers mean

Totals are leftover percent per provider login and window. Two connected machines signed into the same email share that row. The meter is used percent (green below 80, amber from 80, red from 95).

Machines list who is signed in on each host. Disconnected hosts show no windows.

Codex reset consume talks to the Codex app-server on the BB server, not on pro or neo. Confirm before it spends a credit.

Polling runs only while the popover is visible.
