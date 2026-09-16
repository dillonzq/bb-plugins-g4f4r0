Give BB reusable agents: named identities with their own instructions, model,
and permissions, chosen per thread.

## What you get

- An **Agents** section in Sidekick's settings to create, edit, and delete
  agents. Editing uses BB's own model and permission pickers.
- An agent selector in every thread header. Picking an agent switches the
  thread to that agent's model and starts a fresh model context with its
  instructions. The conversation stays visible.
- Agent threads stay on their agent's model and never run with more
  permission than the agent allows.
- A `bb sidekick` command and agent tools, so agents can be created and
  maintained from chat.

## How it works

Agents live in this plugin's own storage on the BB server. Nothing leaves the
machine, and the plugin needs no account, API key, or external service.

## For agents

The bundled skill explains when agents may be created or changed, and how an
agent's instructions reach its threads.
