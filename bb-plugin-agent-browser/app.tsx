import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  experimental_Icon as Icon,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, health, Job } from "./src/contracts";
import type { z } from "zod";
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
      name: "Agent Browser",
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
          Also from the CLI: <code>bb agent-browser probe</code> and{" "}
          <code>bb agent-browser setup</code>.
        </p>
      </div>
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "browse-settings",
    component: BrowseSettings,
  });
});
