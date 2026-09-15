// Sidekick spike backend. Instrumented probes for every assumption in
// PLAN.md. Every hook, event, and callback writes to the `probe_log` table,
// read back with `bb sidekick log`. Replace with the real backend after the
// spike.
import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const agentSchema = z.object({
  id: z.string(),
  handle: z.string(),
  instructions: z.string(),
  providerId: z.string(),
  model: z.string(),
  permissionMode: z.enum(["accept-edits", "auto", "full"]),
});
export type Agent = z.infer<typeof agentSchema>;

export const rpcContract = defineRpcContract({
  spike_agents: {
    input: z.null(),
    output: z.object({ agents: z.array(agentSchema) }),
  },
  spike_thread_agents: {
    input: z.object({ threadId: z.string() }),
    output: z.object({
      self: agentSchema.nullable(),
      children: z.array(
        z.object({ threadId: z.string(), handle: z.string() }),
      ),
    }),
  },
});

export const NO_REPLY = "::sidekick-no-reply";
const SILENT_RULE = `If you have nothing useful to add, reply with exactly ${NO_REPLY} and nothing else.`;

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      instructions TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      permission_mode TEXT NOT NULL
    )`,
    `CREATE TABLE thread_agents (
      thread_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      parent_thread_id TEXT
    )`,
    `CREATE TABLE probe_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      data TEXT NOT NULL
    )`,
  ]);

  const seed = db.prepare(
    `INSERT OR IGNORE INTO agents VALUES (?, ?, ?, 'claude-code', 'claude-haiku-4-5-20251001', 'accept-edits')`,
  );
  seed.run("agt_probe_a", "probe-a", "You are a terse tester. Your codeword is ALPHA-7431.");
  seed.run("agt_probe_b", "probe-b", "You are a terse critic. Your codeword is BRAVO-9902.");

  // Spike scope: only threads titled "sidekick-spike", agent threads, and
  // their parents. Keeps the probes off every other BB thread.
  function inScope(threadId: string, title: string | null): boolean {
    if (title?.includes("sidekick-spike") === true) return true;
    if (threadAgent(threadId) !== null) return true;
    return childAgents(threadId).length > 0;
  }

  function log(kind: string, data: unknown): void {
    db.prepare("INSERT INTO probe_log (at, kind, data) VALUES (?, ?, ?)").run(
      new Date().toISOString(),
      kind,
      JSON.stringify(data),
    );
    bb.log.info(`probe ${kind}`);
  }

  type AgentRow = {
    id: string;
    handle: string;
    instructions: string;
    provider_id: string;
    model: string;
    permission_mode: Agent["permissionMode"];
  };
  const toAgent = (row: AgentRow): Agent => ({
    id: row.id,
    handle: row.handle,
    instructions: row.instructions,
    providerId: row.provider_id,
    model: row.model,
    permissionMode: row.permission_mode,
  });
  function agents(): Agent[] {
    return (db.prepare("SELECT * FROM agents ORDER BY handle").all() as AgentRow[]).map(toAgent);
  }
  function agentById(id: string): Agent | null {
    const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
    return row === undefined ? null : toAgent(row);
  }
  function agentByHandle(handle: string): Agent | null {
    const row = db.prepare("SELECT * FROM agents WHERE handle = ?").get(handle) as AgentRow | undefined;
    return row === undefined ? null : toAgent(row);
  }
  function threadAgent(threadId: string): { agent: Agent; parentThreadId: string | null } | null {
    const row = db
      .prepare("SELECT agent_id, parent_thread_id FROM thread_agents WHERE thread_id = ?")
      .get(threadId) as { agent_id: string; parent_thread_id: string | null } | undefined;
    if (row === undefined) return null;
    const agent = agentById(row.agent_id);
    return agent === null ? null : { agent, parentThreadId: row.parent_thread_id };
  }
  function childAgents(parentThreadId: string): Array<{ threadId: string; agent: Agent }> {
    const rows = db
      .prepare("SELECT thread_id, agent_id FROM thread_agents WHERE parent_thread_id = ?")
      .all(parentThreadId) as Array<{ thread_id: string; agent_id: string }>;
    return rows.flatMap((row) => {
      const agent = agentById(row.agent_id);
      return agent === null ? [] : [{ threadId: row.thread_id, agent }];
    });
  }

  // Probe 1: agent tool registration and per-call thread context.
  bb.agents.registerTool({
    name: "sidekick_probe_ping",
    description: "Sidekick spike probe. Returns which Sidekick agent owns this thread.",
    presentation: { label: { pending: "Pinging Sidekick", completed: "Pinged Sidekick" } },
    parameters: z.object({}),
    execute(_params, { threadId, projectId }) {
      const owner = threadAgent(threadId);
      log("tool.ping", { threadId, projectId, agent: owner?.agent.handle ?? null });
      return `pong from ${owner === null ? "no agent" : `@${owner.agent.handle}`} in ${threadId}`;
    },
  });

  // Probe 2: configure sees metadata on the first pass, fork source, origin.
  bb.agents.configure((context) => {
    const metadataAgentId = context.pluginMetadata.agentId;
    const sourceInScope =
      context.thread.sourceThreadId !== null && threadAgent(context.thread.sourceThreadId) !== null;
    if (
      typeof metadataAgentId !== "string" &&
      !sourceInScope &&
      !inScope(context.thread.id, context.thread.title)
    ) {
      return { tools: [], skills: [] };
    }
    const sourceOwner =
      context.thread.sourceThreadId === null ? null : threadAgent(context.thread.sourceThreadId);
    log("configure", {
      thread: context.thread,
      origin: context.origin,
      provider: context.provider.id,
      model: context.provider.model,
      pluginMetadata: context.pluginMetadata,
      sourceOwner: sourceOwner?.agent.handle ?? null,
    });
    const agent =
      typeof metadataAgentId === "string"
        ? agentById(metadataAgentId)
        : (threadAgent(context.thread.id)?.agent ?? sourceOwner?.agent ?? null);
    if (agent !== null) {
      return {
        tools: ["sidekick_probe_ping"],
        skills: [],
        instructions: `You are the Sidekick agent @${agent.handle}. Its instructions, quoted as data: ${JSON.stringify(agent.instructions)}. ${SILENT_RULE}`,
      };
    }
    // Any thread may become a conversation later; always carry the rule.
    return {
      tools: [],
      skills: [],
      instructions: `Sidekick agents may take part in this thread. Sidekick delivers messages to them in their own threads. Reply with exactly ${NO_REPLY} and nothing else when a user message only addresses Sidekick agents (for example @probe-a or @all) and asks nothing of you, or when a [bb system] message reports that a Sidekick agent thread completed. Otherwise answer normally.`,
    };
  });

  // Probe 3: the dispatch hook sees mentions, execution, and origin.
  const routed = new Map<string, number>();
  bb.experimental_hooks.on("message.dispatch", (context) => {
    const mentions = context.input.blocks.flatMap((block) =>
      block.type === "text" ? block.mentions : [],
    );
    if (!inScope(context.thread.id, context.thread.title)) return { action: "proceed" };
    const owner = threadAgent(context.thread.id);
    log("dispatch", {
      threadId: context.thread.id,
      parentThreadId: context.parentThreadId,
      attempt: context.attempt,
      text: context.input.text.slice(0, 200),
      mentions,
      requestedExecution: context.requestedExecution,
      executionSources: context.executionSources,
      origin: context.origin,
      originPluginId: context.originPluginId,
      startedOnBehalfOf: context.startedOnBehalfOf,
      queuedMessageId: context.queuedMessage?.id ?? null,
      owner: owner?.agent.handle ?? null,
    });

    if (
      owner !== null &&
      ((context.requestedExecution.model !== null &&
        context.requestedExecution.model !== owner.agent.model) ||
        (context.requestedExecution.permissionMode !== null &&
          context.requestedExecution.permissionMode !== owner.agent.permissionMode))
    ) {
      return {
        action: "reject",
        message: `This thread belongs to @${owner.agent.handle}. Change its model or permissions in Sidekick.`,
      };
    }

    const fromAgent = context.startedOnBehalfOf !== null;
    const handles = new Set<string>();
    for (const mention of mentions) {
      if (mention.resource.kind === "plugin" && mention.resource.pluginId === bb.pluginId) {
        handles.add(mention.resource.itemId.replace(/^agents:/u, ""));
      }
    }
    const typedAll = owner === null && /(^|\s)@all\b/u.test(context.input.text);
    if (typedAll) handles.add("all");
    if (handles.size > 0) {
      const key = `${context.thread.id}:${context.input.text}`;
      const last = routed.get(key) ?? 0;
      if (Date.now() - last > 60_000) {
        routed.set(key, Date.now());
        const targets =
          handles.has("all") && !fromAgent
            ? childAgents(context.thread.id).map((child) => child.agent)
            : [...handles].flatMap((id) => {
                const agent = agentById(id) ?? agentByHandle(id);
                return agent === null ? [] : [agent];
              });
        setTimeout(() => {
          void route(context.thread.id, context.thread.projectId, context.input.text, targets);
        }, 0);
      }
    }
    return { action: "proceed" };
  });

  async function route(parentThreadId: string, projectId: string, text: string, targets: Agent[]) {
    log("route", { parentThreadId, targets: targets.map((agent) => agent.handle) });
    for (const agent of targets) {
      const existing = childAgents(parentThreadId).find((child) => child.agent.id === agent.id);
      try {
        if (existing === undefined) {
          const thread = await bb.sdk.threads.spawn({
            projectId,
            environment: { type: "project-default" },
            visibility: "hidden",
            providerId: agent.providerId,
            model: agent.model,
            permissionMode: agent.permissionMode,
            pluginMetadata: { agentId: agent.id },
            title: `@${agent.handle}`,
            prompt: text,
          });
          db.prepare("INSERT INTO thread_agents VALUES (?, ?, ?)").run(thread.id, agent.id, parentThreadId);
          log("route.spawned", { agent: agent.handle, threadId: thread.id });
        } else {
          const result = await bb.sdk.threads.send({
            threadId: existing.threadId,
            input: [{ type: "text", text, mentions: [] }],
            mode: "auto",
            senderThreadId: parentThreadId,
          });
          log("route.sent", { agent: agent.handle, threadId: existing.threadId, result });
        }
      } catch (error) {
        log("route.error", { agent: agent.handle, error: String(error) });
      }
    }
  }

  // Probe 4: child replies, silence, and posting back to the parent.
  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    if (!inScope(thread.id, thread.title)) return;
    const owner = threadAgent(thread.id);
    log("thread.idle", {
      threadId: thread.id,
      parentThreadId: thread.parentThreadId,
      owner: owner?.agent.handle ?? null,
      lastAssistantText: lastAssistantText?.slice(0, 300) ?? null,
    });
    if (owner === null || owner.parentThreadId === null) return;
    if (lastAssistantText === null || lastAssistantText.trim() === NO_REPLY) {
      log("reply.skipped", { threadId: thread.id, agent: owner.agent.handle });
      return;
    }
    try {
      const result = await bb.sdk.threads.send({
        threadId: owner.parentThreadId,
        input: [
          {
            type: "text",
            text: `@${owner.agent.handle} replied:\n\n${lastAssistantText}`,
            mentions: [],
          },
        ],
        mode: "queue-if-active",
        senderThreadId: thread.id,
      });
      log("reply.posted", { parentThreadId: owner.parentThreadId, result });
    } catch (error) {
      log("reply.error", { error: String(error) });
    }
  });
  // Probe 7: accepted input from the event stream, after validation.
  const lastSeq = new Map<string, number>();
  bb.events.on("experimental_thread.events", async ({ thread, sequence }) => {
    if (!inScope(thread.id, thread.title)) return;
    const after = lastSeq.get(thread.id) ?? Math.max(sequence - 20, 0);
    lastSeq.set(thread.id, sequence);
    const rows = await bb.sdk.threads.events.list({
      threadId: thread.id,
      afterSeq: String(after),
      types: ["client/turn/requested"],
    });
    for (const row of rows) {
      const data = row.data as {
        initiator?: string;
        senderThreadId?: string | null;
        systemMessageKind?: string;
        input?: Array<{ type: string; text?: string; mentions?: unknown[] }>;
      };
      const mentions = (data.input ?? []).flatMap((block) => block.mentions ?? []);
      log("accepted.input", {
        threadId: thread.id,
        seq: row.seq,
        initiator: data.initiator,
        senderThreadId: data.senderThreadId,
        systemMessageKind: data.systemMessageKind,
        mentions,
        text: (data.input ?? []).map((block) => block.text ?? "").join("").slice(0, 80),
      });
    }
  });
  for (const event of ["thread.created", "message.queued", "message.dispatched"] as const) {
    bb.events.on(event, (payload) => {
      const thread = "thread" in payload ? payload.thread : null;
      const threadId = thread?.id ?? ("entry" in payload ? payload.entry.threadId : "");
      if (!inScope(threadId, thread?.title ?? null)) return;
      log(event, payload);
    });
  }

  // Probe 5: mention provider search and resolve.
  bb.ui.registerMentionProvider({
    id: "agents",
    label: "Sidekick",
    search({ query, threadId }) {
      log("mention.search", { query, threadId });
      const items = agents()
        .filter((agent) => agent.handle.includes(query.toLowerCase()))
        .map((agent) => ({ id: agent.id, title: `@${agent.handle}`, subtitle: agent.model }));
      if ("all".startsWith(query.toLowerCase())) {
        items.unshift({ id: "all", title: "@all", subtitle: "Every agent in this thread" });
      }
      return items;
    },
    resolve(itemId) {
      log("mention.resolve", { itemId });
      const agent = agentById(itemId);
      return {
        context:
          itemId === "all"
            ? "The user addressed every Sidekick agent in this thread. Sidekick delivers it to them."
            : `The user addressed Sidekick agent @${agent?.handle ?? itemId}. Sidekick delivers it to that agent; do not answer on its behalf.`,
      };
    },
  });

  bb.rpc.register(rpcContract, {
    spike_agents: () => ({ agents: agents() }),
    spike_thread_agents: ({ threadId }) => ({
      self: threadAgent(threadId)?.agent ?? null,
      children: childAgents(threadId).map((child) => ({
        threadId: child.threadId,
        handle: child.agent.handle,
      })),
    }),
  });

  // Probe 6: CLI for automations, direct runs, and reading the log.
  const usage = [
    "Usage:",
    "  bb sidekick log [--limit <n>] [--kind <kind>]",
    "  bb sidekick agents",
    "  bb sidekick run --agent <handle> --project <id> --prompt <text> [--thread <id>]",
    "  bb sidekick route --thread <id> --agent <handle> --text <text>",
    "  bb sidekick rpc <plugin-id> <method> [json-input]",
    "  bb sidekick env",
  ].join("\n");
  const flag = (argv: string[], name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  bb.cli.register({
    name: "sidekick",
    summary: "Sidekick spike probes",
    commands: [
      { name: "log", summary: "Read the probe log", usage: "bb sidekick log [--limit <n>] [--kind <kind>]" },
      { name: "agents", summary: "List probe agents", usage: "bb sidekick agents" },
      { name: "run", summary: "Run an agent in a fresh or existing thread", usage: "bb sidekick run --agent <handle> --project <id> --prompt <text> [--thread <id>]" },
      { name: "route", summary: "Route a message to an agent child thread", usage: "bb sidekick route --thread <id> --agent <handle> --text <text>" },
      { name: "rpc", summary: "Call another plugin's RPC", usage: "bb sidekick rpc <plugin-id> <method> [json-input]" },
      { name: "env", summary: "Show CLI context", usage: "bb sidekick env" },
    ],
    async run(argv, context) {
      const [command, ...args] = argv;
      const ok = (value: unknown) => ({ exitCode: 0, stdout: JSON.stringify(value, null, 2).slice(0, 60_000) });
      const fail = (message: string) => ({ exitCode: 1, stderr: message });
      switch (command) {
        case "log": {
          const limit = Number(flag(args, "limit") ?? 40);
          const kind = flag(args, "kind");
          const rows = (
            kind === undefined
              ? db.prepare("SELECT * FROM probe_log ORDER BY id DESC LIMIT ?").all(limit)
              : db.prepare("SELECT * FROM probe_log WHERE kind = ? ORDER BY id DESC LIMIT ?").all(kind, limit)
          ) as Array<{ id: number; at: string; kind: string; data: string }>;
          return ok(rows.reverse().map((row) => ({ ...row, data: JSON.parse(row.data) })));
        }
        case "agents":
          return ok(agents());
        case "run": {
          const agent = agentByHandle(flag(args, "agent") ?? "");
          const prompt = flag(args, "prompt");
          const projectId = flag(args, "project") ?? context.projectId;
          const threadId = flag(args, "thread");
          log("cli.run", { argv, context: { ...context, signal: undefined } });
          if (agent === null || prompt === undefined || projectId === undefined) return fail(usage);
          if (threadId !== undefined) {
            const result = await bb.sdk.threads.send({
              threadId,
              input: [{ type: "text", text: prompt, mentions: [] }],
              mode: "queue-if-active",
            });
            return ok({ sent: threadId, result });
          }
          const thread = await bb.sdk.threads.spawn({
            projectId,
            environment: { type: "project-default" },
            providerId: agent.providerId,
            model: agent.model,
            permissionMode: agent.permissionMode,
            pluginMetadata: { agentId: agent.id },
            title: `@${agent.handle}: ${prompt.slice(0, 40)}`,
            prompt,
          });
          db.prepare("INSERT INTO thread_agents VALUES (?, ?, NULL)").run(thread.id, agent.id);
          return ok({ spawned: thread.id });
        }
        case "route": {
          const threadId = flag(args, "thread");
          const agent = agentByHandle(flag(args, "agent") ?? "");
          const text = flag(args, "text");
          if (threadId === undefined || agent === null || text === undefined) return fail(usage);
          const thread = await bb.sdk.threads.get({ threadId });
          await route(threadId, thread.projectId, text, [agent]);
          return ok({ routed: agent.handle, children: childAgents(threadId).map((child) => child.threadId) });
        }
        case "rpc": {
          const [pluginId, method, input] = args;
          if (pluginId === undefined || method === undefined) return fail(usage);
          const result = await bb.sdk.plugins.callRpc({
            pluginId,
            method,
            input: input === undefined ? null : JSON.parse(input),
            outputSchema: z.unknown(),
          });
          return ok(result);
        }
        case "mention": {
          // Sends text with plugin mention pills, the shape the composer sends.
          const threadId = flag(args, "thread");
          const text = flag(args, "text");
          const ids = (flag(args, "items") ?? "").split(",").filter((id) => id !== "");
          if (threadId === undefined || text === undefined) return fail(usage);
          const mentions = ids.map((itemId) => {
            const label = itemId === "all" ? "@all" : `@${agentById(itemId)?.handle ?? itemId}`;
            const start = text.indexOf(label);
            return {
              start: Math.max(start, 0),
              end: Math.max(start, 0) + label.length,
              resource: { kind: "plugin" as const, pluginId: bb.pluginId, itemId: `agents:${itemId}`, label },
            };
          });
          const result = await bb.sdk.threads.send({
            threadId,
            input: [{ type: "text", text, mentions }],
            mode: "auto",
          });
          return ok(result);
        }
        case "spawn-plain": {
          const projectId = flag(args, "project") ?? "proj_personal";
          const prompt = flag(args, "prompt") ?? "sidekick-spike parent. Reply with ok.";
          const thread = await bb.sdk.threads.spawn({
            projectId,
            environment: { type: "project-default" },
            providerId: "claude-code",
            model: "claude-haiku-4-5-20251001",
            title: flag(args, "title") ?? "sidekick-spike parent",
            prompt,
          });
          return ok({ spawned: thread.id });
        }
        case "env":
          return ok({ context: { ...context, signal: undefined }, id: randomUUID() });
      }
      return { exitCode: command === undefined ? 0 : 1, stdout: usage };
    },
  });

  bb.onDispose(() => bb.log.info("disposed"));
}
