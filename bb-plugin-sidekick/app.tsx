// Sidekick frontend — the Agents page and the agent chip in a thread header.
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_NewThreadComposer as NewThreadComposer,
  useBbNavigate,
  useRealtime,
  useRpc,
  type NewThreadRequest,
  type PluginNavPanelProps,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { Agent, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const NEW_AGENT_PROMPT =
  "I want a new Sidekick agent. Ask me what it should do, then propose a handle, a name, and its instructions. Create it with sidekick_agent_create once I confirm.";

function useAgents() {
  const rpc = useRpc<typeof rpcContract>();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("agents_list").then(
      (result) => {
        setAgents(result.agents);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime("agents-changed", refetch);
  return { rpc, agents, error, refetch };
}

/** One editable field of the profile; saves on blur when the value changed. */
function Field({
  label,
  value,
  multiline,
  onSave,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const shared = {
    value: draft,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: () => {
      if (draft !== value) onSave(draft);
    },
    className:
      "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground",
  };
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1">
        {multiline === true ? <textarea rows={8} {...shared} /> : <input {...shared} />}
      </div>
    </label>
  );
}

function AgentProfile({ agent, onChanged }: { agent: Agent; onChanged: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [error, setError] = useState<string | null>(null);
  const save = (patch: Partial<Agent>) => {
    rpc.call("agents_update", { id: agent.id, ...patch }).then(
      () => {
        setError(null);
        onChanged();
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  };
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">@{agent.handle}</h2>
          <p className="text-sm text-muted-foreground">
            {agent.model} · {agent.permissionMode} · {agent.reasoningLevel}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate.toPluginPanel("agents", { subPath: `${agent.id}/new` })}>
            <Icon name="Plus" className="size-4" />
            Start conversation
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              rpc.call("agents_delete", { id: agent.id }).then(() => {
                onChanged();
                navigate.toPluginPanel("agents", { subPath: "", replace: true });
              });
            }}
          >
            Delete agent
          </Button>
        </div>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Field label="Handle" value={agent.handle} onSave={(handle) => save({ handle })} />
      <Field label="Name" value={agent.name} onSave={(name) => save({ name })} />
      <Field
        label="Description"
        value={agent.description}
        onSave={(description) => save({ description })}
      />
      <Field
        label="Instructions"
        value={agent.instructions}
        multiline
        onSave={(instructions) => save({ instructions })}
      />
      <p className="text-xs text-muted-foreground">
        Model and permissions apply to every thread this agent runs in. A thread cannot change them
        on its own.
      </p>
    </div>
  );
}

function StartConversation({ agent }: { agent: Agent }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const submit = async (request: NewThreadRequest) => {
    const result = await rpc.call("conversation_start", {
      agentId: agent.id,
      request: request as never,
    });
    navigate.toThread(result.threadId);
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <h2 className="text-base font-medium">New thread with @{agent.handle}</h2>
        <p className="text-sm text-muted-foreground">
          {agent.name} runs on {agent.model}. Pick a project to work in a repository, or leave it
          personal.
        </p>
      </div>
      <NewThreadComposer
        defaultProviderId={agent.providerId}
        defaultModel={agent.model}
        defaultReasoningLevel={agent.reasoningLevel}
        defaultPermissionMode={agent.permissionMode}
        placeholder={`Ask @${agent.handle} for something`}
        draftKey={`sidekick:${agent.id}`}
        onSubmit={submit}
      />
    </div>
  );
}

function AgentsPage({ subPath }: PluginNavPanelProps) {
  const { agents, error, refetch } = useAgents();
  const navigate = useBbNavigate();
  const [selectedId, action] = subPath.split("/");
  const selected = (agents ?? []).find((agent) => agent.id === selectedId) ?? null;
  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-border p-3">
        <Button
          className="w-full justify-start"
          variant="ghost"
          onClick={() => navigate.toCompose({ initialPrompt: NEW_AGENT_PROMPT, focusPrompt: true })}
        >
          <Icon name="Plus" className="size-4" />
          New agent
        </Button>
        <ul className="mt-2">
          {(agents ?? []).map((agent) => (
            <li key={agent.id}>
              <button
                type="button"
                onClick={() => navigate.toPluginPanel("agents", { subPath: agent.id })}
                className={cn(
                  "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                  agent.id === selectedId && "bg-accent",
                )}
              >
                <span className="block truncate">@{agent.handle}</span>
                <span className="block truncate text-xs text-muted-foreground">{agent.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : agents === null ? null : selected === null ? (
          <p className="text-sm text-muted-foreground">
            {agents.length === 0
              ? "No agents yet. Choose New agent and describe what it should do."
              : "Select an agent."}
          </p>
        ) : action === "new" ? (
          <StartConversation agent={selected} />
        ) : (
          <AgentProfile agent={selected} onChanged={refetch} />
        )}
      </div>
    </div>
  );
}

function ThreadAgent({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  useEffect(() => {
    rpc.call("thread_agent", { threadId }).then((result) => setAgent(result.agent));
  }, [rpc, threadId]);
  if (agent === null) return null;
  return (
    <button
      type="button"
      title={`${agent.name} · ${agent.model}`}
      onClick={() => navigate.toPluginPanel("agents", { subPath: agent.id })}
      className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
    >
      @{agent.handle}
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "agents",
    title: "Sidekick",
    icon: "Bot",
    path: "agents",
    component: AgentsPage,
  });
  app.slots.experimental_threadHeaderAction({
    id: "thread-agent",
    title: "Sidekick agent",
    component: ThreadAgent,
  });
});
