// Sidekick frontend. Agents are defined in Settings > Agents and chosen per
// thread from the thread header. There are no Sidekick-only screens.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  definePluginApp,
  experimental_ProviderModelPicker as ProviderModelPicker,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { Agent, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const NEW_AGENT_PROMPT =
  "I want a new agent. Ask me what it should do, then propose a handle, a name, and its instructions. Create it with sidekick_agent_create once I confirm.";

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

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
      (cause: unknown) => setError(errorText(cause)),
    );
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime("agents-changed", refetch);
  return { agents, error };
}

const PERMISSION_OPTIONS: ReadonlyArray<{
  value: Agent["permissionMode"];
  label: string;
  description: string;
}> = [
  {
    value: "accept-edits",
    label: "Accept Edits",
    description:
      "Applies edits inside the workspace automatically. Anything beyond the workspace asks you first.",
  },
  {
    value: "auto",
    label: "Approve for me",
    description:
      "Same workspace sandbox, with requests reviewed automatically. High-risk actions can still come back to you.",
  },
  {
    value: "full",
    label: "Full Access",
    description: "No sandbox and no approvals. The agent can run anything on your machine.",
  },
];

const permissionLabel = (mode: Agent["permissionMode"]) =>
  PERMISSION_OPTIONS.find((option) => option.value === mode)?.label ?? mode;

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {description === undefined ? null : (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-card">{children}</div>;
}

/** A labelled text row that saves when it loses focus. */
function TextRow({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="flex items-center gap-4 px-4 py-3">
      <span className="w-28 shrink-0 text-sm">{label}</span>
      <Input
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
      />
    </label>
  );
}

function AgentDetail({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [instructions, setInstructions] = useState(agent.instructions);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setInstructions(agent.instructions), [agent.instructions]);
  const save = (patch: Partial<Agent>) => {
    rpc.call("agents_update", { id: agent.id, ...patch }).then(
      () => setError(null),
      (cause: unknown) => setError(errorText(cause)),
    );
  };
  return (
    <div className="space-y-8">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="ChevronLeft" className="size-4" />
          Agents
        </button>
        <div className="mt-3 flex items-center gap-2">
          <Icon name="Bot" className="size-4 text-muted-foreground" />
          <h2 className="text-base font-medium">@{agent.handle}</h2>
          <span className="rounded border border-border px-1.5 text-xs text-muted-foreground">
            {permissionLabel(agent.permissionMode)}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {agent.name} · {agent.model} · {agent.reasoningLevel}
        </p>
        {error === null ? null : (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <section>
        <SectionHeading title="Identity" description="How you call this agent in threads." />
        <Panel>
          <div className="divide-y divide-border">
            <TextRow label="Handle" value={agent.handle} onSave={(handle) => save({ handle })} />
            <TextRow label="Name" value={agent.name} onSave={(name) => save({ name })} />
            <TextRow
              label="Description"
              value={agent.description}
              placeholder="What this agent is for"
              onSave={(description) => save({ description })}
            />
          </div>
        </Panel>
      </section>

      <section>
        <SectionHeading
          title="Instructions"
          description="Standing behavior for every thread this agent runs in. New threads get changes right away; existing threads after their context is cleared."
        />
        <Panel>
          <textarea
            rows={10}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            onBlur={() => {
              if (instructions !== agent.instructions) save({ instructions });
            }}
            className="block w-full resize-y rounded-lg bg-transparent px-4 py-3 text-sm outline-none"
          />
        </Panel>
      </section>

      <section>
        <SectionHeading
          title="Model"
          description="The model and reasoning level this agent's threads run on."
        />
        <Panel>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="text-sm">Model</span>
            <ProviderModelPicker
              align="end"
              value={{
                providerId: agent.providerId,
                model: agent.model,
                reasoningLevel: agent.reasoningLevel,
              }}
              onChange={(value) =>
                save({
                  providerId: value.providerId,
                  model: value.model,
                  reasoningLevel: value.reasoningLevel,
                })
              }
            />
          </div>
        </Panel>
      </section>

      <section>
        <SectionHeading
          title="Permission limit"
          description="Highest permission mode this agent's threads may run with. A turn that asks for more is refused."
        />
        <Panel>
          <div role="radiogroup" aria-label="Permission limit" className="divide-y divide-border">
            {PERMISSION_OPTIONS.map((option) => {
              const selected = option.value === agent.permissionMode;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    if (!selected) save({ permissionMode: option.value });
                  }}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-foreground" : "border-muted-foreground",
                    )}
                  >
                    {selected ? <span className="size-2 rounded-full bg-foreground" /> : null}
                  </span>
                  <span>
                    <span className="block text-sm">{option.label}</span>
                    <span className="block text-sm text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>
      </section>

      <section>
        <SectionHeading
          title="Danger zone"
          description="Deleting an agent keeps its threads. They stop using its instructions."
        />
        <Panel>
          <div className="px-4 py-3">
            <Button
              variant="destructive"
              onClick={() => {
                rpc.call("agents_delete", { id: agent.id }).then(onBack, (cause: unknown) =>
                  setError(errorText(cause)),
                );
              }}
            >
              Delete agent
            </Button>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function AgentsSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { agents, error } = useAgents();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = (agents ?? []).find((agent) => agent.id === openId) ?? null;
  if (open !== null) return <AgentDetail agent={open} onBack={() => setOpenId(null)} />;
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">Agents</h2>
          <p className="text-sm text-muted-foreground">
            Reusable identities with their own instructions, model, and permissions. Pick one from
            any thread header.
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() => navigate.toCompose({ initialPrompt: NEW_AGENT_PROMPT, focusPrompt: true })}
        >
          <Icon name="Plus" className="size-4" />
          New agent
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Panel>
        {agents === null ? null : agents.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">
            No agents yet. Choose New agent and describe what it should do.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {agents.map((agent) => (
              <li key={agent.id} className="flex items-center gap-2 pr-2">
                <button
                  type="button"
                  onClick={() => setOpenId(agent.id)}
                  className="min-w-0 flex-1 px-4 py-3 text-left"
                >
                  <span className="flex items-center gap-2">
                    <Icon name="Bot" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium">@{agent.handle}</span>
                    <span className="rounded border border-border px-1.5 text-xs text-muted-foreground">
                      {agent.name}
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                    <span>{agent.model}</span>
                    <span>{agent.reasoningLevel}</span>
                    <span className={cn(agent.permissionMode === "full" && "text-orange-500")}>
                      {permissionLabel(agent.permissionMode)}
                    </span>
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Actions for @${agent.handle}`}>
                      <Icon name="MoreHorizontal" className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setOpenId(agent.id)}>Open</DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => void rpc.call("agents_delete", { id: agent.id })}
                    >
                      Delete agent
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function ThreadAgentSelector({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { agents } = useAgents();
  const [current, setCurrent] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("thread_agent", { threadId }).then((result) => setCurrent(result.agent));
  }, [rpc, threadId]);
  useEffect(refetch, [refetch]);
  useRealtime("agents-changed", refetch);
  const choose = (agentId: string | null) => {
    rpc.call("thread_agent_set", { threadId, agentId }).then(
      (result) => {
        setCurrent(result.agent);
        setError(null);
      },
      (cause: unknown) => setError(errorText(cause)),
    );
  };
  if (agents === null || (agents.length === 0 && current === null)) return null;
  const label = current === null ? "Agent" : `@${current.handle}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          aria-label={current === null ? "Choose an agent" : `Agent: @${current.handle}`}
        >
          <Icon name="Bot" className="size-3.5" />
          {isCompactViewport ? null : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block">Agent for this thread</span>
          <span className="block text-xs font-normal text-muted-foreground">
            Switching starts a fresh model context. Messages stay visible.
          </span>
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => choose(null)}>
          <span className="flex-1">No agent</span>
          {current === null ? <Icon name="Check" className="size-3.5" /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {agents.map((agent) => (
          <DropdownMenuItem key={agent.id} onSelect={() => choose(agent.id)}>
            <span className="min-w-0 flex-1">
              <span className="block">@{agent.handle}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {agent.name} · {agent.model}
              </span>
            </span>
            {current?.id === agent.id ? <Icon name="Check" className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
        {error === null ? null : (
          <>
            <DropdownMenuSeparator />
            <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
              {error}
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default definePluginApp((app) => {
  // The section renders its own heading so it can switch between the list and
  // an agent's detail page, like Settings > Machines.
  app.slots.settingsSection({ id: "agents", component: AgentsSettings });
  app.slots.experimental_threadHeaderAction({
    id: "thread-agent",
    title: "Agent",
    component: ThreadAgentSelector,
  });
});
