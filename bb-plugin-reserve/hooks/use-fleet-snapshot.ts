import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { FleetSnapshot, rpcContract } from "../server";
import { createVisiblePoller } from "../lib/visible-poller.ts";

export function useFleetSnapshot() {
  const rpc = useRpc<typeof rpcContract>();
  const container = useRef<HTMLDivElement>(null);
  const pollerRef = useRef<ReturnType<typeof createVisiblePoller<FleetSnapshot>> | null>(null);
  const manualReload = useRef(false);
  const [active, setActive] = useState(false);
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let intersecting = false;
    let pageHidden = false;
    const finishManual = () => {
      if (!manualReload.current) return;
      manualReload.current = false;
      setReloading(false);
    };
    const poller = createVisiblePoller({
      load: () => rpc.call("getFleet", null),
      receive(next) {
        setSnapshot(next);
        setError(null);
        finishManual();
      },
      error(cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        finishManual();
      },
      clear() {
        setSnapshot(null);
        setError(null);
        finishManual();
      },
      intervalMs: (next) => next.refreshIntervalMs,
    });
    pollerRef.current = poller;
    const update = () => {
      const visible = intersecting && !pageHidden && document.visibilityState === "visible" && element.getClientRects().length > 0;
      poller.setActive(visible);
      setActive(visible);
    };
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;
      update();
    });
    const hide = () => { pageHidden = true; update(); };
    const show = () => { pageHidden = false; update(); };
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      poller.dispose();
      pollerRef.current = null;
    };
  }, [rpc]);

  return {
    container,
    active,
    snapshot,
    error,
    reloading,
    reload() {
      if (pollerRef.current?.refresh() !== true) return;
      manualReload.current = true;
      setReloading(true);
    },
  };
}
