import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { UsageSnapshot, rpcContract } from "../server";
import { createVisiblePoller } from "../lib/visible-poller.ts";

/** One last view. Survives hide/unmount without holding host payloads. */
let lastUsage: UsageSnapshot | null = null;
let forceRefresh = false;

function stillFresh(snapshot: UsageSnapshot): boolean {
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return false;
  return Date.now() - fetchedAt < snapshot.refreshIntervalMs;
}

export function useFleetSnapshot() {
  const rpc = useRpc<typeof rpcContract>();
  const container = useRef<HTMLDivElement>(null);
  const pollerRef = useRef<ReturnType<typeof createVisiblePoller<UsageSnapshot>> | null>(null);
  const pending = useRef(0);
  const queued = useRef(0);
  const [active, setActive] = useState(false);
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(lastUsage);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    let alive = true;
    async function getUsage(force: boolean) {
      pending.current += 1;
      setReloading(true);
      try {
        return await rpc.call("getUsage", force ? { force: true } : {});
      } finally {
        pending.current = Math.max(0, pending.current - 1);
        if (force) queued.current = 0;
        if (alive && pending.current === 0 && queued.current === 0) setReloading(false);
      }
    }

    if (lastUsage === null) {
      void getUsage(false).then((next) => {
        if (!alive) return;
        if (lastUsage === null) {
          lastUsage = next;
          setSnapshot(next);
        }
        if (stillFresh(next)) return;
        return getUsage(true).then((fresh) => {
          if (!alive) return;
          lastUsage = fresh;
          setSnapshot(fresh);
        });
      }).catch(() => {});
    }

    const element = container.current;
    if (!element) return () => { alive = false; };

    let intersecting = false;
    let pageHidden = false;
    const poller = createVisiblePoller({
      async load() {
        const force = forceRefresh;
        forceRefresh = false;
        if (!force && lastUsage !== null && stillFresh(lastUsage)) return lastUsage;
        return getUsage(force);
      },
      receive(next) {
        lastUsage = next;
        setSnapshot(next);
        setError(null);
        if (!stillFresh(next)) {
          void getUsage(true).then((fresh) => {
            if (!alive) return;
            lastUsage = fresh;
            setSnapshot(fresh);
            setError(null);
          }).catch(() => {});
        }
      },
      error(cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      },
      clear() {
        setError(null);
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
      alive = false;
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
      if (pollerRef.current === null) return;
      forceRefresh = true;
      if (pollerRef.current.refresh() !== true) return;
      queued.current += 1;
      setReloading(true);
    },
  };
}
