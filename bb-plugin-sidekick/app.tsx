// Sidekick spike frontend. Probes the sidebar page, the thread header, and
// the silent-reply directive. Replace with the real UI after the spike.
import { useEffect, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { Agent, rpcContract } from "./server";

function AgentsPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  useEffect(() => {
    rpc.call("spike_agents").then((result) => setAgents(result.agents));
  }, [rpc]);
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pt-3 md:px-5 md:pt-4">
        <h2 className="text-sm font-medium">Agents</h2>
        <ul className="mt-3 divide-y divide-border text-sm">
          {(agents ?? []).map((agent) => (
            <li key={agent.id} className="flex justify-between py-2">
              <span>@{agent.handle}</span>
              <span className="text-muted-foreground">{agent.model}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ThreadAgents({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    rpc.call("spike_thread_agents", { threadId }).then((result) => {
      const handles = [
        ...(result.self === null ? [] : [result.self.handle]),
        ...result.children.map((child) => child.handle),
      ];
      setLabel(handles.length === 0 ? null : handles.map((handle) => `@${handle}`).join(" "));
    });
  }, [rpc, threadId]);
  if (label === null) return null;
  return <span className="px-2 text-xs text-muted-foreground">{label}</span>;
}

function NoReply() {
  return null;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "agents",
    title: "Sidekick",
    icon: "Users",
    path: "agents",
    component: AgentsPage,
  });
  app.slots.experimental_threadHeaderAction({
    id: "thread-agents",
    title: "Agents in this thread",
    component: ThreadAgents,
  });
  app.slots.messageDirective({ id: "sidekick-no-reply", component: NoReply });
});
