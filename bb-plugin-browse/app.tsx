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
import { browseLink } from "./src/link-routing";
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
      name: "Stagehand engine",
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
  app.contentScripts.register({
    id: "hide-native-browser-launcher",
    mount() {
      // BB's launcher slots are additive. Scope this presentation override to
      // the core action's stable id, including its sortable row/drag handle.
      const style = document.createElement("style");
      style.dataset.browseNativeLauncher = "hidden";
      style.textContent = `
        #file-search-result-open-browser,
        div:has(> button#file-search-result-open-browser) { display: none !important; }
      `;
      document.head.append(style);
      return () => style.remove();
    },
  });
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
    title: "Open browser",
    icon: "Globe",
    layout: "flush",
    component: LiveBrowser,
    run: ({ openPanel }) => { openPanel({ title: "Browser", params: {} }); },
  });
  app.slots.experimental_threadHeaderAction({
    id: "auto-show",
    title: "Browser sessions",
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
  const [address, setAddress] = useState("");
  const [opening, setOpening] = useState(false);
  const launching = useRef(false);
  async function openAddress() {
    if (launching.current) return;
    launching.current = true;
    setOpening(true);
    setError("");
    try {
      const text = address.trim();
      const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("Enter an http or https address without login details.");
      const result = await rpc.call("start", { threadId, mode: "managed", url: url.href });
      await sync();
      if (!nav.openThreadPanel({ actionId: "live", params: { id: result.session.id }, title: browserTitle(result.session) }))
        throw new Error("Browser started. Select its session below to open it.");
    } catch (e) { setError(String(e)); }
    finally { launching.current = false; setOpening(false); }
  }
  const current = sessions.find((s) => s.id === id);
  if (!id)
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <form aria-label="Browser navigation" className="flex shrink-0 items-center gap-1 border-b px-3 py-2" onSubmit={(event) => { event.preventDefault(); void openAddress(); }}>
          <Button type="button" variant="ghost" size="icon" aria-label="Back" disabled><Icon name="ArrowLeft" className="size-4" /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Forward" disabled><Icon name="ArrowRight" className="size-4" /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Refresh sessions" onClick={() => void sync()}><Icon name="RefreshCw" className="size-4" /></Button>
          <input
            aria-label="Website address"
            className="min-w-0 flex-1 rounded-md bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Enter URL"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <Button type="submit" variant="ghost" size="icon" aria-label={opening ? "Opening" : "Go"} disabled={opening || !address.trim()}><Icon name="ArrowRight" className="size-4" /></Button>
        </form>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-12">
            {error && <p role="alert" className="mb-4 text-sm">{error}</p>}
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-muted-foreground"><Icon name="History" className="size-4" />Sessions</h2>
            {!sessions.length && <p className="text-sm text-muted-foreground">No sessions yet.</p>}
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button type="button" className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={async () => {
                    try {
                      const target = ["released", "error"].includes(s.status) ? (await rpc.call("reconnect", { id: s.id })).session : s;
                      nav.openThreadPanel({ actionId: "live", params: { id: target.id }, title: browserTitle(target) });
                    } catch (e) { setError(String(e)); }
                  }}>
                    <Icon name="Globe" className="size-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{browserTitle(s)}</span><span className="block truncate text-xs text-muted-foreground">{s.url}</span></span>
                    <span className="shrink-0 text-xs text-muted-foreground">{s.hostLabel} · {s.status === "released" ? "Closed" : s.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-2 text-sm">
        <span>
          {current ? `${current.hostLabel} · ${id}` : id}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            nav.openThreadPanel({ actionId: "live", params: {}, title: "Browsers" })
          }
        >
          All sessions
        </Button>
        {current?.mode === "native" && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const result = await rpc.call("start", {
                  threadId,
                  hostId: current.hostId,
                  mode: "managed",
                  url: current.url,
                  newTab: true,
                });
                nav.openThreadPanel({
                  actionId: "live",
                  params: { id: result.session.id },
                  title: browserTitle(result.session),
                });
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Open in Browse on {current.hostLabel}
          </Button>
        )}
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

function browserTitle(s: Pick<Session, "url">) {
  let title = "Browser";
  try {
    title = new URL(s.url).hostname || title;
  } catch {}
  return title;
}
function AutoShowBrowsers({ threadId }: { threadId: string }) {
  const { threadId: selectedThreadId } = useBbContext();
  const nav = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [linkState, setLinkState] = useState<{
    url: string;
    error?: string;
  } | null>(null);
  const pendingLinks = useRef(new Set<string>());
  const opened = useRef(new Set<string>());
  const activeThread = useRef(threadId);
  activeThread.current = threadId;
  const openLink = useCallback(
    async (url: string) => {
      if (!threadId) return;
      const key = `${threadId}:${url}`;
      if (pendingLinks.current.has(key)) return;
      pendingLinks.current.add(key);
      setLinkState({ url });
      try {
        const result = await rpc.call("start", {
          threadId,
          mode: "managed",
          url,
        });
        if (activeThread.current !== threadId) return;
        if (
          !nav.openThreadPanel({
            actionId: "live",
            params: { id: result.session.id },
            title: browserTitle(result.session),
          })
        ) {
          throw new Error(
            "Browser started. Open Browser from the new-tab menu to view this session.",
          );
        }
        opened.current.add(result.session.id);
        setLinkState((state) => (state?.url === url ? null : state));
      } catch (error) {
        if (activeThread.current === threadId)
          setLinkState({ url, error: String(error) });
      } finally {
        pendingLinks.current.delete(key);
      }
    },
    [threadId, rpc, nav],
  );
  useEffect(() => {
    setLinkState(null);
    if (!threadId || selectedThreadId !== threadId) return;
    const routeLauncher = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      nav.openThreadPanel({ actionId: "live", params: {}, title: "Browser" });
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("#file-search-result-open-browser") ||
          (event.key === "Enter" && target?.getAttribute("aria-activedescendant") === "file-search-result-open-browser"))
        routeLauncher(event);
    };
    const click = (event: MouseEvent) => {
      if (event.composedPath().some(node => node instanceof Element && node.id === "file-search-result-open-browser")) {
        routeLauncher(event);
        return;
      }
      const url = browseLink(event, window.location);
      if (!url) return;
      event.preventDefault();
      event.stopPropagation();
      void openLink(url);
    };
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", keydown, true);
    };
  }, [threadId, selectedThreadId, openLink, nav]);
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
  return linkState ? (
    <div
      role={linkState.error ? "alert" : "status"}
      className="fixed bottom-4 right-4 z-50 max-w-md rounded-md border bg-background p-3 text-sm shadow-lg"
    >
      <p>{linkState.error || "Opening in Browser…"}</p>
      {linkState.error && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openLink(linkState.url)}
        >
          Retry
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => setLinkState(null)}>
        Dismiss
      </Button>
    </div>
  ) : null;
}
