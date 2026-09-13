import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRpc, useRealtime } from "@get-bb/plugin-sdk/app";
import type { rpcContract, State } from "./src/contracts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
function OnePasswordPage() {
  const rpc = useRpc<typeof rpcContract>(),
    [state, setState] = useState<State | null>(null),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState<string | null>(null);
  const refresh = useCallback(() => {
    void rpc.call("state").then(
      (s) => {
        setState(s);
        setError(null);
      },
      () => setError("Could not load 1Password settings. Try refreshing."),
    );
  }, [rpc]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);
  useRealtime("requests-changed", refresh);
  const requests = state?.requests ?? [],
    active = requests.filter((r) =>
      ["pending", "approved", "running"].includes(r.status),
    );
  const cancel = async (id: string) => {
    setPending(id);
    try {
      await rpc.call("cancel", { id });
      refresh();
    } catch {
      setError("Could not cancel this request. Check the approval service.");
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-5 md:px-6 md:py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              <Icon name="Lock" className="size-3.5" />
              Community integration
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">1Password</h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Credentials for your work. Approval stays with you.
            </p>
          </div>
          <Button variant="outline" onClick={refresh}>
            <Icon name="RotateCcw" className="size-4" />
            Refresh
          </Button>
        </div>
        {(error || state?.error) && (
          <p
            role="alert"
            className="mt-5 rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
          >
            {error || state?.error}
          </p>
        )}
        {!state ? (
          <p role="status" className="mt-8 text-sm text-muted-foreground">
            Loading 1Password…
          </p>
        ) : !state.configured ? (
          <section className="mt-8 rounded-xl border border-border bg-card p-6">
            <Icon name="Lock" className="mb-4 size-8 text-primary" />
            <h2 className="text-lg font-semibold">
              Connect your approval service
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Run the included service and protected worker on infrastructure
              outside your BB agent’s administrative access. Save an approval
              passkey in 1Password, then add the service address and BB request
              token in this plugin’s settings.
            </p>
            <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm">
              <li>Deploy the service using the package’s deployment guide.</li>
              <li>Open its address and create your approval passkey.</li>
              <li>
                Add the HTTPS origin and request token in BB Settings → Plugins
                → 1Password.
              </li>
              <li>
                Try the credential-free approval mapping before connecting a
                vault.
              </li>
            </ol>
            <p className="mt-5 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              The 1Password service account token is entered directly on your
              approval service.
            </p>
          </section>
        ) : (
          <>
            <section className="mt-7 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
              <div>
                <h2 className="text-sm font-medium">
                  {state.available
                    ? "Approval service available"
                    : "Approval service unavailable"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {state.enrolled
                    ? "Passkey enrolled"
                    : "Passkey enrollment needed"}{" "}
                  ·{" "}
                  {state.connected
                    ? "Vault access configured"
                    : "Vault access not configured"}
                </p>
              </div>
              {state.approvalOrigin && (
                <a
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  href={state.approvalOrigin}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open approvals ↗
                </a>
              )}
            </section>
            <div className="mb-3 mt-8 flex items-center justify-between">
              <h2 className="text-base font-semibold">Active requests</h2>
              <span className="text-xs text-muted-foreground">
                {active.length} active
              </span>
            </div>
            {!active.length ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Ask your agent to use a credential mapping. Requests will appear
                here for review.
              </div>
            ) : (
              <div className="space-y-3">
                {active.map((r) => (
                  <article
                    key={r.id}
                    className="rounded-xl border border-border bg-card p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-medium">{r.label}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {r.reason}
                        </p>
                      </div>
                      <span className="rounded-full border border-border px-2 py-1 text-xs">
                        {r.status}
                      </span>
                    </div>
                    <p className="mt-3 break-all text-xs text-muted-foreground">
                      {r.projectId} · {r.kind} · {r.url ?? r.profile}
                    </p>
                    <div className="mt-4 flex gap-3">
                      {r.status === "pending" && state.approvalOrigin && (
                        <a
                          href={`${state.approvalOrigin}/#request=${encodeURIComponent(r.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                        >
                          Review & approve ↗
                        </a>
                      )}
                      <Button
                        variant="outline"
                        disabled={pending === r.id}
                        onClick={() => void cancel(r.id)}
                      >
                        {r.status === "running" ? "Revoke" : "Cancel"}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <h2 className="mb-3 mt-8 text-base font-semibold">
              Available mappings
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {state.mappings.map((m) => (
                <div key={m.id} className="rounded-xl border border-border p-4">
                  <h3 className="text-sm font-medium">{m.label}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {m.kind} · {m.profile} · up to {m.maxSeconds}s
                  </p>
                  <code className="mt-3 block break-all text-xs">{m.id}</code>
                </div>
              ))}
            </div>
            {!state.mappings.length && (
              <p className="text-sm text-muted-foreground">
                Create your first mapping on the approval service.
              </p>
            )}
            <h2 className="mb-3 mt-8 text-base font-semibold">
              Recent activity
            </h2>
            <div className="divide-y divide-border">
              {requests
                .filter((r) => !active.includes(r))
                .slice(0, 20)
                .map((r) => (
                  <div
                    key={r.id}
                    className="flex justify-between gap-3 py-3 text-sm"
                  >
                    <div>
                      {r.label}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString()} ·{" "}
                        {r.result?.summary ?? r.kind}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {r.status}
                    </span>
                  </div>
                ))}
            </div>
          </>
        )}
        <p className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
          Independent community integration, not affiliated with or endorsed by
          1Password. Your approval passkey authorizes this service; vault access
          uses a restricted service account.
        </p>
      </div>
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "onepassword",
    title: "1Password",
    icon: "Lock",
    path: "dashboard",
    component: OnePasswordPage,
  });
});
