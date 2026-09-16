// Sidekick — reusable agents with their own instructions, model, and
// permissions, attached to ordinary BB threads.
//
// An agent thread is a normal BB thread carrying `pluginMetadata.agentId`.
// `bb.agents.configure` turns that tag into the agent's instructions, and the
// `message.dispatch` hook keeps the thread on the agent's model and within its
// permissions. The Agents settings page, the thread header selector, the CLI,
// and the agent tools all read and write the same `agents` table.
import { randomBytes } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const HANDLE_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
/** Leaves room inside configure's 4096-character budget for memory later. */
const MAX_INSTRUCTIONS = 2_000;

const permissionModeSchema = z.enum(["accept-edits", "auto", "full"]);
const reasoningLevelSchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "ultracode",
]);

const agentSchema = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  providerId: z.string(),
  model: z.string(),
  reasoningLevel: reasoningLevelSchema,
  permissionMode: permissionModeSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Agent = z.infer<typeof agentSchema>;

const agentWriteSchema = z.object({
  handle: z.string(),
  name: z.string(),
  description: z.string().optional(),
  instructions: z.string(),
  providerId: z.string().optional(),
  model: z.string().optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  permissionMode: permissionModeSchema.optional(),
});

const agentPatchSchema = agentWriteSchema.partial().extend({ id: z.string() });

export const rpcContract = defineRpcContract({
  agents_list: {
    input: z.null(),
    output: z.object({ agents: z.array(agentSchema) }),
  },
  agents_get: {
    input: z.object({ id: z.string() }),
    output: z.object({ agent: agentSchema.nullable() }),
  },
  agents_update: {
    input: agentPatchSchema,
    output: z.object({ agent: agentSchema }),
  },
  agents_delete: {
    input: z.object({ id: z.string() }),
    output: z.object({ deleted: z.boolean() }),
  },
  thread_agent: {
    input: z.object({ threadId: z.string() }),
    output: z.object({ agent: agentSchema.nullable() }),
  },
  thread_agent_set: {
    input: z.object({ threadId: z.string(), agentId: z.string().nullable() }),
    output: z.object({ agent: agentSchema.nullable() }),
  },
});

/** Realtime channel the Agents settings and thread headers listen on. */
const AGENTS_CHANGED = "agents-changed";

type AgentRow = {
  id: string;
  handle: string;
  name: string;
  description: string;
  instructions: string;
  provider_id: string;
  model: string;
  reasoning_level: Agent["reasoningLevel"];
  permission_mode: Agent["permissionMode"];
  created_at: number;
  updated_at: number;
};

class InputError extends Error {}

const PERMISSION_RANK: Record<Agent["permissionMode"], number> = {
  "accept-edits": 0,
  auto: 1,
  full: 2,
};

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    providerId: row.provider_id,
    model: row.model,
    reasoningLevel: row.reasoning_level,
    permissionMode: row.permission_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateHandle(value: string): string {
  const handle = value.trim().toLowerCase().replace(/^@/, "");
  if (!HANDLE_PATTERN.test(handle)) {
    throw new InputError(
      "handle must be 2-32 characters, start with a letter, and use lowercase letters, digits, or hyphens",
    );
  }
  return handle;
}

function validateText(label: string, value: string, max: number, required: boolean): string {
  const text = value.trim();
  if (text === "") {
    if (required) throw new InputError(`${label} must not be empty`);
    return "";
  }
  if (text.length > max) {
    throw new InputError(`${label} must be at most ${max} characters`);
  }
  return text;
}

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE agents (
       id TEXT PRIMARY KEY,
       handle TEXT NOT NULL,
       name TEXT NOT NULL,
       description TEXT NOT NULL DEFAULT '',
       instructions TEXT NOT NULL,
       provider_id TEXT NOT NULL,
       model TEXT NOT NULL,
       reasoning_level TEXT NOT NULL,
       permission_mode TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       deleted_at INTEGER
     );
     CREATE UNIQUE INDEX agents_active_handle ON agents(handle) WHERE deleted_at IS NULL;
     CREATE TABLE thread_agents (
       thread_id TEXT PRIMARY KEY,
       agent_id TEXT NOT NULL,
       created_at INTEGER NOT NULL
     );
     CREATE INDEX thread_agents_agent ON thread_agents(agent_id);`,
  ]);

  function listAgents(): Agent[] {
    const rows = db
      .prepare("SELECT * FROM agents WHERE deleted_at IS NULL ORDER BY handle")
      .all() as AgentRow[];
    return rows.map(toAgent);
  }
  function findAgent(idOrHandle: string): Agent | null {
    const row = db
      .prepare(
        `SELECT * FROM agents
         WHERE deleted_at IS NULL AND (id = ? OR handle = ?)
         LIMIT 1`,
      )
      .get(idOrHandle, idOrHandle.trim().toLowerCase().replace(/^@/, "")) as AgentRow | undefined;
    return row === undefined ? null : toAgent(row);
  }
  function threadAgent(threadId: string): Agent | null {
    const row = db
      .prepare("SELECT agent_id FROM thread_agents WHERE thread_id = ?")
      .get(threadId) as { agent_id: string } | undefined;
    return row === undefined ? null : findAgent(row.agent_id);
  }
  function rememberThreadAgent(threadId: string, agentId: string): void {
    db.prepare(
      "INSERT OR REPLACE INTO thread_agents (thread_id, agent_id, created_at) VALUES (?, ?, ?)",
    ).run(threadId, agentId, Date.now());
  }
  function changed(): void {
    bb.realtime.publish(AGENTS_CHANGED, { count: listAgents().length });
  }

  /** BB's own defaults for a new thread, used when the user names none. */
  async function executionDefaults(projectId?: string) {
    const target = projectId ?? "proj_personal";
    const defaults = await bb.sdk.projects.defaultExecutionOptions({ projectId: target });
    if (defaults === null) {
      throw new InputError(
        "BB has no execution defaults yet; name a provider and model for this agent",
      );
    }
    return defaults;
  }

  async function createAgent(
    input: z.infer<typeof agentWriteSchema>,
    projectId?: string,
  ): Promise<Agent> {
    const handle = validateHandle(input.handle);
    if (findAgent(handle) !== null) {
      throw new InputError(`an agent named @${handle} already exists`);
    }
    const defaults = await executionDefaults(projectId);
    const now = Date.now();
    const agent: Agent = {
      id: `agt_${randomBytes(8).toString("base64url").toLowerCase()}`,
      handle,
      name: validateText("name", input.name, MAX_NAME, true),
      description: validateText("description", input.description ?? "", MAX_DESCRIPTION, false),
      instructions: validateText("instructions", input.instructions, MAX_INSTRUCTIONS, true),
      providerId: input.providerId ?? defaults.providerId,
      model: input.model ?? defaults.model,
      reasoningLevel: input.reasoningLevel ?? defaults.reasoningLevel,
      permissionMode: input.permissionMode ?? defaults.permissionMode,
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(
      `INSERT INTO agents (
         id, handle, name, description, instructions, provider_id, model,
         reasoning_level, permission_mode, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      agent.id,
      agent.handle,
      agent.name,
      agent.description,
      agent.instructions,
      agent.providerId,
      agent.model,
      agent.reasoningLevel,
      agent.permissionMode,
      agent.createdAt,
      agent.updatedAt,
    );
    changed();
    return agent;
  }

  function updateAgent(input: z.infer<typeof agentPatchSchema>): Agent {
    const current = findAgent(input.id);
    if (current === null) throw new InputError(`no agent ${input.id}`);
    const handle = input.handle === undefined ? current.handle : validateHandle(input.handle);
    if (handle !== current.handle && findAgent(handle) !== null) {
      throw new InputError(`an agent named @${handle} already exists`);
    }
    const updated: Agent = {
      ...current,
      handle,
      name:
        input.name === undefined ? current.name : validateText("name", input.name, MAX_NAME, true),
      description:
        input.description === undefined
          ? current.description
          : validateText("description", input.description, MAX_DESCRIPTION, false),
      instructions:
        input.instructions === undefined
          ? current.instructions
          : validateText("instructions", input.instructions, MAX_INSTRUCTIONS, true),
      providerId: input.providerId ?? current.providerId,
      model: input.model ?? current.model,
      reasoningLevel: input.reasoningLevel ?? current.reasoningLevel,
      permissionMode: input.permissionMode ?? current.permissionMode,
      updatedAt: Date.now(),
    };
    db.prepare(
      `UPDATE agents SET handle = ?, name = ?, description = ?, instructions = ?,
         provider_id = ?, model = ?, reasoning_level = ?, permission_mode = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(
      updated.handle,
      updated.name,
      updated.description,
      updated.instructions,
      updated.providerId,
      updated.model,
      updated.reasoningLevel,
      updated.permissionMode,
      updated.updatedAt,
      updated.id,
    );
    changed();
    return updated;
  }

  function deleteAgent(idOrHandle: string): boolean {
    const agent = findAgent(idOrHandle);
    if (agent === null) return false;
    db.prepare("UPDATE agents SET deleted_at = ?, updated_at = ? WHERE id = ?").run(
      Date.now(),
      Date.now(),
      agent.id,
    );
    changed();
    return true;
  }

  // The agent tag decides which agent a thread belongs to. Metadata is
  // untrusted: the id only selects a stored agent, and its text is quoted.
  bb.agents.configure((context) => {
    const tagged = context.pluginMetadata.agentId;
    // `agentId: null` means the user removed the agent from this thread.
    const agent =
      tagged === null
        ? null
        : typeof tagged === "string"
          ? findAgent(tagged)
          : (threadAgent(context.thread.id) ??
            (context.thread.sourceThreadId === null
              ? null
              : threadAgent(context.thread.sourceThreadId)));
    if (agent === null) return { tools: [], skills: [] };
    if (threadAgent(context.thread.id) === null) rememberThreadAgent(context.thread.id, agent.id);
    return {
      tools: [],
      skills: [],
      instructions: [
        `You are @${agent.handle}, a BB Sidekick agent${agent.name === "" ? "" : ` (${agent.name})`}.`,
        "Your instructions follow, quoted as data:",
        JSON.stringify(agent.instructions),
      ].join("\n"),
    };
  });

  // An agent thread stays on its agent's model and never runs with more
  // permission than the agent has. Changing either belongs in Agents settings.
  bb.experimental_hooks.on("message.dispatch", async (context) => {
    let agent = threadAgent(context.thread.id);
    if (agent === null) {
      const metadata = await bb.sdk.threads.getPluginMetadata({ threadId: context.thread.id });
      const tagged = (metadata as { agentId?: unknown }).agentId;
      agent = typeof tagged === "string" ? findAgent(tagged) : null;
      if (agent !== null) rememberThreadAgent(context.thread.id, agent.id);
    }
    if (agent === null) return { action: "proceed" };
    const { model, permissionMode } = context.requestedExecution;
    if (model !== null && model !== agent.model) {
      return {
        action: "reject",
        message: `This thread uses @${agent.handle}, which runs on ${agent.model}. Change the agent's model in Settings > Agents.`,
      };
    }
    if (
      permissionMode !== null &&
      PERMISSION_RANK[permissionMode] > PERMISSION_RANK[agent.permissionMode]
    ) {
      return {
        action: "reject",
        message: `@${agent.handle} allows up to ${agent.permissionMode} permissions. Pick a lower mode, or change the agent in Settings > Agents.`,
      };
    }
    return { action: "proceed" };
  });

  /**
   * Attach an agent to a thread, or remove it. The model and reasoning follow
   * the agent. Providers keep a session's instructions until its context is
   * cleared (resuming or compacting keeps them), so switching clears the model
   * context. The conversation stays visible. Only idle threads can switch.
   */
  async function setThreadAgent(threadId: string, agentId: string | null) {
    const agent = agentId === null ? null : findAgent(agentId);
    if (agentId !== null && agent === null) throw new InputError(`no agent ${agentId}`);
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.status === "active") {
      throw new InputError("Wait for the current turn to finish before switching agents.");
    }
    if (agent !== null && thread.providerId !== agent.providerId) {
      throw new InputError(
        `@${agent.handle} runs on ${agent.providerId}, and this thread uses ${thread.providerId}. Start a new thread to use it.`,
      );
    }
    await bb.sdk.threads.updatePluginMetadata({
      threadId,
      set: { agentId: agent === null ? null : agent.id },
    });
    if (agent === null) {
      db.prepare("DELETE FROM thread_agents WHERE thread_id = ?").run(threadId);
    } else {
      rememberThreadAgent(threadId, agent.id);
      await bb.sdk.threads.update({
        threadId,
        model: agent.model,
        reasoningLevel: agent.reasoningLevel,
      });
    }
    await bb.sdk.threads.clearContext({ threadId });
    bb.realtime.publish(AGENTS_CHANGED, { threadId });
    return { agent };
  }

  bb.rpc.register(rpcContract, {
    agents_list: () => ({ agents: listAgents() }),
    agents_get: ({ id }) => ({ agent: findAgent(id) }),
    agents_update: (input) => ({ agent: updateAgent(input) }),
    agents_delete: ({ id }) => ({ deleted: deleteAgent(id) }),
    thread_agent: ({ threadId }) => ({ agent: threadAgent(threadId) }),
    thread_agent_set: ({ threadId, agentId }) => setThreadAgent(threadId, agentId),
  });

  const agentSummary = (agent: Agent) =>
    `@${agent.handle} — ${agent.name} [${agent.model}, ${agent.permissionMode}] ${agent.id}`;

  bb.agents.registerTool({
    name: "sidekick_agent_list",
    description: "List BB Sidekick agents with their handles, models, and permissions.",
    presentation: { label: { pending: "Listing agents", completed: "Listed agents" } },
    parameters: z.object({}),
    execute() {
      const agents = listAgents();
      return agents.length === 0 ? "No agents yet." : agents.map(agentSummary).join("\n");
    },
  });

  bb.agents.registerTool({
    name: "sidekick_agent_get",
    description: "Read one Sidekick agent's complete profile, including its instructions.",
    presentation: { label: { pending: "Reading agent", completed: "Read agent" } },
    parameters: z.object({ agent: z.string().describe("Agent id or @handle") }),
    execute({ agent }) {
      const found = findAgent(agent);
      return found === null
        ? { content: [{ type: "text", text: `No agent ${agent}.` }], isError: true }
        : JSON.stringify(found, null, 2);
    },
  });

  bb.agents.registerTool({
    name: "sidekick_agent_create",
    description:
      "Create a Sidekick agent. Only call this when the user explicitly asks for a new agent. Omit provider, model, reasoning, and permissions to use BB's defaults.",
    instructions:
      "Creating an agent needs an explicit user request. Confirm the handle and instructions first; there are no draft agents.",
    presentation: { label: { pending: "Creating agent", completed: "Created agent" } },
    parameters: z.object({
      handle: z.string().describe("Unique @handle, lowercase letters, digits, and hyphens"),
      name: z.string(),
      description: z.string().optional(),
      instructions: z.string().describe("The agent's standing instructions"),
      providerId: z.string().optional(),
      model: z.string().optional(),
      reasoningLevel: reasoningLevelSchema.optional(),
      permissionMode: permissionModeSchema.optional(),
    }),
    async execute(input, { projectId }) {
      try {
        const agent = await createAgent(input, projectId);
        return `Created ${agentSummary(agent)}`;
      } catch (error) {
        return { content: [{ type: "text", text: String(error) }], isError: true };
      }
    },
  });

  bb.agents.registerTool({
    name: "sidekick_agent_update",
    description:
      "Update a Sidekick agent's handle, name, description, instructions, model, reasoning, or permissions.",
    presentation: { label: { pending: "Updating agent", completed: "Updated agent" } },
    parameters: z.object({
      agent: z.string().describe("Agent id or @handle"),
      handle: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      instructions: z.string().optional(),
      providerId: z.string().optional(),
      model: z.string().optional(),
      reasoningLevel: reasoningLevelSchema.optional(),
      permissionMode: permissionModeSchema.optional(),
    }),
    execute({ agent, ...patch }) {
      const found = findAgent(agent);
      if (found === null) {
        return { content: [{ type: "text", text: `No agent ${agent}.` }], isError: true };
      }
      try {
        return `Updated ${agentSummary(updateAgent({ ...patch, id: found.id }))}`;
      } catch (error) {
        return { content: [{ type: "text", text: String(error) }], isError: true };
      }
    },
  });

  bb.agents.registerTool({
    name: "sidekick_agent_delete",
    description:
      "Delete a Sidekick agent. Its existing threads stay. Only call this when the user asks for it.",
    presentation: { label: { pending: "Deleting agent", completed: "Deleted agent" } },
    parameters: z.object({ agent: z.string().describe("Agent id or @handle") }),
    execute({ agent }) {
      return deleteAgent(agent) ? `Deleted ${agent}.` : `No agent ${agent}.`;
    },
  });

  const usage = [
    "Usage:",
    "  bb sidekick list [--json]",
    "  bb sidekick get <id-or-handle> [--json]",
    "  bb sidekick create --handle <handle> --name <name> --instructions <text>",
    "      [--description <text>] [--provider <id>] [--model <model>]",
    "      [--reasoning <level>] [--permission-mode <mode>] [--json]",
    "  bb sidekick update <id-or-handle> [same options as create] [--json]",
    "  bb sidekick delete <id-or-handle>",
  ].join("\n");
  const flag = (argv: string[], name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    const value = index === -1 ? undefined : argv[index + 1];
    return value?.startsWith("--") === true ? undefined : value;
  };

  bb.cli.register({
    name: "sidekick",
    summary: "Manage BB Sidekick agents",
    commands: [
      { name: "list", summary: "List agents", usage: "bb sidekick list [--json]" },
      {
        name: "get",
        summary: "Read one agent",
        usage: "bb sidekick get <id-or-handle> [--json]",
      },
      {
        name: "create",
        summary: "Create an agent",
        usage:
          "bb sidekick create --handle <handle> --name <name> --instructions <text> [options]",
      },
      {
        name: "update",
        summary: "Update an agent",
        usage: "bb sidekick update <id-or-handle> [options]",
      },
      {
        name: "delete",
        summary: "Delete an agent",
        usage: "bb sidekick delete <id-or-handle>",
      },
    ],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const args = argv.filter((arg) => arg !== "--json");
      const [command, ...rest] = args;
      const target = rest[0]?.startsWith("--") === true ? undefined : rest[0];
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value, null, 2) : text,
      });
      if (command === undefined || command === "help" || command === "--help") {
        return { exitCode: 0, stdout: usage };
      }
      try {
        switch (command) {
          case "list": {
            const agents = listAgents();
            return reply(
              agents,
              agents.length === 0 ? "No agents yet." : agents.map(agentSummary).join("\n"),
            );
          }
          case "get": {
            if (target === undefined) return { exitCode: 1, stderr: usage };
            const agent = findAgent(target);
            if (agent === null) return { exitCode: 1, stderr: `No agent ${target}.` };
            return reply(agent, JSON.stringify(agent, null, 2));
          }
          case "create": {
            const agent = await createAgent(
              {
                handle: flag(rest, "handle") ?? "",
                name: flag(rest, "name") ?? "",
                description: flag(rest, "description"),
                instructions: flag(rest, "instructions") ?? "",
                providerId: flag(rest, "provider"),
                model: flag(rest, "model"),
                reasoningLevel: reasoningLevelSchema.optional().parse(flag(rest, "reasoning")),
                permissionMode: permissionModeSchema
                  .optional()
                  .parse(flag(rest, "permission-mode")),
              },
              ctx.projectId,
            );
            return reply(agent, `Created ${agentSummary(agent)}`);
          }
          case "update": {
            if (target === undefined) return { exitCode: 1, stderr: usage };
            const found = findAgent(target);
            if (found === null) return { exitCode: 1, stderr: `No agent ${target}.` };
            const agent = updateAgent({
              id: found.id,
              handle: flag(rest, "handle"),
              name: flag(rest, "name"),
              description: flag(rest, "description"),
              instructions: flag(rest, "instructions"),
              providerId: flag(rest, "provider"),
              model: flag(rest, "model"),
              reasoningLevel: reasoningLevelSchema.optional().parse(flag(rest, "reasoning")),
              permissionMode: permissionModeSchema.optional().parse(flag(rest, "permission-mode")),
            });
            return reply(agent, `Updated ${agentSummary(agent)}`);
          }
          case "delete": {
            if (target === undefined) return { exitCode: 1, stderr: usage };
            if (!deleteAgent(target)) return { exitCode: 1, stderr: `No agent ${target}.` };
            return reply({ deleted: target }, `Deleted ${target}.`);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { exitCode: 1, stderr: message };
      }
      return { exitCode: 1, stderr: usage };
    },
  });
}
