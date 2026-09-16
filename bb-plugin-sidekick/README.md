# Sidekick

Reusable BB agents with their own instructions, model, and permissions.

- **Settings > Sidekick > Agents** lists agents. Open one to change its handle,
  name, instructions, model, reasoning, or permission limit. Changes save as
  you go.
- **Thread header > Agent** picks the agent for a thread. Switching clears the
  model context so the new instructions load; messages stay visible.
- An agent thread refuses a different model and any permission mode above the
  agent's.

## CLI

```sh
bb sidekick list [--json]
bb sidekick get <id-or-handle> [--json]
bb sidekick create --handle <handle> --name <name> --instructions <text> [options]
bb sidekick update <id-or-handle> [options]
bb sidekick delete <id-or-handle>
```

Options: `--description`, `--provider`, `--model`, `--reasoning`,
`--permission-mode`. Omitted execution settings use BB's defaults.

## Agent tools

`sidekick_agent_list`, `sidekick_agent_get`, `sidekick_agent_create`,
`sidekick_agent_update`, `sidekick_agent_delete`. See `skills/sidekick`.

## Development

```sh
npm ci --include=dev
npm run typecheck
bb plugin build bb-plugin-sidekick   # from the repo root
bb plugin reload sidekick
```

Design and test results: [PLAN.md](PLAN.md).
