// Sidekick frontend. Agents are defined in Settings > Agents and chosen per
// thread from the thread header. There are no Sidekick-only screens.
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_PermissionModePicker as PermissionModePicker,
  experimental_ProviderModelPicker as ProviderModelPicker,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { Agent, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

function AgentDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [draft, setDraft] = useState(agent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Agent>) => setDraft((current) => ({ ...current, ...patch }));
  const save = async () => {
    setSaving(true);
    try {
      await rpc.call("agents_update", {
        id: agent.id,
        handle: draft.handle,
        name: draft.name,
        description: draft.description,
        instructions: draft.instructions,
        providerId: draft.providerId,
        model: draft.model,
        reasoningLevel: draft.reasoningLevel,
        permissionMode: draft.permissionMode,
      });
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit @{agent.handle}</DialogTitle>
          <DialogDescription>
            Changes apply to new threads, and to existing threads after their context is cleared.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Handle</span>
            <Input value={draft.handle} onChange={(event) => set({ handle: event.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Name</span>
            <Input value={draft.name} onChange={(event) => set({ name: event.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Description</span>
            <Input
              value={draft.description}
              onChange={(event) => set({ description: event.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Instructions</span>
            <textarea
              rows={8}
              value={draft.instructions}
              onChange={(event) => set({ instructions: event.target.value })}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ProviderModelPicker
              value={{
                providerId: draft.providerId,
                model: draft.model,
                reasoningLevel: draft.reasoningLevel,
              }}
              onChange={(value) =>
                set({
                  providerId: value.providerId,
                  model: value.model,
                  reasoningLevel: value.reasoningLevel,
                })
              }
            />
            <PermissionModePicker
              providerId={draft.providerId}
              value={draft.permissionMode}
              onChange={(permissionMode) => set({ permissionMode })}
            />
          </div>
          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentsSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { agents, error } = useAgents();
  const [editing, setEditing] = useState<Agent | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
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
      <div className="rounded-lg border border-border bg-card">
        {agents === null ? null : agents.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">
            No agents yet. Choose New agent and describe what it should do.
          </p>
        ) : (
          <ul className="divide-y divide-border px-4">
            {agents.map((agent) => (
              <li key={agent.id} className="flex items-center gap-3 py-3">
                <Icon name="Bot" className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">@{agent.handle}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {agent.name} · {agent.model} · {agent.permissionMode}
                    </span>
                  </div>
                  {agent.description === "" ? null : (
                    <p className="truncate text-xs text-muted-foreground">{agent.description}</p>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Actions for @${agent.handle}`}>
                      <Icon name="MoreHorizontal" className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(agent)}>Edit</DropdownMenuItem>
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
      </div>
      {editing === null ? null : (
        <AgentDialog key={editing.id} agent={editing} onClose={() => setEditing(null)} />
      )}
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
  app.slots.settingsSection({
    id: "agents",
    title: "Agents",
    description: "Reusable identities with their own instructions, model, and permissions.",
    component: AgentsSettings,
  });
  app.slots.experimental_threadHeaderAction({
    id: "thread-agent",
    title: "Agent",
    component: ThreadAgentSelector,
  });
});
