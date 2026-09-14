import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  useBbContext,
  useBbNavigate,
  useRealtime,
  experimental_Icon as Icon,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, health, Job, Session } from "./src/contracts";
import type { z } from "zod";
import { CredentialForm } from "./components/credential-form";
import { Button } from "./components/ui/button";
import {
  SettingsSection,
  SettingsRowList,
  SettingsRow,
} from "./components/ui/settings-section";

type Health = z.infer<typeof health>;
type Machine = { hostId: string; label: string; connected: boolean };

function MachineDependencies({
  machine,
  revision,
}: {
  machine: Machine;
  revision: number;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [info, setInfo] = useState<Health | null>(null),
    [busy, setBusy] = useState<"check" | "install" | null>(null),
    [error, setError] = useState(""),
    [job, setJob] = useState<Job | null>(null);
  const alive = useRef(true),
    locked = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  const check = useCallback(async () => {
    if (!machine.connected || locked.current) return;
    locked.current = true;
    const gen = generation.current;
    setBusy("check");
    setError("");
    try {
      const next = await rpc.call("probe", { hostId: machine.hostId });
      if (alive.current && gen === generation.current) setInfo(next);
    } catch (e) {
      if (alive.current && gen === generation.current) {
        setInfo(null);
        setError(String(e));
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(null);
    }
  }, [rpc, machine.hostId, machine.connected]);
  useEffect(() => {
    if (!machine.connected) {
      generation.current++;
      setInfo(null);
      setError("");
      return;
    }
    void check();
  }, [check, revision, machine.connected]);
  async function install() {
    if (locked.current || !machine.connected) return;
    locked.current = true;
    setBusy("install");
    setError("");
    const gen = generation.current;
    try {
      const started = await rpc.call("setup", {
        hostId: machine.hostId,
        dependencies: true,
      });
      let current: Job = started;
      while (alive.current && gen === generation.current) {
        setJob(current);
        if (current.status !== "running") break;
        await new Promise((r) => setTimeout(r, 1200));
        if (!alive.current || gen !== generation.current) return;
        current = await rpc.call("job", {
          hostId: machine.hostId,
          id: current.id,
        });
      }
      if (!alive.current || gen !== generation.current) return;
      if (current.status !== "succeeded")
        throw Error(current.error ?? current.status);
      const next = await rpc.call("probe", { hostId: machine.hostId });
      if (alive.current && gen === generation.current) setInfo(next);
    } catch (e) {
      if (alive.current && gen === generation.current) setError(String(e));
    } finally {
      locked.current = false;
      if (alive.current) {
        setBusy(null);
        setJob(null);
      }
    }
  }
  const rows = [
    {
      name: "Chromium / Chrome",
      icon: "Globe",
      ready: info?.chromeRunnable,
      version: info?.chromeVersion?.replace(
        /^Google Chrome for Testing\s*/,
        "",
      ),
      status: info
        ? info.chromeRunnable
          ? "Launch verified"
          : info.chromeInstalled
            ? "Installed, cannot launch"
            : "Not installed"
        : "Not checked",
    },
    {
      name: "Browse engine",
      icon: "Terminal",
      ready: info?.installed,
      version: info?.installed ? info.version : null,
      status: info
        ? info.installed
          ? "Ready"
          : "Not installed"
        : "Not checked",
    },
    {
      name: "FFmpeg",
      icon: "Play",
      ready: info?.ffmpeg,
      version: null,
      status: info
        ? info.ffmpeg
          ? "Ready for recording"
          : "Recording unavailable"
        : "Not checked",
    },
  ];
  if (!info || info.platform === "linux")
    rows.push(
      {
        name: "Display",
        icon: "Monitor",
        ready: info ? info.display !== "missing" : undefined,
        version: null,
        status: info
          ? info.display === "host"
            ? "Host DISPLAY"
            : info.display === "virtual"
              ? "Virtual display (Xvfb)"
              : "No display — install Xvfb and keyboard files"
          : "Not checked",
      },
      {
        name: "Xvfb",
        icon: "AppWindow",
        ready: info?.xvfb,
        version: null,
        status: info
          ? info.xvfb
            ? "Installed"
            : "Not installed"
          : "Not checked",
      },
      {
        name: "xkbcomp",
        icon: "Keyboard",
        ready: info?.xkbcomp,
        version: null,
        status: info
          ? info.xkbcomp
            ? "Keyboard compiler ready"
            : "Not installed — x11-xkb-utils"
          : "Not checked",
      },
      {
        name: "XKB keymap data",
        icon: "FileCode",
        ready: info?.xkbData,
        version: null,
        status: info
          ? info.xkbData
            ? "Installed"
            : "Not installed — xkb-data"
          : "Not checked",
      },
    );
  return (
    <section aria-label={machine.label}>
      <SettingsSection
        title={
          <span className="flex min-w-0 items-center gap-2">
            <Icon
              name="Laptop"
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="truncate">{machine.label}</span>
          </span>
        }
        action={
          machine.connected ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Recheck ${machine.label}`}
              disabled={Boolean(busy)}
              onClick={() => void check()}
            >
              {busy === "check" ? "Checking…" : "Recheck"}
            </Button>
          ) : undefined
        }
      >
        <SettingsRowList>
          {!machine.connected ? (
            <SettingsRow className="py-3.5">
              <Icon
                name="Globe"
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Browser dependencies</p>
                <p className="mt-0.5 text-xs text-subtle-foreground/75">
                  Machine offline · reconnect to check
                </p>
              </div>
              <Icon
                name="CircleX"
                className="size-4 text-muted-foreground"
                aria-label="Offline"
              />
            </SettingsRow>
          ) : (
            rows.map((row) => (
              <SettingsRow key={row.name} className="py-3.5">
                <Icon
                  name={row.icon}
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {row.name}
                    </p>
                    {row.version && (
                      <span className="text-xs text-subtle-foreground/75">
                        {row.version}
                      </span>
                    )}
                  </div>
                  <p
                    className={`mt-0.5 text-xs ${info && !row.ready ? "text-warning-text" : "text-subtle-foreground/75"}`}
                  >
                    {busy === "install"
                      ? "Installing…"
                      : busy === "check"
                        ? "Checking…"
                        : row.status}
                  </p>
                </div>
                {!busy && info && (
                  <Icon
                    name={row.ready ? "CircleCheck" : "CircleX"}
                    className={`size-4 shrink-0 ${row.ready ? "text-muted-foreground/60" : "text-warning-text"}`}
                    aria-label={row.status}
                  />
                )}
              </SettingsRow>
            ))
          )}
        </SettingsRowList>
      </SettingsSection>
      {machine.connected && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span role="status" className="text-xs text-subtle-foreground/75">
            {busy === "install"
              ? `Installing dependencies${job ? ` · ${Math.round(job.durationMs / 1000)}s` : "…"}`
              : info
                ? `${info.platform} / ${info.arch}`
                : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Install dependencies on ${machine.label}`}
            disabled={Boolean(busy)}
            onClick={() => void install()}
          >
            {busy === "install" ? "Installing…" : "Install dependencies"}
          </Button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mt-2 break-words text-xs text-destructive-text"
        >
          {error}
        </p>
      )}
      {info?.launchError && (
        <details className="mt-2 text-xs text-subtle-foreground">
          <summary className="cursor-pointer">Launch details</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words text-destructive-text">
            {info.launchError}
          </pre>
        </details>
      )}
    </section>
  );
}

function BrowseSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [machines, setMachines] = useState<Machine[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const alive = useRef(true),
    fetching = useRef(false);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    setError("");
    try {
      const items = await rpc.call("machines", null);
      if (alive.current) {
        setMachines(items);
        setRevision((v) => v + 1);
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      fetching.current = false;
      if (alive.current) setLoading(false);
    }
  }, [rpc]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  return (
    <div className="space-y-6">
      <SettingsSection
        title="Machine dependencies"
        description="Manage browser and recording tools across all machines. Browsers follow their thread’s machine."
        bodyClassName="border-0 bg-transparent p-0"
        action={
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
      >
        <div className="space-y-6">
          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
          {!machines.length && (
            <p role="status" className="text-sm text-subtle-foreground">
              {loading
                ? "Loading machines…"
                : error
                  ? "Could not load machines."
                  : "No machines enrolled."}
            </p>
          )}
          {machines.map((machine) => (
            <MachineDependencies
              key={machine.hostId}
              machine={machine}
              revision={revision}
            />
          ))}
        </div>
      </SettingsSection>
      <div className="space-y-3 text-xs text-subtle-foreground/75">
        <details>
          <summary className="cursor-pointer text-subtle-foreground">
            Installation details
          </summary>
          <p className="mt-2 leading-relaxed">
            Installation requires internet access. Close active Browse sessions
            on the target machine before updating. On Debian/Ubuntu, missing
            libraries and FFmpeg are installed in Browse’s own directory without
            administrator access. Other systems use their installed libraries.
            Profiles and saved files are preserved.
          </p>
        </details>
        <p>
          Also from the CLI: <code>bb browse probe</code> and{" "}
          <code>bb browse setup</code>.
        </p>
      </div>
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.pendingInteraction({
    id: "browser-credentials",
    component: CredentialForm,
  });
  app.slots.settingsSection({
    id: "browse-settings",
    component: BrowseSettings,
  });
  app.slots.threadPanelAction({
    id: "live",
    title: "Browser",
    icon: "Globe",
    layout: "flush",
    component: LiveBrowser,
  });
  app.slots.experimental_appOverlay({
    id: "auto-show",
    component: AutoShowBrowsers,
  });
});

function LiveBrowser({
  params,
  threadId,
}: {
  threadId: string;
  params: unknown;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState("");
  const id =
    params &&
    typeof params === "object" &&
    !Array.isArray(params) &&
    "id" in params
      ? String((params as { id: unknown }).id)
      : "";
  const sync = useCallback(async () => {
    try {
      setSessions(await rpc.call("list", { threadId }));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [rpc, threadId]);
  useEffect(() => {
    void sync();
  }, [sync]);
  useRealtime("browser-changed", () => {
    void sync();
  });
  const current = sessions.find((s) => s.id === id);
  if (!id)
    return (
      <div className="p-4 space-y-3">
        <p>
          Browsers for this thread. Each session stays on its selected machine.
        </p>
        {error && <p role="alert">{error}</p>}
        {!sessions.length && (
          <p>No browser sessions yet. Ask the agent to open a page.</p>
        )}
        {sessions.map((s) => (
          <Button
            key={s.id}
            variant="outline"
            onClick={() =>
              nav.openThreadPanel({
                actionId: "live",
                params: { id: s.id },
                title: browserTitle(s),
              })
            }
          >
            {s.hostLabel} · {s.mode} · {s.url} · {s.status}
          </Button>
        ))}
      </div>
    );
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-2 text-sm">
        <span>
          {current ? `${current.hostLabel} · ${current.mode} · ${id}` : id}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            nav.openThreadPanel({ actionId: "live", title: "Browsers" })
          }
        >
          All sessions
        </Button>
        {current && ["error", "released"].includes(current.status) && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const r = await rpc.call("reconnect", { id });
                nav.openThreadPanel({
                  actionId: "live",
                  params: { id: r.session.id },
                  title: browserTitle(r.session),
                });
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Reconnect
          </Button>
        )}
        {error && <span role="alert">{error}</span>}
      </div>
      <iframe
        title="Live browser"
        className="min-h-0 w-full flex-1 border-0 bg-black"
        src={`/api/v1/plugins/browse/http/viewer?id=${encodeURIComponent(id)}`}
      />
    </div>
  );
}

function browserTitle(s: Pick<Session, "url" | "hostLabel">) {
  let title = "Browser";
  try {
    title = new URL(s.url).hostname || title;
  } catch {}
  return s.hostLabel ? `${title} · ${s.hostLabel}` : title;
}
function AutoShowBrowsers() {
  const { threadId } = useBbContext();
  const nav = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const opened = useRef(new Set<string>());
  const activeThread = useRef(threadId);
  activeThread.current = threadId;
  const sync = useCallback(
    async (revealId?: string) => {
      if (!threadId) return;
      try {
        const sessions = await rpc.call("list", { threadId });
        if (activeThread.current !== threadId) return;
        // Oldest first leaves the newly opened page selected. Routine refreshes
        // never steal focus from another session or reopen a user-closed tab.
        for (const s of [...sessions].reverse()) {
          if (
            revealId
              ? s.id !== revealId
              : !["ready", "connecting"].includes(s.status) ||
                opened.current.has(s.id)
          )
            continue;
          if (
            nav.openThreadPanel({
              actionId: "live",
              params: { id: s.id },
              title: browserTitle(s),
            })
          )
            opened.current.add(s.id);
        }
      } catch {
        /* Keep manual Browser launcher available after an RPC failure. */
      }
    },
    [nav, rpc, threadId],
  );
  useRealtime("browser-changed", () => {
    void sync();
  });
  useRealtime("browser-reveal", (payload) => {
    if (!payload || typeof payload !== "object") return;
    const event = payload as { threadId?: string; id?: string };
    if (event.threadId === threadId && event.id) void sync(event.id);
  });
  useEffect(() => {
    void sync();
  }, [sync]);
  return null;
}
