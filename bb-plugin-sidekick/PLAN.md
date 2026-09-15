# Sidekick plan

Sidekick lets you create reusable agents with their own instructions, model, permissions, and memory, and call them into ordinary BB threads with `@handle`.

```text
Sidekick owns agents: identity and behavior.
Automations owns schedules and runs.
BB threads own conversation and execution.
```

Status: spike done (2026-09-15, BB 0.43.1, Plugin SDK 0.4.87). Every assumption below was tested live. The package holds spike code, not the real plugin. The plugin is installed from this checkout and disabled.

## Names and copy

| Thing | Name |
| --- | --- |
| Plugin | Sidekick |
| Plugin ID | `sidekick` (folder `bb-plugin-sidekick`) |
| One member | agent |
| CLI | `bb sidekick ...` |
| Agent tools | `sidekick_*` |
| Mention one | `@handle` |
| Mention all in thread | `@all`, with `@everyone` as an alias, scoped to the thread |

UI copy follows BB: sentence case for actions and titles, for example "New agent", "New automation", "Start conversation", "Delete agent".

## The core decision: one agent per thread

A BB thread has one provider session with one model, one permission mode, and one tool set. The Plugin SDK cannot change these per turn:

- `bb.agents.configure` selects this plugin's own tools, skills, and up to 4096 characters of instructions. Changes apply when the session is next constructed.
- The `message.dispatch` hook can only proceed, wait, or reject. It cannot amend the model or rewrite the message.

Two agents in one provider session would share context and permissions, so that design is rejected.

- **Agent thread.** A thread spawned by Sidekick with `pluginMetadata: { agentId }` and the agent's `providerId`, `model`, `reasoningLevel`, and `permissionMode`. `configure` reads the metadata and adds the agent's instructions, tools, and memory.
- **Conversation thread.** Any normal thread where the user mentions agents. Each mentioned agent gets one agent thread for that conversation.
- **Conversation agent threads are hidden and have no BB parent.** Sidekick records the link in `thread_agents` and posts replies itself. See "Why not BB child threads".
- **Direct conversation.** "Start conversation" on a profile opens BB's new thread composer for that agent and spawns one visible top-level agent thread.

No rooms, hidden projects, or separate thread database.

### Why not BB child threads

Tested and rejected:

- BB posts a `[bb system] @thread completed` notice to the parent after a child turn. Sidekick's own post would duplicate it.
- When several children finish close together, BB batches them into "Child thread updates: … completed." with no reply text. With `@all` the parent saw nothing useful twice.
- One follow-up reply produced no notice at all.

Hidden threads with no parent get no BB notices, stay out of the sidebar, and remain addressable by ID. Sidekick posts every reply, so delivery is consistent.

Cost: BB's parent permission ceiling no longer applies, so Sidekick clamps permissions itself (see Safety).

## BB surfaces used

| Need | BB surface | Verified |
| --- | --- | --- |
| Sidebar page | `app.slots.navPanel` with `path: "agents"` | Yes, top-level "Sidekick" entry |
| Agent list and detail | Page component, `useBbNavigate().toPluginPanel` | Page renders |
| `@handle` menu | `bb.ui.registerMentionProvider`, `@` trigger | Yes, see mention notes |
| Participants in a thread | `app.slots.experimental_threadHeaderAction` | Yes |
| Agent identity on a thread | Thread plugin metadata | Yes, on the first `configure` pass |
| Instructions, tools, memory | `bb.agents.configure` | Yes, first turn and follow-ups |
| Keep agent model and permissions | `experimental_hooks.on("message.dispatch")` rejects | Yes, HTTP 409 with our message |
| Routing trigger | `bb.events.on("experimental_thread.events")` then `bb.sdk.threads.events.list` | Yes |
| Sending to agents | `bb.sdk.threads.spawn` and `send` with `senderThreadId` | Yes |
| Replies to the conversation | `bb.sdk.threads.send` with `senderThreadId` of the agent thread | Yes |
| Silent replies | `app.slots.messageDirective({ id: "sidekick-no-reply" })` | Yes, braces required |
| Schedules | Builtin Automations: script automation plus `bb.sdk.plugins.callRpc` | Yes |
| Storage | `bb.storage.database()` and `migrate` | Yes |
| Live updates in the page | `bb.realtime.publish` | Not needed for the spike |
| Standing agent guidance | `skills/sidekick/SKILL.md` | Build step |

Every experimental API keeps its `experimental_` name.

## Data

All in Sidekick's own database.

```text
agents                  id, handle, name, description, instructions,
                        provider_id, model, reasoning_level, permission_mode,
                        created_at, updated_at, deleted_at
agent_memories          adapted from BB Memory: id, agent_id, scope_key, name,
                        summary, details, kind, tags_json, importance, pinned,
                        source_thread_id, write_reason, version, timestamps
agent_memory_history    memory_id, version, action, snapshot_json, reason
agent_memories_fts      FTS5 over name, summary, details, tags
thread_agents           thread_id, agent_id, conversation_thread_id, created_at
agent_automation_links  agent_id, automation_id, project_id, created_at
```

- `agentId` is random (`agt_...`) and never derived from the handle.
- Handles are unique among agents that are not deleted, and are lowercase `[a-z0-9-]`.
- Mentions store the `agentId`, so renaming a handle does not break history.
- Deleting an agent sets `deleted_at`. Threads and Automations stay.
- `configure` is synchronous. The database is synchronous too, so lookups there are fine.

## Agent tools

Create, read, update, and delete everywhere. Updates carry the extra actions.

```text
sidekick_agent_list / _get / _create / _update / _delete
sidekick_agent_message
sidekick_memory_search / _get / _create / _update / _delete
sidekick_automation_list / _get / _create / _update / _delete
```

- `sidekick_agent_create` only runs on an explicit user request. No drafts.
- `sidekick_agent_message` sends to an agent in the current conversation, spawning its agent thread if needed. The tool's `execute` receives `threadId`, so Sidekick knows the sender.
- `sidekick_automation_update` handles linking (`agentIds`), pausing (`enabled`), and schedule or prompt changes.
- `sidekick_automation_delete` deletes the real Automation. It confirms first and warns when other agents are linked. Unlinking is an update.
- Tool output is bounded. Each tool has a `presentation.label` in sentence case.

The CLI mirrors the tools: `bb sidekick agent list`, `bb sidekick automation update <id> --agent <id>`, and so on, plus `bb sidekick run`.

## Sidebar page

- **Left:** agent list with handle, name, and model. "New agent" at the top.
- **Right:** the selected agent with sections for identity, instructions, memory, model and permissions, automations, and "Start conversation".
- Fields are editable in place. Creation is conversational.
- **New agent** spawns a normal thread in the personal project with a prompt to describe the agent. That thread's agent calls `sidekick_agent_create`.
- **New automation** spawns a setup thread the same way, with the agent preselected.
- Threads are not listed under agents. Participation shows in the thread header.
- Use a valid host icon name. `Users` fell back to a default glyph.

## Routing

1. The user types `@researcher` and picks the agent from the mention menu. The pill travels as `{ kind: "plugin", pluginId: "sidekick", itemId: "agents:<agentId>" }`. `resolve` receives the bare `agentId`.
2. BB accepts the message. `experimental_thread.events` fires (debounced, about one second). Sidekick lists new `client/turn/requested` events for that thread.
3. It routes only events with `initiator: "user"` that contain Sidekick mentions. Events with `initiator: "agent"` or `"system"` are never routed, which prevents loops.
4. For each agent it finds or spawns the hidden agent thread for this conversation and sends the message with `senderThreadId` set to the conversation.
5. On `thread.idle` of an agent thread, Sidekick reads `lastAssistantText`. If it is the silent marker, nothing is posted. Otherwise it sends the reply into the conversation with `mode: "queue-if-active"` and `senderThreadId` set to the agent thread.

Why not route from the dispatch hook: it runs before BB validates the message. A malformed mention was routed even though BB then rejected the send with HTTP 422. The hook stays for blocking model and permission changes only.

`@all` (and its alias `@everyone`):

- Sends once to every agent that already has an agent thread in this conversation.
- Never includes agents that are not in the conversation. Does nothing when there are none.
- Mentions are deduplicated. An agent may stay silent.
- Only user-initiated messages trigger it.

Messages without a mention go to the thread's own agent as usual. Automatic responder selection is out of B1.

### How it looks

- Posted replies render as a collapsed "Message from Agent" card with the text inside. The card's label says "Agent", not the handle, so the text starts with `@handle` to identify the speaker.
- Agents see incoming messages prefixed with `[bb message from thread:<id>]`.
- A posted reply starts a turn in the conversation thread. If the conversation is busy it queues and sends when idle.

### Silent replies

The marker is `::sidekick-no-reply{}`. The braces are required: without them BB shows the literal text.

- **Agent threads.** `configure` adds: "If you have nothing useful to add, reply with exactly `::sidekick-no-reply{}` and nothing else." Sidekick skips posting when the reply is the marker.
- **Conversation threads.** `configure` adds: reply with the marker when a message only addresses Sidekick agents, or when it is a Sidekick agent reply that needs no response. With that instruction the conversation agent stayed silent on every tested reply.
- The directive component renders nothing. Only the "Worked for" row remains.
- **Instructions are fixed when a session is built.** Any thread can become a conversation later, so `configure` adds the short conversation rule to every thread, not only threads that already have agents. Keep it under about 400 characters.

### Mention menu

- The Sidekick section appears below BB's own sections. Typing `@pro` showed Projects first. `@probe` showed Threads, then Sidekick.
- Visible agent threads titled `@handle` also match in the Threads section. Conversation agent threads are hidden. Direct conversation threads must not use `@handle` titles. Use "Researcher: <topic>" instead.

### Forks

BB does not copy plugin metadata to forks. `configure` receives `thread.sourceThreadId` and `origin.kind: "fork"`, so Sidekick looks up the source thread's agent and applies it. Tested: the fork kept the agent's instructions. Sidekick also records the fork in `thread_agents` so the dispatch hook protects it.

## Memory

Adapted from BB's builtin Memory plugin (MIT, `get-bb/bb` `plugins/memory`). Keep its license notice in the adapted file.

Copy nearly as is:

- Record: `name`, one-line `summary`, `details`, `kind` (fact, preference, decision, procedure, episode, reference), `tags`, `importance` 0 to 100, `pinned`.
- Optimistic versioning with `expectedVersion`, and `memory_history` with source thread and write reason.
- Soft delete ("forget").
- FTS5 search over name, summary, details, and tags.
- A compact index of summaries in instructions, with details read on demand.
- Write validation that rejects secrets, prompt-injection phrasing, role tags, and invisible characters.
- Skill guidance on what to save and what never to save.

Change:

- Scope is the agent: `scope_key` is `agent:<agentId>`, optionally `agent:<agentId>:project:<projectId>`.
- The index goes only into that agent's threads, not every thread.
- Native tools `sidekick_memory_search / _get / _create / _update / _delete` resolve the agent from the tool's `threadId`, so one agent cannot write another's memory. The `bb sidekick memory ...` CLI stays for people and scripts.
- Budget: agent instructions and the memory index share 4096 characters in `configure`. Alternative to test: index through `contributeInstructions` (its own 4096) if it can identify the agent on a new thread's first turn.
- UI: the Memory section of the agent profile lists, edits, and forgets entries.

The builtin Memory plugin can run alongside: project facts there, the agent's role learning in Sidekick.

## Automations

Automations are project scoped and unchanged. Sidekick creates them through the Automations plugin's RPC (`automations_create`, `automations_update`, `automations_delete`, `automations_list`, `automations_get`, `automations_pause`, `automations_resume`, `automations_run`) and records `agentId <-> automationId` itself.

- **Fresh thread each run.** A script automation runs `bb sidekick run --agent <handle> --project <id> --prompt <text>`. Tested: the script found `bb` on `PATH`, and Sidekick spawned an agent thread that answered from the agent's instructions.
- **Existing thread.** The same command with `--thread <threadId>`.
- **Several agents.** `--agent` repeated.
- The global Automations page shows these as script automations. Agent profiles list only linked ones.
- Attaching an existing global automation stores a link only.

## Safety

- Creating an agent needs explicit user intent.
- **Permission clamp.** Hidden agent threads have no BB parent, so BB's ceiling does not apply. Sidekick spawns with the lower of the agent's mode and the conversation thread's mode, and the dispatch hook rejects anything above the agent's mode.
- The dispatch hook rejects model or permission changes in agent threads. Tested with `bb thread tell --model` and `--permission-mode`.
- The hook runs before the thread is in `thread_agents` on the very first dispatch. It reads plugin metadata with `bb.sdk.threads.getPluginMetadata` when the database has no row.
- Metadata is untrusted. `configure` validates `agentId` against the database and quotes all agent text as data.
- Creating, enabling, or deleting automations that can change files or external services asks for confirmation.
- Agent to agent messages only reach agent threads in the same conversation and project.

## Build order

Phase 1 is single agents, complete. Phase 2 adds conversations with several agents.

### Phase 1: single agents

1. ~~Spike.~~ Done. Results below.
2. **Agents.** Replace spike code: storage, `sidekick_agent_*` tools and CLI, `configure`, dispatch hook with metadata fallback, forks.
3. **Page.** Nav panel, list and detail, in-place editing, "New agent", "Start conversation".
4. **Memory.** Adapted store, tools, CLI, index in agent threads, profile section.
5. **Automations.** Tools over the Automations RPC, `bb sidekick run`, profile list.
6. **Skill, docs, tests.** `skills/sidekick/SKILL.md`, README and PLUGIN_OVERVIEW, repo README table, tests for handles, permission checks, and memory validation.
7. **Verify live**, then build, enable, reload, and commit.

### Phase 2: conversations

8. **Routing.** Mention provider, event-stream trigger, hidden agent threads, reply posting, silent marker, `@all`, header participants, `sidekick_agent_message`, permission clamp.
9. **Tests and live verification** for routing guards and silence.

## B1 scope

In: agent profiles, the sidebar page, conversational creation, instructions, memory, model and permissions, one or many agents per conversation, `@handle`, `@all`, agent to agent messages, forks, fresh and existing thread automations, automation tools, and the profile automation list.

Later: default agent, project members and owner, automatic responder selection.

Out: a separate chat app, drafts, hidden projects, `@all` beyond the conversation, recursive broadcasts, a replacement Automations UI, a separate scheduler.

## Decisions

- `@all` wakes every agent in the current conversation. `@everyone` is an alias.
- Agent replies are posted in the conversation, starting with the handle.
- Conversation agent threads are hidden and unparented.
- Routing runs from accepted input events, not the dispatch hook.
- Fresh-thread automations are script automations that call `bb sidekick run`.
- Changing the model or permissions in an agent thread is blocked with a message pointing to Sidekick.
- Silent marker: `::sidekick-no-reply{}`.
- Agent memory lives in Sidekick, not the builtin Memory plugin.
- **Start conversation** opens BB's own new thread composer (`experimental_NewThreadComposer`) on the agent's page at `/plugins/sidekick/agents/<agentId>/new`, seeded with the agent's provider, model, reasoning, and permission mode. The user picks project and environment as usual. `onSubmit` sends the `NewThreadRequest` to Sidekick, which spawns with `pluginMetadata: { agentId }` and opens the thread.
- New agents use BB's defaults when the user does not specify: the provider and model BB would pick for a new thread, reasoning `medium`, permission `auto`. Saved on the agent so they do not drift.
- No tool scoping in Phase 1. Agents have every tool; the focus is behavior.

## Spike results

| # | Assumption | Result |
| --- | --- | --- |
| 1 | Spawned thread gets metadata on the first `configure` pass | Pass |
| 2 | Agent instructions reach the model, first turn and follow-ups | Pass (codeword answered) |
| 3 | Sidekick tool is selected and knows the thread's agent | Pass |
| 4 | Dispatch hook sees model and permission changes | Pass |
| 5 | Dispatch hook rejection shows our message | Pass (HTTP 409) |
| 6 | Plugin mentions arrive with pill data | Pass (`agents:<id>`) |
| 7 | Dispatch hook is safe for routing | Fail: runs before validation. Use accepted input events |
| 8 | Accepted input events expose initiator and mentions | Pass |
| 9 | BB child notices can carry agent replies | Fail: duplicates, batched without text, one missing |
| 10 | Hidden unparented threads avoid notices and the sidebar | Pass |
| 11 | Sidekick-posted replies arrive, queue when busy | Pass |
| 12 | Silent agent reply is skipped | Pass |
| 13 | Conversation agent stays silent on agent replies | Pass after stricter instructions |
| 14 | Directive hides the marker | Pass only as `::sidekick-no-reply{}` |
| 15 | Forks keep the agent | Pass via `sourceThreadId` |
| 16 | Script automation can run `bb sidekick run` | Pass |
| 17 | Automations RPC callable from Sidekick | Pass (`list`, `get`) |
| 18 | Sidebar page, header action, mention menu render | Pass, with icon and mention ordering notes |
| 19 | Builtin Memory plugin can scope per agent | Fail: global and project only |

## Open questions

1. The posted reply card says "Message from Agent". Can a hidden sender thread show its title instead? Check with BB before building, or accept the handle in the text.
2. Each posted reply costs one short turn in the conversation thread. Acceptable for B1; revisit if BB adds a way to post without a turn.
3. Mention ordering puts Sidekick below BB's sections. Check whether BB offers ordering or a dedicated trigger later.
